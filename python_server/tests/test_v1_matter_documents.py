"""Tests for the authenticated v1 document lane.

Coverage split:
- Route-level: authentication, ability and tenant gates, allow-listed bodies,
  error mapping. Storage and scanner are test doubles — this is mocked
  evidence, not real adapter verification (ClamAV/files-service adapters are
  unverified against any deployed backend).
- Service-level: idempotent create replay/conflict, file fingerprint binding,
  scan gating, token issue/verify, requirement recalculation semantics.

No database is contacted: db.query/with_transaction are stubbed fixtures.
"""

import asyncio
import hashlib
import io
import time
import unittest
import uuid
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import jwt as pyjwt

import db
from main import app
from routers.v1 import transfers
from services import matter_document_service as svc
from services.document_scanner import ScannerUnavailableError, ScanResult
from services.document_storage import LocalDocumentStorage

SECRET = "matter-documents-slice-tests-32-secret!"
OWN = "22222222-2222-4222-8222-222222222222"
FOREIGN = "33333333-3333-4333-8333-333333333333"
DOC_ID = "55555555-5555-4555-8555-555555555555"

PDF_BYTES = b"%PDF-1.4 fake-synthetic-test-file"
PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-png"
DOCX_BYTES = b"PK\x03\x04fake-docx-zip"
EXE_BYTES = b"MZ\x90\x00fake-executable"


def token(*, role=3, ai=5, abilities=("transfers:read", "transfers:write"), golden=None):
    return pyjwt.encode(
        {
            "type": "access",
            "user_id": 123,
            "golden_record_id": golden,
            "abilities": list(abilities),
            "accountable_institution_id": ai,
            "user_roles_id": role,
            "exp": int(time.time()) + 3600,
        },
        SECRET,
        algorithm="HS256",
    )


def transfer_row(ai=5, **overrides):
    row = {
        "id": OWN,
        "transfer_id": "TRF-2026-TEST",
        "matter_id": "44444444-4444-4444-8444-444444444444",
        "property_address": "12 Test Street",
        "status": "in_progress",
        "accountable_institution_id": ai,
        "client_request_id": None,
        "request_fingerprint": None,
    }
    row.update(overrides)
    return row


def document_row(ai=5, **overrides):
    row = {
        "id": DOC_ID,
        "transfer_id": OWN,
        "catalogue_document_id": None,
        "name": "FICA documents",
        "status": "pending",
        "notes": None,
        "file_size": None,
        "file_type": None,
        "original_file_name": None,
        "requirement_key": None,
        "storage_key": None,
        "file_instance_id": None,
        "sha256": None,
        "scan_status": "not_scanned",
        "scan_result": None,
        "scanned_at": None,
        "accountable_institution_id": ai,
        "client_request_id": None,
        "request_fingerprint": None,
        "uploaded_by_user_id": None,
        "uploaded_at": None,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }
    row.update(overrides)
    return row


def uploaded_clean_row(**overrides):
    base = {
        "status": "uploaded",
        "scan_status": "clean",
        "storage_key": "ai-5/transfers/x/documents/y/z",
        "file_instance_id": uuid.uuid4(),
        "sha256": hashlib.sha256(PDF_BYTES).hexdigest(),
        "file_type": "application/pdf",
        "original_file_name": "fica.pdf",
        "file_size": len(PDF_BYTES),
    }
    base.update(overrides)
    return document_row(**base)


async def _tx(cb):
    return await cb(SimpleNamespace())


class FakeScanner:
    def __init__(self, result=None, error=None):
        self.result = result or ScanResult(status="clean")
        self.error = error
        self.calls = 0

    async def scan(self, data):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


class FakeStorage:
    def __init__(self):
        self.objects = {}

    def put(self, key, data, content_type):
        self.objects[key] = data

    def get(self, key):
        return self.objects[key]


class _ModuleSettings:
    jwt_secret = SECRET
    secret_key = "service-secret"
    document_token_secret = "token-secret"
    document_link_ttl_seconds = 300
    node_env = "development"


class RouteTestBase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(
            patch.object(app.state, "settings", _ModuleSettings(), create=True)
        )
        self.query = self.stack.enter_context(
            patch.object(transfers, "query", AsyncMock(side_effect=self._fixture))
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        if "FROM transfers t" in text and "t.id = $1" in text:
            ai = params[-1]
            if str(params[0]) == FOREIGN or ai != 5:
                return db.QueryResult(rows=[], row_count=0)
            return db.QueryResult(rows=[transfer_row()], row_count=1)
        if "FROM transfer_documents" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "FROM transfer_document_requirements" in text:
            return db.QueryResult(rows=[], row_count=0)
        raise AssertionError(f"Unexpected query: {text}")

    def _headers(self, **claims):
        return {"Authorization": f"Bearer {token(**claims)}"}


class DocumentRouteAuthTests(RouteTestBase):
    async def test_create_requires_authentication(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents", json={"name": "X"}
        )
        self.assertEqual(response.status_code, 401)

    async def test_create_requires_write_ability(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents",
            json={"name": "X"},
            headers=self._headers(abilities=["transfers:read"]),
        )
        self.assertEqual(response.status_code, 403)

    async def test_create_client_denied(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents",
            json={"name": "X"},
            headers=self._headers(role=4, abilities=["transfers:write"], golden=str(uuid.uuid4())),
        )
        self.assertEqual(response.status_code, 403)

    async def test_create_cross_tenant_404(self):
        response = await self.client.post(
            f"/api/v1/transfers/{FOREIGN}/documents",
            json={"name": "X"},
            headers=self._headers(),
        )
        self.assertEqual(response.status_code, 404)

    async def test_create_body_allow_list(self):
        for field in ("status", "scan_status", "accountable_institution_id", "storage_key"):
            response = await self.client.post(
                f"/api/v1/transfers/{OWN}/documents",
                json={"name": "X", field: "nope"},
                headers=self._headers(),
            )
            self.assertEqual(response.status_code, 422, field)

    async def test_download_link_read_only_ability_ok(self):
        self.stack.enter_context(
            patch.object(
                transfers, "get_document", AsyncMock(return_value=uploaded_clean_row())
            )
        )
        self.stack.enter_context(
            patch.object(transfers, "record_operation", AsyncMock())
        )
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents/{DOC_ID}/download-link",
            headers=self._headers(abilities=["transfers:read"]),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/v1/documents/download/v1.", response.json()["data"]["downloadUrl"])

    async def test_download_link_client_denied(self):
        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents/{DOC_ID}/download-link",
            headers=self._headers(role=4, abilities=["transfers:read"], golden=str(uuid.uuid4())),
        )
        self.assertEqual(response.status_code, 403)

    async def test_upload_route_requires_write_and_tenant(self):
        files = {"file": ("f.pdf", io.BytesIO(PDF_BYTES), "application/pdf")}
        no_auth = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents/{DOC_ID}/file", files=files
        )
        self.assertEqual(no_auth.status_code, 401)
        foreign = await self.client.post(
            f"/api/v1/transfers/{FOREIGN}/documents/{DOC_ID}/file",
            files={"file": ("f.pdf", io.BytesIO(PDF_BYTES), "application/pdf")},
            headers=self._headers(),
        )
        self.assertEqual(foreign.status_code, 404)


class CreateDocumentServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.queries = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(
            patch.object(svc.db, "query", AsyncMock(side_effect=self._fixture))
        )
        self.stack.enter_context(
            patch.object(
                svc.db,
                "with_transaction",
                AsyncMock(side_effect=_tx),
            )
        )
        self.user = SimpleNamespace(user_id=7)

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        self.queries.append(text)
        if "FROM transfer_documents" in text and "client_request_id" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "INSERT INTO transfer_documents" in text:
            row = document_row(
                name=params[2],
                client_request_id=params[6],
                request_fingerprint=params[7],
            )
            return db.QueryResult(rows=[row], row_count=1)
        if "document_operation_log" in text:
            return db.QueryResult(rows=[], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_create_returns_pending_row(self):
        row, created = await svc.create_document(
            transfer_row(),
            self.user,
            {
                "name": "FICA documents",
                "catalogue_document_id": None,
                "requirement_key": "fica",
                "notes": None,
                "client_request_id": uuid.uuid4(),
            },
        )
        self.assertTrue(created)
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["name"], "FICA documents")

    async def test_replay_same_key_returns_existing(self):
        key = uuid.uuid4()
        fingerprint = svc.create_fingerprint(
            5, OWN, {"name": "FICA documents", "catalogue_document_id": None, "requirement_key": "fica"}
        )
        existing = document_row(client_request_id=key, request_fingerprint=fingerprint, name="FICA documents")

        async def fixture(text, params=None, **kwargs):
            if "client_request_id" in text:
                return db.QueryResult(rows=[existing], row_count=1)
            return db.QueryResult(rows=[], row_count=1)

        with patch.object(svc.db, "query", AsyncMock(side_effect=fixture)):
            row, created = await svc.create_document(
                transfer_row(),
                self.user,
                {
                    "name": "FICA documents",
                    "catalogue_document_id": None,
                    "requirement_key": "fica",
                    "notes": None,
                    "client_request_id": key,
                },
            )
        self.assertFalse(created)
        self.assertEqual(row["id"], existing["id"])

    async def test_same_key_different_payload_conflicts(self):
        key = uuid.uuid4()
        existing = document_row(
            client_request_id=key, request_fingerprint="different", name="Other"
        )

        async def fixture(text, params=None, **kwargs):
            if "client_request_id" in text:
                return db.QueryResult(rows=[existing], row_count=1)
            return db.QueryResult(rows=[], row_count=1)

        with patch.object(svc.db, "query", AsyncMock(side_effect=fixture)):
            with self.assertRaises(svc.DocumentIdempotencyConflictError):
                await svc.create_document(
                    transfer_row(),
                    self.user,
                    {
                        "name": "FICA documents",
                        "catalogue_document_id": None,
                        "requirement_key": "fica",
                        "notes": None,
                        "client_request_id": key,
                    },
                )


class UploadServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.persisted = []
        # Stateful document row — UPDATEs merge into it, SELECTs return it.
        self.doc_state = document_row()
        self.stack.enter_context(
            patch.object(svc.db, "query", AsyncMock(side_effect=self._fixture))
        )
        self.user = SimpleNamespace(user_id=7)
        self.storage = FakeStorage()

    async def _fixture(self, text, params=None, **kwargs):
        stripped = text.strip()
        if stripped.startswith("UPDATE transfer_documents"):
            if "file_instance_id = $3" in stripped:
                self.doc_state.update(
                    {
                        "storage_key": params[1],
                        "file_instance_id": params[2],
                        "sha256": params[3],
                        "file_type": params[4],
                        "original_file_name": params[5],
                        "file_size": params[6],
                        "scan_status": params[7],
                        "scan_result": params[8],
                        "status": params[9],
                    }
                )
            elif "scanned_at" in stripped:
                self.doc_state.update(
                    {"scan_status": params[1], "scan_result": params[2], "status": params[3]}
                )
            else:  # scan-failure marker UPDATE
                self.doc_state.update({"scan_status": "error", "scan_result": params[1]})
            row = document_row(**self.doc_state)
            self.persisted.append(row)
            return db.QueryResult(rows=[row], row_count=1)
        if "FROM transfer_documents" in text:
            return db.QueryResult(rows=[document_row(**self.doc_state)], row_count=1)
        if "document_operation_log" in text:
            return db.QueryResult(rows=[], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_clean_upload_becomes_downloadable(self):
        scanner = FakeScanner(ScanResult(status="clean"))
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=scanner, user=self.user,
        )
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(row["scan_status"], "clean")
        self.assertEqual(len(self.storage.objects), 1)

    async def test_infected_upload_is_quarantined_and_not_downloadable(self):
        scanner = FakeScanner(ScanResult(status="infected", signature="Eicar-Test"))
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=scanner, user=self.user,
        )
        self.assertEqual(outcome, "quarantined")
        self.assertEqual(row["scan_status"], "infected")
        self.assertEqual(row["status"], "pending")

    async def test_scanner_failure_keeps_file_unavailable(self):
        scanner = FakeScanner(error=ScannerUnavailableError("clamd unreachable"))
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=scanner, user=self.user,
        )
        self.assertEqual(outcome, "scan_pending")
        self.assertEqual(row["scan_status"], "error")

    async def test_oversize_rejected(self):
        data = PDF_BYTES + b"0" * (svc.MAX_FILE_BYTES)
        with self.assertRaises(svc.DocumentValidationError):
            await svc.upload_document_file(
                transfer_row(), document_row(), data, "big.pdf",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )

    async def test_unsupported_type_rejected(self):
        with self.assertRaises(svc.DocumentValidationError):
            await svc.upload_document_file(
                transfer_row(), document_row(), EXE_BYTES, "evil.pdf",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )

    async def test_zip_without_docx_extension_rejected(self):
        with self.assertRaises(svc.DocumentValidationError):
            await svc.upload_document_file(
                transfer_row(), document_row(), DOCX_BYTES, "archive.zip",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )

    async def test_same_bytes_replay_skips_rescan(self):
        doc = uploaded_clean_row()
        scanner = FakeScanner()
        row, outcome = await svc.upload_document_file(
            transfer_row(), doc, PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=scanner, user=self.user,
        )
        self.assertEqual(outcome, "replay")
        self.assertEqual(scanner.calls, 0)
        self.assertEqual(len(self.storage.objects), 0)

    async def test_different_bytes_conflict(self):
        doc = uploaded_clean_row()
        with self.assertRaises(svc.DocumentIdempotencyConflictError):
            await svc.upload_document_file(
                transfer_row(), doc, PNG_BYTES, "other.png",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )

    async def test_retry_after_scan_error_rescans_same_bytes(self):
        doc = uploaded_clean_row(scan_status="error", status="pending")
        scanner = FakeScanner(ScanResult(status="clean"))
        row, outcome = await svc.upload_document_file(
            transfer_row(), doc, PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=scanner, user=self.user,
        )
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(scanner.calls, 1)


class DownloadTokenTests(unittest.TestCase):
    def test_issue_and_verify_round_trip(self):
        token_value, expires = svc.issue_download_token(
            uploaded_clean_row(), "token-secret", 300
        )
        payload = svc.verify_download_token(token_value, "token-secret")
        self.assertIsNotNone(payload)
        self.assertEqual(payload["doc"], DOC_ID)
        self.assertEqual(payload["ai"], 5)

    def test_issue_denied_without_clean_scan(self):
        for overrides in (
            {"scan_status": "pending"},
            {"scan_status": "infected"},
            {"status": "pending"},
            {"storage_key": None},
        ):
            with self.assertRaises(svc.DocumentNotAvailableError, msg=overrides):
                svc.issue_download_token(uploaded_clean_row(**overrides), "s")

    def test_verify_rejects_tampered_and_expired(self):
        token_value, _ = svc.issue_download_token(uploaded_clean_row(), "s", 300)
        self.assertIsNone(svc.verify_download_token(token_value, "wrong-secret"))
        self.assertIsNone(svc.verify_download_token(token_value + "x", "s"))
        self.assertIsNone(svc.verify_download_token("garbage", "s"))
        expired, _ = svc.issue_download_token(uploaded_clean_row(), "s", -10)
        self.assertIsNone(svc.verify_download_token(expired, "s"))


class RequirementEvaluationTests(unittest.TestCase):
    def test_condition_vocabulary(self):
        rule = lambda **kw: {"classification_code": None, "condition_key": None, **kw}
        ctx = {"classification_code": "sale", "has_bond": True}
        self.assertTrue(svc._rule_applies(rule(), ctx))
        self.assertTrue(svc._rule_applies(rule(condition_key="has_bond"), ctx))
        self.assertFalse(svc._rule_applies(rule(condition_key="cash_purchase"), ctx))
        self.assertFalse(svc._rule_applies(rule(condition_key="unknown_cond"), ctx))
        self.assertTrue(svc._rule_applies(rule(classification_code="sale"), ctx))
        self.assertFalse(svc._rule_applies(rule(classification_code="auction"), ctx))
        self.assertTrue(svc._rule_applies(rule(classification_code="*"), ctx))


class RecalculateServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.executed = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(
            patch.object(svc.db, "query", AsyncMock(side_effect=self._fixture))
        )
        self.stack.enter_context(
            patch.object(
                svc.db,
                "with_transaction",
                AsyncMock(side_effect=_tx),
            )
        )
        self.user = SimpleNamespace(user_id=7)

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        if "FROM matters" in text:
            return db.QueryResult(rows=[{"classification_code": "sale"}], row_count=1)
        if "FROM bonds" in text:
            return db.QueryResult(rows=[{"present": 1}], row_count=1)
        if "FROM transfer_financials" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "FROM document_requirement_rules" in text:
            return db.QueryResult(
                rows=[
                    {"rule_key": "fica", "display_name": "FICA", "classification_code": None, "condition_key": None},
                    {"rule_key": "bond_letter", "display_name": "Bond letter", "classification_code": None, "condition_key": "has_bond"},
                    {"rule_key": "cash_proof", "display_name": "Proof of funds", "classification_code": None, "condition_key": "cash_purchase"},
                ],
                row_count=3,
            )
        if "INSERT INTO transfer_document_requirements" in text or "UPDATE transfer_document_requirements" in text:
            self.executed.append((text.strip(), params))
            return db.QueryResult(rows=[], row_count=1)
        if "FROM transfer_document_requirements" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "document_operation_log" in text:
            return db.QueryResult(rows=[], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_applies_baseline_and_matched_conditional_only(self):
        await svc.recalculate_requirements(transfer_row(), self.user)
        inserts = [p for t, p in self.executed if t.startswith("INSERT")]
        keys = {p[2] for p in inserts}
        self.assertEqual(keys, {"fica", "bond_letter"})
        # Withdrawal update targets only still-active rows not in the
        # applicable set — nothing is ever deleted.
        updates = [t for t, _ in self.executed if t.startswith("UPDATE")]
        self.assertTrue(any("status = 'withdrawn'" in u for u in updates))


class DownloadRouteTests(RouteTestBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.stack.enter_context(
            patch.object(svc.db, "query", AsyncMock(side_effect=self._svc_fixture))
        )

    async def _svc_fixture(self, text, params=None, **kwargs):
        if "FROM transfer_documents" in text:
            return db.QueryResult(rows=[uploaded_clean_row()], row_count=1)
        if "document_operation_log" in text:
            return db.QueryResult(rows=[], row_count=1)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_download_with_valid_token(self):
        from routers.v1 import documents as doc_router

        token_value, _ = svc.issue_download_token(uploaded_clean_row(), "token-secret")
        storage = FakeStorage()
        storage.objects["ai-5/transfers/x/documents/y/z"] = PDF_BYTES
        with patch.object(doc_router, "build_storage", lambda: storage):
            response = await self.client.get(f"/api/v1/documents/download/{token_value}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, PDF_BYTES)
        self.assertEqual(response.headers.get("content-type"), "application/pdf")

    async def test_download_rejects_bad_token(self):
        response = await self.client.get("/api/v1/documents/download/v1.bad.token")
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
