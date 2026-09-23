-- Migration: 026_deedly_generate_property_id_ambiguity_fix.sql
-- Purpose: Repair public.generate_property_id() — authored in migration 002
--          with a PL/pgSQL variable named property_id that collides with the
--          properties.property_id column inside the uniqueness probe
--          (WHERE property_id = property_id). Under PostgreSQL's default
--          plpgsql.variable_conflict = error the function raises 42702
--          "column reference property_id is ambiguous" on every call.
--
-- Notes:
-- - Forward-only: migration 002 is already applied everywhere, so this
--   replaces the function in place via CREATE OR REPLACE (identical
--   signature: no arguments, RETURNS TEXT). No call sites change —
--   matter_property_service._insert_property() invokes
--   generate_property_id() unqualified under a 'transfers, public'
--   search_path, which continues to resolve public.generate_property_id().
-- - The uniqueness probe explicitly targets transfers.properties (the table
--   moved from public to the transfers schema in migration 010) and binds
--   the candidate through a distinctly named variable, so the predicate can
--   never be ambiguous again.
-- - DEPLOYMENT ORDER: this correction must be applied BEFORE manual
--   property capture (POST /api/v1/transfers/{id}/properties) is enabled —
--   the capture path calls this function on every insert.
-- - Discovered by the migration-024 verification run
--   (docs/deedly-migration-024-verification-report.md §6.1). Number
--   coordinated through Dean → Jordan: 022 SARS, 023 parties, 024 property
--   idempotency, 025 documents — 026 is the next free number on all
--   active branches at authoring time.

BEGIN;

SET LOCAL search_path TO transfers, public;

CREATE OR REPLACE FUNCTION public.generate_property_id()
RETURNS TEXT AS $$
DECLARE
    v_year_part TEXT;
    v_random_part TEXT;
    v_property_id TEXT;
BEGIN
    v_year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    v_random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    v_property_id := 'PROP-' || v_year_part || '-' || v_random_part;

    -- Ensure uniqueness — explicitly target transfers.properties and bind
    -- the candidate through v_property_id so column and variable can never
    -- collide in this predicate.
    WHILE EXISTS (
        SELECT 1 FROM transfers.properties
        WHERE transfers.properties.property_id = v_property_id
    ) LOOP
        v_random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
        v_property_id := 'PROP-' || v_year_part || '-' || v_random_part;
    END LOOP;

    RETURN v_property_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
