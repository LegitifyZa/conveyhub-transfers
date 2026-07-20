BEGIN;

INSERT INTO template_data_fields (field_key, label, entity_name, data_type, description) VALUES
('Client.FirstName', 'Client first name', 'Client', 'Text', 'The client''s given name.'),
('Client.LastName', 'Client last name', 'Client', 'Text', 'The client''s family name.'),
('Client.FullName', 'Client full name', 'Client', 'Text', 'The client''s full legal name.'),
('Client.IDNumber', 'Client ID number', 'Client', 'Identifier', 'The client''s South African ID or registered identifier.'),
('Client.Email', 'Client email', 'Client', 'Text', 'The client''s email address.'),
('Client.Phone', 'Client phone', 'Client', 'Text', 'The client''s contact number.'),
('Seller.FullName', 'Seller full name', 'Seller', 'Text', 'The seller''s full legal name.'),
('Seller.IDNumber', 'Seller ID number', 'Seller', 'Identifier', 'The seller''s South African ID or registered identifier.'),
('Seller.TaxNumber', 'Seller tax number', 'Seller', 'Identifier', 'The seller''s tax reference number.'),
('Purchaser.FullName', 'Purchaser full name', 'Purchaser', 'Text', 'The purchaser''s full legal name.'),
('Purchaser.IDNumber', 'Purchaser ID number', 'Purchaser', 'Identifier', 'The purchaser''s South African ID or registered identifier.'),
('Purchaser.TaxNumber', 'Purchaser tax number', 'Purchaser', 'Identifier', 'The purchaser''s tax reference number.'),
('Property.Address', 'Property address', 'Property', 'Text', 'The property''s physical address.'),
('Property.ERF', 'Property ERF number', 'Property', 'Identifier', 'The registered ERF, portion, or cadastral identifier.'),
('Property.Description', 'Property description', 'Property', 'Text', 'The property''s legal description.'),
('Property.Municipality', 'Property municipality', 'Property', 'Text', 'The municipality responsible for the property.'),
('Transfer.PurchasePrice', 'Transfer purchase price', 'Transfer', 'Currency', 'The agreed purchase price for the transfer.'),
('Transfer.OccupationDate', 'Transfer occupation date', 'Transfer', 'Date', 'The agreed date of occupation.'),
('Transfer.TransactionDate', 'Transfer transaction date', 'Transfer', 'Date', 'The effective transaction date.'),
('Firm.Name', 'Firm name', 'Firm', 'Text', 'The name of the instructing conveyancing firm.'),
('Matter.ReferenceNumber', 'Matter reference number', 'Matter', 'Identifier', 'The firm''s unique reference for the matter.'),
('Bond.LenderName', 'Bond lender name', 'Bond', 'Text', 'The financial institution granting the bond.'),
('Bond.LoanAmount', 'Bond loan amount', 'Bond', 'Currency', 'The amount secured by the bond.'),
('Municipality.AccountNumber', 'Municipal account number', 'Municipality', 'Identifier', 'The municipal account associated with the property.')
ON CONFLICT (field_key) DO UPDATE SET label = EXCLUDED.label, entity_name = EXCLUDED.entity_name, data_type = EXCLUDED.data_type, description = EXCLUDED.description, is_active = TRUE;

INSERT INTO milestone_definitions (code, name, default_status_label, matter_type, sequence_number) VALUES
('transferor-fica', 'Transferor', 'FICA Received', 'transfer', 1),
('transferee-fica', 'Transferee', 'FICA Received', 'transfer', 2),
('guarantees', 'Guarantees', 'Guarantee/s Due Date', 'transfer', 3),
('transfer-duty', 'Transfer Duty', 'Applied', 'transfer', 4),
('rates', 'Rates', 'Figures Requested', 'transfer', 5),
('levies', 'Levies', 'Figures Requested', 'transfer', 6),
('home-owners', 'Home Owners', 'Consent Requested', 'transfer', 7),
('electrical', 'Electrical', 'Certificate Requested', 'transfer', 8),
('entomologist', 'Entomologist', 'Certificate Requested', 'transfer', 9),
('electric-fence', 'Electric Fence', 'Certificate Received', 'transfer', 10),
('gas-conformity', 'Gas Conformity', 'Certificate Requested', 'transfer', 11),
('plumbing', 'Plumbing', 'Certificate Requested', 'transfer', 12),
('instruction', 'Instruction', 'Instruction received', 'transfer', 13),
('deposit', 'Deposit', 'Deposit Due', 'transfer', 14),
('new-bond', 'New Bond', 'Bond Grant Due', 'transfer', 15),
('subject-to-sale', 'Subject to Sale', 'Due Date', 'transfer', 16),
('suspensive-conditions', 'Suspensive Cond''s', 'All Conditions met', 'transfer', 17),
('bond-cancellation', 'Bond Cancellation', 'Figures Requested', 'transfer', 18),
('title-deed', 'Title Deed', 'Title Deed Requested', 'transfer', 19),
('transfer-costs', 'Transfer Costs', 'Proforma Sent', 'transfer', 20),
('fica', 'FICA', 'Certified', 'transfer', 21),
('pool', 'Pool', 'Certificate Requested', 'transfer', 22),
('registration-complete', 'Transfer Registration Complete', '5 days after reg', 'transfer', 23)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, default_status_label = EXCLUDED.default_status_label, matter_type = EXCLUDED.matter_type, sequence_number = EXCLUDED.sequence_number, is_active = TRUE;

INSERT INTO document_catalogue (catalogue_code, name, module, matter_type, status, legal_authority, current_version, template_file_name) VALUES
('CAT-001', 'Agreement of Sale', 'Transfers', 'Property Transfer', 'Active', 'Alienation of Land Act 68 of 1981', '2.1', 'Agreement of Sale v2.1.docx'),
('CAT-002', 'Transfer Duty Declaration', 'Transfers', 'Property Transfer', 'Active', 'Transfer Duty Act 40 of 1949', '1.4', 'Transfer Duty Declaration v1.4.pdf'),
('CAT-003', 'Bond Registration Instruction', 'Bonds', 'Bond Registration', 'Active', 'Deeds Registries Act 47 of 1937', '3.0', 'Bond Registration Instruction v3.0.docx'),
('CAT-004', 'Rates Clearance Application', 'Transfers', 'Property Transfer', 'Draft', 'Local Government: Municipal Systems Act 32 of 2000', '1.2', 'Rates Clearance Application v1.2.docx'),
('CAT-005', 'Account - Pro Forma Statement - Debit and Credit', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Account - Pro Forma Statement - Debit and Credit v1.0.docx'),
('CAT-006', 'Account - Pro Forma Statement - Fees and Disbursements', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Account - Pro Forma Statement - Fees and Disbursements v1.0.docx'),
('CAT-007', 'Account - Reconciliation', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Account - Reconciliation v1.0.docx'),
('CAT-008', 'Account - Transferee Final', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Account - Transferee Final v1.0.docx'),
('CAT-009', 'Account - Transferor Final', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Account - Transferor Final v1.0.docx'),
('CAT-010', 'Alienation of Land Act - Section 20', 'General', 'General Conveyancing', 'Active', 'Alienation of Land Act 68 of 1981, section 20', '1.0', 'Alienation of Land Act - Section 20 v1.0.docx'),
('CAT-011', 'Authority to Invest', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Authority to Invest v1.0.docx'),
('CAT-012', 'Certificate of Confirmation of Purchase Price and Deposit', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Certificate of Confirmation of Purchase Price and Deposit v1.0.docx'),
('CAT-013', 'Certificate there are No Exclusive Use Areas', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Certificate there are No Exclusive Use Areas v1.0.docx'),
('CAT-014', 'Confirmation of Transferee Bank details for Refund purposes on Pro Forma', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Confirmation of Transferee Bank details for Refund purposes on Pro Forma v1.0.docx'),
('CAT-015', 'Consent to Transfer by Home Owners Association', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Consent to Transfer by Home Owners Association v1.0.docx'),
('CAT-016', 'Conveyancer''s Certificate - Section 15B(3)(a)', 'General', 'General Conveyancing', 'Active', 'Sectional Titles Act 95 of 1986, section 15B(3)(a)', '1.0', 'Conveyancer''s Certificate - Section 15B(3)(a) v1.0.docx'),
('CAT-017', 'Deed of Transfer - Sectional - Form H', 'General', 'General Conveyancing', 'Active', 'Sectional Titles Act 95 of 1986 and regulations', '1.0', 'Deed of Transfer - Sectional - Form H v1.0.docx'),
('CAT-018', 'Form LLL', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Form LLL v1.0.docx'),
('CAT-019', 'Instruction to Register', 'General', 'General Conveyancing', 'Active', 'Not specified', '1.0', 'Instruction to Register v1.0.docx'),
('CAT-020', 'Transfer Duty Declaration', 'General', 'General Conveyancing', 'Active', 'Transfer Duty Act 40 of 1949', '1.0', 'Transfer Duty Declaration v1.0.docx')
ON CONFLICT (catalogue_code) DO UPDATE SET name = EXCLUDED.name, module = EXCLUDED.module, matter_type = EXCLUDED.matter_type, status = EXCLUDED.status, legal_authority = EXCLUDED.legal_authority, current_version = EXCLUDED.current_version, template_file_name = EXCLUDED.template_file_name;

INSERT INTO clauses (identifier, name, category) VALUES
('transfer-purchase-price', 'Purchase Price', 'Commercial Terms'),
('occupation', 'Occupation', 'Commercial Terms'),
('rates-clearance', 'Rates Clearance', 'Regulatory')
ON CONFLICT (identifier) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category;

INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
SELECT id, '2.0', 'Active', 'Alienation of Land Act 68 of 1981', DATE '2026-01-01', 'The purchase price for the Property is {{Transfer.PurchasePrice}}, payable in accordance with the terms of this agreement.' FROM clauses WHERE identifier = 'transfer-purchase-price'
ON CONFLICT (clause_id, version) DO UPDATE SET status = EXCLUDED.status, legal_authority = EXCLUDED.legal_authority, effective_date = EXCLUDED.effective_date, content = EXCLUDED.content;
INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
SELECT id, '1.3', 'Active', 'Alienation of Land Act 68 of 1981', DATE '2026-01-01', 'Occupation of the Property shall be given to the Purchaser on {{Transfer.OccupationDate}}.' FROM clauses WHERE identifier = 'occupation'
ON CONFLICT (clause_id, version) DO UPDATE SET status = EXCLUDED.status, legal_authority = EXCLUDED.legal_authority, effective_date = EXCLUDED.effective_date, content = EXCLUDED.content;
INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
SELECT id, '1.1', 'Active', 'Local Government: Municipal Systems Act 32 of 2000', DATE '2026-01-01', 'The Seller shall obtain all rates and clearance certificates required for the transfer of {{Property.Address}}.' FROM clauses WHERE identifier = 'rates-clearance'
ON CONFLICT (clause_id, version) DO UPDATE SET status = EXCLUDED.status, legal_authority = EXCLUDED.legal_authority, effective_date = EXCLUDED.effective_date, content = EXCLUDED.content;

COMMIT;
