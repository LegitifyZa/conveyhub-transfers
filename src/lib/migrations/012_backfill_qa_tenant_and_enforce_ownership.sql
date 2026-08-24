-- Migration: 012_backfill_qa_tenant_and_enforce_ownership.sql
-- Purpose: Backfill the DEEDLY prototype/test dataset with the QA Sandbox tenant
--          (accountable_institution_id = 5) and make the ownership columns NOT NULL.
-- Scope:   Current 8 matters + 8 transfers on the deedly-migration branch, or a fresh
--          database with zero rows.  Never assigns AI 5 to future/unknown rows.

BEGIN;

SET LOCAL search_path TO transfers, public;

DO $$
DECLARE
    matters_count        INT;
    transfers_count      INT;
    non_five_count       INT;
    unmatched_matter     INT;
    unmatched_transfer   INT;
    duplicate_src        INT;
BEGIN
    SELECT COUNT(*) INTO matters_count   FROM transfers.matters;
    SELECT COUNT(*) INTO transfers_count FROM transfers.transfers;

    -- Fresh database: nothing to backfill, skip to the NOT NULL enforcement.
    IF matters_count = 0 AND transfers_count = 0 THEN
        RETURN;
    END IF;

    -- The prototype dataset must be exactly 8 matters and 8 transfers.
    IF matters_count != 8 OR transfers_count != 8 THEN
        RAISE EXCEPTION 'Migration 012 expected exactly 8 matters and 8 transfers for backfill, found % matters and % transfers', matters_count, transfers_count;
    END IF;

    -- Refuse to overwrite any non-NULL AI that is not the QA Sandbox value.
    SELECT COUNT(*)
    INTO non_five_count
    FROM (
        SELECT accountable_institution_id
        FROM transfers.matters
        WHERE accountable_institution_id IS NOT NULL AND accountable_institution_id != 5
        UNION ALL
        SELECT accountable_institution_id
        FROM transfers.transfers
        WHERE accountable_institution_id IS NOT NULL AND accountable_institution_id != 5
    ) x;

    IF non_five_count > 0 THEN
        RAISE EXCEPTION 'Migration 012 found existing accountable_institution_id values other than the QA Sandbox value (5); refusing to proceed';
    END IF;

    -- Every matter must be recoverable from exactly one transfer via source_record_id.
    SELECT COUNT(*)
    INTO unmatched_matter
    FROM transfers.matters m
    LEFT JOIN transfers.transfers t ON m.source_record_id = t.id::text
    WHERE t.id IS NULL;

    IF unmatched_matter > 0 THEN
        RAISE EXCEPTION 'Migration 012 found matters with no matching transfer by source_record_id';
    END IF;

    SELECT COUNT(*)
    INTO unmatched_transfer
    FROM transfers.transfers t
    LEFT JOIN transfers.matters m ON m.source_record_id = t.id::text
    WHERE m.id IS NULL;

    IF unmatched_transfer > 0 THEN
        RAISE EXCEPTION 'Migration 012 found transfers with no matching matter by source_record_id';
    END IF;

    SELECT COUNT(*)
    INTO duplicate_src
    FROM (
        SELECT source_record_id
        FROM transfers.matters
        GROUP BY source_record_id
        HAVING COUNT(*) > 1
    ) x;

    IF duplicate_src > 0 THEN
        RAISE EXCEPTION 'Migration 012 found duplicate source_record_id values in matters';
    END IF;
END $$;

-- Backfill matters first (only NULL rows; existing 5s are left untouched).
UPDATE transfers.matters
SET accountable_institution_id = 5
WHERE accountable_institution_id IS NULL;

-- Backfill the matching transfers via the verified source_record_id relationship.
UPDATE transfers.transfers t
SET accountable_institution_id = 5
FROM transfers.matters m
WHERE m.source_record_id = t.id::text
  AND t.accountable_institution_id IS NULL;

DO $$
DECLARE
    remaining_nulls INT;
BEGIN
    SELECT COUNT(*)
    INTO remaining_nulls
    FROM (
        SELECT accountable_institution_id
        FROM transfers.matters
        WHERE accountable_institution_id IS NULL
        UNION ALL
        SELECT accountable_institution_id
        FROM transfers.transfers
        WHERE accountable_institution_id IS NULL
    ) x;

    IF remaining_nulls > 0 THEN
        RAISE EXCEPTION 'Migration 012 left % NULL accountable_institution_id values after backfill', remaining_nulls;
    END IF;
END $$;

-- Make the ownership columns NOT NULL only when every row is populated.
ALTER TABLE transfers.matters
    ALTER COLUMN accountable_institution_id SET NOT NULL;

ALTER TABLE transfers.transfers
    ALTER COLUMN accountable_institution_id SET NOT NULL;

COMMIT;
