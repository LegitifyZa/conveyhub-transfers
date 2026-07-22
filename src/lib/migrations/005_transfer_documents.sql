BEGIN;

CREATE TABLE IF NOT EXISTS transfer_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    catalogue_document_id UUID REFERENCES document_catalogue(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected', 'not_required')),
    notes TEXT,
    file_path TEXT,
    file_size INTEGER,
    file_type VARCHAR(100),
    original_file_name VARCHAR(500),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (transfer_id, catalogue_document_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_documents_transfer_id ON transfer_documents(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_documents_catalogue_document_id ON transfer_documents(catalogue_document_id);
CREATE INDEX IF NOT EXISTS idx_transfer_documents_status ON transfer_documents(status);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_transfer_documents_updated_at
    BEFORE UPDATE ON transfer_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
