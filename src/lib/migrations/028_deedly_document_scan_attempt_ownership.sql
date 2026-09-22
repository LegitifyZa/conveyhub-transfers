-- Migration 028: DEEDLY matter documents — scan-attempt ownership.
--
-- Status: PROPOSED — authored for review. Executed only against the isolated
-- deedly-documents-test scratch database for test coverage; no production or
-- shared application database has been migrated. Numbering is coordinated
-- through Dean to Jordan (026/027 are reserved on other tracks).
--
-- Adds a lease-based ownership marker so a single authorised scan attempt owns
-- a document's pending scan: only the current attempt may publish a verdict,
-- and an abandoned attempt becomes reclaimable once its lease expires.

BEGIN;

SET LOCAL search_path TO transfers, public;

ALTER TABLE transfers.transfer_documents
    ADD COLUMN IF NOT EXISTS scan_attempt_id UUID,
    ADD COLUMN IF NOT EXISTS scan_attempt_expires_at TIMESTAMPTZ;

-- Partial index: lets a recovery sweep find live/expired claims without
-- scanning rows that have never been claimed.
CREATE INDEX IF NOT EXISTS idx_transfer_documents_scan_attempt_expiry
    ON transfers.transfer_documents (scan_attempt_expires_at)
    WHERE scan_attempt_id IS NOT NULL;

COMMENT ON COLUMN transfers.transfer_documents.scan_attempt_id IS
    'UUID of the scan attempt currently authorised to publish a verdict; NULL when no attempt is in flight.';
COMMENT ON COLUMN transfers.transfer_documents.scan_attempt_expires_at IS
    'Lease expiry for the owning scan attempt; after this passes another attempt may claim the document.';

COMMIT;
