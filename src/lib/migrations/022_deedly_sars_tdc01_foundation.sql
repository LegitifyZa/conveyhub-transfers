-- Migration: 022_deedly_sars_tdc01_foundation.sql
-- Purpose: DEEDLY SARS TDC01 local foundation tables, firm/role additions
--          and tenant-scoped audit lifecycle. No live SARS connectivity.
-- Scope:   Schema and reference-data only; no API or validation rules.

BEGIN;

SET LOCAL search_path TO transfers, public;

-- 1. Firm contact additions for SARS correspondence.
ALTER TABLE account_firm_settings
    ADD COLUMN IF NOT EXISTS fax VARCHAR(20),
    ADD COLUMN IF NOT EXISTS sars_contact_details JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Seed the additional SARS-relevant party roles.
INSERT INTO party_role_definitions (code, label, description) VALUES
    ('estate_agent', 'Estate Agent', 'Matter-specific estate agency representative'),
    ('existing_shareholder', 'Existing Shareholder/Member/Beneficiary', 'Existing shareholder, member or beneficiary for trust/company transfers'),
    ('new_shareholder', 'New Shareholder/Member/Beneficiary', 'New shareholder, member or beneficiary for trust/company transfers'),
    ('trustee', 'Trustee', 'Person appointed to administer and represent a trust')
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- 3. Core SARS submission lifecycle table.
CREATE TABLE IF NOT EXISTS sars_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL,
    matter_id UUID,
    accountable_institution_id INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'assessed', 'paid', 'completed', 'rejected', 'cancelled')),
    payload_version VARCHAR(50) NOT NULL DEFAULT '1.0',
    submission_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    sars_reference_no VARCHAR(50),
    assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
    receipt_no VARCHAR(50),
    receipt_amount NUMERIC(14,2),
    receipt_at DATE,
    submitted_at TIMESTAMPTZ,
    assessed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    vdp_indicator BOOLEAN NOT NULL DEFAULT FALSE,
    vdp_application_no VARCHAR(50),
    exemption_section9 TEXT,
    exemption_other_act TEXT,
    related_exchange_sars_reference_no VARCHAR(50),
    related_exchange_total_fair_value NUMERIC(14,2),
    related_exchange_other_consideration NUMERIC(14,2),
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sars_submissions_transfer_tenant
        FOREIGN KEY (transfer_id, accountable_institution_id)
        REFERENCES transfers(id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sars_submissions_transfer_id
    ON sars_submissions (transfer_id);
CREATE INDEX IF NOT EXISTS idx_sars_submissions_accountable_institution_id
    ON sars_submissions (accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_sars_submissions_status
    ON sars_submissions (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sars_submissions_id_accountable_institution_id
    ON sars_submissions (id, accountable_institution_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sars_submissions_active_draft_per_transfer
    ON sars_submissions (transfer_id) WHERE status = 'draft';

-- 4. Append-only SARS submission event history.
CREATE TABLE IF NOT EXISTS sars_submission_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sars_submission_id UUID NOT NULL,
    event_type VARCHAR(40) NOT NULL
        CHECK (event_type IN ('created', 'submitted', 'response_received', 'receipt_received', 'error', 'resubmitted', 'exemption_issued')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    accountable_institution_id INTEGER NOT NULL,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sars_submission_events_submission_tenant
        FOREIGN KEY (sars_submission_id, accountable_institution_id)
        REFERENCES sars_submissions(id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sars_submission_events_submission_id
    ON sars_submission_events (sars_submission_id);
CREATE INDEX IF NOT EXISTS idx_sars_submission_events_accountable_institution_id
    ON sars_submission_events (accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_sars_submission_events_event_type
    ON sars_submission_events (event_type);

-- 5. Versioned DEEDLY pre-submission calculation / projection.
CREATE TABLE IF NOT EXISTS sars_calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL,
    sars_submission_id UUID REFERENCES sars_submissions(id) ON DELETE SET NULL,
    accountable_institution_id INTEGER NOT NULL,
    calculation_version VARCHAR(50) NOT NULL DEFAULT '1.0',
    purchase_price NUMERIC(14,2),
    other_consideration NUMERIC(14,2),
    total_consideration NUMERIC(14,2),
    transfer_duty_payable NUMERIC(14,2),
    is_vat_transaction BOOLEAN,
    vat_rate_indicator CHAR(1),
    vat_payable NUMERIC(14,2),
    output_tax_payable NUMERIC(14,2),
    supply_going_concern_payable NUMERIC(14,2),
    sub_total NUMERIC(14,2),
    penalty_interest NUMERIC(14,2),
    total_payable NUMERIC(14,2),
    party_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
    calculation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sars_calculations_transfer_tenant
        FOREIGN KEY (transfer_id, accountable_institution_id)
        REFERENCES transfers(id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sars_calculations_transfer_id
    ON sars_calculations (transfer_id);
CREATE INDEX IF NOT EXISTS idx_sars_calculations_accountable_institution_id
    ON sars_calculations (accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_sars_calculations_sars_submission_id
    ON sars_calculations (sars_submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sars_calculations_id_accountable_institution_id
    ON sars_calculations (id, accountable_institution_id);

-- 6. SARS transaction facts for one transfer party (not GR identity).
CREATE TABLE IF NOT EXISTS sars_party_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_party_id UUID NOT NULL,
    transfer_id UUID NOT NULL,
    sars_submission_id UUID REFERENCES sars_submissions(id) ON DELETE SET NULL,
    accountable_institution_id INTEGER NOT NULL,
    share_percentage NUMERIC(5,2) CHECK (share_percentage IS NULL OR (share_percentage >= 0 AND share_percentage <= 100)),
    is_connected_person BOOLEAN,
    fixed_period_years INTEGER,
    annual_income NUMERIC(14,2),
    not_registered_for_income_tax BOOLEAN,
    not_registered_reason TEXT,
    spouse_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    marital_notes TEXT,
    acquisition_date DATE,
    original_purchase_price NUMERIC(14,2),
    effective_date_of_transaction DATE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_sars_party_details_transfer_party
        UNIQUE (transfer_party_id),
    CONSTRAINT fk_sars_party_details_transfer_party_tenant
        FOREIGN KEY (transfer_party_id, transfer_id, accountable_institution_id)
        REFERENCES transfer_parties(id, transfer_id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sars_party_details_transfer_party_id
    ON sars_party_details (transfer_party_id);
CREATE INDEX IF NOT EXISTS idx_sars_party_details_transfer_id
    ON sars_party_details (transfer_id);
CREATE INDEX IF NOT EXISTS idx_sars_party_details_accountable_institution_id
    ON sars_party_details (accountable_institution_id);

-- 7. SARS transaction facts for one property in the transfer.
CREATE TABLE IF NOT EXISTS sars_property_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    matter_property_id UUID REFERENCES matter_properties(id) ON DELETE SET NULL,
    sars_submission_id UUID REFERENCES sars_submissions(id) ON DELETE SET NULL,
    accountable_institution_id INTEGER NOT NULL,
    is_enterprise_asset_for_vat BOOLEAN,
    input_tax_claimed BOOLEAN,
    property_improvement_indicator VARCHAR(20),
    bought_by_indicator VARCHAR(20),
    property_usage_indicator VARCHAR(20),
    property_nature_indicator VARCHAR(20),
    other_property_usage_desc TEXT,
    other_property_nature_desc TEXT,
    income_tax_act_applicable TEXT,
    monthly_rental_value NUMERIC(14,2),
    land_value NUMERIC(14,2),
    occupational_rent NUMERIC(14,2),
    improvement_value NUMERIC(14,2),
    other_consideration NUMERIC(14,2),
    total_fair_value NUMERIC(14,2),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sars_property_details_transfer_tenant
        FOREIGN KEY (transfer_id, accountable_institution_id)
        REFERENCES transfers(id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sars_property_details_transfer_property
    ON sars_property_details (transfer_id, COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_sars_property_details_transfer_id
    ON sars_property_details (transfer_id);
CREATE INDEX IF NOT EXISTS idx_sars_property_details_property_id
    ON sars_property_details (property_id);
CREATE INDEX IF NOT EXISTS idx_sars_property_details_accountable_institution_id
    ON sars_property_details (accountable_institution_id);

-- 8. Versioned declaration/signature evidence.
CREATE TABLE IF NOT EXISTS sars_declaration_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sars_submission_id UUID NOT NULL,
    declaration_type VARCHAR(40) NOT NULL
        CHECK (declaration_type IN ('seller', 'purchaser', 'conveyancer', 'additional_conveyancer')),
    declared_by_party_id UUID,
    declared_by_user_id INTEGER,
    declaration_date DATE,
    signature_document_id UUID REFERENCES transfer_documents(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    accountable_institution_id INTEGER NOT NULL,
    created_by_user_id INTEGER,
    updated_by_user_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sars_declaration_events_submission_tenant
        FOREIGN KEY (sars_submission_id, accountable_institution_id)
        REFERENCES sars_submissions(id, accountable_institution_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sars_declaration_events_submission_id
    ON sars_declaration_events (sars_submission_id);
CREATE INDEX IF NOT EXISTS idx_sars_declaration_events_accountable_institution_id
    ON sars_declaration_events (accountable_institution_id);
CREATE INDEX IF NOT EXISTS idx_sars_declaration_events_type
    ON sars_declaration_events (declaration_type);

-- 9. Tenant-anchoring triggers for SARS tables.
CREATE OR REPLACE FUNCTION sars_submissions_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM transfers
    WHERE id = NEW.transfer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sars_submissions_set_tenant ON sars_submissions;
CREATE TRIGGER trg_sars_submissions_set_tenant
    BEFORE INSERT OR UPDATE ON sars_submissions
    FOR EACH ROW EXECUTE FUNCTION sars_submissions_set_tenant();

CREATE OR REPLACE FUNCTION sars_submission_events_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM sars_submissions
    WHERE id = NEW.sars_submission_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sars_submission_events_set_tenant ON sars_submission_events;
CREATE TRIGGER trg_sars_submission_events_set_tenant
    BEFORE INSERT OR UPDATE ON sars_submission_events
    FOR EACH ROW EXECUTE FUNCTION sars_submission_events_set_tenant();

CREATE OR REPLACE FUNCTION sars_calculations_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM transfers
    WHERE id = NEW.transfer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sars_calculations_set_tenant ON sars_calculations;
CREATE TRIGGER trg_sars_calculations_set_tenant
    BEFORE INSERT OR UPDATE ON sars_calculations
    FOR EACH ROW EXECUTE FUNCTION sars_calculations_set_tenant();

CREATE OR REPLACE FUNCTION sars_party_details_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id, transfer_id
    INTO NEW.accountable_institution_id, NEW.transfer_id
    FROM transfer_parties
    WHERE id = NEW.transfer_party_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sars_party_details_set_tenant ON sars_party_details;
CREATE TRIGGER trg_sars_party_details_set_tenant
    BEFORE INSERT OR UPDATE ON sars_party_details
    FOR EACH ROW EXECUTE FUNCTION sars_party_details_set_tenant();

CREATE OR REPLACE FUNCTION sars_property_details_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM transfers
    WHERE id = NEW.transfer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sars_property_details_set_tenant ON sars_property_details;
CREATE TRIGGER trg_sars_property_details_set_tenant
    BEFORE INSERT OR UPDATE ON sars_property_details
    FOR EACH ROW EXECUTE FUNCTION sars_property_details_set_tenant();

CREATE OR REPLACE FUNCTION sars_declaration_events_set_tenant()
RETURNS TRIGGER AS $$
BEGIN
    SELECT accountable_institution_id
    INTO NEW.accountable_institution_id
    FROM sars_submissions
    WHERE id = NEW.sars_submission_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sars_declaration_events_set_tenant ON sars_declaration_events;
CREATE TRIGGER trg_sars_declaration_events_set_tenant
    BEFORE INSERT OR UPDATE ON sars_declaration_events
    FOR EACH ROW EXECUTE FUNCTION sars_declaration_events_set_tenant();

-- 10. updated_at triggers for new tables.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS update_sars_submissions_updated_at ON sars_submissions;
        CREATE TRIGGER update_sars_submissions_updated_at
            BEFORE UPDATE ON sars_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_sars_submission_events_updated_at ON sars_submission_events;
        CREATE TRIGGER update_sars_submission_events_updated_at
            BEFORE UPDATE ON sars_submission_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_sars_calculations_updated_at ON sars_calculations;
        CREATE TRIGGER update_sars_calculations_updated_at
            BEFORE UPDATE ON sars_calculations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_sars_party_details_updated_at ON sars_party_details;
        CREATE TRIGGER update_sars_party_details_updated_at
            BEFORE UPDATE ON sars_party_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_sars_property_details_updated_at ON sars_property_details;
        CREATE TRIGGER update_sars_property_details_updated_at
            BEFORE UPDATE ON sars_property_details FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

        DROP TRIGGER IF EXISTS update_sars_declaration_events_updated_at ON sars_declaration_events;
        CREATE TRIGGER update_sars_declaration_events_updated_at
            BEFORE UPDATE ON sars_declaration_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMIT;
