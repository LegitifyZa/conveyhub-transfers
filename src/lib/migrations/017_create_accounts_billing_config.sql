-- Migration: 017_create_accounts_billing_config.sql
-- Purpose: Create tenant-scoped billing, firm account settings, statutory/custom tariff schedules,
--          and proforma statements anchored to Transfers and accountable_institution_id.
-- Created: 2026-08-27

BEGIN;

CREATE SCHEMA IF NOT EXISTS transfers;
SET LOCAL search_path TO transfers, public;

-- 1. Tenant-scoped firm account settings
CREATE TABLE IF NOT EXISTS transfers.account_firm_settings (
    accountable_institution_id INTEGER PRIMARY KEY,
    firm_name VARCHAR(255) NOT NULL DEFAULT '',
    registration_number VARCHAR(100) DEFAULT '',
    is_vat_registered BOOLEAN NOT NULL DEFAULT TRUE,
    vat_number VARCHAR(100) DEFAULT '',
    vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1500,
    active_tariff_schedule_id VARCHAR(100) NOT NULL DEFAULT 'lssa-2026-2027',
    tariff_multiplier NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    trust_account JSONB NOT NULL DEFAULT '{"bankName":"","accountNumber":"","branchCode":"","accountType":"","beneficiaryReference":""}'::jsonb,
    customary_disbursements JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_firm_settings_ai
    ON transfers.account_firm_settings (accountable_institution_id);

-- 2. Versioned tariff schedules (Global official schedules have NULL accountable_institution_id)
CREATE TABLE IF NOT EXISTS transfers.tariff_schedules (
    id VARCHAR(100) NOT NULL,
    accountable_institution_id INTEGER,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL DEFAULT '1.0',
    effective_date DATE NOT NULL,
    gazette_reference VARCHAR(255),
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    brackets JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, COALESCE(accountable_institution_id, 0))
);

CREATE INDEX IF NOT EXISTS idx_tariff_schedules_ai
    ON transfers.tariff_schedules (accountable_institution_id);

-- 3. Proforma statements anchored to transfer_id (UUID) and accountable_institution_id
CREATE TABLE IF NOT EXISTS transfers.proforma_statements (
    id VARCHAR(100) PRIMARY KEY,
    transfer_id UUID NOT NULL,
    accountable_institution_id INTEGER NOT NULL,
    matter_reference VARCHAR(100) NOT NULL,
    statement_type VARCHAR(50) NOT NULL DEFAULT 'buyer',
    status VARCHAR(50) NOT NULL DEFAULT 'issued',
    purchase_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    deposit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    loan_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    is_vat_transaction BOOLEAN NOT NULL DEFAULT FALSE,
    property_address TEXT,
    erf_number VARCHAR(100),
    tariff_schedule_id VARCHAR(100) NOT NULL,
    tariff_version VARCHAR(50) NOT NULL DEFAULT '1.0',
    statement_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proforma_statements_transfer
    ON transfers.proforma_statements (transfer_id);

CREATE INDEX IF NOT EXISTS idx_proforma_statements_ai
    ON transfers.proforma_statements (accountable_institution_id);

COMMIT;
