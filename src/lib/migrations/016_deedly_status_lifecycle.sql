-- Migration: 016_deedly_status_lifecycle.sql
-- Purpose: Align DEEDLY transfers.status and transfer matters.status to the
--          two-state lifecycle: in_progress / complete.
-- Created: 2026-08-26

BEGIN;
SET LOCAL search_path TO transfers, public;

CREATE SCHEMA IF NOT EXISTS transfers;

-- 1. Preflight guard for transfers.status
DO $$
DECLARE
    v_invalid_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_invalid_count
    FROM transfers
    WHERE status NOT IN ('draft', 'in_progress', 'completed', 'complete');

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Migration 016: % transfer(s) have unsupported status values. Manual review required before converting to DEEDLY lifecycle.', v_invalid_count;
    END IF;
END $$;

-- 2. Preflight guard for DEEDLY transfer matters.status
DO $$
DECLARE
    v_invalid_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_invalid_count
    FROM matters
    WHERE matter_type = 'transfer'
      AND status NOT IN ('draft', 'in_progress', 'completed', 'complete');

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Migration 016: % DEEDLY transfer matter(s) have unsupported status values. Manual review required before converting to DEEDLY lifecycle.', v_invalid_count;
    END IF;
END $$;

-- 3. Convert transfers.status
UPDATE transfers
SET status = 'complete'
WHERE status = 'completed';

UPDATE transfers
SET status = 'in_progress'
WHERE status = 'draft';

-- 4. Convert DEEDLY transfer matters.status
UPDATE matters
SET status = 'complete'
WHERE matter_type = 'transfer'
  AND status = 'completed';

UPDATE matters
SET status = 'in_progress'
WHERE matter_type = 'transfer'
  AND status = 'draft';

-- 5. Drop the old transfers.status check constraint if it exists, by discovering its name
DO $$
DECLARE
    cname text;
BEGIN
    SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'transfers'
      AND cls.relname = 'transfers'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
    LIMIT 1;

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transfers.transfers DROP CONSTRAINT %I', cname);
    END IF;
END $$;

-- 6. Apply DEEDLY two-state constraint to transfers
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'transfers'
          AND constraint_name = 'transfers_status_check'
    ) THEN
        EXECUTE 'ALTER TABLE transfers.transfers
                 ADD CONSTRAINT transfers_status_check
                 CHECK (status IN (''in_progress'', ''complete''))';
    END IF;
END $$;

-- 7. Drop the old matters.status check constraint if it exists, by discovering its name
DO $$
DECLARE
    cname text;
BEGIN
    SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'transfers'
      AND cls.relname = 'matters'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
    LIMIT 1;

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transfers.matters DROP CONSTRAINT %I', cname);
    END IF;
END $$;

-- 8. Apply conditional matters.status constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matters'
          AND constraint_name = 'matters_status_check'
    ) THEN
        EXECUTE 'ALTER TABLE transfers.matters
                 ADD CONSTRAINT matters_status_check
                 CHECK (
                     (matter_type <> ''transfer'' AND status IN (
                         ''draft'', ''pending'', ''in_progress'', ''review'', ''completed'', ''cancelled'', ''archived''
                     ))
                     OR
                     (matter_type = ''transfer'' AND status IN (''in_progress'', ''complete''))
                 )';
    END IF;
END $$;

COMMIT;
