-- Add external platform tenant ownership columns to matters and transfers
-- Migration: 009_add_accountable_institution_id_to_matters_and_transfers.sql
-- Created: 2026-08-19

BEGIN;

CREATE SCHEMA IF NOT EXISTS transfers;
SET LOCAL search_path TO transfers, public;

-- Add nullable tenant-owner columns for transitional mapping from firm_id.
-- These are cross-database platform identifiers, not database FKs.
ALTER TABLE matters
    ADD COLUMN IF NOT EXISTS accountable_institution_id INTEGER;

ALTER TABLE transfers
    ADD COLUMN IF NOT EXISTS accountable_institution_id INTEGER;

-- Indexes for tenant-scoped queries.
CREATE INDEX IF NOT EXISTS idx_matters_accountable_institution_id
    ON matters (accountable_institution_id);

CREATE INDEX IF NOT EXISTS idx_transfers_accountable_institution_id
    ON transfers (accountable_institution_id);

COMMIT;
