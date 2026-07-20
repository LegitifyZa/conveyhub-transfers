import { getActiveClause, INITIAL_CLAUSES, LegalClause } from './clauseLibrary'
import { getTemplateDataField } from './templateDataDictionary'

export interface MatterTemplateData {
  Client?: {
    FirstName?: string
    LastName?: string
    FullName?: string
    IDNumber?: string
    Email?: string
    Phone?: string
  }
  Seller?: {
    FullName?: string
    IDNumber?: string
    TaxNumber?: string
  }
  Purchaser?: {
    FullName?: string
    IDNumber?: string
    TaxNumber?: string
  }
  Property?: {
    Address?: string
    ERF?: string
    Description?: string
    Municipality?: string
  }
  Transfer?: {
    PurchasePrice?: number
    OccupationDate?: string
    TransactionDate?: string
  }
  Firm?: {
    Name?: string
  }
  Matter?: {
    ReferenceNumber?: string
  }
  Bond?: {
    LenderName?: string
    LoanAmount?: number
  }
  Municipality?: {
    AccountNumber?: string
  }
}

export interface TemplateResolution {
  content: string
  resolvedFields: string[]
  unresolvedFields: string[]
  undefinedFields: string[]
  resolvedClauses: string[]
  unresolvedClauses: string[]
}

const PLACEHOLDER_PATTERN = /{{\s*([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)*)\s*}}/g
const CLAUSE_PATTERN = /{{\s*Clause:([a-z0-9-]+)\s*}}/gi

const getMatterValue = (data: MatterTemplateData, path: string): string | number | undefined => {
  const value = path.split('.').reduce<unknown>((currentValue, segment) => {
    if (!currentValue || typeof currentValue !== 'object') return undefined
    return (currentValue as Record<string, unknown>)[segment]
  }, data)

  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

const formatMatterValue = (key: string, value: string | number) => {
  const field = getTemplateDataField(key)
  if (field?.dataType === 'Currency' && typeof value === 'number') {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2
    }).format(value)
  }

  if (field?.dataType === 'Date' && typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'long' }).format(date)
    }
  }

  return String(value)
}

export const extractTemplateFields = (template: string): string[] => {
  const fields = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    fields.add(match[1])
  }
  return [...fields]
}

export const resolveTemplate = (template: string, matterData: MatterTemplateData, clauses: LegalClause[] = INITIAL_CLAUSES): TemplateResolution => {
  const resolvedFields = new Set<string>()
  const unresolvedFields = new Set<string>()
  const undefinedFields = new Set<string>()
  const resolvedClauses = new Set<string>()
  const unresolvedClauses = new Set<string>()
  const assembledTemplate = template.replace(CLAUSE_PATTERN, (placeholder, identifier: string) => {
    const clause = getActiveClause(clauses, identifier)
    if (!clause) {
      unresolvedClauses.add(identifier)
      return placeholder
    }

    resolvedClauses.add(`${clause.identifier} v${clause.version}`)
    return clause.content
  })
  const content = assembledTemplate.replace(PLACEHOLDER_PATTERN, (placeholder, key: string) => {
    if (!getTemplateDataField(key)) {
      undefinedFields.add(key)
      return placeholder
    }

    const value = getMatterValue(matterData, key)
    if (value === undefined) {
      unresolvedFields.add(key)
      return placeholder
    }

    resolvedFields.add(key)
    return formatMatterValue(key, value)
  })

  return {
    content,
    resolvedFields: [...resolvedFields],
    unresolvedFields: [...unresolvedFields],
    undefinedFields: [...undefinedFields],
    resolvedClauses: [...resolvedClauses],
    unresolvedClauses: [...unresolvedClauses]
  }
}
