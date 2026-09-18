"""Authenticated matter-document service: metadata creation, gated upload,
scan-before-download, short-lived download tokens, and requirement
recalculation.

Design rules (approved scope):
- Storage, scan and lifecycle states are separate columns. A document is
  downloadable only when status='uploaded' AND scan_status='clean' AND a
  storage_key exists. Scanner failure never releases a file.
- Idempotency mirrors the established pattern: document creation binds
  (accountable_institution_id, client_request_id) with a request_fingerprint
  covering institution + matter + document identity; reuse with a different
  payload conflicts. File upload binds to the document row itself: the same
  bytes (sha256) replay the stored outcome, different bytes conflict — there
  is no replacement in this slice.
- Partial failures are recorded durably in document_operation_log with the
  identifiers/outcome needed for reconciliation. File contents, credentials
  and download tokens are never logged.
- The platform audit logger contract is a flagged missing integration; the
  operation log is the audit adapter for this slice. An audit write failure
  does not roll back the business operation — it is itself recorded
  best-effort (stderr) so a failed audit never becomes silent.
"""

import base64
import hashlib
import hmac
import json
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Optional, Protocol

import db
from services.document_scanner import MalwareScanner, ScannerUnavailableError
from services.document_storage import DocumentStorage, build_storage_key

MAX_FILE_BYTES = 25 * 1024 * 1024

# Server-side content validation: canonical type -> (magic prefix, mimetypes).
# The declared Content-Type/extension is never trusted; the sniffed type must
# be in this allow-list and consistent with the declared name.
ALLOWED_FILE_TYPES = {
    "application/pdf": (b"%PDF", (".pdf",)),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        b"PK\x03\x04",
        (".docx",),
    ),
    "image/jpeg": (b"\xff\xd8\xff", (".jpg", ".jpeg")),
    "image/png": (b"\x89PNG\r\n\x1a\n", (".png",)),
}

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Supported conditional-requirement vocabulary. Unknown condition_key values
# are inert (the rule is skipped) — an unrecognised condition is never
# silently treated as applicable. Dean's approved catalogue defines the real
# rules; this vocabulary is the evaluation mechanism only.
_SUPPORTED_CONDITIONS = ("has_bond", "cash_purchase")


class DocumentServiceError(Exception):
    pass


class DocumentValidationError(DocumentServiceError):
    pass


class DocumentIdempotencyConflictError(DocumentServiceError):
    """client_request_id reused with a different payload, or the file changed."""

    pass


class DocumentNotFoundError(DocumentServiceError):
    pass


class DocumentNotAvailableError(DocumentServiceError):
    """The document has no clean, scanned file to download."""

    pass


def _is_docx_package(data: bytes) -> bool:
    """Verify the OOXML package structure, not merely the ZIP signature.

    A DOCX is a ZIP containing [Content_Types].xml and word/document.xml —
    checking members rules out arbitrary ZIPs renamed to .docx.
    """
    try:
        import zipfile
        from io import BytesIO

        with zipfile.ZipFile(BytesIO(data)) as archive:
            names = set(archive.namelist())
        return "[Content_Types].xml" in names and "word/document.xml" in names
    except Exception:
        return False


def sniff_file_type(data: bytes, filename: Optional[str]) -> str:
    """Return the canonical content type from magic bytes, or raise.

    DOCX requires both the .docx name and a valid OOXML package — magic bytes
    alone cannot distinguish it from other ZIP formats.
    """
    suffix = f".{filename.rsplit('.', 1)[-1].lower()}" if filename and "." in filename else ""
    for mime, (magic, extensions) in ALLOWED_FILE_TYPES.items():
        if data.startswith(magic):
            if mime == _DOCX_MIME:
                if suffix != ".docx" or not _is_docx_package(data):
                    continue
            return mime
    raise DocumentValidationError(
        "Unsupported file type — only PDF, DOCX, JPG and PNG files are accepted"
    )


def create_fingerprint(
    accountable_institution_id: int,
    transfer_id: str,
    payload: dict,
) -> str:
    canonical = {
        "ai": accountable_institution_id,
        "transfer": transfer_id,
        "name": payload.get("name"),
        "catalogue_document_id": payload.get("catalogue_document_id"),
        "requirement_key": payload.get("requirement_key"),
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True).encode("utf-8")
    ).hexdigest()


def file_fingerprint(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------
# Durable operation log / audit adapter
# --------------------------------------------------------------------------

async def record_operation(
    operation: str,
    outcome: str,
    *,
    accountable_institution_id: int,
    actor_user_id: Optional[int],
    transfer_id: Optional[str],
    document_id: Optional[str],
    detail: Optional[dict] = None,
    connection: Any = None,
) -> None:
    """Write a reconciliation/audit row. Never raises.

    An audit-delivery failure is deliberately not propagated: the business
    operation must not roll back because the audit lane failed. The failure is
    surfaced on stderr so it is observable and can be alarmed on — a missing
    audit row is a reconciliation gap, not a hidden success.
    """
    try:
        await db.query(
            """
            INSERT INTO document_operation_log
                (operation, outcome, accountable_institution_id, actor_user_id,
                 transfer_id, document_id, detail)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            [
                operation,
                outcome,
                accountable_institution_id,
                actor_user_id,
                transfer_id,
                document_id,
                json.dumps(detail) if detail else None,
            ],
            connection=connection,
        )
    except Exception:  # noqa: BLE001 — audit failure must never break the op
        print(
            f"document_operation_log write failed: operation={operation} "
            f"outcome={outcome} document={document_id}",
            file=sys.stderr,
        )


# --------------------------------------------------------------------------
# Document metadata creation (idempotent)
# --------------------------------------------------------------------------

_DOC_READ_COLUMNS = """
    id, transfer_id, catalogue_document_id, name, status, notes, file_size,
    file_type, original_file_name, requirement_key, storage_key,
    file_instance_id, sha256, scan_status, scan_result, scanned_at,
    accountable_institution_id, client_request_id, request_fingerprint,
    uploaded_by_user_id, uploaded_at, created_at, updated_at
""".strip()


async def _find_document_by_request(
    accountable_institution_id: int,
    client_request_id: uuid.UUID,
    *,
    connection: Any = None,
) -> Optional[dict]:
    result = await db.query(
        f"""
        SELECT {_DOC_READ_COLUMNS}
        FROM transfer_documents
        WHERE accountable_institution_id = $1 AND client_request_id = $2
        """,
        [accountable_institution_id, client_request_id],
        connection=connection,
    )
    return result.rows[0] if result.rows else None


async def create_document(
    transfer: dict,
    user: Any,
    payload: dict,
) -> tuple[dict, bool]:
    """Create a pending document row. Returns (row, created).

    Idempotent per (accountable_institution_id, client_request_id): a replay
    with the same fingerprint returns the existing row; reuse with a
    different payload raises DocumentIdempotencyConflictError.
    """
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 255:
        raise DocumentValidationError("name is required (1–255 characters)")

    catalogue_id = payload.get("catalogue_document_id")
    requirement_key = payload.get("requirement_key")
    if requirement_key is not None and (
        not isinstance(requirement_key, str) or len(requirement_key) > 150
    ):
        raise DocumentValidationError("requirement_key is invalid")

    ai = transfer["accountable_institution_id"]
    client_request_id = payload.get("client_request_id")
    fingerprint = (
        create_fingerprint(ai, str(transfer["id"]), payload)
        if client_request_id is not None
        else None
    )

    async def _do_create(connection: Any) -> tuple[dict, bool]:
        if client_request_id is not None:
            existing = await _find_document_by_request(
                ai, client_request_id, connection=connection
            )
            if existing is not None:
                if existing.get("request_fingerprint") == fingerprint:
                    return existing, False
                raise DocumentIdempotencyConflictError(
                    "client_request_id was already used with a different payload"
                )

        result = await db.query(
            f"""
            INSERT INTO transfer_documents
                (transfer_id, catalogue_document_id, name, status, notes,
                 requirement_key, accountable_institution_id,
                 client_request_id, request_fingerprint, uploaded_by_user_id)
            VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9)
            RETURNING {_DOC_READ_COLUMNS}
            """,
            [
                transfer["id"],
                catalogue_id,
                name.strip(),
                payload.get("notes"),
                requirement_key,
                ai,
                client_request_id,
                fingerprint,
                user.user_id,
            ],
            connection=connection,
        )
        row = result.rows[0]
        await record_operation(
            "document_created",
            "success",
            accountable_institution_id=ai,
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(row["id"]),
            detail={"name": name.strip(), "requirement_key": requirement_key},
            connection=connection,
        )
        return row, True

    try:
        return await db.with_transaction(_do_create)
    except Exception as exc:
        # Unique-index race on (ai, client_request_id): resolve as replay.
        if client_request_id is not None and "idx_transfer_documents_client_request" in str(exc):
            existing = await _find_document_by_request(ai, client_request_id)
            if existing is not None and existing.get("request_fingerprint") == fingerprint:
                return existing, False
            raise DocumentIdempotencyConflictError(
                "client_request_id was already used with a different payload"
            ) from exc
        raise


async def get_document(
    transfer: dict,
    document_id: str,
) -> dict:
    """Load a document scoped to the authorised transfer's institution."""
    result = await db.query(
        f"""
        SELECT {_DOC_READ_COLUMNS}
        FROM transfer_documents
        WHERE id = $1 AND transfer_id = $2
          AND accountable_institution_id = $3
        """,
        [document_id, transfer["id"], transfer["accountable_institution_id"]],
    )
    if not result.rows:
        raise DocumentNotFoundError("Document not found")
    return result.rows[0]


# --------------------------------------------------------------------------
# File upload: validate -> store -> scan -> persist state
# --------------------------------------------------------------------------

async def upload_document_file(
    transfer: dict,
    document: dict,
    data: bytes,
    filename: Optional[str],
    *,
    storage: DocumentStorage,
    scanner: MalwareScanner,
    user: Any,
) -> tuple[dict, str]:
    """Upload file bytes onto an existing document row.

    Returns (row, outcome) where outcome is 'uploaded', 'quarantined',
    'scan_pending' or 'replay'. Raises DocumentValidationError for
    size/type rejections and DocumentIdempotencyConflictError when a
    different file is presented for a document that already has one.
    """
    if len(data) == 0:
        raise DocumentValidationError("Empty file")
    if len(data) > MAX_FILE_BYTES:
        await record_operation(
            "upload_rejected",
            "failure",
            accountable_institution_id=document["accountable_institution_id"],
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(document["id"]),
            detail={"reason": "size_limit", "size": len(data)},
        )
        raise DocumentValidationError("File exceeds the 25 MB limit")

    content_type = sniff_file_type(data, filename)
    digest = file_fingerprint(data)
    ai = document["accountable_institution_id"]

    # Upload binds to the document row: same bytes replay the stored outcome;
    # different bytes on a document that already has a file conflict — there
    # is no replacement in this slice.
    if document.get("sha256"):
        if document["sha256"] == digest:
            if document["scan_status"] == "clean":
                return document, "replay"
            return await _rescan_or_record(
                transfer, document, data, storage, scanner, user
            )
        await record_operation(
            "upload_rejected",
            "conflict",
            accountable_institution_id=ai,
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(document["id"]),
            detail={"reason": "different_file"},
        )
        raise DocumentIdempotencyConflictError(
            "A different file was supplied for an existing document — "
            "replacement is not supported"
        )

    # Content-addressed key: same bytes always resolve to the same object, so
    # a retry or concurrent identical upload cannot accumulate duplicates.
    storage_key = build_storage_key(ai, str(transfer["id"]), str(document["id"]), digest)
    instance_id = uuid.uuid4()
    try:
        storage.put(storage_key, data, content_type)
    except Exception as exc:
        await record_operation(
            "file_uploaded",
            "failure",
            accountable_institution_id=ai,
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(document["id"]),
            detail={"stage": "storage", "error": type(exc).__name__},
        )
        raise DocumentServiceError("File storage failed") from exc

    # Persist the object reference BEFORE scanning so a scanner failure leaves
    # a durable, reconcilable record (stored-but-unscanned), not a silent
    # orphan. The UPDATE is conditional on sha256 IS NULL: a concurrent upload
    # that already persisted wins; this writer then resolves from the stored
    # row (same digest → continue; different → conflict). The stored object
    # can therefore never be silently overwritten or duplicated.
    try:
        stored = await _persist_file_state(
            document,
            storage_key=storage_key,
            instance_id=instance_id,
            digest=digest,
            content_type=content_type,
            filename=filename,
            size=len(data),
            scan_status="pending",
            scan_result=None,
            status="pending",
            user=user,
        )
    except Exception as exc:
        # Storage succeeded but the row did not — the object is reconcilable
        # through this durable record (storage_key is an internal identifier,
        # never exposed to clients).
        await record_operation(
            "file_uploaded",
            "failure",
            accountable_institution_id=ai,
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(document["id"]),
            detail={
                "stage": "persist",
                "error": type(exc).__name__,
                "storage_key": storage_key,
                "file_instance_id": str(instance_id),
            },
        )
        raise DocumentServiceError("Document persistence failed") from exc
    if stored is None:
        # Concurrent writer already persisted this document. Resolve from the
        # stored row: identical bytes continue to the (shared) scan outcome;
        # different bytes conflict — replacement is not supported.
        current = await get_document(transfer, str(document["id"]))
        if current.get("sha256") == digest:
            await record_operation(
                "file_uploaded",
                "conflict",
                accountable_institution_id=ai,
                actor_user_id=user.user_id,
                transfer_id=str(transfer["id"]),
                document_id=str(document["id"]),
                detail={"reason": "concurrent_same_file"},
            )
            if current["scan_status"] == "clean":
                return current, "replay"
            return await _scan_and_finalize(transfer, current, data, scanner, user)
        await record_operation(
            "upload_rejected",
            "conflict",
            accountable_institution_id=ai,
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(document["id"]),
            # The losing writer's object was already stored under its own
            # digest key — record it so the orphan is reconcilable.
            detail={
                "reason": "concurrent_different_file",
                "storage_key": storage_key,
                "file_instance_id": str(instance_id),
            },
        )
        raise DocumentIdempotencyConflictError(
            "A different file was supplied for an existing document — "
            "replacement is not supported"
        )
    await record_operation(
        "file_uploaded",
        "success",
        accountable_institution_id=ai,
        actor_user_id=user.user_id,
        transfer_id=str(transfer["id"]),
        document_id=str(document["id"]),
        detail={"file_instance_id": str(instance_id), "size": len(data), "type": content_type},
    )
    return await _scan_and_finalize(transfer, stored, data, scanner, user)


async def _rescan_or_record(transfer, document, data, storage, scanner, user):
    """Same-bytes retry on a document whose earlier scan did not complete."""
    if document["scan_status"] in ("pending", "error"):
        return await _scan_and_finalize(transfer, document, data, scanner, user)
    # 'infected' — the verdict is final for these bytes.
    return document, "replay"


async def _persist_file_state(
    document: dict,
    *,
    storage_key: str,
    instance_id: uuid.UUID,
    digest: str,
    content_type: str,
    filename: Optional[str],
    size: int,
    scan_status: str,
    scan_result: Optional[str],
    status: str,
    user: Any,
) -> dict:
    # sha256 IS NULL makes the write single-winner: only the first upload to
    # persist wins; a concurrent writer gets no row and resolves from the
    # stored state — the first writer's object is never overwritten.
    result = await db.query(
        f"""
        UPDATE transfer_documents
        SET storage_key = $2, file_instance_id = $3, sha256 = $4,
            file_type = $5, original_file_name = $6, file_size = $7,
            scan_status = $8, scan_result = $9, status = $10,
            uploaded_by_user_id = $11, uploaded_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND sha256 IS NULL
        RETURNING {_DOC_READ_COLUMNS}
        """,
        [
            document["id"],
            storage_key,
            instance_id,
            digest,
            content_type,
            filename,
            size,
            scan_status,
            scan_result,
            status,
            user.user_id,
        ],
    )
    return result.rows[0] if result.rows else None


async def _scan_and_finalize(transfer, document, data, scanner, user):
    ai = document["accountable_institution_id"]
    try:
        result = await scanner.scan(data)
    except ScannerUnavailableError as exc:
        await db.query(
            "UPDATE transfer_documents SET scan_status = 'error', scan_result = $2 WHERE id = $1",
            [document["id"], type(exc).__name__],
        )
        await record_operation(
            "scan_completed",
            "failure",
            accountable_institution_id=ai,
            actor_user_id=user.user_id,
            transfer_id=str(transfer["id"]),
            document_id=str(document["id"]),
            detail={"error": type(exc).__name__},
        )
        row = await get_document(transfer, str(document["id"]))
        return row, "scan_pending"

    status = "uploaded" if result.status == "clean" else "pending"
    row = await _persist_scan_result(document, result.status, result.signature, status)
    await record_operation(
        "scan_completed",
        "success" if result.status == "clean" else "failure",
        accountable_institution_id=ai,
        actor_user_id=user.user_id,
        transfer_id=str(transfer["id"]),
        document_id=str(document["id"]),
        detail={"scan_status": result.status, "signature": result.signature},
    )
    return row, ("uploaded" if result.status == "clean" else "quarantined")


async def _persist_scan_result(document, scan_status, signature, status):
    result = await db.query(
        f"""
        UPDATE transfer_documents
        SET scan_status = $2, scan_result = $3, scanned_at = CURRENT_TIMESTAMP,
            status = $4
        WHERE id = $1
        RETURNING {_DOC_READ_COLUMNS}
        """,
        [document["id"], scan_status, signature, status],
    )
    return result.rows[0]


# --------------------------------------------------------------------------
# Short-lived opaque download tokens
# --------------------------------------------------------------------------
# Token: 'v1.<b64url payload>.<b64url HMAC-SHA256>'. Payload carries only
# identifiers + expiry + a jti for audit correlation. Stateless — there is
# NO individual revocation before expiry; exposure is bounded by the TTL.
# Whoever holds the token may retrieve the file within the TTL (bearer-link
# reuse); the document's clean/uploaded state is re-checked at retrieval.

DEFAULT_TOKEN_TTL_SECONDS = 300


def issue_download_token(
    document: dict,
    secret: str,
    ttl_seconds: int = DEFAULT_TOKEN_TTL_SECONDS,
) -> tuple[str, int]:
    if not (
        document["status"] == "uploaded"
        and document["scan_status"] == "clean"
        and document.get("storage_key")
    ):
        raise DocumentNotAvailableError(
            "Document is not available for download"
        )
    expires = int(datetime.now(timezone.utc).timestamp()) + ttl_seconds
    payload = {
        "v": 1,
        "sc": "doc-dl",
        "doc": str(document["id"]),
        "ai": document["accountable_institution_id"],
        "exp": expires,
        "jti": str(uuid.uuid4()),
    }
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    token = f"v1.{body}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"
    return token, expires


def verify_download_token(token: str, secret: str) -> Optional[dict]:
    try:
        version, body, sig = token.split(".")
        if version != "v1":
            return None
        expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
        provided = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4))
        if not hmac.compare_digest(expected, provided):
            return None
        payload = json.loads(
            base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        )
        if payload.get("sc") != "doc-dl":
            return None
        if int(payload["exp"]) < int(datetime.now(timezone.utc).timestamp()):
            return None
        return payload
    except Exception:
        return None


async def get_document_for_download(document_id: str, ai: int) -> dict:
    result = await db.query(
        f"""
        SELECT {_DOC_READ_COLUMNS}
        FROM transfer_documents
        WHERE id = $1 AND accountable_institution_id = $2
        """,
        [document_id, ai],
    )
    if not result.rows:
        raise DocumentNotFoundError("Document not found")
    doc = result.rows[0]
    if not (
        doc["status"] == "uploaded"
        and doc["scan_status"] == "clean"
        and doc.get("storage_key")
    ):
        raise DocumentNotAvailableError("Document is not available for download")
    return doc


# --------------------------------------------------------------------------
# Document requirements — rule evaluation + idempotent recalculation
# --------------------------------------------------------------------------

async def _load_matter_context(transfer: dict) -> dict:
    """Evaluate the supported condition vocabulary against stored matter data.

    has_bond is tri-state: True/False when evidence exists, None when the
    financing facts are missing — a missing fact must NOT be treated as a
    negative answer. These heuristics are implementation choices pending
    Dean's approved rule definitions, not business facts.
    """
    context = {"classification_code": None, "has_bond": None}

    matter_result = await db.query(
        """
        SELECT classification_code FROM matters
        WHERE id = $1 AND accountable_institution_id = $2
        """,
        [transfer["matter_id"], transfer["accountable_institution_id"]],
    )
    if matter_result.rows:
        context["classification_code"] = matter_result.rows[0].get("classification_code")

    bond_result = await db.query(
        "SELECT 1 AS present FROM bonds WHERE transfer_id = $1 LIMIT 1",
        [transfer["id"]],
    )
    loan_result = await db.query(
        "SELECT loan_amount FROM transfer_financials WHERE transfer_id = $1 LIMIT 1",
        [transfer["id"]],
    )
    if bond_result.rows:
        context["has_bond"] = True
    elif loan_result.rows:
        loan = loan_result.rows[0].get("loan_amount")
        # Explicit loan data decides; a NULL amount stays unknown.
        if loan is not None:
            context["has_bond"] = float(loan) > 0
    return context


def _rule_evaluable(rule: dict, context: dict) -> bool:
    """True when the rule can actually be decided for this matter.

    A rule is unevaluable when its condition_key is outside the supported
    vocabulary, when it is scoped to a classification the matter does not
    record, or when the underlying fact is missing (has_bond unknown).
    Unevaluable rules are surfaced via 'unevaluatedRules' and any existing
    requirement bound to them is left untouched — never silently applied
    or withdrawn.
    """
    classification = rule.get("classification_code")
    if classification and classification != "*" and context.get("classification_code") is None:
        return False
    condition = rule.get("condition_key")
    if condition is None:
        return True
    if condition not in _SUPPORTED_CONDITIONS:
        return False
    if condition in ("has_bond", "cash_purchase") and context.get("has_bond") is None:
        return False
    return True


def _rule_applies(rule: dict, context: dict) -> bool:
    classification = rule.get("classification_code")
    if classification and classification != "*" and classification != context.get("classification_code"):
        return False
    condition = rule.get("condition_key")
    if condition is None:
        return True
    if condition == "has_bond":
        return context["has_bond"] is True
    if condition == "cash_purchase":
        return context["has_bond"] is False
    return False  # unreachable while _rule_evaluable gates callers


async def recalculate_requirements(transfer: dict, user: Any) -> dict:
    """Apply active rules to the matter. Idempotent upsert.

    Requirements that stop applying are marked 'withdrawn' — never deleted —
    and the uploaded evidence linked via requirement_key is never touched.
    Rules whose condition is outside the supported vocabulary are reported
    under 'unevaluatedRules' and their existing requirements are preserved:
    an unevaluated rule is never silently treated as "not required".
    Returns the post-recalculation requirement list.
    """
    ai = transfer["accountable_institution_id"]
    context = await _load_matter_context(transfer)
    rules_result = await db.query(
        """
        SELECT rule_key, display_name, classification_code, condition_key
        FROM document_requirement_rules
        WHERE status = 'active'
        ORDER BY sequence_number, rule_key
        """,
        [],
    )
    evaluable = [rule for rule in rules_result.rows if _rule_evaluable(rule, context)]
    unevaluated = [rule for rule in rules_result.rows if not _rule_evaluable(rule, context)]
    applicable = {
        rule["rule_key"]: rule
        for rule in evaluable
        if _rule_applies(rule, context)
    }
    # Keys that may be withdrawn: evaluable rules only. Requirements bound to
    # unevaluated rules are excluded from the withdrawal set — we cannot
    # prove they stopped applying.
    withdrawable = {rule["rule_key"] for rule in evaluable}

    async def _apply(connection: Any) -> None:
        for key, rule in applicable.items():
            await db.query(
                """
                INSERT INTO transfer_document_requirements
                    (transfer_id, accountable_institution_id, requirement_key,
                     display_name, source, condition_key, status, applied_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'active', CURRENT_TIMESTAMP)
                ON CONFLICT (transfer_id, requirement_key) DO UPDATE SET
                    status = 'active', withdrawn_at = NULL,
                    display_name = EXCLUDED.display_name,
                    updated_at = CURRENT_TIMESTAMP
                """,
                [
                    transfer["id"],
                    ai,
                    key,
                    rule["display_name"],
                    "conditional" if rule.get("condition_key") else "baseline",
                    rule.get("condition_key"),
                ],
                connection=connection,
            )
        # Withdraw evaluable requirements whose rule no longer applies — in
        # place, never a delete. Unevaluated rules are outside this set.
        await db.query(
            """
            UPDATE transfer_document_requirements
            SET status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE transfer_id = $1 AND accountable_institution_id = $2
              AND status = 'active'
              AND requirement_key = ANY($3::varchar[])
              AND requirement_key <> ALL($4::varchar[])
            """,
            [transfer["id"], ai, list(withdrawable), list(applicable.keys())],
            connection=connection,
        )

    await db.with_transaction(_apply)
    await record_operation(
        "requirements_recalculated",
        "success",
        accountable_institution_id=ai,
        actor_user_id=user.user_id,
        transfer_id=str(transfer["id"]),
        document_id=None,
        detail={
            "classification_code": context.get("classification_code"),
            "applicable": sorted(applicable.keys()),
            "unevaluated": [rule["rule_key"] for rule in unevaluated],
        },
    )
    data = await list_requirements(transfer)
    data["unevaluatedRules"] = [
        {"ruleKey": rule["rule_key"], "conditionKey": rule.get("condition_key")}
        for rule in unevaluated
    ]
    return data


async def list_requirements(transfer: dict) -> dict:
    """Requirements with satisfaction state — evidence joins, never deletes."""
    result = await db.query(
        """
        SELECT r.id, r.requirement_key, r.display_name, r.source,
               r.condition_key, r.status, r.applied_at, r.withdrawn_at,
               (
                   SELECT d.id FROM transfer_documents d
                   WHERE d.transfer_id = r.transfer_id
                     AND d.requirement_key = r.requirement_key
                     AND d.status = 'uploaded' AND d.scan_status = 'clean'
                   ORDER BY d.uploaded_at DESC NULLS LAST
                   LIMIT 1
               ) AS satisfied_document_id,
               (
                   SELECT d.id FROM transfer_documents d
                   WHERE d.transfer_id = r.transfer_id
                     AND d.requirement_key = r.requirement_key
                   ORDER BY d.created_at DESC
                   LIMIT 1
               ) AS linked_document_id
        FROM transfer_document_requirements r
        WHERE r.transfer_id = $1 AND r.accountable_institution_id = $2
        ORDER BY r.applied_at, r.requirement_key
        """,
        [transfer["id"], transfer["accountable_institution_id"]],
    )
    return {
        "requirements": [
            {
                "id": str(row["id"]),
                "requirementKey": row["requirement_key"],
                "displayName": row["display_name"],
                "source": row["source"],
                "conditionKey": row["condition_key"],
                "status": row["status"],
                "satisfiedDocumentId": (
                    str(row["satisfied_document_id"])
                    if row["satisfied_document_id"]
                    else None
                ),
                "linkedDocumentId": (
                    str(row["linked_document_id"]) if row["linked_document_id"] else None
                ),
            }
            for row in result.rows
        ]
    }
