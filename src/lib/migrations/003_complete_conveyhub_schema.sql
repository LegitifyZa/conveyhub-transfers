BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS firms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    tax_number VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) NOT NULL DEFAULT 'South Africa',
    trust_account_name VARCHAR(255),
    trust_account_bank VARCHAR(255),
    trust_account_number_encrypted BYTEA,
    trust_account_number_last4 VARCHAR(4),
    trust_account_branch_code VARCHAR(20),
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES firms(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    dark_mode BOOLEAN NOT NULL DEFAULT FALSE,
    language_code VARCHAR(10) NOT NULL DEFAULT 'en-ZA',
    timezone VARCHAR(100) NOT NULL DEFAULT 'Africa/Johannesburg',
    currency_code CHAR(3) NOT NULL DEFAULT 'ZAR',
    email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    in_app_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS municipality VARCHAR(255);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS legal_description TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lot_number VARCHAR(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS portion_number VARCHAR(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sectional_title_scheme VARCHAR(255);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sectional_title_unit_number VARCHAR(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS exclusive_use_areas TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS homeowners_association VARCHAR(255);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS square_footage NUMERIC(12,2);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS source_system VARCHAR(100);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS source_record_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS matters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID REFERENCES firms(id) ON DELETE RESTRICT,
    reference_number VARCHAR(100) NOT NULL,
    matter_type VARCHAR(50) NOT NULL CHECK (matter_type IN ('transfer', 'bond', 'cancellation', 'general')),
    title VARCHAR(255),
    description TEXT,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'in_progress', 'review', 'completed', 'cancelled', 'archived')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    opened_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    completed_date DATE,
    source_system VARCHAR(100),
    source_record_id VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (firm_id, reference_number)
);

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS matter_id UUID REFERENCES matters(id) ON DELETE SET NULL;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transaction_date DATE;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS occupation_date DATE;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS registration_date DATE;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(14,2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS loan_amount NUMERIC(14,2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(8,5);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS loan_term_years INTEGER;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS post_and_petties NUMERIC(14,2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS clearance_certificate_fee NUMERIC(14,2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS rates_clearance_amount NUMERIC(14,2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS net_proceeds NUMERIC(14,2);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'ZAR';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE parties ADD COLUMN IF NOT EXISTS matter_id UUID REFERENCES matters(id) ON DELETE CASCADE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS entity_type VARCHAR(30) NOT NULL DEFAULT 'individual';
ALTER TABLE parties ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS tax_number VARCHAR(100);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS role_title VARCHAR(100);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS source_system VARCHAR(100);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS source_record_id VARCHAR(255);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS matter_parties (
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    role VARCHAR(40) NOT NULL CHECK (role IN ('client', 'purchaser', 'buyer', 'seller', 'transferor', 'transferee', 'borrower', 'lender', 'agent', 'other')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (matter_id, party_id, role)
);

CREATE TABLE IF NOT EXISTS party_bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    account_holder VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50),
    account_number_encrypted BYTEA NOT NULL,
    account_number_last4 VARCHAR(4) NOT NULL,
    branch_code VARCHAR(20),
    purpose VARCHAR(50) NOT NULL DEFAULT 'general' CHECK (purpose IN ('general', 'refund', 'proceeds', 'deposit')),
    verification_status VARCHAR(30) NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transfer_financials (
    transfer_id UUID PRIMARY KEY REFERENCES transfers(id) ON DELETE CASCADE,
    purchase_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    deposit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
    loan_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (loan_amount >= 0),
    interest_rate NUMERIC(8,5) CHECK (interest_rate IS NULL OR interest_rate >= 0),
    loan_term_years INTEGER CHECK (loan_term_years IS NULL OR loan_term_years > 0),
    transfer_duty NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (transfer_duty >= 0),
    conveyancing_fees NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (conveyancing_fees >= 0),
    deeds_office_fees NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deeds_office_fees >= 0),
    vat NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat >= 0),
    post_and_petties NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (post_and_petties >= 0),
    clearance_certificate_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (clearance_certificate_fee >= 0),
    rates_clearance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rates_clearance_amount >= 0),
    total_costs NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_costs >= 0),
    net_proceeds NUMERIC(14,2),
    effective_rate NUMERIC(8,5),
    loan_to_value_ratio NUMERIC(8,5),
    currency_code CHAR(3) NOT NULL DEFAULT 'ZAR',
    calculation_version VARCHAR(50),
    calculation_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    calculated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bonds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID REFERENCES matters(id) ON DELETE CASCADE,
    transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
    lender_party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    lender_name VARCHAR(255),
    application_reference VARCHAR(100),
    loan_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    interest_rate NUMERIC(8,5),
    loan_term_years INTEGER,
    status VARCHAR(40) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'pending', 'approved', 'granted', 'instructed', 'registered', 'declined', 'cancelled')),
    application_date DATE,
    approval_date DATE,
    grant_due_date DATE,
    registration_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS municipal_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    municipality VARCHAR(255) NOT NULL,
    account_number VARCHAR(100) NOT NULL,
    account_holder VARCHAR(255),
    current_balance NUMERIC(14,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (property_id, municipality, account_number)
);

CREATE TABLE IF NOT EXISTS clearance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    clearance_type VARCHAR(40) NOT NULL CHECK (clearance_type IN ('rates', 'levies', 'homeowners_association', 'transfer_duty')),
    authority_name VARCHAR(255),
    reference_number VARCHAR(100),
    amount NUMERIC(14,2),
    status VARCHAR(40) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'requested', 'figures_received', 'applied', 'paid', 'certificate_received', 'completed', 'rejected', 'not_required')),
    requested_date DATE,
    due_date DATE,
    paid_date DATE,
    certificate_date DATE,
    valid_until DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transfer_guarantees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    issuer VARCHAR(255),
    reference_number VARCHAR(100),
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    due_date DATE,
    received_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'requested', 'received', 'accepted', 'rejected', 'expired')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transfer_conditions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    condition_type VARCHAR(50) NOT NULL CHECK (condition_type IN ('suspensive', 'subject_to_sale', 'other')),
    description TEXT NOT NULL,
    due_date DATE,
    fulfilled_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'waived', 'failed', 'not_required')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compliance_certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    certificate_type VARCHAR(40) NOT NULL CHECK (certificate_type IN ('electrical', 'entomologist', 'electric_fence', 'gas_conformity', 'plumbing', 'pool', 'other')),
    certificate_number VARCHAR(100),
    issuer VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'requested', 'received', 'verified', 'rejected', 'expired', 'not_required')),
    requested_date DATE,
    issued_date DATE,
    received_date DATE,
    expiry_date DATE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fica_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'documents_requested', 'documents_received', 'verified', 'rejected', 'expired', 'not_required')),
    risk_rating VARCHAR(20) CHECK (risk_rating IS NULL OR risk_rating IN ('low', 'medium', 'high')),
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (matter_id, party_id)
);

CREATE TABLE IF NOT EXISTS matter_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('pro_forma_debit_credit', 'pro_forma_fees_disbursements', 'reconciliation', 'transferee_final', 'transferor_final', 'trust', 'other')),
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'final', 'cancelled')),
    statement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    currency_code CHAR(3) NOT NULL DEFAULT 'ZAR',
    total_debits NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_credits NUMERIC(14,2) NOT NULL DEFAULT 0,
    balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matter_account_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES matter_accounts(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('fee', 'disbursement', 'transfer_duty', 'deposit', 'payment', 'refund', 'interest', 'vat', 'other')),
    description TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    reference_number VARCHAR(100),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS milestone_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    default_status_label VARCHAR(255),
    matter_type VARCHAR(50) NOT NULL DEFAULT 'transfer',
    sequence_number INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matter_milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    definition_id UUID REFERENCES milestone_definitions(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    status_label VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'overdue', 'not_required')),
    sequence_number INTEGER NOT NULL,
    due_date DATE,
    completed_date DATE,
    notes TEXT,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (matter_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS milestone_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    milestone_id UUID NOT NULL REFERENCES matter_milestones(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    old_status VARCHAR(30),
    new_status VARCHAR(30),
    old_due_date DATE,
    new_due_date DATE,
    old_notes TEXT,
    new_notes TEXT,
    change_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_data_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    field_key VARCHAR(255) UNIQUE NOT NULL,
    label VARCHAR(255) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    data_type VARCHAR(30) NOT NULL CHECK (data_type IN ('Text', 'Date', 'Currency', 'Identifier')),
    description TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_catalogue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    catalogue_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    module VARCHAR(50) NOT NULL CHECK (module IN ('Transfers', 'Bonds', 'Cancellations', 'General')),
    matter_type VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Active', 'Draft', 'Retired')),
    legal_authority TEXT,
    current_version VARCHAR(50) NOT NULL DEFAULT '1.0',
    template_file_name VARCHAR(500),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_catalogue_fields (
    catalogue_document_id UUID NOT NULL REFERENCES document_catalogue(id) ON DELETE CASCADE,
    data_field_id UUID NOT NULL REFERENCES template_data_fields(id) ON DELETE RESTRICT,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (catalogue_document_id, data_field_id)
);

CREATE TABLE IF NOT EXISTS document_catalogue_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    catalogue_document_id UUID NOT NULL REFERENCES document_catalogue(id) ON DELETE CASCADE,
    supporting_document_name VARCHAR(255) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    sequence_number INTEGER NOT NULL DEFAULT 1,
    UNIQUE (catalogue_document_id, supporting_document_name)
);

CREATE TABLE IF NOT EXISTS document_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    catalogue_document_id UUID REFERENCES document_catalogue(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    identifier VARCHAR(150) UNIQUE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Active', 'Draft', 'Retired')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_template_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    file_name VARCHAR(500),
    storage_key TEXT,
    mime_type VARCHAR(150),
    legal_authority TEXT,
    effective_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Active', 'Draft', 'Retired')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, version)
);

CREATE TABLE IF NOT EXISTS template_version_fields (
    template_version_id UUID NOT NULL REFERENCES document_template_versions(id) ON DELETE CASCADE,
    data_field_id UUID NOT NULL REFERENCES template_data_fields(id) ON DELETE RESTRICT,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (template_version_id, data_field_id)
);

CREATE TABLE IF NOT EXISTS clauses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(150) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clause_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clause_id UUID NOT NULL REFERENCES clauses(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Active', 'Draft', 'Retired')),
    legal_authority TEXT,
    effective_date DATE,
    content TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (clause_id, version)
);

CREATE TABLE IF NOT EXISTS template_version_clauses (
    template_version_id UUID NOT NULL REFERENCES document_template_versions(id) ON DELETE CASCADE,
    clause_id UUID NOT NULL REFERENCES clauses(id) ON DELETE RESTRICT,
    sequence_number INTEGER NOT NULL DEFAULT 1,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (template_version_id, clause_id)
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS matter_id UUID REFERENCES matters(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS catalogue_document_id UUID REFERENCES document_catalogue(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(500);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS checksum_sha256 CHAR(64);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version VARCHAR(50) NOT NULL DEFAULT '1.0';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS document_parties (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    relationship VARCHAR(50) NOT NULL DEFAULT 'subject',
    PRIMARY KEY (document_id, party_id, relationship)
);

CREATE TABLE IF NOT EXISTS generated_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    template_version_id UUID REFERENCES document_template_versions(id) ON DELETE RESTRICT,
    file_name VARCHAR(500) NOT NULL,
    output_format VARCHAR(10) NOT NULL CHECK (output_format IN ('DOCX', 'PDF')),
    storage_key TEXT,
    generator_version VARCHAR(50) NOT NULL,
    resolved_content TEXT,
    resolved_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    unresolved_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    undefined_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    unresolved_clauses JSONB NOT NULL DEFAULT '[]'::jsonb,
    generation_input JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS generated_document_clauses (
    generated_document_id UUID NOT NULL REFERENCES generated_documents(id) ON DELETE CASCADE,
    clause_version_id UUID NOT NULL REFERENCES clause_versions(id) ON DELETE RESTRICT,
    sequence_number INTEGER NOT NULL,
    PRIMARY KEY (generated_document_id, clause_version_id)
);

CREATE TABLE IF NOT EXISTS cancellations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
    cancellation_type VARCHAR(50) NOT NULL DEFAULT 'transfer',
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'under_review', 'approved', 'processing', 'completed', 'rejected')),
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cancellation_id UUID REFERENCES cancellations(id) ON DELETE SET NULL,
    matter_id UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    recipient_party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    bank_account_id UUID REFERENCES party_bank_accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    currency_code CHAR(3) NOT NULL DEFAULT 'ZAR',
    reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'paid', 'failed', 'cancelled')),
    payment_reference VARCHAR(100),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    matter_id UUID REFERENCES matters(id) ON DELETE CASCADE,
    party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    communication_type VARCHAR(30) NOT NULL CHECK (communication_type IN ('email', 'sms', 'phone', 'letter', 'note')),
    direction VARCHAR(20) NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound', 'internal')),
    recipient VARCHAR(255),
    sender VARCHAR(255),
    subject VARCHAR(500),
    message TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sent', 'delivered', 'failed', 'received')),
    external_message_id VARCHAR(255),
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID REFERENCES firms(id) ON DELETE SET NULL,
    matter_id UUID REFERENCES matters(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255),
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    action VARCHAR(100) NOT NULL,
    summary TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS golden_record_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id UUID REFERENCES parties(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    source_system VARCHAR(100) NOT NULL DEFAULT 'Golden Records',
    external_record_id VARCHAR(255) NOT NULL,
    external_id_number VARCHAR(100),
    external_registration_number VARCHAR(100),
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_system, external_record_id)
);

CREATE INDEX IF NOT EXISTS idx_users_firm_id ON users(firm_id);
CREATE INDEX IF NOT EXISTS idx_matters_firm_id ON matters(firm_id);
CREATE INDEX IF NOT EXISTS idx_matters_reference_number ON matters(reference_number);
CREATE INDEX IF NOT EXISTS idx_matters_status ON matters(status);
CREATE INDEX IF NOT EXISTS idx_matters_type ON matters(matter_type);
CREATE INDEX IF NOT EXISTS idx_matters_assigned_to ON matters(assigned_to);
CREATE INDEX IF NOT EXISTS idx_matters_due_date ON matters(due_date);
CREATE INDEX IF NOT EXISTS idx_transfers_matter_id ON transfers(matter_id);
CREATE INDEX IF NOT EXISTS idx_parties_matter_id ON parties(matter_id);
CREATE INDEX IF NOT EXISTS idx_parties_tax_number ON parties(tax_number);
CREATE INDEX IF NOT EXISTS idx_matter_parties_party_id ON matter_parties(party_id);
CREATE INDEX IF NOT EXISTS idx_bonds_matter_id ON bonds(matter_id);
CREATE INDEX IF NOT EXISTS idx_clearance_records_matter_id ON clearance_records(matter_id);
CREATE INDEX IF NOT EXISTS idx_compliance_certificates_matter_id ON compliance_certificates(matter_id);
CREATE INDEX IF NOT EXISTS idx_compliance_certificates_status ON compliance_certificates(status);
CREATE INDEX IF NOT EXISTS idx_fica_verifications_matter_id ON fica_verifications(matter_id);
CREATE INDEX IF NOT EXISTS idx_fica_verifications_party_id ON fica_verifications(party_id);
CREATE INDEX IF NOT EXISTS idx_matter_accounts_matter_id ON matter_accounts(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_account_entries_account_id ON matter_account_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_matter_milestones_matter_id ON matter_milestones(matter_id);
CREATE INDEX IF NOT EXISTS idx_matter_milestones_status ON matter_milestones(status);
CREATE INDEX IF NOT EXISTS idx_matter_milestones_due_date ON matter_milestones(due_date);
CREATE INDEX IF NOT EXISTS idx_milestone_history_milestone_id ON milestone_history(milestone_id);
CREATE INDEX IF NOT EXISTS idx_document_catalogue_module ON document_catalogue(module);
CREATE INDEX IF NOT EXISTS idx_document_catalogue_status ON document_catalogue(status);
CREATE INDEX IF NOT EXISTS idx_document_template_versions_template_id ON document_template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_clause_versions_clause_id ON clause_versions(clause_id);
CREATE INDEX IF NOT EXISTS idx_documents_matter_id ON documents(matter_id);
CREATE INDEX IF NOT EXISTS idx_documents_catalogue_id ON documents(catalogue_document_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_matter_id ON generated_documents(matter_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_generated_at ON generated_documents(generated_at);
CREATE INDEX IF NOT EXISTS idx_cancellations_matter_id ON cancellations(matter_id);
CREATE INDEX IF NOT EXISTS idx_refunds_matter_id ON refunds(matter_id);
CREATE INDEX IF NOT EXISTS idx_communications_matter_id ON communications(matter_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_matter_id ON activity_log(matter_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'firms', 'user_preferences', 'matters', 'party_bank_accounts', 'transfer_financials',
        'bonds', 'municipal_accounts', 'clearance_records', 'transfer_guarantees',
        'transfer_conditions', 'compliance_certificates', 'fica_verifications',
        'matter_accounts', 'milestone_definitions', 'matter_milestones',
        'template_data_fields', 'document_catalogue', 'document_templates', 'clauses',
        'cancellations', 'refunds'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON %I', table_name, table_name);
        EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', table_name, table_name);
    END LOOP;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'matter_milestones' AND column_name = 'due_date' AND data_type = 'date'
    ) THEN
        ALTER TABLE matter_milestones ALTER COLUMN due_date TYPE TIMESTAMPTZ USING due_date::TIMESTAMPTZ;
        ALTER TABLE matter_milestones ALTER COLUMN completed_date TYPE TIMESTAMPTZ USING completed_date::TIMESTAMPTZ;
        ALTER TABLE milestone_history ALTER COLUMN old_due_date TYPE TIMESTAMPTZ USING old_due_date::TIMESTAMPTZ;
        ALTER TABLE milestone_history ALTER COLUMN new_due_date TYPE TIMESTAMPTZ USING new_due_date::TIMESTAMPTZ;
    END IF;
END $$;

commit;
