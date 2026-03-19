-- Initial database schema for Legitify ConveyHub
-- Migration: 001_initial_schema.sql
-- Created: 2026-03-19

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'conveyancer')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create transfers table
CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id VARCHAR(50) UNIQUE NOT NULL,
    property_address TEXT NOT NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    transfer_duty DECIMAL(12,2),
    conveyancing_fees DECIMAL(12,2),
    deeds_office_fees DECIMAL(12,2),
    vat DECIMAL(12,2),
    total_costs DECIMAL(12,2),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
    current_step INTEGER DEFAULT 1,
    total_steps INTEGER DEFAULT 5,
    progress INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create parties table
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID REFERENCES transfers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('buyer', 'seller')),
    id_number VARCHAR(13),
    registration_number VARCHAR(50),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID REFERENCES transfers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_path TEXT,
    file_size INTEGER,
    file_type VARCHAR(100),
    category VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    user_id UUID REFERENCES users(id),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

CREATE INDEX IF NOT EXISTS idx_transfers_transfer_id ON transfers(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_updated_at ON transfers(updated_at);
CREATE INDEX IF NOT EXISTS idx_transfers_purchase_price ON transfers(purchase_price);

CREATE INDEX IF NOT EXISTS idx_parties_transfer_id ON parties(transfer_id);
CREATE INDEX IF NOT EXISTS idx_parties_type ON parties(type);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);
CREATE INDEX IF NOT EXISTS idx_parties_id_number ON parties(id_number);
CREATE INDEX IF NOT EXISTS idx_parties_email ON parties(email);

CREATE INDEX IF NOT EXISTS idx_documents_transfer_id ON documents(transfer_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);

-- Create trigger function for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON transfers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_parties_updated_at BEFORE UPDATE ON parties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create audit triggers for main tables
CREATE TRIGGER audit_users_trigger
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_transfers_trigger
    AFTER INSERT OR UPDATE OR DELETE ON transfers
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_parties_trigger
    AFTER INSERT OR UPDATE OR DELETE ON parties
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_documents_trigger
    AFTER INSERT OR UPDATE OR DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create view for transfer summaries
CREATE OR REPLACE VIEW transfer_summary AS
SELECT 
    t.id,
    t.transfer_id,
    t.property_address,
    t.purchase_price,
    t.total_costs,
    t.status,
    t.current_step,
    t.total_steps,
    t.progress,
    t.created_at,
    t.updated_at,
    COUNT(DISTINCT p.id) as party_count,
    COUNT(DISTINCT d.id) as document_count,
    COUNT(DISTINCT p.id) FILTER (WHERE p.type = 'buyer') as buyer_count,
    COUNT(DISTINCT p.id) FILTER (WHERE p.type = 'seller') as seller_count
FROM transfers t
LEFT JOIN parties p ON t.id = p.transfer_id
LEFT JOIN documents d ON t.id = d.transfer_id
GROUP BY t.id, t.transfer_id, t.property_address, t.purchase_price, t.total_costs, t.status, t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at;

-- Create view for party details
CREATE OR REPLACE VIEW party_details AS
SELECT 
    p.id,
    p.transfer_id,
    p.name,
    p.type,
    p.id_number,
    p.registration_number,
    p.email,
    p.phone,
    p.address,
    p.created_at,
    p.updated_at,
    t.transfer_id as transfer_ref,
    t.property_address,
    t.status as transfer_status
FROM parties p
JOIN transfers t ON p.transfer_id = t.id;

-- Create view for document details
CREATE OR REPLACE VIEW document_details AS
SELECT 
    d.id,
    d.transfer_id,
    d.name,
    d.file_path,
    d.file_size,
    d.file_type,
    d.category,
    d.status,
    d.uploaded_at,
    d.updated_at,
    t.transfer_id as transfer_ref,
    t.property_address,
    t.status as transfer_status
FROM documents d
JOIN transfers t ON d.transfer_id = t.id;

-- Insert default admin user (password should be hashed in production)
INSERT INTO users (email, name, role) 
VALUES ('admin@legitify.co.za', 'System Administrator', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Create function to generate transfer ID
CREATE OR REPLACE FUNCTION generate_transfer_id()
RETURNS TEXT AS $$
DECLARE
    year_part TEXT;
    timestamp_part TEXT;
    random_part TEXT;
    transfer_id TEXT;
BEGIN
    year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    timestamp_part := EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT;
    random_part := LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
    transfer_id := 'TRF-' || year_part || '-' || SUBSTRING(timestamp_part, -6) || '-' || random_part;
    
    -- Ensure uniqueness
    WHILE EXISTS (SELECT 1 FROM transfers WHERE transfer_id = transfer_id) LOOP
        random_part := LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
        transfer_id := 'TRF-' || year_part || '-' || SUBSTRING(timestamp_part, -6) || '-' || random_part;
    END LOOP;
    
    RETURN transfer_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to calculate transfer progress
CREATE OR REPLACE FUNCTION calculate_transfer_progress(current_step INTEGER, total_steps INTEGER)
RETURNS INTEGER AS $$
BEGIN
    RETURN ROUND((current_step::DECIMAL / total_steps::DECIMAL) * 100);
END;
$$ LANGUAGE plpgsql;

-- Create function to update transfer progress
CREATE OR REPLACE FUNCTION update_transfer_progress()
RETURNS TRIGGER AS $$
BEGIN
    NEW.progress = calculate_transfer_progress(NEW.current_step, NEW.total_steps);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update progress when step changes
CREATE TRIGGER update_transfer_progress_trigger
    BEFORE UPDATE OF current_step ON transfers
    FOR EACH ROW EXECUTE FUNCTION update_transfer_progress();

-- Create function to validate SA ID number
CREATE OR REPLACE FUNCTION validate_sa_id_number(id_number TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Basic validation: 13 digits
    IF id_number !~ '^\d{13}$' THEN
        RETURN FALSE;
    END IF;
    
    -- More sophisticated validation can be added here
    -- For now, just check format
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create constraint for SA ID validation
ALTER TABLE parties ADD CONSTRAINT check_sa_id_number 
    CHECK (id_number IS NULL OR validate_sa_id_number(id_number));

-- Create function to get transfer statistics
CREATE OR REPLACE FUNCTION get_transfer_statistics()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', COUNT(*),
        'draft', COUNT(*) FILTER (WHERE status = 'draft'),
        'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
        'completed', COUNT(*) FILTER (WHERE status = 'completed'),
        'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
        'avg_purchase_price', AVG(purchase_price),
        'total_value', SUM(purchase_price)
    ) INTO result
    FROM transfers;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO legitify_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO legitify_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO legitify_app;
