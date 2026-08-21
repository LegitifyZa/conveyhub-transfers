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


def _matter_row(matter_type="transfer", source_record_id="TRF-2026-123456"):
    return FakeResult(
        rows=[{
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
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    async def query(self, text, params, *, connection=None):
        self.calls.append((text, params))
        return self.results.pop(0)


async def fake_with_transaction(callback):
    return await callback(None)


class TransferDeleteTests(unittest.IsolatedAsyncioTestCase):
    TRANSFER_UUID = "uuid-1"
    TRANSFER_REF = "TRF-2026-123456"
    MATTER_ID = "matter-1"
    PROPERTY_ID = "prop-1"

    async def _delete(self, db, transfer_id=TRANSFER_REF):
        with patch("routers.transfers.query", new=db.query):
            with patch("routers.transfers.with_transaction", new=fake_with_transaction):
                return await delete_transfer(transfer_id)

    async def test_auto_created_matter_and_property_are_deleted(self):
        # Expected query sequence when both matter and property are deletable.
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, self.MATTER_ID, self.PROPERTY_ID),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_row(),
            _count(0),  # other transfers referencing matter
            _count(0),  # bonds
            _count(0),  # clearance_records
            _count(0),  # compliance_certificates
            _count(0),  # fica_verifications
            _count(0),  # matter_accounts
            _count(0),  # matter_parties
            _count(0),  # parties
            FakeResult(row_count=1),  # DELETE matters
            _property_row(self.TRANSFER_REF),
            _count(0),  # other transfers referencing property
            _count(0),  # matters referencing property
            _count(0),  # municipal_accounts
            _count(0),  # compliance_certificates
            FakeResult(row_count=1),  # DELETE properties
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertTrue(any("DELETE FROM matters" in q for q in queries))
        self.assertTrue(any("DELETE FROM properties" in q for q in queries))

    async def test_matter_shared_by_another_transfer_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, self.MATTER_ID, self.PROPERTY_ID),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_row(),
            _count(1),  # another transfer still references this matter
            _count(0),  # bonds
            _count(0),  # clearance_records
            _count(0),  # compliance_certificates
            _count(0),  # fica_verifications
            _count(0),  # matter_accounts
            _count(0),  # matter_parties
            _count(0),  # parties
            _property_row(self.TRANSFER_REF),
            _count(0),  # other transfers referencing property
            _count(0),  # matters referencing property
            _count(0),  # municipal_accounts
            _count(0),  # compliance_certificates
            FakeResult(row_count=1),  # DELETE properties
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertFalse(any("DELETE FROM matters" in q for q in queries))
        self.assertTrue(any("DELETE FROM properties" in q for q in queries))

    async def test_matter_with_blocking_child_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, self.MATTER_ID, self.PROPERTY_ID),
            FakeResult(row_count=1),  # DELETE transfers
            _matter_row(),
            _count(0),  # other transfers
            _count(1),  # bonds block matter deletion
            _property_row(self.TRANSFER_REF),
            _count(0),  # other transfers referencing property
            _count(0),  # matters referencing property
            _count(0),  # municipal_accounts
            _count(0),  # compliance_certificates
            FakeResult(row_count=1),  # DELETE properties
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)

    async def test_null_created_for_transfer_id_preserves_property(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, self.PROPERTY_ID),
            FakeResult(row_count=1),  # DELETE transfers
            _property_row(None),
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM matters", queries)
        self.assertNotIn("DELETE FROM properties", queries)

    async def test_property_marker_for_other_transfer_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, self.PROPERTY_ID),
            FakeResult(row_count=1),  # DELETE transfers
            _property_row("TRF-OTHER-999"),
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
        queries = [c[0] for c in db.calls]
        self.assertNotIn("DELETE FROM properties", queries)

    async def test_property_still_referenced_is_preserved(self):
        db = FakeDB([
            _transfer_row(self.TRANSFER_UUID, self.TRANSFER_REF, None, self.PROPERTY_ID),
            FakeResult(row_count=1),  # DELETE transfers
            _property_row(self.TRANSFER_REF),
            _count(0),  # other transfers
            _count(1),  # another matter still references this property
        ])

        result = await self._delete(db)

        self.assertEqual(result["success"], True)
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
