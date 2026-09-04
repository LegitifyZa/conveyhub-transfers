-- Migration: 021_deedly_specialist_role_capacity_persistence.sql
-- Purpose: Add the foundational specialist role/capacity persistence tables:
--          representative-capacity definitions, party-relationship definitions,
--          matter-owned estate contexts, normalized party relationships and
--          representative assignments.
-- Scope:   Schema and reference-data only; no API, no validation, no signing,
--          no authority evidence, no workflow.

BEGIN;

SET LOCAL search_path TO transfers, public;

-- 1. Reference: representative-capacity definitions.
CREATE TABLE IF NOT EXISTS representative_capacity_definitions (
    code VARCHAR(40) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Reference: party-relationship definitions (structure only; no seed).
CREATE TABLE IF NOT EXISTS party_relationship_definitions (
    code VARCHAR(40) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Seed the three confirmed representative-capacity codes idempotently.
INSERT INTO representative_capacity_definitions (code, label, description) VALUES
    ('executor', 'Executor', 'Person appointed to administer a deceased estate. Capacity does not itself confer signing authority.'),
    ('masters_representative', 'Master''s Representative', 'Person appointed by the Master of the High Court to act in relation to an estate or protected person. Capacity does not itself confer signing authority.'),
    ('trustee', 'Trustee', 'Person appointed to administer and represent a trust. Capacity does not itself confer signing authority.')
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- 4. Composite unique keys on parent tables required for tenant-safe FKs.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'transfers'
          AND tablename = 'transfers'
          AND indexname = 'idx_transfers_id_accountable_institution_id'
    ) THEN
        CREATE UNIQUE INDEX idx_transfers_id_accountable_institution_id
            ON transfers (id, accountable_institution_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'transfers'
          AND tablename = 'transfer_parties'
          AND indexname = 'idx_transfer_parties_id_accountable_institution_id'
    ) THEN
        CREATE UNIQUE INDEX idx_transfer_parties_id_accountable_institution_id
            ON transfer_parties (id, accountable_institution_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'transfers'
          AND tablename = 'transfer_parties'
          AND indexname = 'idx_transfer_parties_id_transfer_id_accountable_institution_id'
    ) THEN
        CREATE UNIQUE INDEX idx_transfer_parties_id_transfer_id_accountable_institution_id
            ON transfer_parties (id, transfer_id, accountable_institution_id);
    END IF;
END $$;

-- 5. Matter-owned estate context.
CREATE TABLE IF NOT EXISTS matter_estate_contexts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL,
    deceased_golden_record_id UUID,
    masters_estate_reference TEXT,
    accountable_institution_id INTEGER NOT NULL,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_matter_estate_contexts_transfer_tenant
        FOREIGN KEY (transfer_id, accountable_institution_id)
        REFERENCES transfers (id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matter_estate_contexts_transfer_id
    ON matter_estate_contexts (transfer_id);
CREATE INDEX IF NOT EXISTS idx_matter_estate_contexts_accountable_institution_id
    ON matter_estate_contexts (accountable_institution_id);

-- Unique alternate keys for represented-target FKs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_estate_contexts_id_accountable_institution_id
    ON matter_estate_contexts (id, accountable_institution_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_estate_contexts_id_transfer_id_accountable_institution_id
    ON matter_estate_contexts (id, transfer_id, accountable_institution_id);

-- 6. Tenant-anchoring trigger for matter_estate_contexts.
CREATE OR REPLACE FUNCTION matter_estate_contexts_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM transfers
    WHERE id = NEW.transfer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_matter_estate_contexts_set_tenant ON matter_estate_contexts;
CREATE TRIGGER trg_matter_estate_contexts_set_tenant
    BEFORE INSERT OR UPDATE ON matter_estate_contexts
    FOR EACH ROW EXECUTE FUNCTION matter_estate_contexts_set_tenant();

-- 7. Normalized party relationship assignments.
CREATE TABLE IF NOT EXISTS party_relationship_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_party_id UUID NOT NULL,
    relationship_code VARCHAR(40) NOT NULL,
    accountable_institution_id INTEGER NOT NULL,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_party_relationship_assignment
        UNIQUE (transfer_party_id, relationship_code),
    CONSTRAINT fk_party_relationships_transfer_party_tenant
        FOREIGN KEY (transfer_party_id, accountable_institution_id)
        REFERENCES transfer_parties (id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_party_relationships_relationship_code
        FOREIGN KEY (relationship_code)
        REFERENCES party_relationship_definitions (code)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_party_relationship_assignments_relationship_code
    ON party_relationship_assignments (relationship_code);

-- 8. Tenant-anchoring trigger for party_relationship_assignments.
CREATE OR REPLACE FUNCTION party_relationship_assignments_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM transfer_parties
    WHERE id = NEW.transfer_party_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_party_relationship_assignments_set_tenant ON party_relationship_assignments;
CREATE TRIGGER trg_party_relationship_assignments_set_tenant
    BEFORE INSERT OR UPDATE ON party_relationship_assignments
    FOR EACH ROW EXECUTE FUNCTION party_relationship_assignments_set_tenant();

-- 9. Representative assignments.
CREATE TABLE IF NOT EXISTS representative_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL,
    person_golden_record_id UUID NOT NULL,
    capacity VARCHAR(40) NOT NULL,
    represented_transfer_party_id UUID,
    represented_estate_context_id UUID,
    assignment_state VARCHAR(40) NOT NULL DEFAULT 'active'
        CHECK (assignment_state IN ('active', 'withdrawn', 'superseded')),
    accountable_institution_id INTEGER NOT NULL,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_representative_assignment_single_target
        CHECK (((represented_transfer_party_id IS NOT NULL)::int +
                (represented_estate_context_id IS NOT NULL)::int) = 1),
    CONSTRAINT fk_representative_assignments_transfer_tenant
        FOREIGN KEY (transfer_id, accountable_institution_id)
        REFERENCES transfers (id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_representative_assignments_capacity
        FOREIGN KEY (capacity)
        REFERENCES representative_capacity_definitions (code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_representative_assignments_transfer_party_target
        FOREIGN KEY (represented_transfer_party_id, transfer_id, accountable_institution_id)
        REFERENCES transfer_parties (id, transfer_id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_representative_assignments_estate_context_target
        FOREIGN KEY (represented_estate_context_id, transfer_id, accountable_institution_id)
        REFERENCES matter_estate_contexts (id, transfer_id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_representative_assignments_transfer_id
    ON representative_assignments (transfer_id);
CREATE INDEX IF NOT EXISTS idx_representative_assignments_person_golden_record_id
    ON representative_assignments (person_golden_record_id);
CREATE INDEX IF NOT EXISTS idx_representative_assignments_accountable_institution_id
    ON representative_assignments (accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_representative_assignments_capacity
    ON representative_assignments (capacity);

-- Partial unique indexes to prevent duplicate assignments for each target type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_representative_assignments_transfer_party
    ON representative_assignments (transfer_id, person_golden_record_id, capacity, represented_transfer_party_id, accountable_institution_id)
    WHERE represented_transfer_party_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_representative_assignments_estate_context
    ON representative_assignments (transfer_id, person_golden_record_id, capacity, represented_estate_context_id, accountable_institution_id)
    WHERE represented_estate_context_id IS NOT NULL;

-- 10. Tenant-anchoring trigger for representative_assignments.
CREATE OR REPLACE FUNCTION representative_assignments_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM transfers
    WHERE id = NEW.transfer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_representative_assignments_set_tenant ON representative_assignments;
CREATE TRIGGER trg_representative_assignments_set_tenant
    BEFORE INSERT OR UPDATE ON representative_assignments
    FOR EACH ROW EXECUTE FUNCTION representative_assignments_set_tenant();

-- 11. updated_at triggers for new tables.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_representative_capacity_definitions_updated_at ON representative_capacity_definitions;
        CREATE TRIGGER update_representative_capacity_definitions_updated_at
            BEFORE UPDATE ON representative_capacity_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_party_relationship_definitions_updated_at ON party_relationship_definitions;
        CREATE TRIGGER update_party_relationship_definitions_updated_at
            BEFORE UPDATE ON party_relationship_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_matter_estate_contexts_updated_at ON matter_estate_contexts;
        CREATE TRIGGER update_matter_estate_contexts_updated_at
            BEFORE UPDATE ON matter_estate_contexts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_party_relationship_assignments_updated_at ON party_relationship_assignments;
        CREATE TRIGGER update_party_relationship_assignments_updated_at
            BEFORE UPDATE ON party_relationship_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_representative_assignments_updated_at ON representative_assignments;
        CREATE TRIGGER update_representative_assignments_updated_at
            BEFORE UPDATE ON representative_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;
