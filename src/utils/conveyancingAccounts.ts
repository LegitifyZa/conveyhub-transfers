/**
 * South African Conveyancing Accounts, Tariffs, SARS Transfer Duty,
 * Deeds Office Statutory Fees, and Billing Engine.
 *
 * Fully compliant with:
 * - Law Society of South Africa (LSSA) Conveyancing Fee Guidelines
 * - SARS Transfer Duty Act 40 of 1949 (Budget Statutory Brackets)
 * - Deeds Registries Act 47 of 1937 Schedule of Fees (Items 1(a), 1(b), 1(c), 1(d))
 * - DEEDLY Accountable Institution / Multi-Tenant Architecture
 */

// ---------------------------------------------------------------------------
// 1. Interfaces & Types
// ---------------------------------------------------------------------------

export type TransactionType = 'transfer' | 'bond' | 'notarial'
export type PropertyType = 'Freehold' | 'Sectional Title' | 'Share Block' | 'Life Rights' | 'Agricultural Holding' | 'Farm' | 'Commercial' | 'Mixed Use' | 'Vacant Land'
export type DisbursementCategory = 'compliance' | 'admin' | 'search' | 'rates' | 'statutory' | 'customary' | 'adhoc'
export type DisbursementApplicationRule = 
  | 'always' 
  | 'conditional_golden_record' 
  | 'conditional_sectional_title' 
  | 'conditional_rates' 
  | 'conditional_bond' 
  | 'manual'

export interface TariffBracket {
  minAmount: number            // Exclusive lower boundary (except 0 for first bracket)
  maxAmount: number | null     // Inclusive upper boundary (null for open-ended top bracket)
  baseFee: number              // Base Rand fee for threshold
  baseThreshold: number        // Amount at which increment calculation begins
  stepAmount: number           // Increment bracket step (e.g. R50,000, R100,000, R200,000, R1,000,000)
  feePerStep: number           // Rand fee per step or part thereof
  description: string
}

export interface TariffSchedule {
  id: string
  name: string
  version: string
  effectiveDate: string        // YYYY-MM-DD
  gazetteReference?: string
  isOfficial: boolean          // Official LSSA schedules are immutable
  description: string
  isDefault?: boolean
  accountableInstitutionId?: number | null // Null for global official schedules
  brackets: TariffBracket[]
}

export interface SarTransferDutyBracket {
  minAmount: number
  maxAmount: number | null
  rate: number                 // Decimal e.g. 0.03 for 3%
  baseAmount: number
  baseThreshold: number
  description: string
}

export interface SarTransferDutySchedule {
  id: string
  name: string
  version: string
  effectiveDate: string
  gazetteReference: string
  brackets: SarTransferDutyBracket[]
}

export interface DeedsOfficeBracket {
  minAmount: number
  maxAmount: number | null
  fee: number
}

export interface DeedsOfficeAdhocFee {
  id: string
  code: string
  name: string
  amount: number
  description: string
  category: 'statutory' | 'certificate' | 'endorsement' | 'search'
}

export interface DisbursementItem {
  id: string
  code: string                 // Stable uppercase identifier (e.g. 'FICA', 'GOLDEN_RECORD_SEARCH')
  name: string
  amount: number
  isVatApplicable: boolean
  category: DisbursementCategory
  enabled: boolean
  applicationRule: DisbursementApplicationRule
  description: string
}

export interface AppliedDisbursementLine {
  id: string
  code: string
  name: string
  amountExclVat: number
  vatAmount: number
  amountInclVat: number
  isVatApplicable: boolean
  category: DisbursementCategory
  applicationRule: DisbursementApplicationRule
  applicationReason: string
}

export interface TrustBankingDetails {
  bankName: string
  accountNumber: string
  branchCode: string
  accountType: string
  beneficiaryReference: string
}

export interface FirmAccountSettings {
  accountableInstitutionId?: number
  firmName: string
  registrationNumber: string
  isVatRegistered: boolean
  vatNumber: string
  vatRate: number              // Default 0.1500 (15%)
  activeTariffScheduleId: string
  tariffMultiplier: number      // Default 1.0000
  trustAccount: TrustBankingDetails
  defaultDisbursements: DisbursementItem[]
  defaultLodgementDeedsCount: number
}

export interface StatementCredit {
  id: string
  name: string
  amount: number
  source: 'buyer_deposit' | 'seller_retention' | 'agent_commission' | 'bank_guarantee' | 'prior_payment' | 'other'
  date?: string
  reference?: string
}

export interface StatementProvenance {
  tariffScheduleId: string
  tariffVersion: string
  tariffName: string
  tariffMultiplier: number
  sarsTransferDutyVersion: string
  deedsOfficeScheduleVersion: string
  firmVatRegistered: boolean
  firmVatNumber: string
  firmVatRate: number
  isVatTransaction: boolean
  calculatedAt: string
}

export interface ProformaStatementData {
  id: string
  transferId: string
  matterReference: string
  accountableInstitutionId?: number
  date: string
  statementType: 'buyer' | 'seller' | 'combined'
  propertyAddress: string
  erfNumber: string
  propertyType?: PropertyType
  purchasePrice: number
  depositAmount: number
  loanAmount: number
  isVatTransaction: boolean
  lodgementDeedsCount: number
  
  // Provenance & Audit
  provenance: StatementProvenance

  // 1. Conveyancing Fees
  conveyancingFeeExclVat: number
  conveyancingFeeVat: number
  conveyancingFeeInclVat: number

  // 2. SARS Transfer Duty
  transferDuty: number
  transferDutyDescription: string
  isTransferDutyExempt: boolean

  // 3. Deeds Office Statutory Fees
  statutoryScheduleItem: 'Item 1(b)' | 'Item 1(c)' | 'Item 1(d)'
  deedsOfficeRegistrationFee: number
  deedsOfficeLodgementFee: number
  deedsOfficeAdhocFees: Array<{ id: string; name: string; amount: number }>
  deedsOfficeTotal: number

  // 4. Disbursements
  disbursements: AppliedDisbursementLine[]
  disbursementsExclVat: number
  disbursementsVat: number
  disbursementsInclVat: number

  // Summary Totals
  subtotalExclVat: number
  totalVat: number
  totalCosts: number
  
  // Credits & Balance
  credits: StatementCredit[]
  totalCredits: number
  balanceDue: number

  status: 'draft' | 'issued' | 'paid' | 'cancelled'
  notes?: string
}

// ---------------------------------------------------------------------------
// 2. Official Statutory Schedules & Benchmarks
// ---------------------------------------------------------------------------

/**
 * SARS Transfer Duty Rates (Transfer Duty Act 40 of 1949 - Budget Statutory Schedule)
 * Continuous boundary semantics: lower-exclusive (except 0), upper-inclusive.
 */
export const SARS_TRANSFER_DUTY_2023_PRESENT: SarTransferDutySchedule = {
  id: 'sars-td-2023-present',
  name: 'SARS Statutory Transfer Duty Schedule',
  version: '2023.1',
  effectiveDate: '2023-03-01',
  gazetteReference: 'Taxation Laws Amendment Act (Budget Rates)',
  brackets: [
    {
      minAmount: 0,
      maxAmount: 1100000,
      rate: 0,
      baseAmount: 0,
      baseThreshold: 0,
      description: '0% (Exempt up to R1,100,000)'
    },
    {
      minAmount: 1100000,
      maxAmount: 1512500,
      rate: 0.03,
      baseAmount: 0,
      baseThreshold: 1100000,
      description: '3% of the value above R1,100,000'
    },
    {
      minAmount: 1512500,
      maxAmount: 2117500,
      rate: 0.06,
      baseAmount: 12375,
      baseThreshold: 1512500,
      description: 'R12,375 + 6% of the value above R1,512,500'
    },
    {
      minAmount: 2117500,
      maxAmount: 2722500,
      rate: 0.08,
      baseAmount: 48675,
      baseThreshold: 2117500,
      description: 'R48,675 + 8% of the value above R2,117,500'
    },
    {
      minAmount: 2722500,
      maxAmount: 12100000,
      rate: 0.11,
      baseAmount: 97075,
      baseThreshold: 2722500,
      description: 'R97,075 + 11% of the value above R2,722,500'
    },
    {
      minAmount: 12100000,
      maxAmount: null,
      rate: 0.13,
      baseAmount: 1128600,
      baseThreshold: 12100000,
      description: 'R1,128,600 + 13% of the value above R12,100,000'
    }
  ]
}

/**
 * LSSA Guideline Tariff 2026/2027 (Official Law Society Recommended Guidelines)
 * Continuous boundary semantics: lower-exclusive (except 0), upper-inclusive.
 */
export const LSSA_TARIFF_2026_2027: TariffSchedule = {
  id: 'lssa-2026-2027',
  name: 'LSSA Guideline Tariff (2026/2027)',
  version: '2026.1',
  effectiveDate: '2026-03-01',
  gazetteReference: 'LSSA Conveyancing Fee Guidelines 2026',
  isOfficial: true,
  description: 'Official recommended guideline tariff for conveyancing transactions in South Africa',
  isDefault: true,
  brackets: [
    {
      minAmount: 0,
      maxAmount: 100000,
      baseFee: 4700,
      baseThreshold: 0,
      stepAmount: 0,
      feePerStep: 0,
      description: 'Fixed fee for values up to R100,000'
    },
    {
      minAmount: 100000,
      maxAmount: 500000,
      baseFee: 4700,
      baseThreshold: 100000,
      stepAmount: 50000,
      feePerStep: 800,
      description: 'R4,700 plus R800 per R50,000 or part thereof up to R500,000'
    },
    {
      minAmount: 500000,
      maxAmount: 1000000,
      baseFee: 11100,
      baseThreshold: 500000,
      stepAmount: 100000,
      feePerStep: 1200,
      description: 'R11,100 plus R1,200 per R100,000 or part thereof up to R1,000,000'
    },
    {
      minAmount: 1000000,
      maxAmount: 5000000,
      baseFee: 17100,
      baseThreshold: 1000000,
      stepAmount: 200000,
      feePerStep: 1600,
      description: 'R17,100 plus R1,600 per R200,000 or part thereof up to R5,000,000'
    },
    {
      minAmount: 5000000,
      maxAmount: null,
      baseFee: 49100,
      baseThreshold: 5000000,
      stepAmount: 1000000,
      feePerStep: 4000,
      description: 'R49,100 plus R4,000 per R1,000,000 or part thereof above R5,000,000'
    }
  ]
}

/**
 * LSSA Guideline Tariff 2025/2026 (Historical Benchmark)
 */
export const LSSA_TARIFF_2025_2026: TariffSchedule = {
  id: 'lssa-2025-2026',
  name: 'LSSA Guideline Tariff (2025/2026)',
  version: '2025.1',
  effectiveDate: '2025-03-01',
  gazetteReference: 'LSSA Conveyancing Fee Guidelines 2025',
  isOfficial: true,
  description: 'Historical official recommended guideline tariff (2025/2026)',
  isDefault: false,
  brackets: [
    {
      minAmount: 0,
      maxAmount: 100000,
      baseFee: 4400,
      baseThreshold: 0,
      stepAmount: 0,
      feePerStep: 0,
      description: 'Fixed fee for values up to R100,000'
    },
    {
      minAmount: 100000,
      maxAmount: 500000,
      baseFee: 4400,
      baseThreshold: 100000,
      stepAmount: 50000,
      feePerStep: 750,
      description: 'R4,400 plus R750 per R50,000 or part thereof up to R500,000'
    },
    {
      minAmount: 500000,
      maxAmount: 1000000,
      baseFee: 10400,
      baseThreshold: 500000,
      stepAmount: 100000,
      feePerStep: 1100,
      description: 'R10,400 plus R1,100 per R100,000 or part thereof up to R1,000,000'
    },
    {
      minAmount: 1000000,
      maxAmount: 5000000,
      baseFee: 15900,
      baseThreshold: 1000000,
      stepAmount: 200000,
      feePerStep: 1500,
      description: 'R15,900 plus R1,500 per R200,000 or part thereof up to R5,000,000'
    },
    {
      minAmount: 5000000,
      maxAmount: null,
      baseFee: 45900,
      baseThreshold: 5000000,
      stepAmount: 1000000,
      feePerStep: 3750,
      description: 'R45,900 plus R3,750 per R1,000,000 or part thereof above R5,000,000'
    }
  ]
}

export const ALL_PRESET_TARIFFS: TariffSchedule[] = [
  LSSA_TARIFF_2026_2027,
  LSSA_TARIFF_2025_2026
]

// ---------------------------------------------------------------------------
// 3. Deeds Office Statutory Schedules (Government Gazette)
// ---------------------------------------------------------------------------

export const DEEDS_OFFICE_LODGEMENT_FEE_PER_DEED = 52.00 // Item 1(a)

export const DEEDS_OFFICE_ITEM_1B_TRANSFER_SCHEDULE: DeedsOfficeBracket[] = [
  { minAmount: 0, maxAmount: 100000, fee: 55 },
  { minAmount: 100000, maxAmount: 200000, fee: 118 },
  { minAmount: 200000, maxAmount: 300000, fee: 700 },
  { minAmount: 300000, maxAmount: 600000, fee: 882 },
  { minAmount: 600000, maxAmount: 800000, fee: 1274 },
  { minAmount: 800000, maxAmount: 1000000, fee: 1460 },
  { minAmount: 1000000, maxAmount: 2000000, fee: 1760 },
  { minAmount: 2000000, maxAmount: 4000000, fee: 2096 },
  { minAmount: 4000000, maxAmount: 6000000, fee: 2940 },
  { minAmount: 6000000, maxAmount: 8000000, fee: 3767 },
  { minAmount: 8000000, maxAmount: 10000000, fee: 4611 },
  { minAmount: 10000000, maxAmount: 15000000, fee: 5862 },
  { minAmount: 15000000, maxAmount: 20000000, fee: 7025 },
  { minAmount: 20000000, maxAmount: 30000000, fee: 8390 },
  { minAmount: 30000000, maxAmount: null, fee: 10064 }
]

export const DEEDS_OFFICE_ITEM_1C_BOND_SCHEDULE: DeedsOfficeBracket[] = [
  { minAmount: 0, maxAmount: 150000, fee: 520 },
  { minAmount: 150000, maxAmount: 300000, fee: 667 },
  { minAmount: 300000, maxAmount: 600000, fee: 836 },
  { minAmount: 600000, maxAmount: 800000, fee: 1211 },
  { minAmount: 800000, maxAmount: 1000000, fee: 1385 },
  { minAmount: 1000000, maxAmount: 2000000, fee: 1675 },
  { minAmount: 2000000, maxAmount: 4000000, fee: 2096 },
  { minAmount: 4000000, maxAmount: 6000000, fee: 2940 },
  { minAmount: 6000000, maxAmount: 8000000, fee: 3767 },
  { minAmount: 8000000, maxAmount: 10000000, fee: 4611 },
  { minAmount: 10000000, maxAmount: 15000000, fee: 5862 },
  { minAmount: 15000000, maxAmount: 20000000, fee: 7025 },
  { minAmount: 20000000, maxAmount: 30000000, fee: 8390 },
  { minAmount: 30000000, maxAmount: null, fee: 10064 }
]

export const DEEDS_OFFICE_ITEM_1D_NOTARIAL_SCHEDULE: DeedsOfficeBracket[] = [
  { minAmount: 0, maxAmount: 150000, fee: 520 },
  { minAmount: 150000, maxAmount: 300000, fee: 667 },
  { minAmount: 300000, maxAmount: 600000, fee: 836 },
  { minAmount: 600000, maxAmount: 800000, fee: 1211 },
  { minAmount: 800000, maxAmount: 1000000, fee: 1385 },
  { minAmount: 1000000, maxAmount: 2000000, fee: 1675 },
  { minAmount: 2000000, maxAmount: 4000000, fee: 2096 },
  { minAmount: 4000000, maxAmount: 6000000, fee: 2940 },
  { minAmount: 6000000, maxAmount: 8000000, fee: 3767 },
  { minAmount: 8000000, maxAmount: 10000000, fee: 4611 },
  { minAmount: 10000000, maxAmount: 15000000, fee: 5862 },
  { minAmount: 15000000, maxAmount: 20000000, fee: 7025 },
  { minAmount: 20000000, maxAmount: 30000000, fee: 8390 },
  { minAmount: 30000000, maxAmount: null, fee: 10064 }
]

export const OFFICIAL_DEEDS_OFFICE_ADHOC_FEES: DeedsOfficeAdhocFee[] = [
  {
    id: 'deeds-cert-title',
    code: 'CERT_TITLE',
    name: 'Certificate of Registered Title / Consolidated Title (Item 2)',
    amount: 700,
    category: 'certificate',
    description: 'Issuing certificate of registered, sectional, or consolidated title'
  },
  {
    id: 'deeds-cancellation',
    code: 'BOND_CANCELLATION',
    name: 'Consent to Cancellation / Release of Bond (Item 3)',
    amount: 520,
    category: 'endorsement',
    description: 'Registration of consent to cancellation or release of mortgage bond'
  },
  {
    id: 'deeds-lost-deed-va',
    code: 'REG_68_VA',
    name: 'Lost Title Deed VA Application (Reg 68(1))',
    amount: 650,
    category: 'statutory',
    description: 'Application & advertisement for copy of lost or destroyed deed'
  },
  {
    id: 'deeds-interdict-search',
    code: 'STATUTORY_SEARCH',
    name: 'Official Deeds Office Search (Item 5)',
    amount: 50,
    category: 'search',
    description: 'Official Deeds Registry computer search fee'
  }
]

// ---------------------------------------------------------------------------
// 4. Default Firm Settings & Customary Disbursements
// ---------------------------------------------------------------------------

export const STANDARD_DEFAULT_DISBURSEMENTS: DisbursementItem[] = [
  {
    id: 'disb-fica',
    code: 'FICA',
    name: 'FICA Verification Fee',
    amount: 450,
    isVatApplicable: true,
    category: 'compliance',
    enabled: true,
    applicationRule: 'always',
    description: 'Statutory FICA compliance & identity verification check'
  },
  {
    id: 'disb-post-petty',
    code: 'POST_PETTY',
    name: 'Postages and Petties',
    amount: 850,
    isVatApplicable: true,
    category: 'admin',
    enabled: true,
    applicationRule: 'always',
    description: 'Postage, couriers, telecommunications, and incidental administration'
  },
  {
    id: 'disb-doc-gen',
    code: 'DOC_GEN',
    name: 'Electronic Document Generation Fee',
    amount: 650,
    isVatApplicable: true,
    category: 'admin',
    enabled: true,
    applicationRule: 'always',
    description: 'Platform software and automated conveyancing document preparation'
  },
  {
    id: 'disb-deeds-search',
    code: 'DEEDS_SEARCH',
    name: 'Deeds Office Search Fee',
    amount: 250,
    isVatApplicable: true,
    category: 'search',
    enabled: true,
    applicationRule: 'always',
    description: 'Attorney electronic search and property/person title verification'
  },
  {
    id: 'disb-rates-cert',
    code: 'RATES_CERT',
    name: 'Rates Clearance Certificate & Figures Fee',
    amount: 1150,
    isVatApplicable: false,
    category: 'rates',
    enabled: true,
    applicationRule: 'conditional_rates',
    description: 'Municipal application & certificate issuing fee (VAT exempt)'
  },
  {
    id: 'disb-hoa-consent',
    code: 'HOA_CONSENT',
    name: 'HOA / Body Corporate Consent Fee',
    amount: 950,
    isVatApplicable: false,
    category: 'compliance',
    enabled: true,
    applicationRule: 'conditional_sectional_title',
    description: 'Homeowners Association or Managing Agent consent fee'
  },
  {
    id: 'disb-golden-record',
    code: 'GOLDEN_RECORD_SEARCH',
    name: 'Golden Record Search & Verification Fee',
    amount: 350,
    isVatApplicable: true,
    category: 'search',
    enabled: true,
    applicationRule: 'conditional_golden_record',
    description: 'Platform Golden Record party search & verification charge (applied when linked)'
  },
  {
    id: 'disb-bond-admin',
    code: 'BOND_ADMIN',
    name: 'Bond Instruction & Administration Fee',
    amount: 950,
    isVatApplicable: true,
    category: 'admin',
    enabled: true,
    applicationRule: 'conditional_bond',
    description: 'Bank instruction receipt, compliance tracking, and administrative processing'
  },
  {
    id: 'disb-elec-instruct',
    code: 'ELECTRONIC_INSTRUCTION',
    name: 'Electronic Instruction Fee',
    amount: 450,
    isVatApplicable: true,
    category: 'admin',
    enabled: true,
    applicationRule: 'conditional_bond',
    description: 'Bank software portal and secure transmission fee'
  }
]

export const DEFAULT_FIRM_SETTINGS: FirmAccountSettings = {
  firmName: '',
  registrationNumber: '',
  isVatRegistered: true,
  vatNumber: '',
  vatRate: 0.1500,
  activeTariffScheduleId: 'lssa-2026-2027',
  tariffMultiplier: 1.0000,
  trustAccount: {
    bankName: '',
    accountNumber: '',
    branchCode: '',
    accountType: '',
    beneficiaryReference: ''
  },
  defaultDisbursements: STANDARD_DEFAULT_DISBURSEMENTS,
  defaultLodgementDeedsCount: 1
}

// ---------------------------------------------------------------------------
// 5. Calculation Functions (Pure, Authoritative, Boundary-Safe)
// ---------------------------------------------------------------------------

/**
 * Calculate Conveyancing Professional Fee using continuous boundary semantics.
 * Formula:
 * - Determine applicable bracket: value > minAmount && (maxAmount === null || value <= maxAmount)
 *   (For 0 or lowest bracket: value >= minAmount)
 * - excess = propertyValue - baseThreshold
 * - steps = Math.ceil(excess / stepAmount)
 * - rawFee = baseFee + steps * feePerStep
 * - feeExclVat = Math.round(rawFee * multiplier)
 */
export function calculateConveyancingFee(
  propertyValue: number,
  schedule: TariffSchedule = LSSA_TARIFF_2026_2027,
  tariffMultiplier = 1.0
): {
  feeExclVat: number
  matchedBracket: TariffBracket
  calculationExplanation: string
} {
  const value = Math.max(0, Number(propertyValue) || 0)
  const multiplier = Number(tariffMultiplier) > 0 ? Number(tariffMultiplier) : 1.0
  const brackets = schedule.brackets && schedule.brackets.length > 0 ? schedule.brackets : LSSA_TARIFF_2026_2027.brackets

  let matchedBracket = brackets[0]
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i]
    const min = b.minAmount
    const max = b.maxAmount

    const isMatch = i === 0
      ? (value >= min && (max === null || value <= max))
      : (value > min && (max === null || value <= max))

    if (isMatch) {
      matchedBracket = b
      break
    }
  }

  // Calculate fee
  let rawFee = matchedBracket.baseFee
  let explanation = `Base fee of R${matchedBracket.baseFee.toLocaleString()}`

  if (matchedBracket.stepAmount > 0 && matchedBracket.feePerStep > 0 && value > matchedBracket.baseThreshold) {
    const excess = value - matchedBracket.baseThreshold
    const steps = Math.ceil(excess / matchedBracket.stepAmount)
    const stepFee = steps * matchedBracket.feePerStep
    rawFee += stepFee
    explanation += ` + ${steps} step(s) of R${matchedBracket.stepAmount.toLocaleString()} @ R${matchedBracket.feePerStep.toLocaleString()} = R${rawFee.toLocaleString()}`
  }

  const feeExclVat = Math.round(rawFee * multiplier)
  if (multiplier !== 1.0) {
    explanation += ` (Applied ${multiplier}x multiplier: R${feeExclVat.toLocaleString()})`
  }

  return {
    feeExclVat,
    matchedBracket,
    calculationExplanation: explanation
  }
}

/**
 * Calculate SARS Transfer Duty using official statutory continuous boundary schedule.
 * Handles developer sales / VAT-inclusive transactions with complete exemption.
 */
export function calculateTransferDuty(
  propertyValue: number,
  isVatTransaction = false,
  schedule: SarTransferDutySchedule = SARS_TRANSFER_DUTY_2023_PRESENT
): {
  transferDuty: number
  bracketTier: string
  rateDescription: string
  isExempt: boolean
} {
  const value = Math.max(0, Number(propertyValue) || 0)

  if (isVatTransaction) {
    return {
      transferDuty: 0,
      bracketTier: 'VAT Transaction (Developer Sale)',
      rateDescription: 'Exempt from Transfer Duty (Purchase price is subject to VAT)',
      isExempt: true
    }
  }

  const brackets = schedule.brackets
  let matched = brackets[0]

  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i]
    const min = b.minAmount
    const max = b.maxAmount

    const isMatch = i === 0
      ? (value >= min && (max === null || value <= max))
      : (value > min && (max === null || value <= max))

    if (isMatch) {
      matched = b
      break
    }
  }

  let duty = matched.baseAmount
  if (matched.rate > 0 && value > matched.baseThreshold) {
    const excess = value - matched.baseThreshold
    duty += excess * matched.rate
  }

  const roundedDuty = Math.round(duty)
  return {
    transferDuty: roundedDuty,
    bracketTier: `Bracket R${matched.minAmount.toLocaleString()} - ${matched.maxAmount ? 'R' + matched.maxAmount.toLocaleString() : 'Above'}`,
    rateDescription: matched.description,
    isExempt: roundedDuty === 0
  }
}

/**
 * Calculate Deeds Office Statutory Fees with explicit branching:
 * - 'transfer': Item 1(b) schedule + Item 1(a) lodgement
 * - 'bond': Item 1(c) schedule + Item 1(a) lodgement
 * - 'notarial': Item 1(d) schedule + Item 1(a) lodgement
 */
export function calculateDeedsOfficeFee(
  amount: number,
  transactionType: TransactionType = 'transfer',
  deedsCount = 1,
  adhocFees: DeedsOfficeAdhocFee[] = []
): {
  statutoryScheduleItem: 'Item 1(b)' | 'Item 1(c)' | 'Item 1(d)'
  statutoryRegistrationFee: number
  statutoryLodgementFee: number
  adhocFeesTotal: number
  totalDeedsOfficeFees: number
  deedsCount: number
} {
  const value = Math.max(0, Number(amount) || 0)
  const count = Math.max(1, parseInt(String(deedsCount || 1), 10) || 1)

  let schedule: DeedsOfficeBracket[]
  let scheduleItem: 'Item 1(b)' | 'Item 1(c)' | 'Item 1(d)'

  if (transactionType === 'bond') {
    schedule = DEEDS_OFFICE_ITEM_1C_BOND_SCHEDULE
    scheduleItem = 'Item 1(c)'
  } else if (transactionType === 'notarial') {
    schedule = DEEDS_OFFICE_ITEM_1D_NOTARIAL_SCHEDULE
    scheduleItem = 'Item 1(d)'
  } else {
    schedule = DEEDS_OFFICE_ITEM_1B_TRANSFER_SCHEDULE
    scheduleItem = 'Item 1(b)'
  }

  let regFee = schedule[0].fee
  for (let i = 0; i < schedule.length; i++) {
    const b = schedule[i]
    const min = b.minAmount
    const max = b.maxAmount

    const isMatch = i === 0
      ? (value >= min && (max === null || value <= max))
      : (value > min && (max === null || value <= max))

    if (isMatch) {
      regFee = b.fee
      break
    }
  }

  // Item 1(a) Lodgement fee per deed
  const lodgementFee = Math.round(count * DEEDS_OFFICE_LODGEMENT_FEE_PER_DEED)
  const adhocTotal = adhocFees.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const total = regFee + lodgementFee + adhocTotal

  return {
    statutoryScheduleItem: scheduleItem,
    statutoryRegistrationFee: regFee,
    statutoryLodgementFee: lodgementFee,
    adhocFeesTotal: adhocTotal,
    totalDeedsOfficeFees: total,
    deedsCount: count
  }
}

/**
 * Filter and evaluate applicable disbursements based on matter context.
 */
export function evaluateDisbursements(params: {
  disbursements: DisbursementItem[]
  firmIsVatRegistered: boolean
  vatRate: number
  context?: {
    isBondMatter?: boolean
    propertyType?: PropertyType
    hasGoldenRecordEntity?: boolean
    requiresRatesClearance?: boolean
  }
}): {
  appliedLines: AppliedDisbursementLine[]
  totalExclVat: number
  totalVat: number
  totalInclVat: number
} {
  const {
    disbursements,
    firmIsVatRegistered,
    vatRate,
    context = {}
  } = params

  const isBond = context.isBondMatter === true
  const isSectional = context.propertyType === 'Sectional Title'
  const hasGolden = context.hasGoldenRecordEntity === true
  const hasRates = context.requiresRatesClearance !== false // Default true for transfers

  const appliedLines: AppliedDisbursementLine[] = []

  for (const item of disbursements) {
    if (!item.enabled) continue

    let shouldApply = false
    let reason = 'Standard customary charge'

    switch (item.applicationRule) {
      case 'always':
        shouldApply = !isBond || item.category === 'compliance' || item.category === 'admin'
        reason = 'Standard practice disbursement'
        break

      case 'conditional_golden_record':
        shouldApply = hasGolden
        reason = 'Applied: Matter linked to Golden Record verified entity'
        break

      case 'conditional_sectional_title':
        shouldApply = isSectional
        reason = 'Applied: Sectional Title / Body Corporate property'
        break

      case 'conditional_rates':
        shouldApply = !isBond && hasRates
        reason = 'Applied: Municipal rates clearance certificate required'
        break

      case 'conditional_bond':
        shouldApply = isBond
        reason = 'Applied: Mortgage bond administration'
        break

      case 'manual':
        shouldApply = false
        break
    }

    if (shouldApply) {
      const amountExcl = Number(item.amount) || 0
      const vat = (item.isVatApplicable && firmIsVatRegistered) ? Math.round(amountExcl * vatRate) : 0
      appliedLines.push({
        id: item.id,
        code: item.code,
        name: item.name,
        amountExclVat: amountExcl,
        vatAmount: vat,
        amountInclVat: amountExcl + vat,
        isVatApplicable: item.isVatApplicable,
        category: item.category,
        applicationRule: item.applicationRule,
        applicationReason: reason
      })
    }
  }

  const totalExclVat = appliedLines.reduce((s, l) => s + l.amountExclVat, 0)
  const totalVat = appliedLines.reduce((s, l) => s + l.vatAmount, 0)
  const totalInclVat = totalExclVat + totalVat

  return {
    appliedLines,
    totalExclVat,
    totalVat,
    totalInclVat
  }
}

/**
 * Generate a complete Proforma Statement with full provenance and statutory compliance.
 */
export function generateProformaStatement(params: {
  transferId: string
  matterReference?: string
  accountableInstitutionId?: number
  propertyAddress: string
  erfNumber?: string
  propertyType?: PropertyType
  purchasePrice: number
  depositAmount?: number
  loanAmount?: number
  isVatTransaction?: boolean
  lodgementDeedsCount?: number
  statementType?: 'buyer' | 'seller' | 'combined'
  firmSettings?: FirmAccountSettings
  tariffSchedule?: TariffSchedule
  hasGoldenRecordEntity?: boolean
  customCredits?: StatementCredit[]
  adhocDeedsFees?: DeedsOfficeAdhocFee[]
}): ProformaStatementData {
  const {
    transferId,
    matterReference = transferId,
    accountableInstitutionId,
    propertyAddress,
    erfNumber = '',
    propertyType = 'Freehold',
    purchasePrice,
    depositAmount = 0,
    loanAmount = 0,
    isVatTransaction = false,
    lodgementDeedsCount = 1,
    statementType = 'buyer',
    firmSettings = DEFAULT_FIRM_SETTINGS,
    tariffSchedule = LSSA_TARIFF_2026_2027,
    hasGoldenRecordEntity = false,
    customCredits,
    adhocDeedsFees = []
  } = params

  const effectiveVatRate = firmSettings.isVatRegistered ? firmSettings.vatRate : 0

  // 1. Conveyancing Fees
  const convResult = calculateConveyancingFee(purchasePrice, tariffSchedule, firmSettings.tariffMultiplier)
  const convExcl = convResult.feeExclVat
  const convVat = Math.round(convExcl * effectiveVatRate)
  const convIncl = convExcl + convVat

  // 2. SARS Transfer Duty
  const tdResult = calculateTransferDuty(purchasePrice, isVatTransaction, SARS_TRANSFER_DUTY_2023_PRESENT)

  // 3. Deeds Office Statutory Fees
  const deedsResult = calculateDeedsOfficeFee(purchasePrice, 'transfer', lodgementDeedsCount, adhocDeedsFees)

  // 4. Disbursements
  const disbResult = evaluateDisbursements({
    disbursements: firmSettings.defaultDisbursements,
    firmIsVatRegistered: firmSettings.isVatRegistered,
    vatRate: effectiveVatRate,
    context: {
      isBondMatter: false,
      propertyType,
      hasGoldenRecordEntity,
      requiresRatesClearance: true
    }
  })

  // Summary calculation
  const subtotalExclVat = convExcl + tdResult.transferDuty + deedsResult.totalDeedsOfficeFees + disbResult.totalExclVat
  const totalVat = convVat + disbResult.totalVat
  const totalCosts = convIncl + tdResult.transferDuty + deedsResult.totalDeedsOfficeFees + disbResult.totalInclVat

  // Credits
  const credits: StatementCredit[] = customCredits || (depositAmount > 0 ? [
    {
      id: 'cred-1',
      name: 'Deposit Received from Purchaser',
      amount: depositAmount,
      source: 'buyer_deposit'
    }
  ] : [])

  const totalCredits = credits.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const balanceDue = totalCosts - totalCredits

  const provenance: StatementProvenance = {
    tariffScheduleId: tariffSchedule.id,
    tariffVersion: tariffSchedule.version || '1.0',
    tariffName: tariffSchedule.name,
    tariffMultiplier: firmSettings.tariffMultiplier,
    sarsTransferDutyVersion: SARS_TRANSFER_DUTY_2023_PRESENT.version,
    deedsOfficeScheduleVersion: '2026.1',
    firmVatRegistered: firmSettings.isVatRegistered,
    firmVatNumber: firmSettings.vatNumber,
    firmVatRate: effectiveVatRate,
    isVatTransaction,
    calculatedAt: new Date().toISOString()
  }

  return {
    id: `PF-${Date.now().toString(36).toUpperCase()}`,
    transferId,
    matterReference,
    accountableInstitutionId,
    date: new Date().toISOString(),
    statementType,
    propertyAddress,
    erfNumber,
    propertyType,
    purchasePrice,
    depositAmount,
    loanAmount,
    isVatTransaction,
    lodgementDeedsCount,
    provenance,
    conveyancingFeeExclVat: convExcl,
    conveyancingFeeVat: convVat,
    conveyancingFeeInclVat: convIncl,
    transferDuty: tdResult.transferDuty,
    transferDutyDescription: tdResult.rateDescription,
    isTransferDutyExempt: tdResult.isExempt,
    statutoryScheduleItem: deedsResult.statutoryScheduleItem,
    deedsOfficeRegistrationFee: deedsResult.statutoryRegistrationFee,
    deedsOfficeLodgementFee: deedsResult.statutoryLodgementFee,
    deedsOfficeAdhocFees: adhocDeedsFees.map(a => ({ id: a.id, name: a.name, amount: a.amount })),
    deedsOfficeTotal: deedsResult.totalDeedsOfficeFees,
    disbursements: disbResult.appliedLines,
    disbursementsExclVat: disbResult.totalExclVat,
    disbursementsVat: disbResult.totalVat,
    disbursementsInclVat: disbResult.totalInclVat,
    subtotalExclVat,
    totalVat,
    totalCosts,
    credits,
    totalCredits,
    balanceDue,
    status: 'issued',
    notes: 'Payment due on receipt of proforma into the firm Section 86 trust account.'
  }
}

// ---------------------------------------------------------------------------
// 6. Formatting Utilities
// ---------------------------------------------------------------------------

export function formatZAR(amount: number): string {
  const num = Number(amount) || 0
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num)
}
