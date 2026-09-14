-- Add a party-source model to transfer_parties: institution-owned manual parties
-- alongside Golden Record-linked parties, plus institution-scoped request
-- idempotency on transfers and transfer_parties.
-- Migration: 023_deedly_manual_party_sources.sql
--
-- Notes:
-- - Existing rows are all Golden Record-linked, so the 'golden_record' default
--   backfills them correctly and their (transfer_id, golden_record_id, role)
--   uniqueness is unchanged.
-- - Manual capture fields are institution-private matter data (name, id_number,
--   email, phone, address) mirroring the existing capture shape. No Golden
--   Record identity-of-record columns are added.
-- - manual_id_type/manual_passport_country exist solely so the advisory
--   duplicate check can compare LIKE identifier types (an SA ID is never
--   compared to a passport number, and passport country disambiguates where
--   captured). All identifier fields stay optional: no mandatory identifier
--   and no identifier exclusivity is introduced.
-- - entity_type remains explicit for BOTH sources. This slice supports manual
--   natural persons only; the CHECK enforces entity_type = 'person' for manual
--   rows until company/trust capture is approved.
-- - client_request_id provides request idempotency scoped by
--   accountable_institution_id, so a foreign institution's reuse of a key can
--   neither observe nor collide with another institution's request.

BEGIN;

SET LOCAL search_path TO transfers, public;

-- 1. transfer_parties: source discriminator + manual capture fields + idempotency.
ALTER TABLE transfer_parties
    ADD COLUMN IF NOT EXISTS party_source VARCHAR(16) NOT NULL DEFAULT 'golden_record',
    ADD COLUMN IF NOT EXISTS manual_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS manual_id_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS manual_id_type VARCHAR(16),
    ADD COLUMN IF NOT EXISTS manual_passport_country VARCHAR(3),
    ADD COLUMN IF NOT EXISTS manual_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS manual_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS manual_address TEXT,
    ADD COLUMN IF NOT EXISTS client_request_id UUID,
    ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64),
    ADD COLUMN IF NOT EXISTS acknowledged_duplicate BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE transfer_parties
    ALTER COLUMN golden_record_id DROP NOT NULL;

-- 2. Source/field consistency: a row is exactly one shape.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'transfer_parties'
          AND constraint_name = 'transfer_parties_party_source_check'
    ) THEN
        ALTER TABLE transfer_parties
            ADD CONSTRAINT transfer_parties_party_source_check
            CHECK (party_source IN ('golden_record', 'manual'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'transfer_parties'
          AND constraint_name = 'transfer_parties_source_fields_check'
    ) THEN
        ALTER TABLE transfer_parties
            ADD CONSTRAINT transfer_parties_source_fields_check CHECK (
                (
                    party_source = 'golden_record'
                    AND golden_record_id IS NOT NULL
                    AND manual_name IS NULL
                    AND manual_id_number IS NULL
                    AND manual_id_type IS NULL
                    AND manual_passport_country IS NULL
                    AND manual_email IS NULL
                    AND manual_phone IS NULL
                    AND manual_address IS NULL
                )
                OR
                (
                    party_source = 'manual'
                    AND entity_type = 'person'
                    AND golden_record_id IS NULL
                    AND manual_name IS NOT NULL
                    AND btrim(manual_name) <> ''
                    AND (manual_id_type IS NULL OR manual_id_type IN ('sa_id', 'passport', 'other'))
                    AND (manual_passport_country IS NULL OR manual_id_type = 'passport')
                )
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_parties_client_request
    ON transfer_parties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

-- 3. transfers: idempotent matter creation.
ALTER TABLE transfers
    ADD COLUMN IF NOT EXISTS client_request_id UUID,
    ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_client_request
    ON transfers (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

COMMIT;
