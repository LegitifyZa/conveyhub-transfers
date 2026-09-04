-- Migration: 018_deedly_party_property_contract_foundation.sql
-- Purpose: DEEDLY party and property contract schema foundation.
--          Extends transfer_parties for extensible entity types and primary-contact,
--          creates reference tables for entity types and party roles,
--          seeds the approved ordinary transfer roles and sale/donation rules,
--          and introduces a matter_properties relationship for input/output
--          property modelling.
-- Created: 2026-08-27

BEGIN;

SET LOCAL search_path TO transfers, public;

-- 1. Extensible entity type definitions.
--    Aligned with the Golden Records/Entities entity-type contract.
--    Future entity types are added as reference rows without redesigning
--    transfer_parties.
CREATE TABLE IF NOT EXISTS entity_type_definitions (
    code VARCHAR(40) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Stable party role definitions.
--    Only the ordinary transfer roles are seeded now.
--    Specialist role/capacity machine codes remain intentionally unseeded
--    until explicit role/capacity model design approval.
CREATE TABLE IF NOT EXISTS party_role_definitions (
    code VARCHAR(40) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Per-classification role rules.
--    This is a configuration table. Only the approved sale-type and donation
--    rules are seeded; Development, deceased-estate and Section 45 rules are
--    intentionally absent to avoid inventing unapproved specialist machine codes.
CREATE TABLE IF NOT EXISTS classification_party_role_rules (
    classification_code VARCHAR(100) NOT NULL
        REFERENCES matter_classification_options(canonical_code) ON DELETE CASCADE,
    role_code VARCHAR(40) NOT NULL
        REFERENCES party_role_definitions(code) ON DELETE CASCADE,
    min_count INTEGER NOT NULL DEFAULT 1,
    max_count INTEGER,  -- NULL = unlimited
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    allows_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_entity_type_codes TEXT[],  -- subset of entity_type_definitions; NULL = any active
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (classification_code, role_code)
);

CREATE INDEX IF NOT EXISTS idx_classification_party_role_rules_classification
    ON classification_party_role_rules(classification_code);
CREATE INDEX IF NOT EXISTS idx_classification_party_role_rules_role
    ON classification_party_role_rules(role_code);

-- 4. Add is_primary_contact to transfer_parties as a communication/UI flag only.
ALTER TABLE transfer_parties
    ADD COLUMN IF NOT EXISTS is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_transfer_parties_is_primary_contact
    ON transfer_parties (is_primary_contact)
    WHERE is_primary_contact = TRUE;

-- At most one primary communication contact per transfer and role.
-- This is a UI/communication convenience only and carries no legal authority.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_parties_one_primary_per_role
    ON transfer_parties (transfer_id, role)
    WHERE is_primary_contact = TRUE;

-- 5. Make transfer_parties.entity_type extensible.
--    Drop the restrictive person/company CHECK constraint and add an FK to
--    entity_type_definitions. The FK is reference-data-driven, not a hard-coded
--    CHECK list, so future entity types are added by inserting reference rows.

-- 5a. Widen the column to match the reference primary key and future codes.
ALTER TABLE transfer_parties
    ALTER COLUMN entity_type TYPE VARCHAR(40);

-- 5b. Remove the legacy hard-coded CHECK if it still exists.
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class cls ON con.conrelid = cls.oid
    JOIN pg_namespace ns ON cls.relnamespace = ns.oid
    WHERE ns.nspname = 'transfers'
      AND cls.relname = 'transfer_parties'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%entity_type%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transfers.transfer_parties DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

-- 5c. Add the reference-data-driven FK.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'transfer_parties'
          AND constraint_name = 'fk_transfer_parties_entity_type'
    ) THEN
        EXECUTE 'ALTER TABLE transfers.transfer_parties
                 ADD CONSTRAINT fk_transfer_parties_entity_type
                 FOREIGN KEY (entity_type)
                 REFERENCES transfers.entity_type_definitions(code)
                 ON UPDATE CASCADE ON DELETE RESTRICT';
    END IF;
END $$;

-- 6. Matter property relationship table.
--    This is the foundation for multiple properties per matter and the
--    input/output distinction required by Development matters.
--
--    Transitional authority contract for transfers.property_id:
--      - transfers.property_id remains the legacy single-property pointer used
--        by existing Express routes and non-DEEDLY working data.
--      - matter_properties is the DEEDLY-v1 canonical relationship.
--      - During the transition, v1 create/read/update should treat
--        matter_properties as authoritative; the legacy column must not be
--        written independently for the same relationship.
--      - A later migration will backfill any remaining transfers.property_id
--        values into matter_properties and may then remove the legacy column.
--
--    Tenant safety: matter_properties.accountable_institution_id is derived
--    from matters.accountable_institution_id via a trigger so a row cannot be
--    associated with the wrong accountable institution.
CREATE TABLE IF NOT EXISTS matter_properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    property_kind VARCHAR(20) NOT NULL CHECK (property_kind IN ('input', 'output')),
    registration_status VARCHAR(20),
    role_in_matter VARCHAR(50),
    external_property_id TEXT,
    property_source VARCHAR(100),
    accountable_institution_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (property_kind = 'output' OR property_id IS NOT NULL),
    UNIQUE (matter_id, property_id, property_kind)
);

CREATE INDEX IF NOT EXISTS idx_matter_properties_matter_id
    ON matter_properties(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_properties_property_id
    ON matter_properties(property_id);
CREATE INDEX IF NOT EXISTS idx_matter_properties_accountable_institution_id
    ON matter_properties(accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_matter_properties_external_property_id
    ON matter_properties(external_property_id);

-- 6a. Derive matter_properties.accountable_institution_id from matters so
--     cross-tenant property associations cannot be introduced.
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
    FOR EACH ROW EXECUTE FUNCTION matter_properties_set_tenant();

-- 7. Seed supported entity types.
--    These are the only entity types approved for the DEEDLY party model now.
INSERT INTO entity_type_definitions (code, label, description) VALUES
    ('person', 'Person', 'Natural person'),
    ('company', 'Company', 'Registered company or juristic person'),
    ('trust', 'Trust', 'Trust arrangement, with trustees represented separately')
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- 8. Seed the approved ordinary transfer party roles.
INSERT INTO party_role_definitions (code, label, description) VALUES
    ('transferor', 'Transferor', 'Entity transferring ownership or interest'),
    ('transferee', 'Transferee', 'Entity receiving ownership or interest')
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- 9. Seed classification role rules for the nine sale-type classifications
--    and transfer.donation. Both require at least one transferor and one
--    transferee; multiple parties of the same role are allowed; all three
--    supported entity types may act in either role.
WITH sale_classifications(code) AS (
    VALUES
        ('transfer.private_treaty.not_applicable'),
        ('transfer.private_treaty.sectional_title_register'),
        ('transfer.private_treaty.township_register'),
        ('transfer.private_treaty.extension_of_scheme'),
        ('transfer.private_treaty.subdivision'),
        ('transfer.private_treaty.bulk_transfer'),
        ('transfer.auction'),
        ('transfer.sale_in_execution'),
        ('transfer.property_in_possession')
)
INSERT INTO classification_party_role_rules (
    classification_code, role_code, min_count, max_count, is_required, allows_primary_contact, allowed_entity_type_codes
)
SELECT c.code, 'transferor', 1, NULL, TRUE, TRUE, ARRAY['person', 'company', 'trust']
FROM sale_classifications c
ON CONFLICT (classification_code, role_code) DO UPDATE SET
    min_count = EXCLUDED.min_count,
    max_count = EXCLUDED.max_count,
    is_required = EXCLUDED.is_required,
    allows_primary_contact = EXCLUDED.allows_primary_contact,
    allowed_entity_type_codes = EXCLUDED.allowed_entity_type_codes,
    updated_at = CURRENT_TIMESTAMP;

WITH sale_classifications(code) AS (
    VALUES
        ('transfer.private_treaty.not_applicable'),
        ('transfer.private_treaty.sectional_title_register'),
        ('transfer.private_treaty.township_register'),
        ('transfer.private_treaty.extension_of_scheme'),
        ('transfer.private_treaty.subdivision'),
        ('transfer.private_treaty.bulk_transfer'),
        ('transfer.auction'),
        ('transfer.sale_in_execution'),
        ('transfer.property_in_possession')
)
INSERT INTO classification_party_role_rules (
    classification_code, role_code, min_count, max_count, is_required, allows_primary_contact, allowed_entity_type_codes
)
SELECT c.code, 'transferee', 1, NULL, TRUE, TRUE, ARRAY['person', 'company', 'trust']
FROM sale_classifications c
ON CONFLICT (classification_code, role_code) DO UPDATE SET
    min_count = EXCLUDED.min_count,
    max_count = EXCLUDED.max_count,
    is_required = EXCLUDED.is_required,
    allows_primary_contact = EXCLUDED.allows_primary_contact,
    allowed_entity_type_codes = EXCLUDED.allowed_entity_type_codes,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO classification_party_role_rules (
    classification_code, role_code, min_count, max_count, is_required, allows_primary_contact, allowed_entity_type_codes
)
VALUES
    ('transfer.donation', 'transferor', 1, NULL, TRUE, TRUE, ARRAY['person', 'company', 'trust']),
    ('transfer.donation', 'transferee', 1, NULL, TRUE, TRUE, ARRAY['person', 'company', 'trust'])
ON CONFLICT (classification_code, role_code) DO UPDATE SET
    min_count = EXCLUDED.min_count,
    max_count = EXCLUDED.max_count,
    is_required = EXCLUDED.is_required,
    allows_primary_contact = EXCLUDED.allows_primary_contact,
    allowed_entity_type_codes = EXCLUDED.allowed_entity_type_codes,
    updated_at = CURRENT_TIMESTAMP;

-- 10. updated_at triggers for new transactional/reference tables.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        EXECUTE 'DROP TRIGGER IF EXISTS update_entity_type_definitions_updated_at ON entity_type_definitions';
        EXECUTE 'CREATE TRIGGER update_entity_type_definitions_updated_at BEFORE UPDATE ON entity_type_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';

        EXECUTE 'DROP TRIGGER IF EXISTS update_party_role_definitions_updated_at ON party_role_definitions';
        EXECUTE 'CREATE TRIGGER update_party_role_definitions_updated_at BEFORE UPDATE ON party_role_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';

        EXECUTE 'DROP TRIGGER IF EXISTS update_classification_party_role_rules_updated_at ON classification_party_role_rules';
        EXECUTE 'CREATE TRIGGER update_classification_party_role_rules_updated_at BEFORE UPDATE ON classification_party_role_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';

        EXECUTE 'DROP TRIGGER IF EXISTS update_matter_properties_updated_at ON matter_properties';
        EXECUTE 'CREATE TRIGGER update_matter_properties_updated_at BEFORE UPDATE ON matter_properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
    END IF;
END $$;

COMMIT;
