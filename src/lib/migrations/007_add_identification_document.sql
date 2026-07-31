-- Add Identification as a required transfer document
INSERT INTO document_catalogue (catalogue_code, name, module, matter_type, status, legal_authority, current_version, template_file_name) VALUES
('CAT-021', 'Identification', 'Transfers', 'Property Transfer', 'Active', 'Not specified', '1.0', NULL)
ON CONFLICT (catalogue_code) DO NOTHING;
