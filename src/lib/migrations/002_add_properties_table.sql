-- Add properties table
-- Migration: 002_add_properties_table.sql
-- Created: 2026-04-07

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_values)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, record_id, action, old_values, new_values)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    END IF;
    INSERT INTO audit_log (table_name, record_id, action, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create properties table
CREATE TABLE IF NOT EXISTS properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id VARCHAR(50) UNIQUE NOT NULL,
    erf_number VARCHAR(50),
    street_address TEXT NOT NULL,
    suburb VARCHAR(100),
    city VARCHAR(100) NOT NULL,
    postal_code VARCHAR(10),
    province VARCHAR(50) NOT NULL,
    country VARCHAR(50) DEFAULT 'South Africa',
    property_type VARCHAR(50) NOT NULL CHECK (property_type IN ('residential', 'commercial', 'industrial', 'agricultural', 'vacant_land')),
    title_deed_number VARCHAR(100),
    survey_general_number VARCHAR(100),
    extent_sqm DECIMAL(10,2),
    zoning VARCHAR(50),
    rates_number VARCHAR(50),
    municipal_valuation DECIMAL(12,2),
    year_built INTEGER,
    bedrooms INTEGER,
    bathrooms INTEGER,
    garages INTEGER,
    parking_spaces INTEGER,
    swimming_pool BOOLEAN DEFAULT FALSE,
    security_features TEXT,
    description TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold', 'under_offer', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add property_id to transfers table and create foreign key relationship
ALTER TABLE transfers 
ADD COLUMN property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

-- Create indexes for properties table
CREATE INDEX IF NOT EXISTS idx_properties_property_id ON properties(property_id);
CREATE INDEX IF NOT EXISTS idx_properties_street_address ON properties(street_address);
CREATE INDEX IF NOT EXISTS idx_properties_suburb ON properties(suburb);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_postal_code ON properties(postal_code);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON properties(created_at);
CREATE INDEX IF NOT EXISTS idx_properties_lat_lng ON properties(latitude, longitude);

-- Create index for transfers property_id
CREATE INDEX IF NOT EXISTS idx_transfers_property_id ON transfers(property_id);

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for audit logging
CREATE TRIGGER audit_properties_trigger
    AFTER INSERT OR UPDATE OR DELETE ON properties
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create view for property details with transfer information
CREATE OR REPLACE VIEW property_details AS
SELECT 
    p.id,
    p.property_id,
    p.erf_number,
    p.street_address,
    p.suburb,
    p.city,
    p.postal_code,
    p.province,
    p.country,
    p.property_type,
    p.title_deed_number,
    p.survey_general_number,
    p.extent_sqm,
    p.zoning,
    p.rates_number,
    p.municipal_valuation,
    p.year_built,
    p.bedrooms,
    p.bathrooms,
    p.garages,
    p.parking_spaces,
    p.swimming_pool,
    p.security_features,
    p.description,
    p.latitude,
    p.longitude,
    p.status,
    p.created_at,
    p.updated_at,
    COUNT(t.id) as transfer_count,
    MAX(t.created_at) as last_transfer_date
FROM properties p
LEFT JOIN transfers t ON p.id = t.property_id
GROUP BY p.id, p.property_id, p.erf_number, p.street_address, p.suburb, p.city, p.postal_code, p.province, p.country, p.property_type, p.title_deed_number, p.survey_general_number, p.extent_sqm, p.zoning, p.rates_number, p.municipal_valuation, p.year_built, p.bedrooms, p.bathrooms, p.garages, p.parking_spaces, p.swimming_pool, p.security_features, p.description, p.latitude, p.longitude, p.status, p.created_at, p.updated_at;

-- Create function to generate property ID
CREATE OR REPLACE FUNCTION generate_property_id()
RETURNS TEXT AS $$
DECLARE
    year_part TEXT;
    random_part TEXT;
    property_id TEXT;
BEGIN
    year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    property_id := 'PROP-' || year_part || '-' || random_part;
    
    -- Ensure uniqueness
    WHILE EXISTS (SELECT 1 FROM properties WHERE property_id = property_id) LOOP
        random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
        property_id := 'PROP-' || year_part || '-' || random_part;
    END LOOP;
    
    RETURN property_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to validate South African postal code
CREATE OR REPLACE FUNCTION validate_sa_postal_code(postal_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Basic validation: 4 digits for South Africa
    IF postal_code !~ '^\d{4}$' THEN
        RETURN FALSE;
    END IF;
    
    -- More sophisticated validation can be added here
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create constraint for SA postal code validation
ALTER TABLE properties ADD CONSTRAINT check_sa_postal_code 
    CHECK (postal_code IS NULL OR validate_sa_postal_code(postal_code));

-- Insert some sample properties
INSERT INTO properties (
    property_id, erf_number, street_address, suburb, city, postal_code, province, 
    property_type, title_deed_number, extent_sqm, bedrooms, bathrooms, 
    municipal_valuation, year_built, description
) VALUES 
    ('PROP-2026-0001', '1234', '123 Oak Street', 'Rondebosch', 'Cape Town', '7701', 'Western Cape', 'residential', 'TD12345/2023', 450.50, 3, 2, 2500000, 2019, 'Modern family home with garden and mountain views'),
    ('PROP-2026-0002', '5678', '456 Elm Avenue', 'Sandton', 'Johannesburg', '2196', 'Gauteng', 'residential', 'TD67890/2022', 680.25, 4, 3, 3200000, 2020, 'Luxury estate home with pool and security'),
    ('PROP-2026-0003', '9012', '789 Pine Road', 'Umhlanga', 'Durban', '4319', 'KwaZulu-Natal', 'residential', 'TD11111/2021', 320.75, 2, 2, 1800000, 2018, 'Coastal property with sea views')
ON CONFLICT (property_id) DO NOTHING;
