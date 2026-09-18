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
import base64
import hashlib
import hmac
import io
import json
import time
import unittest
import uuid
import zipfile
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

def _zip_bytes(members: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        for name, body in members.items():
            archive.writestr(name, body)
    return buf.getvalue()


PDF_BYTES = b"%PDF-1.4 fake-synthetic-test-file"
PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-png"
# A real OOXML package: ZIP containing the members DOCX validation requires.
DOCX_BYTES = _zip_bytes(
    {"[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>"}
)
# A valid ZIP that is NOT an OOXML package — must be rejected even renamed .docx.
PLAIN_ZIP_BYTES = _zip_bytes({"readme.txt": "not a document"})
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

    async def test_declared_oversize_upload_rejected_413(self):
        # A declared body larger than the file cap + multipart overhead is
        # refused before any bytes are consumed or the matter is authorized.
        # httpx normalizes Content-Length to the real body size, so the guard
        # is exercised at the route function with the declared header present.
        from fastapi import HTTPException

        user = SimpleNamespace(
            is_client=False,
            has_ability=lambda ability: ability == "transfers:write",
        )
        fake_request = SimpleNamespace(
            headers={"content-length": str(svc.MAX_FILE_BYTES + 128 * 1024)}
        )
        with self.assertRaises(HTTPException) as ctx:
            await transfers.upload_transfer_document_file(
                id=OWN,
                document_id=DOC_ID,
                request=fake_request,
                file=SimpleNamespace(),
                user=user,
            )
        self.assertEqual(ctx.exception.status_code, 413)

    async def test_chunked_oversize_body_rejected_413(self):
        # The uncovered path: a chunked/undeclared body carries no reliable
        # Content-Length, so the route guard cannot see it. The ASGI
        # UploadBodyLimitMiddleware counts actual bytes and refuses at the
        # cap — before the multipart parser can spool the rest to disk.
        # The stream must be a VALID multipart envelope: an invalid body
        # fails parsing fast (400) without ever reaching the byte limit.
        boundary = "x" * 16
        head = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="big.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode()

        async def oversized_stream():
            yield head
            for _ in range(30):
                yield b"%PDF-1.4 " + b"x" * (1024 * 1024 - 10)  # ~30 MB file part
            yield f"\r\n--{boundary}--\r\n".encode()

        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents/{DOC_ID}/file",
            content=oversized_stream(),
            headers={
                **self._headers(),
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        self.assertEqual(response.status_code, 413)

    async def test_chunked_body_under_limit_passes_middleware(self):
        # A small streamed body (no Content-Length) flows through the
        # middleware to the route — rejection, if any, comes from the
        # handler's own validation, not the byte counter.
        async def small_stream():
            yield b"--x\r\nContent-Disposition: form-data; name=\"file\"; "
            yield b"filename=\"f.pdf\"\r\n\r\n%PDF-1.4 x\r\n--x--\r\n"

        response = await self.client.post(
            f"/api/v1/transfers/{OWN}/documents/{DOC_ID}/file",
            content=small_stream(),
            headers={
                **self._headers(),
                "Content-Type": "multipart/form-data; boundary=x",
            },
        )
        self.assertNotEqual(response.status_code, 413)


class GetDocumentsRouteTests(RouteTestBase):
    """GET /documents readback — evaluation flags through the real route.

    Route-level queries (authorize, document list) go through the base
    fixture; requirement/context queries are service-level stubs — same
    mocked-db caveat as the rest of the module. Scenario knobs are set per
    test: matter classification, financing facts and the active rule set.
    """

    async def asyncSetUp(self):
        # Scenario knobs — tests override before the GET.
        self.matter_classification = "sale"
        self.bond_present = True
        self.financials_row = None  # None => no row; {"loan_amount": x} => row
        self.rules = []
        await super().asyncSetUp()
        self.stack.enter_context(
            patch.object(svc.db, "query", AsyncMock(side_effect=self._svc_fixture))
        )

    async def _fixture(self, text, params=None, **kwargs):
        # The authorizing SELECT must carry t.accountable_institution_id —
        # the requirements/flags queries dereference it from the returned
        # row. Fixtures once supplied the key out-of-band of the real select
        # list, which masked a live regression; assert it on the SQL text.
        if "FROM transfers t" in text and "t.id = $1" in text:
            self.assertIn("t.accountable_institution_id", text)
        return await super()._fixture(text, params, **kwargs)

    async def _svc_fixture(self, text, params=None, **kwargs):
        if "FROM transfer_document_requirements" in text:
            return db.QueryResult(rows=[], row_count=0)
        if "FROM matters" in text:
            return db.QueryResult(
                rows=[{"classification_code": self.matter_classification}], row_count=1
            )
        if "FROM bonds" in text:
            rows = [{"present": 1}] if self.bond_present else []
            return db.QueryResult(rows=rows, row_count=len(rows))
        if "FROM transfer_financials" in text:
            rows = [self.financials_row] if self.financials_row else []
            return db.QueryResult(rows=rows, row_count=len(rows))
        if "FROM document_requirement_rules" in text:
            return db.QueryResult(rows=list(self.rules), row_count=len(self.rules))
        raise AssertionError(f"Unexpected query: {text}")

    async def test_get_missing_classification_is_visibly_unevaluated(self):
        # Matter row exists but classification is NULL: classification-scoped
        # rules are flagged and the missing fact is reported — never a
        # silent empty/complete requirement set.
        self.matter_classification = None
        self.rules = [
            {"rule_key": "fica", "classification_code": None, "condition_key": None},
            {"rule_key": "sale_addendum", "classification_code": "sale", "condition_key": None},
            {"rule_key": "bond_letter", "classification_code": None, "condition_key": "has_bond"},
        ]
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}/documents", headers=self._headers()
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("documents", data)
        self.assertIn("requirements", data)
        self.assertIn("classification_code", data["unevaluatedFacts"])
        # A bond row exists, so has_bond itself is not a missing fact.
        self.assertNotIn("has_bond", data["unevaluatedFacts"])
        flagged = {r["ruleKey"] for r in data["unevaluatedRules"]}
        self.assertIn("sale_addendum", flagged)
        self.assertNotIn("bond_letter", flagged)

    async def test_get_unsupported_condition_is_flagged_not_dropped(self):
        self.rules = [
            {"rule_key": "fica", "classification_code": "sale", "condition_key": None},
            {"rule_key": "specialist_letter", "classification_code": None, "condition_key": "requires_specialist_confirm"},
        ]
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}/documents", headers=self._headers()
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["unevaluatedFacts"], [])
        self.assertEqual(
            data["unevaluatedRules"],
            [{"ruleKey": "specialist_letter", "conditionKey": "requires_specialist_confirm"}],
        )

    async def test_get_complete_evaluation_reports_empty_flags(self):
        self.rules = [
            {"rule_key": "fica", "classification_code": "sale", "condition_key": None},
            {"rule_key": "bond_letter", "classification_code": None, "condition_key": "has_bond"},
        ]
        response = await self.client.get(
            f"/api/v1/transfers/{OWN}/documents", headers=self._headers()
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["unevaluatedFacts"], [])
        self.assertEqual(data["unevaluatedRules"], [])


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
        self.oplog = []
        # Stateful document row — UPDATEs merge into it, SELECTs return it.
        self.doc_state = document_row()
        # Set by tests to make the next persist UPDATE fail (DB outage).
        self.fail_next_persist = False
        # Set by tests to make the operation-log INSERT fail (audit lane down).
        self.fail_oplog = False
        self.stack.enter_context(
            patch.object(svc.db, "query", AsyncMock(side_effect=self._fixture))
        )
        self.user = SimpleNamespace(user_id=7)
        self.storage = FakeStorage()

    async def _fixture(self, text, params=None, **kwargs):
        stripped = text.strip()
        if stripped.startswith("UPDATE transfer_documents"):
            if "file_instance_id = $3" in stripped:
                if self.fail_next_persist:
                    self.fail_next_persist = False
                    raise RuntimeError("simulated database failure")
                # Emulate `WHERE sha256 IS NULL`: a concurrent writer that
                # already persisted leaves no row to update.
                if self.doc_state.get("sha256") is not None:
                    return db.QueryResult(rows=[], row_count=0)
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
            if self.fail_oplog:
                raise RuntimeError("simulated operation-log write failure")
            self.oplog.append(
                {
                    "operation": params[0],
                    "outcome": params[1],
                    "detail": json.loads(params[6]) if params[6] else None,
                }
            )
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

    async def test_scanner_failure_then_retry_recovers_same_object(self):
        # Scanner down on first attempt: bytes persist, scan is marked error,
        # outcome reports not-yet-available — never a false success.
        failing = FakeScanner(error=ScannerUnavailableError("clamd unreachable"))
        stale_doc = document_row()  # snapshot before any persist
        row, outcome = await svc.upload_document_file(
            transfer_row(), stale_doc, PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=failing, user=self.user,
        )
        self.assertEqual(outcome, "scan_pending")
        self.assertEqual(self.doc_state["scan_status"], "error")
        self.assertEqual(len(self.storage.objects), 1)

        # Retry the same bytes once the scanner is healthy: same object key,
        # rescan completes, document becomes uploaded — nothing is stuck.
        recovered = FakeScanner(ScanResult(status="clean"))
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(**self.doc_state), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=recovered, user=self.user,
        )
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(row["scan_status"], "clean")
        self.assertEqual(len(self.storage.objects), 1)

    async def test_concurrent_identical_uploads_converge_on_one_object(self):
        # Writer 1 wins the conditional persist.
        row1, outcome1 = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=FakeScanner(), user=self.user,
        )
        self.assertEqual(outcome1, "uploaded")

        # Writer 2 held a stale snapshot (no sha256), stored the same bytes
        # under the same content-addressed key, then lost the persist race.
        stale_snapshot = document_row()
        row2, outcome2 = await svc.upload_document_file(
            transfer_row(), stale_snapshot, PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=FakeScanner(), user=self.user,
        )
        self.assertEqual(outcome2, "replay")
        self.assertEqual(row2["id"], row1["id"])
        self.assertEqual(row2["sha256"], row1["sha256"])
        # Exactly one object exists — identical bytes at the identical key.
        self.assertEqual(len(self.storage.objects), 1)
        self.assertEqual(self.doc_state["scan_status"], "clean")

    async def test_concurrent_different_file_conflicts_without_overwrite(self):
        row1, outcome1 = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=FakeScanner(), user=self.user,
        )
        self.assertEqual(outcome1, "uploaded")

        # A concurrent writer with different bytes loses the persist race and
        # must conflict — the stored row is never overwritten.
        with self.assertRaises(svc.DocumentIdempotencyConflictError):
            await svc.upload_document_file(
                transfer_row(), document_row(), PNG_BYTES, "other.png",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )
        self.assertEqual(self.doc_state["sha256"], hashlib.sha256(PDF_BYTES).hexdigest())
        self.assertEqual(self.doc_state["file_type"], "application/pdf")
        self.assertEqual(self.doc_state["status"], "uploaded")
        # The losing writer's object is durable-identified in the op log for
        # reconciliation (storage itself keeps no-delete semantics).
        conflicts = [
            entry for entry in self.oplog
            if entry["detail"] and entry["detail"].get("reason") == "concurrent_different_file"
        ]
        self.assertEqual(len(conflicts), 1)
        self.assertIn("storage_key", conflicts[0]["detail"])

    async def test_storage_success_persist_failure_durable_and_retryable(self):
        self.fail_next_persist = True
        with self.assertRaises(svc.DocumentServiceError):
            await svc.upload_document_file(
                transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )
        # Stored object survives with its identifiers in the failure record —
        # reconcilable, not a silent orphan, and not a false success.
        self.assertEqual(len(self.storage.objects), 1)
        failures = [
            entry for entry in self.oplog
            if entry["operation"] == "file_uploaded" and entry["outcome"] == "failure"
        ]
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["detail"]["stage"], "persist")
        self.assertIn("storage_key", failures[0]["detail"])
        self.assertIn("file_instance_id", failures[0]["detail"])

        # Retry of the same bytes reuses the same object key and succeeds.
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=FakeScanner(), user=self.user,
        )
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(len(self.storage.objects), 1)

    async def test_storage_persist_and_oplog_all_fail_still_recovers(self):
        # Worst case: bytes stored, row persist fails, AND the recovery
        # record write fails too. Recovery semantics, in order of strength:
        #   1. The durable record (document_operation_log) — absent here.
        #   2. The stderr alert — the observable alarm signal (tested below).
        #   3. The object itself — retained under its deterministic key
        #      (ai/transfer/document/sha256), so a retry or reconciliation
        #      sweep can re-derive and re-attach it. Nothing is lost beyond
        #      detection latency; the caller still gets an honest failure.
        self.fail_next_persist = True
        self.fail_oplog = True
        captured = io.StringIO()
        with self.assertRaises(svc.DocumentServiceError):
            from contextlib import redirect_stderr

            with redirect_stderr(captured):
                await svc.upload_document_file(
                    transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
                    storage=self.storage, scanner=FakeScanner(), user=self.user,
                )
        # The failed recovery write surfaced as a stderr alert, not a
        # swallowed silent loss — and never rolled the error into success.
        self.assertIn("document_operation_log write failed", captured.getvalue())
        # The object survives under the deterministic key — re-derivable.
        self.assertEqual(len(self.storage.objects), 1)
        key = next(iter(self.storage.objects))
        self.assertIn(hashlib.sha256(PDF_BYTES).hexdigest(), key)
        self.assertFalse(self.doc_state.get("sha256"))

        # Once both lanes recover, the same-bytes retry reuses the identical
        # key — no second object, no stuck state, honest success at last.
        self.fail_oplog = False
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(), PDF_BYTES, "fica.pdf",
            storage=self.storage, scanner=FakeScanner(), user=self.user,
        )
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(len(self.storage.objects), 1)

    async def test_docx_accepts_real_ooxml_package(self):
        scanner = FakeScanner(ScanResult(status="clean"))
        row, outcome = await svc.upload_document_file(
            transfer_row(), document_row(), DOCX_BYTES, "contract.docx",
            storage=self.storage, scanner=scanner, user=self.user,
        )
        self.assertEqual(outcome, "uploaded")
        self.assertEqual(
            row["file_type"],
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    async def test_renamed_zip_is_not_a_docx(self):
        # A plain ZIP renamed .docx lacks the OOXML members — rejected even
        # though the ZIP magic bytes match.
        with self.assertRaises(svc.DocumentValidationError):
            await svc.upload_document_file(
                transfer_row(), document_row(), PLAIN_ZIP_BYTES, "evil.docx",
                storage=self.storage, scanner=FakeScanner(), user=self.user,
            )


class LocalStorageBehaviorTests(unittest.TestCase):
    """LocalDocumentStorage create-if-absent + atomic-publish behavior.

    REAL-FILESYSTEM evidence: these tests run the actual local development
    adapter against a real temp directory with real threads — distinct from
    the FakeStorage-mocked service tests elsewhere in this file. Scope is
    the dev adapter only: this is NOT verification of the files-service
    adapter, whose atomicity/concurrency contract remains unconfirmed.
    """

    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.storage = LocalDocumentStorage(self.tmp.name)

    def test_second_put_same_key_never_overwrites(self):
        self.storage.put("ai-5/t/d/doc/aaa", PDF_BYTES, "application/pdf")
        self.storage.put("ai-5/t/d/doc/aaa", PNG_BYTES, "image/png")
        # First writer wins — same key means identical digest in production;
        # here it proves put is genuinely create-if-absent, not upsert.
        self.assertEqual(self.storage.get("ai-5/t/d/doc/aaa"), PDF_BYTES)

    def test_concurrent_puts_publish_complete_bytes_only(self):
        # Real threads on a real filesystem race the same key; readers only
        # ever see the complete object (temp-write + atomic link publish),
        # never a partial file. Dev-adapter evidence only — the files-service
        # adapter's publish atomicity is unverified.
        import concurrent.futures
        import os

        key = "ai-5/t/d/doc/bbb"
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda _: self.storage.put(key, PDF_BYTES, "application/pdf"), range(16)))
        self.assertEqual(self.storage.get(key), PDF_BYTES)
        # No temp/partial artifacts remain under the storage root.
        leftovers = [
            f for _, _, files in os.walk(self.tmp.name) for f in files if f.endswith(".tmp")
        ]
        self.assertEqual(leftovers, [])

    def test_get_missing_key_raises(self):
        with self.assertRaises(FileNotFoundError):
            self.storage.get("ai-5/t/d/doc/missing")


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

    def test_tampered_payload_rejected(self):
        # Rewriting the signed payload — swapping the document id or the
        # institution — invalidates the HMAC. This is the binding that makes a
        # token for document A unusable for document B or another tenant.
        token_value, _ = svc.issue_download_token(
            uploaded_clean_row(), "token-secret", 300
        )
        version, body, sig = token_value.split(".")
        payload = json.loads(
            base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        )
        for field, value in (("doc", FOREIGN), ("ai", 99)):
            forged = dict(payload, **{field: value})
            forged_body = base64.urlsafe_b64encode(
                json.dumps(forged, separators=(",", ":")).encode()
            ).decode().rstrip("=")
            forged_token = f"{version}.{forged_body}.{sig}"
            self.assertIsNone(
                svc.verify_download_token(forged_token, "token-secret"), field
            )

    def test_token_scope_prefix_rejected(self):
        token_value, _ = svc.issue_download_token(uploaded_clean_row(), "s", 300)
        version, body, sig = token_value.split(".")
        payload = json.loads(
            base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        )
        forged = dict(payload, sc="other-purpose")
        # Even a correctly re-signed token for another scope is refused.
        forged_body = base64.urlsafe_b64encode(
            json.dumps(forged, separators=(",", ":")).encode()
        ).decode().rstrip("=")
        forged_sig = base64.urlsafe_b64encode(
            hmac.new(b"s", forged_body.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        self.assertIsNone(
            svc.verify_download_token(f"{version}.{forged_body}.{forged_sig}", "s")
        )


class DownloadLookupTests(unittest.IsolatedAsyncioTestCase):
    """get_document_for_download binds document id AND institution."""

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        if "FROM transfer_documents" in text:
            # Rows exist only inside institution 5.
            if params[1] == 5 and params[0] == DOC_ID:
                return db.QueryResult(rows=[uploaded_clean_row()], row_count=1)
            return db.QueryResult(rows=[], row_count=0)
        raise AssertionError(f"Unexpected query: {text}")

    async def test_cross_institution_document_lookup_denied(self):
        with patch.object(svc.db, "query", AsyncMock(side_effect=self._fixture)):
            with self.assertRaises(svc.DocumentNotFoundError):
                await svc.get_document_for_download(DOC_ID, 6)

    async def test_foreign_document_id_denied(self):
        with patch.object(svc.db, "query", AsyncMock(side_effect=self._fixture)):
            with self.assertRaises(svc.DocumentNotFoundError):
                await svc.get_document_for_download(FOREIGN, 5)

    async def test_non_clean_document_unavailable(self):
        async def pending_fixture(text, params=None, **kwargs):
            if "FROM transfer_documents" in text:
                return db.QueryResult(
                    rows=[uploaded_clean_row(scan_status="pending", status="pending")],
                    row_count=1,
                )
            raise AssertionError(f"Unexpected query: {text}")

        with patch.object(svc.db, "query", AsyncMock(side_effect=pending_fixture)):
            with self.assertRaises(svc.DocumentNotAvailableError):
                await svc.get_document_for_download(DOC_ID, 5)


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
        # Scenario knobs — tests override before calling recalculate.
        self.matter_classification = "sale"
        self.bond_present = True
        self.financials_row = None  # None => no row; {"loan_amount": x} => row
        self.rules = [
            {"rule_key": "fica", "display_name": "FICA", "classification_code": None, "condition_key": None},
            {"rule_key": "bond_letter", "display_name": "Bond letter", "classification_code": None, "condition_key": "has_bond"},
            {"rule_key": "cash_proof", "display_name": "Proof of funds", "classification_code": None, "condition_key": "cash_purchase"},
            # Condition outside the supported vocabulary — must be
            # surfaced, never silently applied or withdrawn.
            {"rule_key": "specialist_letter", "display_name": "Specialist letter", "classification_code": None, "condition_key": "requires_specialist_confirm"},
        ]

    async def _fixture(self, text, params=None, **kwargs):
        params = params or []
        if "FROM matters" in text:
            return db.QueryResult(
                rows=[{"classification_code": self.matter_classification}], row_count=1
            )
        if "FROM bonds" in text:
            rows = [{"present": 1}] if self.bond_present else []
            return db.QueryResult(rows=rows, row_count=len(rows))
        if "FROM transfer_financials" in text:
            rows = [self.financials_row] if self.financials_row else []
            return db.QueryResult(rows=rows, row_count=len(rows))
        if "FROM document_requirement_rules" in text:
            return db.QueryResult(rows=list(self.rules), row_count=len(self.rules))
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

    async def test_unevaluated_rule_is_flagged_and_never_withdrawn(self):
        data = await svc.recalculate_requirements(transfer_row(), self.user)
        # The unsupported condition produces no requirement row...
        inserts = [p for t, p in self.executed if t.startswith("INSERT")]
        keys = {p[2] for p in inserts}
        self.assertNotIn("specialist_letter", keys)
        # ...is surfaced as unevaluated rather than silently "not required"...
        self.assertEqual(
            data["unevaluatedRules"],
            [{"ruleKey": "specialist_letter", "conditionKey": "requires_specialist_confirm"}],
        )
        # ...and an existing requirement bound to that rule is outside the
        # withdrawal set — we cannot prove it stopped applying.
        withdrawals = [p for t, p in self.executed if "'withdrawn'" in t]
        self.assertEqual(len(withdrawals), 1)
        withdrawable_keys = set(withdrawals[0][2])
        self.assertNotIn("specialist_letter", withdrawable_keys)
        self.assertEqual(
            withdrawable_keys, {"fica", "bond_letter", "cash_proof"}
        )

    async def test_missing_financing_facts_are_unevaluated_not_negative(self):
        # No bonds row and no financials row: has_bond is unknown — a
        # missing fact must NOT be treated as a negative answer.
        self.bond_present = False
        self.financials_row = None
        data = await svc.recalculate_requirements(transfer_row(), self.user)
        inserts = [p for t, p in self.executed if t.startswith("INSERT")]
        keys = {p[2] for p in inserts}
        # Neither conditional rule may apply — and neither is withdrawn
        # either: both are unevaluated, not "not required".
        self.assertEqual(keys, {"fica"})
        self.assertEqual(
            {r["ruleKey"] for r in data["unevaluatedRules"]},
            {"bond_letter", "cash_proof", "specialist_letter"},
        )

    async def test_null_loan_amount_is_unknown_not_cash(self):
        # A financials row with a NULL loan amount is ambiguous — it does
        # not establish a cash purchase.
        self.bond_present = False
        self.financials_row = {"loan_amount": None}
        data = await svc.recalculate_requirements(transfer_row(), self.user)
        inserts = [p for t, p in self.executed if t.startswith("INSERT")]
        self.assertEqual({p[2] for p in inserts}, {"fica"})
        self.assertEqual(
            {r["ruleKey"] for r in data["unevaluatedRules"]},
            {"bond_letter", "cash_proof", "specialist_letter"},
        )

    async def test_explicit_zero_loan_evaluates_as_cash_purchase(self):
        # An explicit zero loan IS evidence: cash_purchase applies.
        self.bond_present = False
        self.financials_row = {"loan_amount": 0}
        data = await svc.recalculate_requirements(transfer_row(), self.user)
        inserts = [p for t, p in self.executed if t.startswith("INSERT")]
        self.assertEqual({p[2] for p in inserts}, {"fica", "cash_proof"})
        self.assertEqual(
            {r["ruleKey"] for r in data["unevaluatedRules"]},
            {"specialist_letter"},
        )

    async def test_missing_classification_makes_scoped_rules_unevaluated(self):
        # The matter records no classification: a classification-scoped rule
        # is unevaluated, never silently skipped.
        self.matter_classification = None
        self.rules = [
            {"rule_key": "fica", "display_name": "FICA", "classification_code": None, "condition_key": None},
            {"rule_key": "sale_addendum", "display_name": "Sale addendum", "classification_code": "sale", "condition_key": None},
        ]
        data = await svc.recalculate_requirements(transfer_row(), self.user)
        inserts = [p for t, p in self.executed if t.startswith("INSERT")]
        self.assertEqual({p[2] for p in inserts}, {"fica"})
        self.assertEqual(
            {r["ruleKey"] for r in data["unevaluatedRules"]},
            {"sale_addendum"},
        )
        # The missing fact itself is flagged: the response is visibly
        # unevaluated, never a silent "no requirements" result.
        self.assertIn("classification_code", data["unevaluatedFacts"])

    async def test_evaluation_flags_surface_missing_facts(self):
        # The readback-path helper: missing facts and blocked rules are
        # reported so GET /documents can render an incomplete evaluation
        # rather than a false-complete requirement list.
        self.matter_classification = None
        flags = await svc.evaluation_flags(transfer_row())
        self.assertIn("classification_code", flags["unevaluatedFacts"])
        self.assertIn(
            "specialist_letter",
            {r["ruleKey"] for r in flags["unevaluatedRules"]},
        )
        self.matter_classification = "sale"
        flags = await svc.evaluation_flags(transfer_row())
        self.assertNotIn("classification_code", flags["unevaluatedFacts"])


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

    async def test_download_rejects_expired_token(self):
        expired, _ = svc.issue_download_token(uploaded_clean_row(), "token-secret", -10)
        response = await self.client.get(f"/api/v1/documents/download/{expired}")
        self.assertEqual(response.status_code, 403)

    async def test_download_rejects_tampered_token(self):
        token_value, _ = svc.issue_download_token(uploaded_clean_row(), "token-secret")
        version, body, sig = token_value.split(".")
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        payload["doc"] = FOREIGN
        forged_body = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode()
        ).decode().rstrip("=")
        response = await self.client.get(
            f"/api/v1/documents/download/{version}.{forged_body}.{sig}"
        )
        self.assertEqual(response.status_code, 403)

    async def test_download_denied_when_document_no_longer_available(self):
        # Token verifies, but the file lost availability after issuance —
        # bearer access re-checks state at retrieval.
        async def unavailable_fixture(text, params=None, **kwargs):
            if "FROM transfer_documents" in text:
                return db.QueryResult(
                    rows=[uploaded_clean_row(scan_status="infected", status="pending")],
                    row_count=1,
                )
            if "document_operation_log" in text:
                return db.QueryResult(rows=[], row_count=1)
            raise AssertionError(f"Unexpected query: {text}")

        token_value, _ = svc.issue_download_token(uploaded_clean_row(), "token-secret")
        with patch.object(svc.db, "query", AsyncMock(side_effect=unavailable_fixture)):
            response = await self.client.get(f"/api/v1/documents/download/{token_value}")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
