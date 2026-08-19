-- Add the target transfer_parties relationship table
-- Migration: 008_create_transfer_parties.sql
-- Created: 2026-08-19

BEGIN;

-- Ensure the target schema convention is used and not public.
CREATE SCHEMA IF NOT EXISTS transfers;
SET LOCAL search_path TO transfers, public;

CREATE TABLE IF NOT EXISTS transfer_parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    golden_record_id UUID NOT NULL,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('person', 'company')),
    role VARCHAR(40) NOT NULL,
    accountable_institution_id INTEGER NOT NULL,
    cached_name VARCHAR(255),
    cached_id_number VARCHAR(100),
    cached_email VARCHAR(255),
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (transfer_id, golden_record_id, role)
);

CREATE INDEX IF NOT EXISTS idx_transfer_parties_transfer_id ON transfer_parties(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_parties_golden_record_id ON transfer_parties(golden_record_id);
CREATE INDEX IF NOT EXISTS idx_transfer_parties_accountable_institution_id ON transfer_parties(accountable_institution_id);

-- Use the existing updated_at trigger function if available.
-- It is created by earlier migrations (001/002/003).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'update_updated_at_column'
    ) THEN
        EXECUTE 'DROP TRIGGER IF EXISTS update_transfer_parties_updated_at ON transfer_parties';
        EXECUTE 'CREATE TRIGGER update_transfer_parties_updated_at BEFORE UPDATE ON transfer_parties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
    END IF;
END $$;

COMMIT;
