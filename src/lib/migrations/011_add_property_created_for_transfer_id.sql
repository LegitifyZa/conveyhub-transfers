-- Add provenance marker to properties for transfer-scaffolding ownership.
-- Migration: 011_add_property_created_for_transfer_id.sql
-- Created: 2026-08-21

BEGIN;

SET LOCAL search_path TO transfers, public;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'transfers'
          AND table_name = 'properties'
          AND column_name = 'created_for_transfer_id'
    ) THEN
        ALTER TABLE properties
            ADD COLUMN created_for_transfer_id VARCHAR(50);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_properties_created_for_transfer_id
    ON properties (created_for_transfer_id);

COMMIT;
