export type ClauseStatus = 'Active' | 'Draft' | 'Retired'

export interface LegalClause {
  id: string
  identifier: string
  name: string
  category: string
  version: string
  status: ClauseStatus
  legalAuthority: string
  effectiveDate: string
  content: string
}

export const INITIAL_CLAUSES: LegalClause[] = [
  {
    id: 'CLA-001',
    identifier: 'transfer-purchase-price',
    name: 'Purchase Price',
    category: 'Commercial Terms',
    version: '2.0',
    status: 'Active',
    legalAuthority: 'Alienation of Land Act 68 of 1981',
    effectiveDate: '2026-01-01',
    content: 'The purchase price for the Property is {{Transfer.PurchasePrice}}, payable in accordance with the terms of this agreement.'
  },
  {
    id: 'CLA-002',
    identifier: 'occupation',
    name: 'Occupation',
    category: 'Commercial Terms',
    version: '1.3',
    status: 'Active',
    legalAuthority: 'Alienation of Land Act 68 of 1981',
    effectiveDate: '2026-01-01',
    content: 'Occupation of the Property shall be given to the Purchaser on {{Transfer.OccupationDate}}.'
  },
  {
    id: 'CLA-003',
    identifier: 'rates-clearance',
    name: 'Rates Clearance',
    category: 'Regulatory',
    version: '1.1',
    status: 'Active',
    legalAuthority: 'Local Government: Municipal Systems Act 32 of 2000',
    effectiveDate: '2026-01-01',
    content: 'The Seller shall obtain all rates and clearance certificates required for the transfer of {{Property.Address}}.'
  }
]

const versionValue = (version: string) => version.split('.').map(part => Number(part) || 0)

const compareVersions = (left: string, right: string) => {
  const leftParts = versionValue(left)
  const rightParts = versionValue(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

export const getActiveClause = (clauses: LegalClause[], identifier: string) => clauses
  .filter(clause => clause.identifier === identifier && clause.status === 'Active')
  .sort((left, right) => compareVersions(right.version, left.version))[0]
