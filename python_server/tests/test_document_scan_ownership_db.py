"""PostgreSQL-backed concurrency tests for scan-attempt ownership.

Mocked UPDATE guards cannot establish the behaviour these tests cover: real
row-lock serialisation between concurrent claimants, lease-expiry reclaim
after worker failure, and refusal of a stale attempt's verdict.

Requires TEST_DATABASE_URL pointing at the isolated scratch database on the
deedly-documents-test branch (skipped otherwise). Fixture rows are committed
(rolled-back rows would be invisible to the second claimant's connection) and
deleted again in tearDown; migration 028's columns are applied idempotently.
"""

import asyncio
import hashlib
import os
import unittest
import uuid
from types import SimpleNamespace

PDF_BYTES = b"%PDF-1.4 pg-ownership-test"
AI = 5
FOREIGN_AI = 6

MIGRATION_028 = os.path.join(
    "src", "lib", "migrations", "028_deedly_document_scan_attempt_ownership.sql"
)


def _repo_root() -> str:
    return os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )


def _migration_sql() -> str:
    path = os.path.join(_repo_root(), MIGRATION_028)
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    # The pool already pins search_path; SET LOCAL would warn outside a tx.
    return "\n".join(
        line
        for line in lines
        if line.strip().upper() not in ("BEGIN;", "COMMIT;")
        and not line.strip().upper().startswith("SET LOCAL")
    )


class _DictStorage:
    def __init__(self):
        self.objects = {}

    def put(self, key, data, content_type):
        self.objects[key] = data

    def get(self, key):
        return self.objects[key]


class _SlowScanner:
    """Scanner double with a yield so a concurrent claimant overlaps the
    in-flight attempt deterministically."""

    def __init__(self, status="clean", signature=None):
        from services.document_scanner import ScanResult

        self.result = ScanResult(status=status, signature=signature)
        self.calls = 0

    async def scan(self, data):
        self.calls += 1
        await asyncio.sleep(0.25)
        return self.result


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class ScanOwnershipConcurrencyDbTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        import tests.db_test_utils as db_test_utils

        db_test_utils.require_test_database()

    async def asyncSetUp(self):
        import tests.db_test_utils as db_test_utils
        from db import close_pool

        await close_pool()
        self.pool = await db_test_utils.get_test_pool()
        # Migration 028 columns — applied idempotently to the scratch DB.
        await self.pool.execute(_migration_sql())

        self.user = SimpleNamespace(user_id=7)
        self.storage = _DictStorage()
        self.transfer_id = uuid.uuid4()
        self.doc_id = uuid.uuid4()
        self.storage_key = f"pg-ownership/{self.doc_id}"
        await self.pool.execute(
            """
            INSERT INTO transfers.transfers
                (id, transfer_id, property_address, purchase_price, status,
                 accountable_institution_id)
            VALUES ($1, $2, '1 Ownership Lane', 1000, 'in_progress', $3)
            """,
            self.transfer_id,
            f"TRF-PG-{self.transfer_id.hex[:12]}",
            AI,
        )

    async def asyncTearDown(self):
        from db import close_pool

        await self.pool.execute(
            "DELETE FROM transfers.document_operation_log WHERE document_id = $1",
            str(self.doc_id),
        )
        await self.pool.execute(
            "DELETE FROM transfers.transfer_documents WHERE id = $1", self.doc_id
        )
        await self.pool.execute(
            "DELETE FROM transfers.transfers WHERE id = $1", self.transfer_id
        )
        await close_pool()

    async def _insert_document(self, **overrides):
        row = {
            "status": "pending",
            "scan_status": "error",
            "scan_result": "ScannerUnavailableError",
            "storage_key": self.storage_key,
            "sha256": hashlib.sha256(PDF_BYTES).hexdigest(),
            "file_instance_id": uuid.uuid4(),
            "file_type": "application/pdf",
            "original_file_name": "pg.pdf",
            "file_size": len(PDF_BYTES),
            "ai": AI,
        }
        row.update(overrides)
        await self.pool.execute(
            """
            INSERT INTO transfers.transfer_documents
                (id, transfer_id, name, status, scan_status, scan_result,
                 storage_key, sha256, file_instance_id, file_type,
                 original_file_name, file_size, accountable_institution_id)
            VALUES ($1, $2, 'PG ownership doc', $3, $4, $5,
                    $6, $7, $8, $9, $10, $11, $12)
            """,
            self.doc_id,
            self.transfer_id,
            row["status"],
            row["scan_status"],
            row["scan_result"],
            row["storage_key"],
            row["sha256"],
            row["file_instance_id"],
            row["file_type"],
            row["original_file_name"],
            row["file_size"],
            row["ai"],
        )

    async def _doc(self):
        return dict(
            await self.pool.fetchrow(
                "SELECT * FROM transfers.transfer_documents WHERE id = $1",
                self.doc_id,
            )
        )

    async def _transfer(self):
        return dict(
            await self.pool.fetchrow(
                "SELECT * FROM transfers.transfers WHERE id = $1", self.transfer_id
            )
        )

    async def test_concurrent_rescans_launch_a_single_scan(self):
        from services import matter_document_service as svc

        await self._insert_document()
        self.storage.objects[self.storage_key] = PDF_BYTES
        transfer, doc = await self._transfer(), await self._doc()

        scanner_a, scanner_b = _SlowScanner(), _SlowScanner()
        res_a, res_b = await asyncio.gather(
            svc.rescan_document_file(
                transfer, doc, storage=self.storage, scanner=scanner_a, user=self.user
            ),
            svc.rescan_document_file(
                transfer, doc, storage=self.storage, scanner=scanner_b, user=self.user
            ),
        )

        # Exactly one attempt owned the scan; the loser reported the current
        # state without scanning.
        self.assertEqual(scanner_a.calls + scanner_b.calls, 1)
        outcomes = sorted([res_a[1], res_b[1]])
        self.assertIn("uploaded", outcomes)
        self.assertTrue(
            set(outcomes) <= {"uploaded", "scan_pending", "replay"}, outcomes
        )
        final = await self._doc()
        self.assertEqual(final["scan_status"], "clean")
        self.assertEqual(final["status"], "uploaded")
        self.assertIsNone(final["scan_attempt_id"])

    async def test_expired_lease_is_reclaimable(self):
        from services import matter_document_service as svc

        await self._insert_document(scan_status="pending", scan_result=None)
        dead_attempt = uuid.uuid4()
        await self.pool.execute(
            """
            UPDATE transfers.transfer_documents
            SET scan_attempt_id = $2,
                scan_attempt_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
            WHERE id = $1
            """,
            self.doc_id,
            dead_attempt,
        )
        self.storage.objects[self.storage_key] = PDF_BYTES
        transfer, doc = await self._transfer(), await self._doc()

        scanner = _SlowScanner()
        row, outcome = await svc.rescan_document_file(
            transfer, doc, storage=self.storage, scanner=scanner, user=self.user
        )

        # The dead worker's expired lease did not block recovery.
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(scanner.calls, 1)
        self.assertEqual(row["scan_status"], "clean")
        final = await self._doc()
        self.assertIsNone(final["scan_attempt_id"])

    async def test_live_attempt_blocks_second_rescan_and_download(self):
        from services import matter_document_service as svc

        await self._insert_document(scan_status="pending", scan_result=None)
        live_attempt = uuid.uuid4()
        await self.pool.execute(
            """
            UPDATE transfers.transfer_documents
            SET scan_attempt_id = $2,
                scan_attempt_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
            WHERE id = $1
            """,
            self.doc_id,
            live_attempt,
        )
        self.storage.objects[self.storage_key] = PDF_BYTES
        transfer, doc = await self._transfer(), await self._doc()

        scanner = _SlowScanner()
        row, outcome = await svc.rescan_document_file(
            transfer, doc, storage=self.storage, scanner=scanner, user=self.user
        )
        self.assertEqual(outcome, "scan_pending")
        self.assertEqual(scanner.calls, 0)
        # Unresolved attempt: still owned, still unavailable for download.
        self.assertEqual((await self._doc())["scan_attempt_id"], live_attempt)
        with self.assertRaises(svc.DocumentNotAvailableError):
            await svc.get_document_for_download(str(self.doc_id), AI)

    async def test_stale_attempt_cannot_publish_verdict(self):
        from services import matter_document_service as svc

        await self._insert_document(scan_status="pending", scan_result=None)
        stale_attempt = uuid.uuid4()
        await self.pool.execute(
            """
            UPDATE transfers.transfer_documents
            SET scan_attempt_id = $2,
                scan_attempt_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
            WHERE id = $1
            """,
            self.doc_id,
            stale_attempt,
        )
        self.storage.objects[self.storage_key] = PDF_BYTES
        transfer, doc = await self._transfer(), await self._doc()

        # Attempt B reclaims the expired lease and publishes its verdict.
        row, outcome = await svc.rescan_document_file(
            transfer, doc, storage=self.storage, scanner=_SlowScanner(), user=self.user
        )
        self.assertEqual(outcome, "uploaded")

        # Attempt A's delayed verdict — even 'infected' — is refused: only
        # the current authorised attempt may publish.
        stale_row = await svc._persist_scan_result(
            doc, "infected", "Eicar-Stale", "pending", stale_attempt
        )
        self.assertIsNone(stale_row)
        final = await self._doc()
        self.assertEqual(final["scan_status"], "clean")
        self.assertEqual(final["status"], "uploaded")

    async def test_concurrent_same_bytes_uploads_scan_once(self):
        from services import matter_document_service as svc

        # A fresh document row: nothing stored, scan not started.
        await self._insert_document(
            status="pending",
            scan_status="not_scanned",
            scan_result=None,
            storage_key=None,
            sha256=None,
            file_instance_id=None,
            file_type=None,
            original_file_name=None,
            file_size=None,
        )
        transfer, doc = await self._transfer(), await self._doc()

        scanner_a, scanner_b = _SlowScanner(), _SlowScanner()
        res_a, res_b = await asyncio.gather(
            svc.upload_document_file(
                transfer, doc, PDF_BYTES, "pg.pdf",
                storage=self.storage, scanner=scanner_a, user=self.user,
            ),
            svc.upload_document_file(
                transfer, doc, PDF_BYTES, "pg.pdf",
                storage=self.storage, scanner=scanner_b, user=self.user,
            ),
        )

        # Identical bytes: one object, one owning scan attempt.
        self.assertEqual(scanner_a.calls + scanner_b.calls, 1)
        outcomes = sorted([res_a[1], res_b[1]])
        self.assertIn("uploaded", outcomes)
        self.assertTrue(
            set(outcomes) <= {"uploaded", "scan_pending", "replay"}, outcomes
        )
        final = await self._doc()
        self.assertEqual(final["scan_status"], "clean")
        self.assertEqual(final["status"], "uploaded")
        self.assertIsNone(final["scan_attempt_id"])

    async def test_download_blocked_when_parent_transfer_foreign(self):
        from services import matter_document_service as svc

        await self._insert_document(scan_status="clean", status="uploaded")
        # Simulate a document row whose parent transfer resolves outside the
        # caller's institution — the parent-matter check must refuse.
        await self.pool.execute(
            "UPDATE transfers.transfers SET accountable_institution_id = $2 WHERE id = $1",
            self.transfer_id,
            FOREIGN_AI,
        )
        with self.assertRaises(svc.DocumentNotFoundError):
            await svc.get_document_for_download(str(self.doc_id), AI)


if __name__ == "__main__":
    unittest.main()
