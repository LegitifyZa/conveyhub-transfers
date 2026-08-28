-- Migration: 019_deedly_taxonomy_approved_classifications.sql
-- Purpose: Add the two newly approved DEEDLY classification taxonomy rows.
--          This is a taxonomy-only migration: no party/capacity machine codes,
--          no classification_party_role_rules, and no workflow rules are seeded.

BEGIN;

SET LOCAL search_path TO transfers, public;

INSERT INTO matter_classification_options (
    canonical_code,
    category,
    subtype,
    transfer_from,
    display_label,
    transfer_from_label,
    requires_transfer_from,
    is_selectable
) VALUES
    ('transfer.deceased_estate_sale',  'transfer', 'deceased_estate_sale',  NULL, 'Deceased Estate Sale',     NULL, FALSE, TRUE),
    ('transfer.endorsement_section_45bis', 'transfer', 'endorsement_section_45bis', NULL, 'Endorsement - Section 45bis', NULL, FALSE, TRUE)
ON CONFLICT (canonical_code) DO UPDATE SET
    category = EXCLUDED.category,
    subtype = EXCLUDED.subtype,
    transfer_from = EXCLUDED.transfer_from,
    display_label = EXCLUDED.display_label,
    transfer_from_label = EXCLUDED.transfer_from_label,
    requires_transfer_from = EXCLUDED.requires_transfer_from,
    is_selectable = EXCLUDED.is_selectable,
    is_active = EXCLUDED.is_active;

COMMIT;
