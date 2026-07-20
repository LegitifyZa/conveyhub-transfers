import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, FilePlus2, FileText, Search } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui'
import { getTemplateDataField, TEMPLATE_DATA_DICTIONARY } from '@/lib/templateDataDictionary'
import { apiRequest } from '@/lib/api/http'

type CatalogueStatus = 'Active' | 'Draft' | 'Retired'

interface CatalogueDocument {
  id: string
  name: string
  module: string
  matterType: string
  version: string
  status: CatalogueStatus
  legalAuthority: string
  template: string
  requiredDataFields: string[]
  requiredSupportingDocuments: string[]
}

const createGeneralDocument = (id: string, name: string, legalAuthority = 'Not specified'): CatalogueDocument => ({
  id,
  name,
  module: 'General',
  matterType: 'General Conveyancing',
  version: '1.0',
  status: 'Active',
  legalAuthority,
  template: `${name} v1.0.docx`,
  requiredDataFields: [],
  requiredSupportingDocuments: []
})

const GENERAL_DOCUMENTS: CatalogueDocument[] = [
  createGeneralDocument('CAT-005', 'Account - Pro Forma Statement - Debit and Credit'),
  createGeneralDocument('CAT-006', 'Account - Pro Forma Statement - Fees and Disbursements'),
  createGeneralDocument('CAT-007', 'Account - Reconciliation'),
  createGeneralDocument('CAT-008', 'Account - Transferee Final'),
  createGeneralDocument('CAT-009', 'Account - Transferor Final'),
  createGeneralDocument('CAT-010', 'Alienation of Land Act - Section 20', 'Alienation of Land Act 68 of 1981, section 20'),
  createGeneralDocument('CAT-011', 'Authority to Invest'),
  createGeneralDocument('CAT-012', 'Certificate of Confirmation of Purchase Price and Deposit'),
  createGeneralDocument('CAT-013', 'Certificate there are No Exclusive Use Areas'),
  createGeneralDocument('CAT-014', 'Confirmation of Transferee Bank details for Refund purposes on Pro Forma'),
  createGeneralDocument('CAT-015', 'Consent to Transfer by Home Owners Association'),
  createGeneralDocument('CAT-016', "Conveyancer's Certificate - Section 15B(3)(a)", 'Sectional Titles Act 95 of 1986, section 15B(3)(a)'),
  createGeneralDocument('CAT-017', 'Deed of Transfer - Sectional - Form H', 'Sectional Titles Act 95 of 1986 and regulations'),
  createGeneralDocument('CAT-018', 'Form LLL'),
  createGeneralDocument('CAT-019', 'Instruction to Register'),
  createGeneralDocument('CAT-020', 'Transfer Duty Declaration', 'Transfer Duty Act 40 of 1949')
]

const INITIAL_CATALOGUE: CatalogueDocument[] = [
  {
    id: 'CAT-001',
    name: 'Agreement of Sale',
    module: 'Transfers',
    matterType: 'Property Transfer',
    version: '2.1',
    status: 'Active',
    legalAuthority: 'Alienation of Land Act 68 of 1981',
    template: 'Agreement of Sale v2.1.docx',
    requiredDataFields: ['Purchaser.FullName', 'Seller.FullName', 'Property.Description', 'Transfer.PurchasePrice', 'Transfer.OccupationDate'],
    requiredSupportingDocuments: ['Title Deed', 'FICA documentation', 'Proof of deposit']
  },
  {
    id: 'CAT-002',
    name: 'Transfer Duty Declaration',
    module: 'Transfers',
    matterType: 'Property Transfer',
    version: '1.4',
    status: 'Active',
    legalAuthority: 'Transfer Duty Act 40 of 1949',
    template: 'Transfer Duty Declaration v1.4.pdf',
    requiredDataFields: ['Transfer.PurchasePrice', 'Purchaser.TaxNumber', 'Seller.TaxNumber', 'Transfer.TransactionDate'],
    requiredSupportingDocuments: ['Signed Agreement of Sale', 'Identity documents']
  },
  {
    id: 'CAT-003',
    name: 'Bond Registration Instruction',
    module: 'Bonds',
    matterType: 'Bond Registration',
    version: '3.0',
    status: 'Active',
    legalAuthority: 'Deeds Registries Act 47 of 1937',
    template: 'Bond Registration Instruction v3.0.docx',
    requiredDataFields: ['Purchaser.FullName', 'Bond.LenderName', 'Bond.LoanAmount', 'Property.Description'],
    requiredSupportingDocuments: ['Grant letter', 'Signed quotation', 'FICA documentation']
  },
  {
    id: 'CAT-004',
    name: 'Rates Clearance Application',
    module: 'Transfers',
    matterType: 'Property Transfer',
    version: '1.2',
    status: 'Draft',
    legalAuthority: 'Local Government: Municipal Systems Act 32 of 2000',
    template: 'Rates Clearance Application v1.2.docx',
    requiredDataFields: ['Property.Municipality', 'Municipality.AccountNumber', 'Property.Description', 'Seller.FullName'],
    requiredSupportingDocuments: ['Latest municipal account', 'Power of attorney']
  },
  ...GENERAL_DOCUMENTS
]

const LEGACY_FIELD_KEYS: Record<string, string> = {
  'Purchaser details': 'Purchaser.FullName',
  'Seller details': 'Seller.FullName',
  'Property description': 'Property.Description',
  'Purchase price': 'Transfer.PurchasePrice',
  'Occupation date': 'Transfer.OccupationDate',
  'Property value': 'Transfer.PurchasePrice',
  'Purchaser tax number': 'Purchaser.TaxNumber',
  'Seller tax number': 'Seller.TaxNumber',
  'Transaction date': 'Transfer.TransactionDate',
  'Borrower details': 'Purchaser.FullName',
  'Lender details': 'Bond.LenderName',
  'Loan amount': 'Bond.LoanAmount',
  Municipality: 'Property.Municipality',
  'Account number': 'Municipality.AccountNumber'
}

const normaliseCatalogueDocument = (document: CatalogueDocument): CatalogueDocument => ({
  ...document,
  requiredDataFields: document.requiredDataFields
    .map(field => LEGACY_FIELD_KEYS[field] || field)
    .filter(field => TEMPLATE_DATA_DICTIONARY.some(dictionaryField => dictionaryField.key === field))
})

const EMPTY_DOCUMENT: Omit<CatalogueDocument, 'id'> = {
  name: '',
  module: 'Transfers',
  matterType: '',
  version: '1.0',
  status: 'Draft',
  legalAuthority: '',
  template: '',
  requiredDataFields: [],
  requiredSupportingDocuments: []
}

const DocumentCatalogue: React.FC = () => {
  const [catalogue, setCatalogue] = useState<CatalogueDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [moduleFilter, setModuleFilter] = useState('All modules')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [showForm, setShowForm] = useState(false)
  const [expandedDocument, setExpandedDocument] = useState<string | null>(null)
  const [newDocument, setNewDocument] = useState(EMPTY_DOCUMENT)

  const seedCatalogue = useMemo(() => INITIAL_CATALOGUE.map(normaliseCatalogueDocument), [])

  const loadCatalogue = async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = await apiRequest<CatalogueDocument[]>('/api/catalogue')
      const normalised = data.map(normaliseCatalogueDocument)
      setCatalogue(normalised.length > 0 ? normalised : seedCatalogue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document catalogue')
      setCatalogue(seedCatalogue)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCatalogue()
  }, [])

  const modules = useMemo(() => [...new Set(catalogue.map(document => document.module))], [catalogue])
  const filteredCatalogue = useMemo(() => {
    const searchValue = searchTerm.toLowerCase()
    return catalogue.filter(document => {
      const matchesSearch = [document.name, document.module, document.matterType, document.legalAuthority]
        .some(value => value.toLowerCase().includes(searchValue))
      const matchesModule = moduleFilter === 'All modules' || document.module === moduleFilter
      const matchesStatus = statusFilter === 'All statuses' || document.status === statusFilter
      return matchesSearch && matchesModule && matchesStatus
    })
  }, [catalogue, moduleFilter, searchTerm, statusFilter])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const document: CatalogueDocument = {
      ...newDocument,
      id: `CAT-${String(Date.now()).slice(-6)}`
    }
    try {
      await apiRequest<CatalogueDocument>('/api/catalogue', { method: 'POST', body: document })
      await loadCatalogue()
      setNewDocument(EMPTY_DOCUMENT)
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document')
    }
  }

  const updateNewDocument = <K extends keyof Omit<CatalogueDocument, 'id'>>(key: K, value: Omit<CatalogueDocument, 'id'>[K]) => {
    setNewDocument(previous => ({ ...previous, [key]: value }))
  }

  const getStatusVariant = (status: CatalogueStatus): 'success' | 'warning' | 'default' => {
    if (status === 'Active') return 'success'
    if (status === 'Draft') return 'warning'
    return 'default'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Document Catalogue</h1>
          <p className="text-gray-600 dark:text-gray-400">A registry of document definitions, templates, and compliance requirements.</p>
        </div>
        <Button onClick={() => setShowForm(previous => !previous)}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {showForm ? 'Close Form' : 'Add Document'}
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add Document to Catalogue</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Name<Input required value={newDocument.name} onChange={event => updateNewDocument('name', event.target.value)} className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Module<select value={newDocument.module} onChange={event => updateNewDocument('module', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"><option>Transfers</option><option>Bonds</option><option>Cancellations</option><option>General</option></select></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Matter Type<Input required value={newDocument.matterType} onChange={event => updateNewDocument('matterType', event.target.value)} className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Version<Input required value={newDocument.version} onChange={event => updateNewDocument('version', event.target.value)} className="mt-1" /></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status<select value={newDocument.status} onChange={event => updateNewDocument('status', event.target.value as CatalogueStatus)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"><option>Draft</option><option>Active</option><option>Retired</option></select></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Template<Input required value={newDocument.template} onChange={event => updateNewDocument('template', event.target.value)} className="mt-1" /></label>
              </div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Legal Authority<Input required value={newDocument.legalAuthority} onChange={event => updateNewDocument('legalAuthority', event.target.value)} className="mt-1" /></label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Required Data Fields<select required multiple value={newDocument.requiredDataFields} onChange={event => updateNewDocument('requiredDataFields', Array.from(event.currentTarget.selectedOptions, option => option.value))} className="mt-1 h-40 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100">{TEMPLATE_DATA_DICTIONARY.map(field => <option key={field.key} value={field.key}>{field.key} — {field.label}</option>)}</select><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">Select every centrally defined field the template requires.</span></label>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Required Supporting Documents<Input required placeholder="Separate documents with commas" onChange={event => updateNewDocument('requiredSupportingDocuments', event.target.value.split(',').map(value => value.trim()).filter(Boolean))} className="mt-1" /></label>
              <div className="flex justify-end"><Button type="submit">Save Document</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search by name, module, matter type, or legal authority..." className="pl-10" />
            </div>
            <select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"><option>All modules</option>{modules.map(module => <option key={module}>{module}</option>)}</select>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"><option>All statuses</option><option>Active</option><option>Draft</option><option>Retired</option></select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400"><span>{filteredCatalogue.length} document{filteredCatalogue.length === 1 ? '' : 's'} shown</span><span>{catalogue.filter(document => document.status === 'Active').length} active</span></div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading catalogue…</p>
      ) : (
        <div className="space-y-4">
          {filteredCatalogue.map(document => (
            <Card key={document.id}>
              <CardContent className="p-5">
                <button type="button" onClick={() => setExpandedDocument(current => current === document.id ? null : document.id)} className="flex w-full items-start justify-between gap-4 text-left">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-teal-50 p-2 dark:bg-teal-900/20"><FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" /></div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-gray-900 dark:text-gray-100">{document.name}</h2><Badge variant={getStatusVariant(document.status)} size="sm">{document.status}</Badge></div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{document.module} · {document.matterType} · Version {document.version}</p>
                    </div>
                  </div>
                  {expandedDocument === document.id ? <ChevronUp className="h-5 w-5 shrink-0 text-gray-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />}
                </button>
                {expandedDocument === document.id && (
                  <div className="mt-5 grid grid-cols-1 gap-5 border-t border-gray-200 pt-5 md:grid-cols-2 dark:border-navy-700">
                    <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Legal Authority</p><p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{document.legalAuthority}</p></div>
                    <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Template</p><p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{document.template}</p></div>
                    <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Required Data Fields</p><ul className="mt-1 list-inside list-disc space-y-1 text-sm text-gray-900 dark:text-gray-100">{document.requiredDataFields.map(field => <li key={field}>{field} — {getTemplateDataField(field)?.label || field}</li>)}</ul></div>
                    <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Required Supporting Documents</p><ul className="mt-1 list-inside list-disc space-y-1 text-sm text-gray-900 dark:text-gray-100">{document.requiredSupportingDocuments.map(supportingDocument => <li key={supportingDocument}>{supportingDocument}</li>)}</ul></div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {filteredCatalogue.length === 0 && <Card><CardContent className="flex flex-col items-center py-12 text-center"><BookOpen className="mb-3 h-8 w-8 text-gray-400" /><p className="font-medium text-gray-900 dark:text-gray-100">No catalogue documents found</p><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Change the filters or add a document definition.</p></CardContent></Card>}
        </div>
      )}
    </div>
  )
}

export { DocumentCatalogue }
