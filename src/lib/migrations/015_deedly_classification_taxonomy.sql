-- Migration: 015_deedly_classification_taxonomy.sql
-- Purpose: Add DEEDLY matter classification taxonomy, classification columns on matters,
--          and many-to-many milestone/document workflow mapping tables.
-- Created: 2026-08-26

BEGIN;
SET LOCAL search_path TO transfers, public;

CREATE SCHEMA IF NOT EXISTS transfers;

-- 1. Classification reference table
CREATE TABLE IF NOT EXISTS matter_classification_options (
    canonical_code          VARCHAR(100) PRIMARY KEY,
    category                VARCHAR(50)  NOT NULL,
    subtype                 VARCHAR(50)  NOT NULL,
    transfer_from           VARCHAR(50),
    display_label           VARCHAR(255) NOT NULL,
    transfer_from_label     VARCHAR(255),
    requires_transfer_from  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_selectable           BOOLEAN      NOT NULL DEFAULT TRUE,
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add classification and firm reference to matters
ALTER TABLE matters
    ADD COLUMN IF NOT EXISTS classification_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS firm_reference     VARCHAR(100);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_matters_classification_code ON matters(classification_code);
CREATE INDEX IF NOT EXISTS idx_matters_firm_reference     ON matters(firm_reference);
CREATE INDEX IF NOT EXISTS idx_matter_classification_options_category ON matter_classification_options(category);
CREATE INDEX IF NOT EXISTS idx_matter_classification_options_subtype  ON matter_classification_options(subtype);
CREATE INDEX IF NOT EXISTS idx_matter_classification_options_selectable ON matter_classification_options(is_selectable);

-- 4. Add FK from matters to reference table, guarded against duplicate or existing FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matters'
          AND constraint_name = 'fk_matters_classification_options'
    ) THEN
        EXECUTE 'ALTER TABLE transfers.matters
                 ADD CONSTRAINT fk_matters_classification_options
                 FOREIGN KEY (classification_code)
                 REFERENCES transfers.matter_classification_options(canonical_code)
                 ON UPDATE CASCADE';
    END IF;
END $$;

-- 5. Classification only allowed on transfer matters
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'transfers'
          AND table_name = 'matters'
          AND constraint_name = 'chk_matters_classification_transfer'
    ) THEN
        EXECUTE 'ALTER TABLE transfers.matters
                 ADD CONSTRAINT chk_matters_classification_transfer
                 CHECK (matter_type = ''transfer'' OR classification_code IS NULL)';
    END IF;
END $$;

-- 6. Workflow mapping tables
CREATE TABLE IF NOT EXISTS classification_milestone_map (
    classification_code     VARCHAR(100) NOT NULL
        REFERENCES matter_classification_options(canonical_code) ON DELETE CASCADE,
    milestone_definition_id UUID NOT NULL
        REFERENCES milestone_definitions(id) ON DELETE CASCADE,
    is_generic_fallback     BOOLEAN NOT NULL DEFAULT FALSE,
    sequence_number         INTEGER,
    PRIMARY KEY (classification_code, milestone_definition_id)
);

CREATE TABLE IF NOT EXISTS classification_document_map (
    classification_code     VARCHAR(100) NOT NULL
        REFERENCES matter_classification_options(canonical_code) ON DELETE CASCADE,
    document_catalogue_id   UUID NOT NULL
        REFERENCES public.document_catalogue(id) ON DELETE CASCADE,
    is_generic_fallback     BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (classification_code, document_catalogue_id)
);

-- 7. Seed the confirmed selectable DEEDLY classification taxonomy
INSERT INTO matter_classification_options (
    canonical_code, category, subtype, transfer_from, display_label,
    transfer_from_label, requires_transfer_from, is_selectable
) VALUES
    -- Transfer / Private Treaty (conditional transfer_from)
    ('transfer.private_treaty.not_applicable',          'transfer', 'private_treaty',          'not_applicable',          'Private Treaty',              'Not Applicable',            TRUE,  TRUE),
    ('transfer.private_treaty.sectional_title_register','transfer', 'private_treaty',          'sectional_title_register','Private Treaty',              'Sectional Title Register',  TRUE,  TRUE),
    ('transfer.private_treaty.township_register',       'transfer', 'private_treaty',          'township_register',       'Private Treaty',              'Township Register',         TRUE,  TRUE),
    ('transfer.private_treaty.extension_of_scheme',     'transfer', 'private_treaty',          'extension_of_scheme',     'Private Treaty',              'Extension of Scheme',       TRUE,  TRUE),
    ('transfer.private_treaty.subdivision',             'transfer', 'private_treaty',          'subdivision',             'Private Treaty',              'Subdivision',               TRUE,  TRUE),
    ('transfer.private_treaty.bulk_transfer',           'transfer', 'private_treaty',          'bulk_transfer',           'Private Treaty',              'Bulk Transfer',             TRUE,  TRUE),

    -- Transfer / Other
    ('transfer.auction',                                'transfer', 'auction',                 NULL,                      'Auction',                     NULL,                        FALSE, TRUE),
    ('transfer.sale_in_execution',                      'transfer', 'sale_in_execution',       NULL,                      'Sale in Execution',           NULL,                        FALSE, TRUE),
    ('transfer.property_in_possession',                 'transfer', 'property_in_possession',  NULL,                      'Property in Possession',      NULL,                        FALSE, TRUE),
    ('transfer.deceased_estate_inheritance',            'transfer', 'deceased_estate_inheritance', NULL,                  'Deceased Estate - Inheritance', NULL,                      FALSE, TRUE),
    ('transfer.endorsement_section_45',                 'transfer', 'endorsement_section_45',  NULL,                      'Endorsement - Section 45',    NULL,                        FALSE, TRUE),
    ('transfer.donation',                               'transfer', 'donation',                NULL,                      'Donation',                    NULL,                        FALSE, TRUE),

    -- Development
    ('development.new_sectional_title_register',        'development', 'new_sectional_title_register',        NULL,         'New Sectional Title Register', NULL,                     FALSE, TRUE),
    ('development.new_township_register_establishment', 'development', 'new_township_register_establishment', NULL,         'New Township Register/Establishment', NULL,                FALSE, TRUE),
    ('development.scheme_extension_sections',           'development', 'scheme_extension_sections',           NULL,         'Scheme Extension (Sections)', NULL,                     FALSE, TRUE),
    ('development.subdivision',                         'development', 'subdivision',                         NULL,         'Subdivision',                 NULL,                        FALSE, TRUE),

    -- Generic workflow fallback, not user-selectable
    ('transfer.generic',                                'transfer', 'generic',                 NULL,                      'Generic Transfer',            NULL,                        FALSE, FALSE)
ON CONFLICT (canonical_code) DO UPDATE SET
    category = EXCLUDED.category,
    subtype = EXCLUDED.subtype,
    transfer_from = EXCLUDED.transfer_from,
    display_label = EXCLUDED.display_label,
    transfer_from_label = EXCLUDED.transfer_from_label,
    requires_transfer_from = EXCLUDED.requires_transfer_from,
    is_selectable = EXCLUDED.is_selectable,
    is_active = EXCLUDED.is_active;

-- 8. Seed the generic fallback milestone mappings
INSERT INTO classification_milestone_map (classification_code, milestone_definition_id, is_generic_fallback, sequence_number)
SELECT 'transfer.generic', md.id, TRUE, md.sequence_number
FROM milestone_definitions md
WHERE md.matter_type = 'transfer'
  AND md.is_active = TRUE
ON CONFLICT (classification_code, milestone_definition_id) DO NOTHING;

-- 9. Seed the generic fallback document mappings
INSERT INTO classification_document_map (classification_code, document_catalogue_id, is_generic_fallback)
SELECT 'transfer.generic', dc.id, TRUE
FROM public.document_catalogue dc
WHERE dc.module = 'Transfers'
  AND dc.status = 'Active'
ON CONFLICT (classification_code, document_catalogue_id) DO NOTHING;

COMMIT;
