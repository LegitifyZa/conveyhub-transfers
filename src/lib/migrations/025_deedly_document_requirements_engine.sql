-- Migration: 025_deedly_document_requirements_engine.sql
-- Purpose: Schema foundation for DEEDLY Document Requirements Engine & Document Center.
--          Introduces:
--          1. document_definitions: Master catalogue of conveyancing logical documents
--          2. document_requirement_rules: Decision tree rules evaluated against matter facts
--          3. matter_document_requirements: Matter-specific active requirements register
--          4. matter_document_requirement_history: Audit log of status transitions and changes
--          5. Seeds core conveyancing documents and decision rules (FICA, POA, Rates, SARS, Levies)
-- Created: 2026-09-25

BEGIN;

SET LOCAL search_path TO transfers, public;

-- ============================================================================
-- 1. Master Catalogue of Logical Document Definitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_definitions (
    code                    VARCHAR(100) PRIMARY KEY,
    name                    VARCHAR(255) NOT NULL,
    category                VARCHAR(50)  NOT NULL,
    fulfillment_type        VARCHAR(30)  NOT NULL CHECK (fulfillment_type IN ('GENERATED', 'COLLECTED')),
    default_output_formats  TEXT[]       NOT NULL DEFAULT ARRAY['pdf'],
    description             TEXT,
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_definitions_category ON document_definitions(category);
CREATE INDEX IF NOT EXISTS idx_document_definitions_fulfillment ON document_definitions(fulfillment_type);
CREATE INDEX IF NOT EXISTS idx_document_definitions_active ON document_definitions(is_active);

-- ============================================================================
-- 2. Document Decision Tree Requirement Rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_requirement_rules (
    rule_code               VARCHAR(100) PRIMARY KEY,
    document_code           VARCHAR(100) NOT NULL REFERENCES document_definitions(code) ON UPDATE CASCADE,
    title                   VARCHAR(255) NOT NULL,
    description             TEXT,
    target_role_code        VARCHAR(40)  REFERENCES party_role_definitions(code) ON UPDATE CASCADE,
    condition_expression    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    requirement_nature      VARCHAR(30)  NOT NULL DEFAULT 'MANDATORY' CHECK (requirement_nature IN ('MANDATORY', 'CONDITIONAL', 'OPTIONAL')),
    priority                INTEGER      NOT NULL DEFAULT 100,
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_requirement_rules_document_code ON document_requirement_rules(document_code);
CREATE INDEX IF NOT EXISTS idx_document_requirement_rules_target_role ON document_requirement_rules(target_role_code);
CREATE INDEX IF NOT EXISTS idx_document_requirement_rules_active ON document_requirement_rules(is_active);

-- ============================================================================
-- 3. Matter Document Requirements Register
-- ============================================================================
CREATE TABLE IF NOT EXISTS matter_document_requirements (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    accountable_institution_id  BIGINT NOT NULL,
    matter_id                   UUID NOT NULL REFERENCES transfers.matters(id) ON DELETE CASCADE,
    document_code               VARCHAR(100) NOT NULL REFERENCES document_definitions(code) ON UPDATE CASCADE,
    rule_code                   VARCHAR(100) REFERENCES document_requirement_rules(rule_code) ON UPDATE CASCADE,
    origin                      VARCHAR(30) NOT NULL DEFAULT 'RULE_AUTOMATED' CHECK (origin IN ('RULE_AUTOMATED', 'MANUAL_AD_HOC')),
    target_party_id             UUID REFERENCES transfers.parties(id) ON DELETE SET NULL,
    title                       VARCHAR(255) NOT NULL,
    instructions                TEXT,
    status                      VARCHAR(40) NOT NULL DEFAULT 'REQUIRED' CHECK (status IN (
                                    'REQUIRED',
                                    'AWAITING_UPLOAD',
                                    'READY_TO_GENERATE',
                                    'GENERATING',
                                    'SUBMITTED',
                                    'UNDER_REVIEW',
                                    'REJECTED',
                                    'SATISFIED',
                                    'NOT_APPLICABLE',
                                    'SUPERSEDED'
                                )),
    satisfaction_source         VARCHAR(30) CHECK (satisfaction_source IN (
                                    'GENERATED',
                                    'UPLOADED',
                                    'MANUAL_WAIVER',
                                    'EXTERNAL_SOURCE'
                                )),
    satisfied_by_generation_id  VARCHAR(100),
    satisfied_by_document_id    UUID REFERENCES transfers.transfer_documents(id) ON DELETE SET NULL,
    rejection_reason            TEXT,
    created_by_user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_by_user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matter_doc_reqs_matter_id ON matter_document_requirements(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_doc_reqs_institution_id ON matter_document_requirements(accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_matter_doc_reqs_document_code ON matter_document_requirements(document_code);
CREATE INDEX IF NOT EXISTS idx_matter_doc_reqs_rule_code ON matter_document_requirements(rule_code);
CREATE INDEX IF NOT EXISTS idx_matter_doc_reqs_target_party ON matter_document_requirements(target_party_id);
CREATE INDEX IF NOT EXISTS idx_matter_doc_reqs_status ON matter_document_requirements(status);

-- Idempotency constraint: a matter cannot have duplicate automated requirements for the same document and target party
CREATE UNIQUE INDEX IF NOT EXISTS uq_matter_doc_req_party_rule
    ON matter_document_requirements (matter_id, document_code, COALESCE(target_party_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE origin = 'RULE_AUTOMATED' AND status NOT IN ('NOT_APPLICABLE', 'SUPERSEDED');

-- ============================================================================
-- 4. Document Requirement Audit & Transition History
-- ============================================================================
CREATE TABLE IF NOT EXISTS matter_document_requirement_history (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requirement_id              UUID NOT NULL REFERENCES matter_document_requirements(id) ON DELETE CASCADE,
    matter_id                   UUID NOT NULL REFERENCES transfers.matters(id) ON DELETE CASCADE,
    accountable_institution_id  BIGINT NOT NULL,
    previous_status             VARCHAR(40),
    new_status                  VARCHAR(40) NOT NULL,
    change_reason               TEXT,
    actor_user_id               UUID REFERENCES public.users(id) ON DELETE SET NULL,
    metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matter_doc_req_hist_req_id ON matter_document_requirement_history(requirement_id);
CREATE INDEX IF NOT EXISTS idx_matter_doc_req_hist_matter_id ON matter_document_requirement_history(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_doc_req_hist_institution ON matter_document_requirement_history(accountable_institution_id);

-- ============================================================================
-- 5. Seed Core Document Definitions
-- ============================================================================
INSERT INTO document_definitions (code, name, category, fulfillment_type, default_output_formats, description) VALUES
    -- FICA KYC
    ('fica_id_document',               'Proof of Identification (ID/Passport)',         'fica',                    'COLLECTED', ARRAY['pdf', 'image/jpeg', 'image/png'], 'Valid certified South African Smart ID or valid Foreign Passport.'),
    ('fica_proof_of_residence',        'Proof of Residential Address',                  'fica',                    'COLLECTED', ARRAY['pdf', 'image/jpeg', 'image/png'], 'Utility bill or bank statement dated within the past 3 months.'),
    ('fica_proof_of_bank',             'Confirmation of Banking Details',               'fica',                    'COLLECTED', ARRAY['pdf'],                             'Official bank confirmation letter with account holder details.'),
    ('fica_cipc_registration',         'CIPC Company Registration Documents',           'fica',                    'COLLECTED', ARRAY['pdf'],                             'Company COR14.3 / Registration Certificate and Director disclosures.'),
    ('fica_trust_letters_of_authority','Letters of Authority (Trust)',                   'fica',                    'COLLECTED', ARRAY['pdf'],                             'Master of the High Court Letters of Authority.'),

    -- Authorities & Resolutions
    ('power_of_attorney_to_transfer',  'Power of Attorney to Pass Transfer',            'authorities',             'GENERATED', ARRAY['pdf', 'docx'],                     'Special Power of Attorney authorizing the conveyancer to execute the deed.'),
    ('resolution_trust_to_sell',       'Trustees Resolution to Sell/Transfer',          'authorities',             'GENERATED', ARRAY['pdf', 'docx'],                     'Formal resolution by all trustees in terms of Trust Deed powers.'),
    ('resolution_company_to_sell',     'Company Resolution to Sell/Transfer',           'authorities',             'GENERATED', ARRAY['pdf', 'docx'],                     'Board resolution in terms of Companies Act section 46 / memorandum.'),
    ('spousal_consent_cop',            'Spousal Consent (In Community of Property)',    'authorities',             'GENERATED', ARRAY['pdf', 'docx'],                     'Consent in terms of Section 15 of Matrimonial Property Act.'),

    -- Municipal, Property & Sectional Clearances
    ('rates_clearance_application',    'Municipal Rates Clearance Application',         'municipal_rates',         'GENERATED', ARRAY['pdf', 'docx'],                     'Formal application to local municipality for rates clearance figures.'),
    ('rates_clearance_certificate',    'Municipal Rates Clearance Certificate (Sec 118)','municipal_rates',        'COLLECTED', ARRAY['pdf'],                             'Section 118 certificate issued by municipality certifying debt clearance.'),
    ('body_corporate_levy_clearance',  'Body Corporate Levy Clearance Certificate',     'sectional_title',         'COLLECTED', ARRAY['pdf'],                             'Section 15B(3)(a)(i)(aa) certificate from body corporate confirming levies paid.'),
    ('homeowners_association_consent', 'Home Owners Association (HOA) Consent',         'property_clearance',      'COLLECTED', ARRAY['pdf'],                             'Consent to transfer issued by HOA / Master Property Owners Association.'),

    -- SARS & Tax
    ('sars_transfer_duty_declaration', 'SARS Transfer Duty Declarations',               'statutory_tax',           'GENERATED', ARRAY['pdf', 'docx'],                     'Transfer duty declarations by transferor and transferee for SARS TDC01.'),
    ('sars_transfer_duty_receipt',     'SARS Transfer Duty Receipt / Exemption',        'statutory_tax',           'COLLECTED', ARRAY['pdf'],                             'Electronic receipt or exemption certificate issued by SARS.'),

    -- Financial & Undertakings
    ('pro_forma_statement_transferee', 'Pro-forma Statement of Account (Transferee)',  'financial_banking',       'GENERATED', ARRAY['pdf', 'docx'],                     'Statement of transfer fees, transfer duty, pro-rata rates and disbursements.'),
    ('pro_forma_statement_transferor', 'Pro-forma Statement of Account (Transferor)',  'financial_banking',       'GENERATED', ARRAY['pdf', 'docx'],                     'Statement of cancellation fees, bond redemption, commission and proceeds.'),
    ('bond_grant_instruction',         'Mortgage Bond Grant / Instruction Letter',      'financial_banking',       'COLLECTED', ARRAY['pdf'],                             'Instruction letter from bond attorney / mortgage bank.'),
    ('bank_payment_guarantee',         'Bank Guarantee for Balance of Purchase Price',  'financial_banking',       'COLLECTED', ARRAY['pdf'],                             'Irrevocable letter of undertaking from registered commercial bank.'),
    ('bond_cancellation_consent',      'Existing Bond Cancellation Consent & Figures',  'financial_banking',       'COLLECTED', ARRAY['pdf'],                             'Consent and settlement figures from existing bondholder.'),

    -- Compliance Certificates
    ('compliance_certificate_electrical','Electrical Compliance Certificate (COC)',      'compliance_certificates', 'COLLECTED', ARRAY['pdf'],                             'Certificate of Compliance in terms of Electrical Installation Regulations.'),
    ('compliance_certificate_beetle',    'Beetle / Wood Borer Clearance Certificate',    'compliance_certificates', 'COLLECTED', ARRAY['pdf'],                             'Certificate by registered inspector confirming freedom from timber pests.'),
    ('compliance_certificate_gas',       'Gas Installation Compliance Certificate',       'compliance_certificates', 'COLLECTED', ARRAY['pdf'],                             'Certificate in terms of Pressure Equipment Regulations for gas appliances.'),
    ('compliance_certificate_electric_fence','Electric Fence System Certificate of Compliance','compliance_certificates', 'COLLECTED', ARRAY['pdf'],                             'Certificate in terms of Electrical Machinery Regulations for electric fences.'),
    ('compliance_certificate_plumbing',  'Water By-Law / Plumbing Certificate',          'compliance_certificates', 'COLLECTED', ARRAY['pdf'],                             'Certificate of compliance of water installation (e.g. City of Cape Town).')
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    fulfillment_type = EXCLUDED.fulfillment_type,
    default_output_formats = EXCLUDED.default_output_formats,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;

-- ============================================================================
-- 6. Seed Initial Core Requirement Rules (Decision Tree Predicates)
-- ============================================================================
INSERT INTO document_requirement_rules (rule_code, document_code, title, target_role_code, condition_expression, requirement_nature, priority) VALUES
    -- Universal Transfer Requirements
    ('rule.transfer.poa.standard',
     'power_of_attorney_to_transfer',
     'Power of Attorney to Pass Transfer required for all transfer matters',
     'transferor',
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 10),

    ('rule.transfer.sars.declaration',
     'sars_transfer_duty_declaration',
     'SARS Transfer Duty Declaration required for transfer matters',
     NULL,
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 20),

    ('rule.transfer.sars.receipt',
     'sars_transfer_duty_receipt',
     'SARS Transfer Duty Receipt or Exemption required prior to lodgement',
     NULL,
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 25),

    ('rule.transfer.rates.application',
     'rates_clearance_application',
     'Municipal Rates Clearance Application required to obtain municipal figures',
     NULL,
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 30),

    ('rule.transfer.rates.certificate',
     'rates_clearance_certificate',
     'Section 118 Rates Clearance Certificate required for Deeds Registry lodgement',
     NULL,
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 35),

    -- Sectional Title Specific Requirements
    ('rule.sectional.levy_clearance',
     'body_corporate_levy_clearance',
     'Body Corporate Levy Clearance required for Sectional Title transfers',
     NULL,
     '{"property_type": "sectional_title"}'::jsonb,
     'MANDATORY', 40),

    -- Financial Accounts
    ('rule.accounts.transferee_pro_forma',
     'pro_forma_statement_transferee',
     'Pro-forma Statement required for buyer payment request',
     'transferee',
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 50),

    ('rule.accounts.transferor_pro_forma',
     'pro_forma_statement_transferor',
     'Pro-forma Statement required for seller calculation',
     'transferor',
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 55),

    -- Party FICA Requirements (per entity type)
    ('rule.fica.person.id',
     'fica_id_document',
     'Proof of ID required for natural persons',
     NULL,
     '{"entity_type": "person"}'::jsonb,
     'MANDATORY', 100),

    ('rule.fica.person.proof_of_residence',
     'fica_proof_of_residence',
     'Proof of Residence required for natural persons',
     NULL,
     '{"entity_type": "person"}'::jsonb,
     'MANDATORY', 105),

    ('rule.fica.company.registration',
     'fica_cipc_registration',
     'CIPC Registration Documents required for juristic entities',
     NULL,
     '{"entity_type": "company"}'::jsonb,
     'MANDATORY', 110),

    ('rule.fica.trust.letters_of_authority',
     'fica_trust_letters_of_authority',
     'Letters of Authority required for trust entities',
     NULL,
     '{"entity_type": "trust"}'::jsonb,
     'MANDATORY', 115),

    -- Compliance Certificates
    ('rule.compliance.electrical',
     'compliance_certificate_electrical',
     'Electrical COC required for property transfer',
     NULL,
     '{"classification_category": "transfer"}'::jsonb,
     'MANDATORY', 150)
ON CONFLICT (rule_code) DO UPDATE SET
    document_code = EXCLUDED.document_code,
    title = EXCLUDED.title,
    target_role_code = EXCLUDED.target_role_code,
    condition_expression = EXCLUDED.condition_expression,
    requirement_nature = EXCLUDED.requirement_nature,
    priority = EXCLUDED.priority,
    is_active = EXCLUDED.is_active;

COMMIT;
