-- Migration 027: DEEDLY P0 document requirement rules — seed of the validated
-- Required Documents Register.
--
-- Status: PROPOSED — authored for review, NOT executed against any database.
-- Schema additions and numbering are coordinated through Dean to Jordan.
-- Numbering: 024/026 are reserved on the property branch, 025 is this
-- documents branch; 027 is the next free number at authoring time.
--
-- Source of truth: DEEDLY_Required_Documents_Register.xlsx ("Requirements",
-- "Document catalogue", "Rule guidance", "Classification guide", "Sources"
-- sheets, dated 21 September 2026). 86 document types x 18 classifications,
-- 1,548 cells: 222 Required / 825 Conditional / 473 Not applicable / 28
-- Optional. Full register-to-engine mapping and the gap/conflict report live
-- in docs/deedly-required-documents-register-mapping.md.
--
-- What this migration seeds — and what it deliberately does not:
--
--   SEEDED (baseline rules only):
--     Every register cell marked "Required" becomes one active rule with
--     condition_key NULL. A baseline rule applies whenever the matter's
--     classification_code matches the rule's classification_code.
--     - Documents Required on all 18 classifications (DOC-001, DOC-033,
--       DOC-041, DOC-053, DOC-054, DOC-082) are seeded once each with
--       classification_code '*' — the engine wildcard. This also covers the
--       'transfer.generic' fallback classification, which the register does
--       not name but for which identity/FICA/title-control evidence is still
--       baseline. Flagged in the mapping doc as an intentional extension.
--     - Documents Required on a subset get one row per classification
--       (114 rows). 120 rules total.
--
--   NOT SEEDED — engine cannot express them today (see mapping doc §4):
--     - "Conditional" cells (825): the register triggers are prose and the
--       engine vocabulary is limited to has_bond/cash_purchase, neither of
--       which matches a register trigger cleanly. Seeding an unsupported
--       condition_key would manufacture permanently-unevaluated rules on
--       every matching matter — the import contract in
--       docs/deedly-document-catalogue-template.md §3.2 rejects that.
--       Conditional coverage needs an approved condition vocabulary and fact
--       sources first (mapping doc §5).
--     - "Optional" cells (28): no "suggested but not gated" requirement
--       state exists; optional documents remain addable free-form by name.
--     - "Not applicable" cells (473): absence of a rule, not a record.
--     - Register columns with no engine field: category, origin/collection
--       route, applies-to-party (per-party scope unsupported), due stage
--       (no stage/gate concept — sequence_number is display order only),
--       accepted-evidence/alternative text, signature/execution flag
--       (all "To review"), "Generate in DEEDLY?" candidate flag (unverified
--       capability — no document_templates rows created), per-doc
--       "Include in P0?" flag (all "To review"), rule version.
--
--   NOT TOUCHED — parallel legacy structures (mapping doc §6):
--     public.document_catalogue, classification_document_map and
--     document_catalogue_requirements are dead on the live v1 lane. Seeding
--     Active 'Transfers' catalogue rows would re-arm the quarantined legacy
--     per-transfer auto-seed with all 86 documents regardless of
--     classification — the exact anti-pattern this register replaces.
--
-- rule_key convention: 'doc-NNN' register identity + '.' + scope
-- ('*' or the canonical classification_code). Keys are stable identities —
-- never reused for a different requirement. rule_key is also the value
-- transfer_documents.requirement_key links an upload to; one classification
-- per matter means each document yields at most one applicable rule per
-- matter, so the known shared-doc_code satisfaction gap does not arise here.
--
-- Idempotent re-import per the proposed contract (template doc §3.2): upsert
-- keyed on rule_key refreshing display_name, classification_code,
-- condition_key and sequence_number. A rule_key reused for a *different*
-- requirement is a human-review conflict, never a silent rename — review any
-- diff this migration would produce before applying it over changed data.

BEGIN;

SET LOCAL search_path TO transfers, public;

INSERT INTO transfers.document_requirement_rules
    (rule_key, display_name, classification_code, condition_key, sequence_number)
VALUES
    -- DOC-001 Identity document / passport
    ('doc-001.*', 'Identity document / passport', '*', NULL, 1),
    -- DOC-008 Death certificate
    ('doc-008.transfer.deceased_estate_inheritance', 'Death certificate', 'transfer.deceased_estate_inheritance', NULL, 8),
    ('doc-008.transfer.deceased_estate_sale', 'Death certificate', 'transfer.deceased_estate_sale', NULL, 8),
    ('doc-008.transfer.endorsement_section_45', 'Death certificate', 'transfer.endorsement_section_45', NULL, 8),
    -- DOC-017 Signed offer to purchase / sale agreement
    ('doc-017.transfer.private_treaty.not_applicable', 'Signed offer to purchase / sale agreement', 'transfer.private_treaty.not_applicable', NULL, 17),
    ('doc-017.transfer.private_treaty.sectional_title_register', 'Signed offer to purchase / sale agreement', 'transfer.private_treaty.sectional_title_register', NULL, 17),
    ('doc-017.transfer.private_treaty.township_register', 'Signed offer to purchase / sale agreement', 'transfer.private_treaty.township_register', NULL, 17),
    ('doc-017.transfer.private_treaty.extension_of_scheme', 'Signed offer to purchase / sale agreement', 'transfer.private_treaty.extension_of_scheme', NULL, 17),
    ('doc-017.transfer.private_treaty.subdivision', 'Signed offer to purchase / sale agreement', 'transfer.private_treaty.subdivision', NULL, 17),
    ('doc-017.transfer.private_treaty.bulk_transfer', 'Signed offer to purchase / sale agreement', 'transfer.private_treaty.bulk_transfer', NULL, 17),
    ('doc-017.transfer.property_in_possession', 'Signed offer to purchase / sale agreement', 'transfer.property_in_possession', NULL, 17),
    ('doc-017.transfer.deceased_estate_sale', 'Signed offer to purchase / sale agreement', 'transfer.deceased_estate_sale', NULL, 17),
    -- DOC-024 Letters of executorship / applicable appointment
    ('doc-024.transfer.deceased_estate_inheritance', 'Letters of executorship / applicable appointment', 'transfer.deceased_estate_inheritance', NULL, 24),
    ('doc-024.transfer.deceased_estate_sale', 'Letters of executorship / applicable appointment', 'transfer.deceased_estate_sale', NULL, 24),
    ('doc-024.transfer.endorsement_section_45', 'Letters of executorship / applicable appointment', 'transfer.endorsement_section_45', NULL, 24),
    -- DOC-025 Liquidation and distribution account
    ('doc-025.transfer.deceased_estate_inheritance', 'Liquidation and distribution account', 'transfer.deceased_estate_inheritance', NULL, 25),
    ('doc-025.transfer.endorsement_section_45', 'Liquidation and distribution account', 'transfer.endorsement_section_45', NULL, 25),
    -- DOC-028 Auction conditions and signed sale record
    ('doc-028.transfer.auction', 'Auction conditions and signed sale record', 'transfer.auction', NULL, 28),
    ('doc-028.transfer.sale_in_execution', 'Auction conditions and signed sale record', 'transfer.sale_in_execution', NULL, 28),
    -- DOC-029 Court order / writ supporting execution sale
    ('doc-029.transfer.sale_in_execution', 'Court order / writ supporting execution sale', 'transfer.sale_in_execution', NULL, 29),
    -- DOC-030 Power of attorney to pass transfer
    ('doc-030.transfer.private_treaty.not_applicable', 'Power of attorney to pass transfer', 'transfer.private_treaty.not_applicable', NULL, 30),
    ('doc-030.transfer.private_treaty.sectional_title_register', 'Power of attorney to pass transfer', 'transfer.private_treaty.sectional_title_register', NULL, 30),
    ('doc-030.transfer.private_treaty.township_register', 'Power of attorney to pass transfer', 'transfer.private_treaty.township_register', NULL, 30),
    ('doc-030.transfer.private_treaty.extension_of_scheme', 'Power of attorney to pass transfer', 'transfer.private_treaty.extension_of_scheme', NULL, 30),
    ('doc-030.transfer.private_treaty.subdivision', 'Power of attorney to pass transfer', 'transfer.private_treaty.subdivision', NULL, 30),
    ('doc-030.transfer.private_treaty.bulk_transfer', 'Power of attorney to pass transfer', 'transfer.private_treaty.bulk_transfer', NULL, 30),
    ('doc-030.transfer.auction', 'Power of attorney to pass transfer', 'transfer.auction', NULL, 30),
    ('doc-030.transfer.sale_in_execution', 'Power of attorney to pass transfer', 'transfer.sale_in_execution', NULL, 30),
    ('doc-030.transfer.property_in_possession', 'Power of attorney to pass transfer', 'transfer.property_in_possession', NULL, 30),
    ('doc-030.transfer.deceased_estate_inheritance', 'Power of attorney to pass transfer', 'transfer.deceased_estate_inheritance', NULL, 30),
    ('doc-030.transfer.deceased_estate_sale', 'Power of attorney to pass transfer', 'transfer.deceased_estate_sale', NULL, 30),
    ('doc-030.transfer.donation', 'Power of attorney to pass transfer', 'transfer.donation', NULL, 30),
    -- DOC-033 FICA / client information questionnaire
    ('doc-033.*', 'FICA / client information questionnaire', '*', NULL, 33),
    -- DOC-035 Deed of transfer
    ('doc-035.transfer.private_treaty.not_applicable', 'Deed of transfer', 'transfer.private_treaty.not_applicable', NULL, 35),
    ('doc-035.transfer.private_treaty.sectional_title_register', 'Deed of transfer', 'transfer.private_treaty.sectional_title_register', NULL, 35),
    ('doc-035.transfer.private_treaty.township_register', 'Deed of transfer', 'transfer.private_treaty.township_register', NULL, 35),
    ('doc-035.transfer.private_treaty.extension_of_scheme', 'Deed of transfer', 'transfer.private_treaty.extension_of_scheme', NULL, 35),
    ('doc-035.transfer.private_treaty.subdivision', 'Deed of transfer', 'transfer.private_treaty.subdivision', NULL, 35),
    ('doc-035.transfer.private_treaty.bulk_transfer', 'Deed of transfer', 'transfer.private_treaty.bulk_transfer', NULL, 35),
    ('doc-035.transfer.auction', 'Deed of transfer', 'transfer.auction', NULL, 35),
    ('doc-035.transfer.sale_in_execution', 'Deed of transfer', 'transfer.sale_in_execution', NULL, 35),
    ('doc-035.transfer.property_in_possession', 'Deed of transfer', 'transfer.property_in_possession', NULL, 35),
    ('doc-035.transfer.deceased_estate_inheritance', 'Deed of transfer', 'transfer.deceased_estate_inheritance', NULL, 35),
    ('doc-035.transfer.deceased_estate_sale', 'Deed of transfer', 'transfer.deceased_estate_sale', NULL, 35),
    ('doc-035.transfer.donation', 'Deed of transfer', 'transfer.donation', NULL, 35),
    -- DOC-036 Transfer duty declaration (TDC01)
    ('doc-036.transfer.private_treaty.not_applicable', 'Transfer duty declaration (TDC01)', 'transfer.private_treaty.not_applicable', NULL, 36),
    ('doc-036.transfer.private_treaty.sectional_title_register', 'Transfer duty declaration (TDC01)', 'transfer.private_treaty.sectional_title_register', NULL, 36),
    ('doc-036.transfer.private_treaty.township_register', 'Transfer duty declaration (TDC01)', 'transfer.private_treaty.township_register', NULL, 36),
    ('doc-036.transfer.private_treaty.extension_of_scheme', 'Transfer duty declaration (TDC01)', 'transfer.private_treaty.extension_of_scheme', NULL, 36),
    ('doc-036.transfer.private_treaty.subdivision', 'Transfer duty declaration (TDC01)', 'transfer.private_treaty.subdivision', NULL, 36),
    ('doc-036.transfer.private_treaty.bulk_transfer', 'Transfer duty declaration (TDC01)', 'transfer.private_treaty.bulk_transfer', NULL, 36),
    ('doc-036.transfer.auction', 'Transfer duty declaration (TDC01)', 'transfer.auction', NULL, 36),
    ('doc-036.transfer.sale_in_execution', 'Transfer duty declaration (TDC01)', 'transfer.sale_in_execution', NULL, 36),
    ('doc-036.transfer.property_in_possession', 'Transfer duty declaration (TDC01)', 'transfer.property_in_possession', NULL, 36),
    ('doc-036.transfer.deceased_estate_inheritance', 'Transfer duty declaration (TDC01)', 'transfer.deceased_estate_inheritance', NULL, 36),
    ('doc-036.transfer.deceased_estate_sale', 'Transfer duty declaration (TDC01)', 'transfer.deceased_estate_sale', NULL, 36),
    ('doc-036.transfer.endorsement_section_45', 'Transfer duty declaration (TDC01)', 'transfer.endorsement_section_45', NULL, 36),
    ('doc-036.transfer.endorsement_section_45bis', 'Transfer duty declaration (TDC01)', 'transfer.endorsement_section_45bis', NULL, 36),
    ('doc-036.transfer.donation', 'Transfer duty declaration (TDC01)', 'transfer.donation', NULL, 36),
    -- DOC-037 Deed of donation
    ('doc-037.transfer.donation', 'Deed of donation', 'transfer.donation', NULL, 37),
    -- DOC-038 Section 45 endorsement application
    ('doc-038.transfer.endorsement_section_45', 'Section 45 endorsement application', 'transfer.endorsement_section_45', NULL, 38),
    -- DOC-039 Section 45bis endorsement application
    ('doc-039.transfer.endorsement_section_45bis', 'Section 45bis endorsement application', 'transfer.endorsement_section_45bis', NULL, 39),
    -- DOC-040 Conveyancer’s sectional title certificate (s15B)
    ('doc-040.transfer.private_treaty.sectional_title_register', 'Conveyancer’s sectional title certificate (s15B)', 'transfer.private_treaty.sectional_title_register', NULL, 40),
    ('doc-040.transfer.private_treaty.extension_of_scheme', 'Conveyancer’s sectional title certificate (s15B)', 'transfer.private_treaty.extension_of_scheme', NULL, 40),
    -- DOC-041 Transfer cost quotation / pro forma
    ('doc-041.*', 'Transfer cost quotation / pro forma', '*', NULL, 41),
    -- DOC-045 Rates clearance certificate
    ('doc-045.transfer.private_treaty.not_applicable', 'Rates clearance certificate', 'transfer.private_treaty.not_applicable', NULL, 45),
    ('doc-045.transfer.private_treaty.sectional_title_register', 'Rates clearance certificate', 'transfer.private_treaty.sectional_title_register', NULL, 45),
    ('doc-045.transfer.private_treaty.township_register', 'Rates clearance certificate', 'transfer.private_treaty.township_register', NULL, 45),
    ('doc-045.transfer.private_treaty.extension_of_scheme', 'Rates clearance certificate', 'transfer.private_treaty.extension_of_scheme', NULL, 45),
    ('doc-045.transfer.private_treaty.subdivision', 'Rates clearance certificate', 'transfer.private_treaty.subdivision', NULL, 45),
    ('doc-045.transfer.private_treaty.bulk_transfer', 'Rates clearance certificate', 'transfer.private_treaty.bulk_transfer', NULL, 45),
    ('doc-045.transfer.auction', 'Rates clearance certificate', 'transfer.auction', NULL, 45),
    ('doc-045.transfer.sale_in_execution', 'Rates clearance certificate', 'transfer.sale_in_execution', NULL, 45),
    ('doc-045.transfer.property_in_possession', 'Rates clearance certificate', 'transfer.property_in_possession', NULL, 45),
    ('doc-045.transfer.deceased_estate_inheritance', 'Rates clearance certificate', 'transfer.deceased_estate_inheritance', NULL, 45),
    ('doc-045.transfer.deceased_estate_sale', 'Rates clearance certificate', 'transfer.deceased_estate_sale', NULL, 45),
    ('doc-045.transfer.donation', 'Rates clearance certificate', 'transfer.donation', NULL, 45),
    -- DOC-048 SARS transfer duty receipt / exemption receipt
    ('doc-048.transfer.private_treaty.not_applicable', 'SARS transfer duty receipt / exemption receipt', 'transfer.private_treaty.not_applicable', NULL, 48),
    ('doc-048.transfer.private_treaty.sectional_title_register', 'SARS transfer duty receipt / exemption receipt', 'transfer.private_treaty.sectional_title_register', NULL, 48),
    ('doc-048.transfer.private_treaty.township_register', 'SARS transfer duty receipt / exemption receipt', 'transfer.private_treaty.township_register', NULL, 48),
    ('doc-048.transfer.private_treaty.extension_of_scheme', 'SARS transfer duty receipt / exemption receipt', 'transfer.private_treaty.extension_of_scheme', NULL, 48),
    ('doc-048.transfer.private_treaty.subdivision', 'SARS transfer duty receipt / exemption receipt', 'transfer.private_treaty.subdivision', NULL, 48),
    ('doc-048.transfer.private_treaty.bulk_transfer', 'SARS transfer duty receipt / exemption receipt', 'transfer.private_treaty.bulk_transfer', NULL, 48),
    ('doc-048.transfer.auction', 'SARS transfer duty receipt / exemption receipt', 'transfer.auction', NULL, 48),
    ('doc-048.transfer.sale_in_execution', 'SARS transfer duty receipt / exemption receipt', 'transfer.sale_in_execution', NULL, 48),
    ('doc-048.transfer.property_in_possession', 'SARS transfer duty receipt / exemption receipt', 'transfer.property_in_possession', NULL, 48),
    ('doc-048.transfer.deceased_estate_inheritance', 'SARS transfer duty receipt / exemption receipt', 'transfer.deceased_estate_inheritance', NULL, 48),
    ('doc-048.transfer.deceased_estate_sale', 'SARS transfer duty receipt / exemption receipt', 'transfer.deceased_estate_sale', NULL, 48),
    ('doc-048.transfer.endorsement_section_45', 'SARS transfer duty receipt / exemption receipt', 'transfer.endorsement_section_45', NULL, 48),
    ('doc-048.transfer.endorsement_section_45bis', 'SARS transfer duty receipt / exemption receipt', 'transfer.endorsement_section_45bis', NULL, 48),
    ('doc-048.transfer.donation', 'SARS transfer duty receipt / exemption receipt', 'transfer.donation', NULL, 48),
    -- DOC-053 Existing title deed / registered copy
    ('doc-053.*', 'Existing title deed / registered copy', '*', NULL, 53),
    -- DOC-054 Deeds search report
    ('doc-054.*', 'Deeds search report', '*', NULL, 54),
    -- DOC-060 Property valuation report(s)
    ('doc-060.transfer.donation', 'Property valuation report(s)', 'transfer.donation', NULL, 60),
    -- DOC-061 Master’s section 42(2) certificate
    ('doc-061.transfer.deceased_estate_sale', 'Master’s section 42(2) certificate', 'transfer.deceased_estate_sale', NULL, 61),
    -- DOC-064 Approved sectional plan
    ('doc-064.development.new_sectional_title_register', 'Approved sectional plan', 'development.new_sectional_title_register', NULL, 64),
    ('doc-064.development.scheme_extension_sections', 'Approved sectional plan', 'development.scheme_extension_sections', NULL, 64),
    -- DOC-065 Approved general plan / subdivision diagram
    ('doc-065.development.new_township_register_establishment', 'Approved general plan / subdivision diagram', 'development.new_township_register_establishment', NULL, 65),
    ('doc-065.development.subdivision', 'Approved general plan / subdivision diagram', 'development.subdivision', NULL, 65),
    -- DOC-066 Planning approval and conditions
    ('doc-066.development.new_sectional_title_register', 'Planning approval and conditions', 'development.new_sectional_title_register', NULL, 66),
    ('doc-066.development.new_township_register_establishment', 'Planning approval and conditions', 'development.new_township_register_establishment', NULL, 66),
    ('doc-066.development.scheme_extension_sections', 'Planning approval and conditions', 'development.scheme_extension_sections', NULL, 66),
    ('doc-066.development.subdivision', 'Planning approval and conditions', 'development.subdivision', NULL, 66),
    -- DOC-067 Development register / subdivision application
    ('doc-067.development.new_sectional_title_register', 'Development register / subdivision application', 'development.new_sectional_title_register', NULL, 67),
    ('doc-067.development.new_township_register_establishment', 'Development register / subdivision application', 'development.new_township_register_establishment', NULL, 67),
    ('doc-067.development.scheme_extension_sections', 'Development register / subdivision application', 'development.scheme_extension_sections', NULL, 67),
    ('doc-067.development.subdivision', 'Development register / subdivision application', 'development.subdivision', NULL, 67),
    -- DOC-068 Certificates of registered title / sectional title
    ('doc-068.development.new_sectional_title_register', 'Certificates of registered title / sectional title', 'development.new_sectional_title_register', NULL, 68),
    ('doc-068.development.new_township_register_establishment', 'Certificates of registered title / sectional title', 'development.new_township_register_establishment', NULL, 68),
    ('doc-068.development.scheme_extension_sections', 'Certificates of registered title / sectional title', 'development.scheme_extension_sections', NULL, 68),
    ('doc-068.development.subdivision', 'Certificates of registered title / sectional title', 'development.subdivision', NULL, 68),
    -- DOC-071 Conveyancer’s section 42(1) certificate
    ('doc-071.transfer.deceased_estate_inheritance', 'Conveyancer’s section 42(1) certificate', 'transfer.deceased_estate_inheritance', NULL, 71),
    ('doc-071.transfer.endorsement_section_45', 'Conveyancer’s section 42(1) certificate', 'transfer.endorsement_section_45', NULL, 71),
    -- DOC-072 Donation tax declaration (IT144)
    ('doc-072.transfer.donation', 'Donation tax declaration (IT144)', 'transfer.donation', NULL, 72),
    -- DOC-076 Conveyancer title-conditions schedule
    ('doc-076.development.new_sectional_title_register', 'Conveyancer title-conditions schedule', 'development.new_sectional_title_register', NULL, 76),
    -- DOC-077 Conveyancer scheme-rules certificate
    ('doc-077.development.new_sectional_title_register', 'Conveyancer scheme-rules certificate', 'development.new_sectional_title_register', NULL, 77),
    -- DOC-078 Revised participation-quota schedule
    ('doc-078.development.scheme_extension_sections', 'Revised participation-quota schedule', 'development.scheme_extension_sections', NULL, 78),
    -- DOC-082 Confirmed registration record
    ('doc-082.*', 'Confirmed registration record', '*', NULL, 82),
    -- DOC-084 Sheriff’s execution-transfer supporting pack
    ('doc-084.transfer.sale_in_execution', 'Sheriff’s execution-transfer supporting pack', 'transfer.sale_in_execution', NULL, 84),
    -- DOC-085 Bulk property / allocation / linked-matter schedule
    ('doc-085.transfer.private_treaty.bulk_transfer', 'Bulk property / allocation / linked-matter schedule', 'transfer.private_treaty.bulk_transfer', NULL, 85)
ON CONFLICT (rule_key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    classification_code = EXCLUDED.classification_code,
    condition_key = EXCLUDED.condition_key,
    sequence_number = EXCLUDED.sequence_number;

COMMIT;
