-- Migration: 013_add_platform_user_actor_columns.sql
-- Purpose: Add parallel platform JWT user_id (INTEGER) columns alongside the
--          existing legacy UUID actor fields for active Transfers workflow tables.
-- Scope:   Schema-only change; no backfill, no FK to public.users, no route
--          behaviour changes, no tenant/ownership modifications.

BEGIN;

SET LOCAL search_path TO transfers, public;

ALTER TABLE matters
    ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER;

ALTER TABLE matters
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;

ALTER TABLE transfers
    ADD COLUMN IF NOT EXISTS submitted_by_user_id INTEGER;

ALTER TABLE matter_milestones
    ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER;

ALTER TABLE milestone_history
    ADD COLUMN IF NOT EXISTS changed_by_user_id INTEGER;

ALTER TABLE transfer_documents
    ADD COLUMN IF NOT EXISTS uploaded_by_user_id INTEGER;

-- Work-queue lookups are expected on milestone assignment, so index the one
-- column that drives that query pattern.  The remaining actor columns are not
-- expected to be used as direct lookup filters at this stage.
CREATE INDEX IF NOT EXISTS idx_matter_milestones_assigned_to_user_id
    ON matter_milestones (assigned_to_user_id);

COMMIT;
