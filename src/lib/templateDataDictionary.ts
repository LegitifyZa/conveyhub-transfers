export type TemplateFieldDataType = 'Text' | 'Date' | 'Currency' | 'Identifier'

export interface TemplateDataField {
  key: string
  label: string
  entity: string
  dataType: TemplateFieldDataType
  description: string
}

export const TEMPLATE_DATA_DICTIONARY: TemplateDataField[] = [
  { key: 'Client.FirstName', label: 'Client first name', entity: 'Client', dataType: 'Text', description: 'The client’s given name.' },
  { key: 'Client.LastName', label: 'Client last name', entity: 'Client', dataType: 'Text', description: 'The client’s family name.' },
  { key: 'Client.FullName', label: 'Client full name', entity: 'Client', dataType: 'Text', description: 'The client’s full legal name.' },
  { key: 'Client.IDNumber', label: 'Client ID number', entity: 'Client', dataType: 'Identifier', description: 'The client’s South African ID or registered identifier.' },
  { key: 'Client.Email', label: 'Client email', entity: 'Client', dataType: 'Text', description: 'The client’s email address.' },
  { key: 'Client.Phone', label: 'Client phone', entity: 'Client', dataType: 'Text', description: 'The client’s contact number.' },
  { key: 'Seller.FullName', label: 'Seller full name', entity: 'Seller', dataType: 'Text', description: 'The seller’s full legal name.' },
  { key: 'Seller.IDNumber', label: 'Seller ID number', entity: 'Seller', dataType: 'Identifier', description: 'The seller’s South African ID or registered identifier.' },
  { key: 'Seller.TaxNumber', label: 'Seller tax number', entity: 'Seller', dataType: 'Identifier', description: 'The seller’s tax reference number.' },
  { key: 'Purchaser.FullName', label: 'Purchaser full name', entity: 'Purchaser', dataType: 'Text', description: 'The purchaser’s full legal name.' },
  { key: 'Purchaser.IDNumber', label: 'Purchaser ID number', entity: 'Purchaser', dataType: 'Identifier', description: 'The purchaser’s South African ID or registered identifier.' },
  { key: 'Purchaser.TaxNumber', label: 'Purchaser tax number', entity: 'Purchaser', dataType: 'Identifier', description: 'The purchaser’s tax reference number.' },
  { key: 'Property.Address', label: 'Property address', entity: 'Property', dataType: 'Text', description: 'The property’s physical address.' },
  { key: 'Property.ERF', label: 'Property ERF number', entity: 'Property', dataType: 'Identifier', description: 'The registered ERF, portion, or cadastral identifier.' },
  { key: 'Property.Description', label: 'Property description', entity: 'Property', dataType: 'Text', description: 'The property’s legal description.' },
  { key: 'Property.Municipality', label: 'Property municipality', entity: 'Property', dataType: 'Text', description: 'The municipality responsible for the property.' },
  { key: 'Transfer.PurchasePrice', label: 'Transfer purchase price', entity: 'Transfer', dataType: 'Currency', description: 'The agreed purchase price for the transfer.' },
  { key: 'Transfer.OccupationDate', label: 'Transfer occupation date', entity: 'Transfer', dataType: 'Date', description: 'The agreed date of occupation.' },
  { key: 'Transfer.TransactionDate', label: 'Transfer transaction date', entity: 'Transfer', dataType: 'Date', description: 'The effective transaction date.' },
  { key: 'Firm.Name', label: 'Firm name', entity: 'Firm', dataType: 'Text', description: 'The name of the instructing conveyancing firm.' },
  { key: 'Matter.ReferenceNumber', label: 'Matter reference number', entity: 'Matter', dataType: 'Identifier', description: 'The firm’s unique reference for the matter.' },
  { key: 'Bond.LenderName', label: 'Bond lender name', entity: 'Bond', dataType: 'Text', description: 'The financial institution granting the bond.' },
  { key: 'Bond.LoanAmount', label: 'Bond loan amount', entity: 'Bond', dataType: 'Currency', description: 'The amount secured by the bond.' },
  { key: 'Municipality.AccountNumber', label: 'Municipal account number', entity: 'Municipality', dataType: 'Identifier', description: 'The municipal account associated with the property.' }
]

export const getTemplateDataField = (key: string) => TEMPLATE_DATA_DICTIONARY.find(field => field.key === key)
