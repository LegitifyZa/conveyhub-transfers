-- Migration: 024_deedly_property_link_idempotency.sql
-- Purpose: Add institution-scoped request idempotency to the property slice —
--          manual property capture (transfers.properties) and the canonical
--          matter–property relationship (transfers.matter_properties).
--
-- Notes:
-- - Mirrors the migration 023 idempotency pattern on transfers /
--   transfer_parties: a nullable client_request_id plus a stored
--   request_fingerprint, with a partial unique index on
--   (accountable_institution_id, client_request_id) so a foreign
--   institution's identical key can neither observe nor collide.
-- - The fingerprint is SHA-256 over {operation, transfer_id, matter_id,
--   validated payload} computed by the application — target-bound, so key
--   reuse against a different matter or payload conflicts (409).
-- - No backfill: existing rows keep client_request_id NULL and stay outside
--   the partial unique indexes. The 019 legacy-sync trigger writes its own
--   property_source provenance and never these columns, so it is unaffected.
-- - matter_properties.accountable_institution_id remains trigger-derived
--   from the parent matter (018/019); the index follows that derived value.
-- - Schema-qualify all targets: this migration must run identically whether
--   or not the caller presets search_path.

BEGIN;

SET LOCAL search_path TO transfers, public;

-- 1. Manual property capture idempotency.
ALTER TABLE transfers.properties
    ADD COLUMN IF NOT EXISTS client_request_id UUID,
    ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_client_request_id
    ON transfers.properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

-- 2. Matter–property link idempotency.
ALTER TABLE transfers.matter_properties
    ADD COLUMN IF NOT EXISTS client_request_id UUID,
    ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_properties_client_request_id
    ON transfers.matter_properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

COMMIT;
