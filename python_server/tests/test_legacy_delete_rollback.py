import datetime
import json
import os
import sys
import uuid
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import load_settings
from db import get_pool, query as db_query, close_pool
import python_server.routers.transfers as legacy_transfers


os.environ.setdefault(
    "POSTGRES_URL",
    "postgresql://neondb_owner:npg_AqGWzru6MpZ7@ep-odd-shape-aw1ky0rb.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
)
os.environ["DB_SCHEMA"] = "transfers"


def _now():
    return datetime.datetime.now()


def _now_aware():
    return datetime.datetime.now(datetime.timezone.utc)


async def _with_rollback(callback):
    """Run a callback inside a transaction that is always rolled back."""
    pool = await get_pool(load_settings())
    async with pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            return await callback(conn)
        finally:
            await tx.rollback()


async def _create_transfer(conn):
    """Use the legacy create endpoint to produce a realistic transfer/matter/property set."""
    original_with_transaction = legacy_transfers.with_transaction
    original_query = legacy_transfers.query

    async def _rollback_transaction(callback):
        return await callback(conn)

    try:
        legacy_transfers.with_transaction = _rollback_transaction
        legacy_transfers.query = db_query
        os.environ["LEGACY_ACCOUNTABLE_INSTITUTION_ID"] = "5"
        body = {
            "property": {
                "address": f"Test Street {uuid.uuid4().hex[:8]}",
                "city": "Cape Town",
                "province": "Western Cape",
                "country": "South Africa",
            },
            "purchasePrice": 1000000,
            "parties": [
                {"name": "Buyer Test", "type": "buyer"},
                {"name": "Seller Test", "type": "seller"},
            ],
        }
        result = await legacy_transfers.create_transfer(body)
    finally:
        legacy_transfers.with_transaction = original_with_transaction
        legacy_transfers.query = original_query
        os.environ.pop("LEGACY_ACCOUNTABLE_INSTITUTION_ID", None)

    if hasattr(result, "body"):
        result = json.loads(result.body)
    transfer = result["data"]
    matter = await db_query(
        "SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer'",
        [transfer["id"]],
        connection=conn,
    )
    prop = await db_query(
        "SELECT id FROM properties WHERE created_for_transfer_id = $1",
        [transfer["transferId"]],
        connection=conn,
    )
    return {
        "id": transfer["id"],
        "transfer_id": transfer["transferId"],
        "matter_id": matter.rows[0]["id"] if matter.rows else None,
        "property_id": prop.rows[0]["id"] if prop.rows else None,
    }


async def _delete(conn, transfer_id):
    original_with_transaction = legacy_transfers.with_transaction
    original_query = legacy_transfers.query

    async def _rollback_transaction(callback):
        return await callback(conn)

    try:
        legacy_transfers.with_transaction = _rollback_transaction
        legacy_transfers.query = db_query
        return await legacy_transfers.delete_transfer(transfer_id)
    finally:
        legacy_transfers.with_transaction = original_with_transaction
        legacy_transfers.query = original_query


async def _insert_matter(conn, source_record_id, matter_type="transfer", property_id=None):
    matter_uuid = str(uuid.uuid4())
    ref = f"REF-{uuid.uuid4().hex[:8].upper()}"
    await db_query(
        """
        INSERT INTO matters (id, reference_number, matter_type, title, status, priority,
                             opened_date, source_record_id, property_id, metadata,
                             accountable_institution_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'draft', 'medium', '2026-01-01', $5, $6, '{}',
                5, $7, $7)
        """,
        [matter_uuid, ref, matter_type, f"Matter {ref}",
         source_record_id, property_id, _now_aware()],
        connection=conn,
    )
    return matter_uuid


async def _insert_bond(conn, matter_id):
    await db_query(
        """
        INSERT INTO bonds (id, matter_id, loan_amount, status, created_at, updated_at)
        VALUES ($1, $2, 0, 'pending', $3, $3)
        """,
        [str(uuid.uuid4()), matter_id, _now_aware()],
        connection=conn,
    )


class LegacyDeleteRollbackTests(unittest.IsolatedAsyncioTestCase):
    """Real database tests that run inside transactions that are always rolled back."""

    async def asyncTearDown(self):
        await close_pool()

    async def test_matter_and_milestones_deleted_via_source_record_id(self):
        async def _tx(conn):
            t = await _create_transfer(conn)
            self.assertIsNotNone(t["matter_id"])

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            t_check = await db_query("SELECT id FROM transfers WHERE id = $1", [t["id"]], connection=conn)
            m_check = await db_query("SELECT id FROM matters WHERE id = $1", [t["matter_id"]], connection=conn)
            ms_check = await db_query("SELECT id FROM matter_milestones WHERE matter_id = $1", [t["matter_id"]], connection=conn)
            self.assertEqual(len(t_check.rows), 0)
            self.assertEqual(len(m_check.rows), 0)
            self.assertEqual(len(ms_check.rows), 0)

        await _with_rollback(_tx)

    async def test_null_transfers_matter_id_still_cleans_matter(self):
        """Reproduces the Preview bug: legacy create does not set transfers.matter_id."""
        async def _tx(conn):
            t = await _create_transfer(conn)
            # Simulate the Preview shape explicitly.
            await db_query(
                "UPDATE transfers SET matter_id = NULL WHERE id = $1",
                [t["id"]],
                connection=conn,
            )

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            t_check = await db_query("SELECT id FROM transfers WHERE id = $1", [t["id"]], connection=conn)
            m_check = await db_query("SELECT id FROM matters WHERE id = $1", [t["matter_id"]], connection=conn)
            self.assertEqual(len(t_check.rows), 0)
            self.assertEqual(len(m_check.rows), 0)

        await _with_rollback(_tx)

    async def test_matter_with_mismatched_source_record_id_is_retained(self):
        async def _tx(conn):
            t = await _create_transfer(conn)
            # Point the matter at a different transfer identity.
            await db_query(
                "UPDATE matters SET source_record_id = $1 WHERE id = $2",
                ["other-transfer-uuid", t["matter_id"]],
                connection=conn,
            )

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            t_check = await db_query("SELECT id FROM transfers WHERE id = $1", [t["id"]], connection=conn)
            m_check = await db_query("SELECT id FROM matters WHERE id = $1", [t["matter_id"]], connection=conn)
            self.assertEqual(len(t_check.rows), 0)
            self.assertEqual(len(m_check.rows), 1)

        await _with_rollback(_tx)

    async def test_matter_with_wrong_type_is_retained(self):
        async def _tx(conn):
            t = await _create_transfer(conn)
            await db_query(
                "UPDATE matters SET matter_type = 'bond' WHERE id = $1",
                [t["matter_id"]],
                connection=conn,
            )

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            m_check = await db_query("SELECT id FROM matters WHERE id = $1", [t["matter_id"]], connection=conn)
            self.assertEqual(len(m_check.rows), 1)

        await _with_rollback(_tx)

    async def test_duplicate_source_record_ids_are_not_deleted(self):
        async def _tx(conn):
            t = await _create_transfer(conn)
            second_matter = await _insert_matter(conn, t["id"], matter_type="transfer")

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            m1 = await db_query("SELECT id FROM matters WHERE id = $1", [t["matter_id"]], connection=conn)
            m2 = await db_query("SELECT id FROM matters WHERE id = $1", [second_matter], connection=conn)
            self.assertEqual(len(m1.rows), 1)
            self.assertEqual(len(m2.rows), 1)

        await _with_rollback(_tx)

    async def test_matter_with_blocking_children_is_retained(self):
        async def _tx(conn):
            t = await _create_transfer(conn)
            await _insert_bond(conn, t["matter_id"])

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            m_check = await db_query("SELECT id FROM matters WHERE id = $1", [t["matter_id"]], connection=conn)
            self.assertEqual(len(m_check.rows), 1)

        await _with_rollback(_tx)

    async def test_unshared_property_created_for_transfer_is_deleted(self):
        async def _tx(conn):
            t = await _create_transfer(conn)

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            p_check = await db_query(
                "SELECT id FROM properties WHERE id = $1",
                [t["property_id"]],
                connection=conn,
            )
            self.assertEqual(len(p_check.rows), 0)

        await _with_rollback(_tx)

    async def test_shared_property_is_retained(self):
        async def _tx(conn):
            t1 = await _create_transfer(conn)
            t2 = await _create_transfer(conn)

            await db_query(
                "UPDATE transfers SET property_id = $1 WHERE id = $2",
                [t1["property_id"], t2["id"]],
                connection=conn,
            )
            await db_query(
                "UPDATE matters SET property_id = $1 WHERE id = $2",
                [t1["property_id"], t2["matter_id"]],
                connection=conn,
            )

            result = await _delete(conn, t1["transfer_id"])
            self.assertEqual(result["success"], True)

            p_check = await db_query(
                "SELECT id FROM properties WHERE id = $1",
                [t1["property_id"]],
                connection=conn,
            )
            self.assertEqual(len(p_check.rows), 1)

            m2 = await db_query("SELECT id FROM matters WHERE id = $1", [t2["matter_id"]], connection=conn)
            self.assertEqual(len(m2.rows), 1)

        await _with_rollback(_tx)

    async def test_property_without_created_for_transfer_marker_is_retained(self):
        async def _tx(conn):
            t = await _create_transfer(conn)
            await db_query(
                "UPDATE properties SET created_for_transfer_id = NULL WHERE id = $1",
                [t["property_id"]],
                connection=conn,
            )

            result = await _delete(conn, t["transfer_id"])
            self.assertEqual(result["success"], True)

            p_check = await db_query(
                "SELECT id FROM properties WHERE id = $1",
                [t["property_id"]],
                connection=conn,
            )
            self.assertEqual(len(p_check.rows), 1)

        await _with_rollback(_tx)

    async def test_transaction_rollback_on_downstream_sql_failure(self):
        """If a downstream delete fails, the whole operation must raise, not commit."""
        async def _tx(conn):
            t = await _create_transfer(conn)

            call_log = []

            async def _failing_query(text, params, *, connection=None):
                call_log.append(text)
                if "DELETE FROM matters" in text:
                    raise RuntimeError("Simulated matter delete failure")
                return await db_query(text, params, connection=connection or conn)

            async def _rollback_transaction(callback):
                return await callback(conn)

            original_query = legacy_transfers.query
            original_with_transaction = legacy_transfers.with_transaction
            legacy_transfers.query = _failing_query
            legacy_transfers.with_transaction = _rollback_transaction
            try:
                with self.assertRaises(RuntimeError):
                    await legacy_transfers.delete_transfer(t["transfer_id"])
            finally:
                legacy_transfers.query = original_query
                legacy_transfers.with_transaction = original_with_transaction

            self.assertFalse(any("DELETE FROM properties" in q for q in call_log))

        await _with_rollback(_tx)


if __name__ == "__main__":
    unittest.main()
