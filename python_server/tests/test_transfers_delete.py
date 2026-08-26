import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.transfers import delete_transfer


class FakeResult:
    def __init__(self, rows=None, row_count=None):
        self.rows = rows or []
        self.row_count = row_count


def _transfer_row(transfer_uuid, transfer_ref, matter_id=None, property_id=None):
    return FakeResult(
        rows=[{
            "id": transfer_uuid,
            "transfer_id": transfer_ref,
            "matter_id": matter_id,
            "property_id": property_id,
        }],
        row_count=1,
    )


def _matter_count(count):
    return FakeResult(rows=[{"count": count}], row_count=1)


def _matter_row(matter_id, source_record_id, matter_type="transfer"):
    return FakeResult(
        rows=[{
            "id": matter_id,
            "matter_type": matter_type,
            "source_record_id": source_record_id,
        }],
        row_count=1,
    )


def _count(value):
    return FakeResult(rows=[{"count": value}], row_count=1)


def _property_row(created_for_transfer_id=None):
    return FakeResult(
        rows=[{"created_for_transfer_id": created_for_transfer_id}],
        row_count=1,
    )


class FakeDB:
    def __init__(self, results, fail_on=None):
        self.results = list(results)
        self.calls = []
        self.fail_on = fail_on or []

    async def query(self, text, params, *, connection=None):
        self.calls.append((text, params))
        for substring in self.fail_on:
            if substring in text:
                raise RuntimeError(f"Simulated SQL failure: {text}")
        return self.results.pop(0)


async def fake_with_transaction(callback):
    return await callback(None)


def _with_matter_blocking(count=1, source_record_id="uuid-1", property_id=None, fail_on=None):
    """Return a FakeDB result list for a transfer whose matter is found and all guards pass."""
    return FakeDB([
        _transfer_row("uuid-1", "TRF-2026-123456", None, property_id),
        FakeResult(row_count=1),  # DELETE transfers
        _matter_count(count),
        _matter_row("matter-1", source_record_id),
        _count(0),  # other transfers referencing matter
        _count(0),  # bonds
        _count(0),  # clearance_records
        _count(0),  # compliance_certificates
        _count(0),  # fica_verifications
        _count(0),  # matter_accounts
        _count(0),  # matter_parties
        _count(0),  # parties
    ] + ([] if fail_on else [FakeResult(row_count=1)]), fail_on=fail_on)  # DELETE matters


class TransferDeleteTests(unittest.IsolatedAsyncioTestCase):
    TRANSFER_UUID = "uuid-1"
    TRANSFER_REF = "TRF-2026-123456"
    MATTER_ID = "matter-1"
    PROPERTY_ID = "prop-1"

    async def _delete(self, db, transfer_id=TRANSFER_REF):
        with patch("routers.transfers.query", new=db.query):
            with patch("routers.transfers.with_transaction", new=fake_with_transaction):
                return await delete_transfer(transfer_id)

    async def test_matter_found_via_source_record_id_is_deleted(self):
        db = _with_matter_blocking(count=1, source_record_id=self.TRANSFER_UUID, property_id=None)

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertTrue(any("DELETE FROM matters" in q for q in queries))
        # Lookup is based on source_record_id, not matter_id.
        self.assertTrue(any("source_record_id" in q and "matters" in q for q in queries))

    async def test_mismatching_source_record_id_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, None),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_count(1),
            _matter_row(self.MATTER_ID, "OTHER-UUID"),
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)

    async def test_unrelated_matter_is_never_deleted(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, None),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_count(0),
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)

    async def test_duplicate_source_record_id_retains_matters(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, None),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_count(2),  # ambiguous duplicate matter relationship
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)

    async def test_matter_shared_by_another_transfer_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, None),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_count(1),
            _matter_row(self.MATTER_ID, self.TRANSFER_UUID),
            _count(1),  # another transfer still references this matter
            _count(0),
            _count(0),
            _count(0),
            _count(0),
            _count(0),
            _count(0),
            _count(0),
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)

    async def test_matter_with_blocking_child_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, None),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_count(1),
            _matter_row(self.MATTER_ID, self.TRANSFER_UUID),
            _count(0),  # other transfers
            _count(1),  # bonds block matter deletion
            _count(0),
            _count(0),
            _count(0),
            _count(0),
            _count(0),
            _count(0),
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)

    async def test_property_unshared_and_auto_created_is_deleted(self):
        db = _with_matter_blocking(count=1, source_record_id=self.TRANSFER_UUID, property_id=self.PROPERTY_ID)
        # append property sequence after the matter deletion result
        db.results.extend([
            _property_row(self.TRANSFER_REF),
            _count(0),
            _count(0),
            _count(0),
            _count(0),
            FakeResult(row_count=1),  # DELETE properties
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertTrue(any("DELETE FROM properties" in q for q in queries))

    async def test_property_still_referenced_is_preserved(self):
        db = _with_matter_blocking(count=1, source_record_id=self.TRANSFER_UUID, property_id=self.PROPERTY_ID)
        db.results.extend([
            _property_row(self.TRANSFER_REF),
            _count(0),
            _count(1),  # another matter still references this property
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM properties", queries)

    async def test_transaction_rollback_on_downstream_sql_failure(self):
        db = _with_matter_blocking(count=1, source_record_id=self.TRANSFER_UUID, fail_on=["DELETE FROM matters"])

        with self.assertRaises(RuntimeError):
            await self._delete(db)

        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM properties", queries)

    async def test_unknown_transfer_returns_404(self):
        db = FakeDB([
            FakeResult(rows=[], row_count=0),
        ])

        with patch("routers.transfers.query", new=db.query):
            with patch("routers.transfers.with_transaction", new=fake_with_transaction):
                result = await delete_transfer("TRF-UNKNOWN")

        self.assertEqual(getattr(result, "status_code", None), 404)
        body = getattr(result, "body", b"")
        self.assertIn(b"Transfer not found", body)


if __name__ == "__main__":
    unittest.main()
