-- Migration 008: Create Accounts, VAT Settings, Tariff Schedules and Proforma Statements

CREATE TABLE IF NOT EXISTS account_firm_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    firm_name VARCHAR(255) NOT NULL DEFAULT 'Legitify Conveyancing Practice',
    registration_number VARCHAR(100) DEFAULT '2026/123456/07',
    is_vat_registered BOOLEAN NOT NULL DEFAULT TRUE,
    vat_number VARCHAR(100) DEFAULT '4120987654',
    vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1500,
    active_tariff_schedule_id VARCHAR(100) NOT NULL DEFAULT 'lssa-2026-2027',
    custom_multiplier NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    trust_account JSONB NOT NULL DEFAULT '{
        "bankName": "Standard Bank South Africa",
        "accountHolder": "Legitify Attorneys Trust Account",
        "accountNumber": "0123456789",
        "branchCode": "051001",
        "accountType": "Section 86(2) Trust Account",
        "referencePrefix": "MAT-"
    }'::jsonb,
    customary_disbursements JSONB NOT NULL DEFAULT '[
        {"id": "fica", "name": "FICA Compliance & Verification Fee", "amount": 450, "isVatApplicable": true, "category": "customary"},
        {"id": "postages", "name": "Postages & Petties", "amount": 850, "isVatApplicable": true, "category": "customary"},
        {"id": "doc_gen", "name": "Electronic Document Generation Fee", "amount": 650, "isVatApplicable": true, "category": "customary"},
        {"id": "search_fee", "name": "Deeds Office Search Fee", "amount": 250, "isVatApplicable": true, "category": "customary"},
        {"id": "rates_clearance", "name": "Rates Clearance Application Fee", "amount": 1150, "isVatApplicable": false, "category": "customary"},
        {"id": "hoa_consent", "name": "HOA / Body Corporate Consent Application", "amount": 950, "isVatApplicable": false, "category": "customary"}
    ]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tariff_schedules (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    effective_date VARCHAR(100) NOT NULL,
    gazette_reference VARCHAR(255),
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    brackets JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proforma_statements (
    id VARCHAR(100) PRIMARY KEY,
    transfer_id VARCHAR(100) NOT NULL,
    matter_reference VARCHAR(100),
    statement_type VARCHAR(50) NOT NULL DEFAULT 'buyer',
    status VARCHAR(50) NOT NULL DEFAULT 'issued',
    purchase_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    deposit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    loan_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    property_address TEXT,
    erf_number VARCHAR(100),
    statement_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proforma_statements_transfer_id ON proforma_statements (transfer_id);

-- Insert default row if not exists
INSERT INTO account_firm_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
