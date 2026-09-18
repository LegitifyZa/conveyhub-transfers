-- Migration 025: DEEDLY authenticated matter documents — upload, scan-gated
-- storage, idempotency, requirements, and reconciliation audit.
--
-- Status: PROPOSED — authored for review, NOT executed against any database.
-- Schema additions and numbering are coordinated through Dean to Jordan.
--
-- Table of contents:
--   A. transfer_documents — tenant, storage, scan and idempotency columns.
--   B. document_requirement_rules — approved-requirement catalogue config.
--   C. transfer_document_requirements — per-matter requirement instances.
--   D. document_operation_log — durable reconciliation/audit trail.
--   E. PROPOSED (Jordan review): deletion-path change for retained files.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. transfer_documents additions
-- ---------------------------------------------------------------------------

-- Institution denormalisation. The table has historically relied on the parent
-- transfer for tenant scoping; a direct column is required for institution-
-- scoped idempotency keys and unambiguous storage/audit attribution.
-- NOTE (Jordan review): the NOT NULL backfill below assumes every existing row
-- has a parent transfers row — the FK guarantees this.
ALTER TABLE transfer_documents
    ADD COLUMN IF NOT EXISTS accountable_institution_id INTEGER;

UPDATE transfer_documents td
SET accountable_institution_id = t.accountable_institution_id
FROM transfers t
WHERE td.transfer_id = t.id
  AND td.accountable_institution_id IS NULL;

ALTER TABLE transfer_documents
    ALTER COLUMN accountable_institution_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transfer_documents_ai
    ON transfer_documents (accountable_institution_id);

-- Idempotency (mirrors the 023 transfers / 024 property pattern).
ALTER TABLE transfer_documents
    ADD COLUMN IF NOT EXISTS client_request_id UUID,
    ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_documents_client_request
    ON transfer_documents (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

-- Requirement satisfaction link. A requirement is a rule-driven obligation;
-- the uploaded document remains a separate record. NULL = free-form upload.
ALTER TABLE transfer_documents
    ADD COLUMN IF NOT EXISTS requirement_key VARCHAR(150);

CREATE INDEX IF NOT EXISTS idx_transfer_documents_requirement
    ON transfer_documents (transfer_id, requirement_key)
    WHERE requirement_key IS NOT NULL;

-- Storage abstraction fields. storage_key is internal-only and must never be
-- projected to clients (mirrors the file_path rule in the v1 list queries).
ALTER TABLE transfer_documents
    ADD COLUMN IF NOT EXISTS storage_key TEXT,
    ADD COLUMN IF NOT EXISTS file_instance_id UUID,
    ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64);

-- Scan state is deliberately separate from the document lifecycle status and
-- from any future human review state. 'not_scanned' rows have no stored file.
ALTER TABLE transfer_documents
    ADD COLUMN IF NOT EXISTS scan_status VARCHAR(30) NOT NULL DEFAULT 'not_scanned'
        CHECK (scan_status IN ('not_scanned', 'pending', 'clean', 'infected', 'error')),
    ADD COLUMN IF NOT EXISTS scan_result VARCHAR(255),
    ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- B. document_requirement_rules — requirement catalogue configuration
-- ---------------------------------------------------------------------------
-- The rules table is seeded from the approved catalogue Dean will supply.
-- This migration creates the mechanism only; it deliberately seeds NO
-- production rules. Example INSERTs are provided commented out — they are
-- illustrative, not approved production requirements.
--
--   condition_key NULL  -> baseline rule (applies whenever classification
--                          matches; classification NULL/'*' matches all).
--   condition_key SET   -> conditional rule, evaluated by the service against
--                          a fixed supported vocabulary (documented in
--                          matter_document_service; unrecognised keys are
--                          inert, never silently treated as applicable).

CREATE TABLE IF NOT EXISTS document_requirement_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_key VARCHAR(150) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    classification_code VARCHAR(100),
    condition_key VARCHAR(100),
    sequence_number INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ILLUSTRATIVE ONLY — not an approved production requirement. Pending Dean's
-- catalogue, this stays commented out:
-- INSERT INTO document_requirement_rules
--     (rule_key, display_name, classification_code, condition_key, sequence_number)
-- VALUES
--     ('example_bond_approval_letter', 'Bond approval letter (EXAMPLE)', NULL, 'has_bond', 10)
-- ON CONFLICT (rule_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- C. transfer_document_requirements — per-matter requirement instances
-- ---------------------------------------------------------------------------
-- One row per (transfer, requirement_key). Recalculation upserts: a rule that
-- stops applying marks the row 'withdrawn' — it is never deleted, and the
-- uploaded evidence linked via transfer_documents.requirement_key is never
-- touched. A withdrawn requirement that becomes applicable again is
-- reactivated in place, preserving its history window.

CREATE TABLE IF NOT EXISTS transfer_document_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    accountable_institution_id INTEGER NOT NULL,
    requirement_key VARCHAR(150) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('baseline', 'conditional')),
    condition_key VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    withdrawn_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (transfer_id, requirement_key)
);

CREATE INDEX IF NOT EXISTS idx_transfer_doc_requirements_transfer
    ON transfer_document_requirements (transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_doc_requirements_ai
    ON transfer_document_requirements (accountable_institution_id);

-- ---------------------------------------------------------------------------
-- D. document_operation_log — durable reconciliation + audit trail
-- ---------------------------------------------------------------------------
-- Records document-lane operations with the identifiers and outcome needed
-- for later reconciliation: upload outcomes, scan results, download-link
-- issuance, observed retrievals, and partial failures (e.g. stored-but-
-- unscanned). This is the audit adapter for this slice; the platform audit
-- logger contract (legitify_auditor via AUDIT_DATABASE_URL) is a flagged
-- missing integration — see docs/deedly-matter-documents-decisions.md.
--
-- HARD RULE: never write file contents, credentials, or download tokens into
-- detail. Identifiers and outcomes only.

CREATE TABLE IF NOT EXISTS document_operation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    operation VARCHAR(40) NOT NULL CHECK (operation IN (
        'document_created',
        'file_uploaded',
        'scan_completed',
        'upload_rejected',
        'download_link_issued',
        'download_retrieved',
        'download_denied',
        'requirements_recalculated',
        'audit_delivery_failed'
    )),
    outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'conflict')),
    accountable_institution_id INTEGER NOT NULL,
    actor_user_id INTEGER,
    transfer_id UUID,
    document_id UUID,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_op_log_transfer
    ON document_operation_log (transfer_id);
CREATE INDEX IF NOT EXISTS idx_doc_op_log_document
    ON document_operation_log (document_id);
CREATE INDEX IF NOT EXISTS idx_doc_op_log_operation_time
    ON document_operation_log (operation, occurred_at);

-- ---------------------------------------------------------------------------
-- E. PROPOSED for Jordan's review — deletion path for retained files
-- ---------------------------------------------------------------------------
-- transfer_documents.transfer_id is ON DELETE CASCADE (constraint
-- transfer_documents_transfer_id_fkey, created in migration 005; the table
-- moved to the transfers schema in 010). A transfer delete therefore
-- destroys the rows that are the only metadata record of retained storage
-- objects — the exact "metadata cascade silently destroys the only record"
-- risk. NOTE: this comment is a proposal, NOT active protection.
--
-- Documented parent-deletion paths (all currently non-operational):
--   1. DELETE /api/transfers/:id — quarantined on BOTH the BFF and FastAPI
--      (401/503), but live handlers exist behind the quarantine and would
--      issue DELETE FROM transfers, cascading here if ever re-enabled.
--   2. TransferService.deleteTransfer (src/lib/services/transferService.ts)
--      — reachable only via path 1.
--   3. Frontend useTransfers.deleteTransfer → the quarantined endpoint.
--   4. Linked-matter deletion inside the quarantined handlers
--      (DELETE FROM matters WHERE id = $1) removes the matter row too.
--   5. DatabaseUtils.cleanupOldRecords (src/lib/utils/databaseUtils.ts) —
--      latent, never called; would bulk-delete 'cancelled' transfers.
--   6. Direct SQL/operator — only the FK action itself decides the outcome.
--
-- Proposal A (preferred): forbid deleting transfers that still have document
-- metadata; archive instead. Requires product confirmation that transfer
-- deletion is never a valid operation once documents exist:
--
--   ALTER TABLE transfer_documents
--       DROP CONSTRAINT transfer_documents_transfer_id_fkey,
--       ADD CONSTRAINT transfer_documents_transfer_id_fkey
--           FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE RESTRICT;
--
-- Proposal B: keep CASCADE but require the deleting path to first tombstone
--   rows and orphan the storage objects under an explicit retention run.
--
-- The same decision applies to transfer_document_requirements (currently
-- CASCADE above, matching the parent convention).
-- document_operation_log.transfer_id is deliberately FK-free so
-- audit/reconciliation rows survive parent deletion. Jordan owns the
-- choice; do not apply either variant
-- without approval. Physical object deletion is disabled in this slice —
-- the storage interface has no delete operation.

COMMIT;
