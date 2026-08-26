-- Migration: 014_rename_transfers_submitted_by_user_id_to_created_by_user_id.sql
-- Purpose: Rename the 013-created transfer creator provenance column to match
--          DEEDLY business terminology: there is no separate submit event, so
--          the original creator is stored as created_by_user_id.
--          The legacy UUID submitted_by column is intentionally untouched.
-- Scope:   Schema-only, transactional, idempotent, no data loss.

BEGIN;

SET LOCAL search_path TO transfers, public;

DO $$
DECLARE
    has_submitted_by_user_id boolean;
    has_created_by_user_id boolean;
BEGIN
    SELECT COUNT(*) > 0 INTO has_submitted_by_user_id
    FROM information_schema.columns
    WHERE table_schema = 'transfers'
      AND table_name = 'transfers'
      AND column_name = 'submitted_by_user_id';

    SELECT COUNT(*) > 0 INTO has_created_by_user_id
    FROM information_schema.columns
    WHERE table_schema = 'transfers'
      AND table_name = 'transfers'
      AND column_name = 'created_by_user_id';

    IF has_submitted_by_user_id AND has_created_by_user_id THEN
        RAISE EXCEPTION 'Both submitted_by_user_id and created_by_user_id exist on transfers. Manual resolution required.';
    END IF;

    IF has_submitted_by_user_id AND NOT has_created_by_user_id THEN
        ALTER TABLE transfers
            RENAME COLUMN submitted_by_user_id TO created_by_user_id;
    ELSIF NOT has_submitted_by_user_id AND NOT has_created_by_user_id THEN
        RAISE EXCEPTION 'Prerequisite missing: neither submitted_by_user_id nor created_by_user_id exists on transfers.';
    END IF;
    -- If created_by_user_id exists and submitted_by_user_id does not, the
    -- desired final state is already present; perform no action.
END $$;

-- The legacy UUID column created by prior migrations remains in place and is
-- not referenced by the new platform actor fields.
-- ALTER TABLE transfers ... submitted_by (UUID) remains untouched.

COMMIT;
