-- Relocate Transfers/DEEDLY-owned working data tables to the lowercase transfers schema.
-- Migration: 010_move_transfer_owned_tables_to_transfers_schema.sql
-- Created: 2026-08-19

BEGIN;

CREATE SCHEMA IF NOT EXISTS transfers;

-- Deprecated legacy views are not used by application code and are removed before
-- the table relocation so they cannot reference the old public.table names.
DROP VIEW IF EXISTS public.transfer_summary;
DROP VIEW IF EXISTS public.party_details;
DROP VIEW IF EXISTS public.property_details;
DROP VIEW IF EXISTS public.document_details;

-- Move approved Transfers-owned working-data tables from public to transfers.
-- Each table is only relocated if it still exists in public and is not already
-- present in transfers. If a source table has already been moved, the loop is a
-- no-op for that table. If a required table is missing from both schemas or
-- exists in both (conflict), the migration fails loudly so the situation is not
-- guessed. Cross-schema FKs to temporarily retained public tables are preserved.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'matters',
    'transfers',
    'parties',
    'properties',
    'transfer_financials',
    'milestone_definitions',
    'matter_milestones',
    'milestone_history',
    'transfer_documents',
    'refunds',
    'municipal_accounts',
    'clearance_records',
    'transfer_guarantees',
    'transfer_conditions',
    'compliance_certificates',
    'matter_accounts',
    'matter_account_entries'
  ];
  src regclass;
  dst regclass;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    src := to_regclass('public.' || t);
    dst := to_regclass('transfers.' || t);

    IF src IS NOT NULL AND dst IS NOT NULL THEN
      RAISE EXCEPTION 'migration 010: table % exists in both public and transfers; manual resolution required', t;
    ELSIF src IS NULL AND dst IS NULL THEN
      RAISE EXCEPTION 'migration 010: required table % not found in public or transfers', t;
    ELSIF src IS NOT NULL AND dst IS NULL THEN
      EXECUTE format('ALTER TABLE %I.%I SET SCHEMA %I', 'public', t, 'transfers');
    END IF;
  END LOOP;
END $$;

COMMIT;
