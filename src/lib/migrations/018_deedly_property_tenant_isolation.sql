-- Migration: 018_deedly_property_tenant_isolation.sql
-- Purpose: Add accountable-institution ownership to properties, enforce that
--          matter_properties can only link a matter to a property in the same
--          accountable institution, backfill legacy transfers.property_id into
--          matter_properties, and keep legacy property writes synchronised to
--          matter_properties.

BEGIN;

SET LOCAL search_path TO transfers, public;

-- 0. Remove the original 002 sample properties only when they have no
--    existing references.  This is a seed-cleanup safeguard; any of these
--    rows that are already in use are left in place and must be resolved
--    by the backfill/validation step below.
DO $$
BEGIN
    DELETE FROM properties
    WHERE property_id IN (
        'PROP-2026-0001',
        'PROP-2026-0002',
        'PROP-2026-0003'
    )
    AND id NOT IN (
        SELECT property_id FROM transfers WHERE property_id IS NOT NULL
        UNION
        SELECT property_id FROM matters WHERE property_id IS NOT NULL
        UNION
        SELECT property_id FROM matter_properties WHERE property_id IS NOT NULL
        UNION
        SELECT property_id FROM municipal_accounts WHERE property_id IS NOT NULL
        UNION
        SELECT property_id FROM compliance_certificates WHERE property_id IS NOT NULL
    );
END $$;

-- 1. Add the tenant column to properties.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'transfers'
          AND table_name = 'properties'
          AND column_name = 'accountable_institution_id'
    ) THEN
        ALTER TABLE properties
            ADD COLUMN accountable_institution_id INTEGER;
    END IF;
END $$;

-- 2. Derive a deterministic accountable_institution_id for every property from
--    the working data that already references it.  A property must not map to
--    more than one accountable institution; that is treated as a data-conflict
--    and stops the migration.
DO $$
DECLARE
    conflict_count INTEGER;
    unresolved_count INTEGER;
    single_ai INTEGER;
    ai_count INTEGER;
BEGIN
    -- Find any property that has been linked by working data in more than one tenant.
    SELECT COUNT(*) INTO conflict_count
    FROM (
        SELECT p.id
        FROM properties p
        JOIN (
            SELECT t.property_id AS pid, t.accountable_institution_id AS ai
            FROM transfers t
            WHERE t.property_id IS NOT NULL
            UNION
            SELECT m.property_id, m.accountable_institution_id
            FROM matters m
            WHERE m.property_id IS NOT NULL
            UNION
            SELECT mp.property_id, mp.accountable_institution_id
            FROM matter_properties mp
            WHERE mp.property_id IS NOT NULL
            UNION
            SELECT cc.property_id, m.accountable_institution_id
            FROM compliance_certificates cc
            JOIN matters m ON cc.matter_id = m.id
            WHERE cc.property_id IS NOT NULL
        ) s ON p.id = s.pid
        GROUP BY p.id
        HAVING COUNT(DISTINCT s.ai) > 1
    ) c;

    IF conflict_count > 0 THEN
        RAISE EXCEPTION '% properties are referenced by more than one accountable institution. Resolve before migration 018.', conflict_count;
    END IF;

    -- Backfill from the single deterministic source where one exists.
    UPDATE properties p
    SET accountable_institution_id = s.ai
    FROM (
        SELECT DISTINCT ON (p.id) p.id, q.ai
        FROM properties p
        JOIN (
            SELECT t.property_id AS pid, t.accountable_institution_id AS ai
            FROM transfers t
            WHERE t.property_id IS NOT NULL
            UNION
            SELECT m.property_id, m.accountable_institution_id
            FROM matters m
            WHERE m.property_id IS NOT NULL
            UNION
            SELECT mp.property_id, mp.accountable_institution_id
            FROM matter_properties mp
            WHERE mp.property_id IS NOT NULL
            UNION
            SELECT cc.property_id, m.accountable_institution_id
            FROM compliance_certificates cc
            JOIN matters m ON cc.matter_id = m.id
            WHERE cc.property_id IS NOT NULL
        ) q ON p.id = q.pid
    ) s
    WHERE p.id = s.id
      AND p.accountable_institution_id IS NULL;

    -- If any property still has no AI and the database contains exactly one
    -- tenant from working transfers, inherit that single tenant.  This handles
    -- unreferenced sample/seed data in a single-tenant dataset without
    -- arbitrarily assigning a tenant.
    SELECT COUNT(DISTINCT accountable_institution_id), MIN(accountable_institution_id)
    INTO ai_count, single_ai
    FROM transfers
    WHERE accountable_institution_id IS NOT NULL;

    IF ai_count = 1 THEN
        UPDATE properties
        SET accountable_institution_id = single_ai
        WHERE accountable_institution_id IS NULL;
    END IF;

    SELECT COUNT(*) INTO unresolved_count
    FROM properties
    WHERE accountable_institution_id IS NULL;

    IF unresolved_count > 0 THEN
        RAISE EXCEPTION '% properties have no determinable accountable_institution_id. Resolve before migration 018.', unresolved_count;
    END IF;
END $$;

-- 3. Make the tenant column mandatory and create a composite unique key that
--    matter_properties can reference.
DO $$
BEGIN
    ALTER TABLE properties
        ALTER COLUMN accountable_institution_id SET NOT NULL;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'transfers'
          AND tablename = 'properties'
          AND indexname = 'idx_properties_id_accountable_institution_id'
    ) THEN
        CREATE UNIQUE INDEX idx_properties_id_accountable_institution_id
            ON properties (id, accountable_institution_id);
    END IF;
END $$;

-- 4. Enforce same-tenant linking for the DEEDLY v1 property relationship.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matter_properties'
          AND constraint_name = 'matter_properties_property_id_fkey'
    ) THEN
        ALTER TABLE matter_properties
            DROP CONSTRAINT matter_properties_property_id_fkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matter_properties'
          AND constraint_name = 'fk_matter_properties_property_tenant'
    ) THEN
        ALTER TABLE matter_properties
            ADD CONSTRAINT fk_matter_properties_property_tenant
            FOREIGN KEY (property_id, accountable_institution_id)
            REFERENCES properties (id, accountable_institution_id)
            ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- 5. Add same-tenant protection to the legacy transfer and matter pointers so
--    that the legacy single-property column cannot point to another tenant's
--    property.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'transfers'
          AND constraint_name = 'transfers_property_id_fkey'
    ) THEN
        ALTER TABLE transfers
            DROP CONSTRAINT transfers_property_id_fkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'transfers'
          AND constraint_name = 'fk_transfers_property_tenant'
    ) THEN
        ALTER TABLE transfers
            ADD CONSTRAINT fk_transfers_property_tenant
            FOREIGN KEY (property_id, accountable_institution_id)
            REFERENCES properties (id, accountable_institution_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matters'
          AND constraint_name = 'matters_property_id_fkey'
    ) THEN
        ALTER TABLE matters
            DROP CONSTRAINT matters_property_id_fkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matters'
          AND constraint_name = 'fk_matters_property_tenant'
    ) THEN
        ALTER TABLE matters
            ADD CONSTRAINT fk_matters_property_tenant
            FOREIGN KEY (property_id, accountable_institution_id)
            REFERENCES properties (id, accountable_institution_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- 6. Backfill legacy transfers.property_id into matter_properties so that
--    existing transfers do not appear property-less to the v1 API.
DO $$
BEGIN
    INSERT INTO matter_properties (
        matter_id,
        property_id,
        property_kind,
        property_source
    )
    SELECT
        t.matter_id,
        t.property_id,
        'input',
        'legacy_transfers'
    FROM transfers t
    WHERE t.matter_id IS NOT NULL
      AND t.property_id IS NOT NULL
    ON CONFLICT (matter_id, property_id, property_kind) DO NOTHING;
END $$;

-- 7. One-way legacy sync: when a legacy transfer's single-property pointer
--    changes, mirror it into matter_properties.  This is a compatibility bridge
--    only; matter_properties remains the v1 authoritative relationship.
CREATE OR REPLACE FUNCTION sync_matter_properties_from_transfer()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.matter_id IS DISTINCT FROM NEW.matter_id AND OLD.matter_id IS NOT NULL THEN
        -- The transfer has moved to a different matter; remove the legacy
        -- property pointer from the previous matter.
        DELETE FROM matter_properties
        WHERE matter_id = OLD.matter_id
          AND property_source = 'legacy_transfers'
          AND property_kind = 'input'
          AND property_id = OLD.property_id;
    END IF;

    IF NEW.matter_id IS NOT NULL AND NEW.property_id IS NOT NULL THEN
        -- Remove the previous legacy pointer for this matter, if any, so that
        -- transfers.property_id remains a single legacy value rather than the
        -- full property set.
        DELETE FROM matter_properties
        WHERE matter_id = NEW.matter_id
          AND property_source = 'legacy_transfers'
          AND property_kind = 'input'
          AND property_id IS DISTINCT FROM NEW.property_id;

        INSERT INTO matter_properties (
            matter_id,
            property_id,
            property_kind,
            property_source
        ) VALUES (
            NEW.matter_id,
            NEW.property_id,
            'input',
            'legacy_transfers'
        )
        ON CONFLICT (matter_id, property_id, property_kind) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_matter_properties_from_transfer ON transfers;
CREATE TRIGGER trg_sync_matter_properties_from_transfer
    AFTER INSERT OR UPDATE OF property_id, matter_id ON transfers
    FOR EACH ROW
    EXECUTE FUNCTION sync_matter_properties_from_transfer();

-- 8. Keep the matter_properties tenant column derived from the parent matter.
--    This was created in migration 017; recreate it here to be safe after any
--    017 re-run.
CREATE OR REPLACE FUNCTION matter_properties_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM matters
    WHERE id = NEW.matter_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_matter_properties_set_tenant ON matter_properties;
CREATE TRIGGER trg_matter_properties_set_tenant
    BEFORE INSERT OR UPDATE ON matter_properties
    FOR EACH ROW
    EXECUTE FUNCTION matter_properties_set_tenant();

-- 9. Preserve the matter_properties updated_at trigger.
DROP TRIGGER IF EXISTS update_matter_properties_updated_at ON matter_properties;
CREATE TRIGGER update_matter_properties_updated_at
    BEFORE UPDATE ON matter_properties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
