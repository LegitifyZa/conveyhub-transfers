import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import query as db_query
import python_server.routers.transfers as legacy_transfers
import tests.db_test_utils as db_test_utils


def _decode(response):
    if isinstance(response, dict):
        return response
    payload = response.body
    if isinstance(payload, bytes):
        payload = payload.decode()
    return json.loads(payload)


def _unique_address():
    import uuid
    return f"{uuid.uuid4().hex[:8]} Authority Street, Cape Town"


def _create_body(status=None):
    body = {
        "property": {
            "address": _unique_address(),
            "city": "Cape Town",
            "province": "Western Cape",
            "country": "South Africa",
        },
        "purchasePrice": 1500000,
        "parties": [
            {"name": "Buyer Test", "type": "buyer"},
            {"name": "Seller Test", "type": "seller"},
        ],
    }
    if status is not None:
        body["status"] = status
    return body


class TransferStatusAuthorityTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        db_test_utils.require_test_database()
        os.environ["DB_SCHEMA"] = "transfers"
        os.environ["LEGACY_ACCOUNTABLE_INSTITUTION_ID"] = "5"

    async def asyncSetUp(self):
        from db import close_pool, get_pool
        from config import load_settings

        await close_pool()
        await get_pool(load_settings())

    async def asyncTearDown(self):
        from db import close_pool

        await close_pool()

    async def _run_with_rollback(self, logic):
        async def _tx(conn):
            original_with_transaction = legacy_transfers.with_transaction
            original_query = legacy_transfers.query

            async def _rollback_transaction(callback):
                return await callback(conn)

            async def _query(text, params=None, connection=None):
                return await db_query(text, params, connection=connection or conn)

            legacy_transfers.with_transaction = _rollback_transaction
            legacy_transfers.query = _query
            try:
                return await logic(conn)
            finally:
                legacy_transfers.with_transaction = original_with_transaction
                legacy_transfers.query = original_query

        return await db_test_utils.with_test_transaction(_tx)

    async def _create_and_get_transfer_id(self, conn, status=None):
        response = await legacy_transfers.create_transfer(_create_body(status))
        data = _decode(response)
        self.assertTrue(data["success"], data)
        return data["data"]["transferId"], data["data"]["id"]

    async def test_create_defaults_to_in_progress(self):
        async def _logic(conn):
            data = _decode(await legacy_transfers.create_transfer(_create_body()))
            self.assertTrue(data["success"])
            self.assertEqual(data["data"]["status"], "in_progress")

        await self._run_with_rollback(_logic)

    async def test_create_ignores_complete_in_request(self):
        async def _logic(conn):
            data = _decode(await legacy_transfers.create_transfer(_create_body("complete")))
            self.assertTrue(data["success"])
            self.assertEqual(data["data"]["status"], "in_progress")

        await self._run_with_rollback(_logic)

    async def test_create_ignores_invalid_legacy_statuses(self):
        for status in ("draft", "completed", "cancelled"):
            with self.subTest(status=status):
                async def _logic(conn, status=status):
                    data = _decode(await legacy_transfers.create_transfer(_create_body(status)))
                    self.assertTrue(data["success"])
                    self.assertEqual(data["data"]["status"], "in_progress")

                await self._run_with_rollback(_logic)

    async def test_update_accepts_only_in_progress_and_complete(self):
        async def _logic(conn):
            transfer_id, transfer_uuid = await self._create_and_get_transfer_id(conn)

            for invalid_status in ("draft", "completed", "cancelled"):
                data = _decode(await legacy_transfers.update_transfer(transfer_id, {"status": invalid_status}))
                self.assertTrue(data["success"])
                self.assertEqual(data["data"]["status"], "in_progress")

            data = _decode(await legacy_transfers.update_transfer(transfer_id, {"status": "complete"}))
            self.assertTrue(data["success"])
            self.assertEqual(data["data"]["status"], "complete")

            data = _decode(await legacy_transfers.update_transfer(transfer_id, {"status": "in_progress"}))
            self.assertTrue(data["success"])
            self.assertEqual(data["data"]["status"], "in_progress")

        await self._run_with_rollback(_logic)

    async def test_detail_uses_persisted_status_not_milestone_override(self):
        async def _logic(conn):
            transfer_id, transfer_uuid = await self._create_and_get_transfer_id(conn)

            matter = await db_query(
                "SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' LIMIT 1",
                [transfer_uuid],
                connection=conn,
            )
            matter_id = matter.rows[0]["id"]
            await db_query(
                "UPDATE matter_milestones SET status = 'completed' WHERE matter_id = $1",
                [matter_id],
                connection=conn,
            )

            data = _decode(await legacy_transfers.get_transfer(transfer_id))
            self.assertTrue(data["success"])
            self.assertEqual(data["data"]["status"], "in_progress")

            _decode(await legacy_transfers.update_transfer(transfer_id, {"status": "complete"}))
            data = _decode(await legacy_transfers.get_transfer(transfer_id))
            self.assertTrue(data["success"])
            self.assertEqual(data["data"]["status"], "complete")

        await self._run_with_rollback(_logic)

    async def test_milestone_completed_remains_valid(self):
        async def _logic(conn):
            _, transfer_uuid = await self._create_and_get_transfer_id(conn)
            matter = await db_query(
                "SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' LIMIT 1",
                [transfer_uuid],
                connection=conn,
            )
            matter_id = matter.rows[0]["id"]
            await db_query(
                "UPDATE matter_milestones SET status = 'completed' WHERE matter_id = $1",
                [matter_id],
                connection=conn,
            )
            completed = await db_query(
                "SELECT COUNT(*) AS n FROM matter_milestones WHERE matter_id = $1 AND status = 'completed'",
                [matter_id],
                connection=conn,
            )
            self.assertGreater(completed.rows[0]["n"], 0)

        await self._run_with_rollback(_logic)

    async def test_dashboard_counts_use_persisted_status(self):
        async def _logic(conn):
            before = _decode(await legacy_transfers.transfer_stats())
            in_progress_before = before["data"]["in_progress"]

            transfer_id, _ = await self._create_and_get_transfer_id(conn)

            after_create = _decode(await legacy_transfers.transfer_stats())
            self.assertEqual(after_create["data"]["in_progress"], in_progress_before + 1)

            _decode(await legacy_transfers.update_transfer(transfer_id, {"status": "complete"}))
            after_complete = _decode(await legacy_transfers.transfer_stats())
            self.assertEqual(after_complete["data"]["in_progress"], in_progress_before)
            self.assertEqual(after_complete["data"]["complete"], before["data"]["complete"] + 1)

        await self._run_with_rollback(_logic)

    async def test_list_mapping_uses_persisted_status(self):
        from starlette.requests import Request

        async def _logic(conn):
            transfer_id, transfer_uuid = await self._create_and_get_transfer_id(conn)

            matter = await db_query(
                "SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' LIMIT 1",
                [transfer_uuid],
                connection=conn,
            )
            matter_id = matter.rows[0]["id"]
            await db_query(
                "UPDATE matter_milestones SET status = 'completed' WHERE matter_id = $1",
                [matter_id],
                connection=conn,
            )

            request = Request({"type": "http", "method": "GET", "query_string": b""})
            result = await legacy_transfers.list_transfers(request)
            for row in result["data"]:
                if str(row["id"]) == transfer_uuid:
                    self.assertEqual(row["status"], "in_progress")
                    return
            self.fail("Created transfer not found in list result")

        await self._run_with_rollback(_logic)
