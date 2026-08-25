// South African Conveyancing & Transfer Accounts Calculation Engine

export interface TariffBracket {
  id: string
  minAmount: number
  maxAmount: number | null // null means unlimited (e.g. above R5,000,000)
  baseFee: number
  baseThreshold: number // Amount above which increments apply
  incrementStep: number // Increment step in ZAR (e.g. 50000, 100000, 200000, 1000000)
  incrementFee: number // Additional fee per step (or part thereof)
  description?: string
}

export interface TariffSchedule {
  id: string
  name: string
  version: string
  effectiveDate: string
  description: string
  isDefault?: boolean
  brackets: TariffBracket[]
}

export interface DeedsOfficeStatutoryFee {
  id: string
  code: string
  name: string
  category: 'lodgement' | 'transfer' | 'bond' | 'notarial' | 'adhoc'
  fee: number
  minAmount?: number
  maxAmount?: number | null
  description?: string
}

export interface DisbursementItem {
  id: string
  code?: string
  name: string
  amount: number
  isVatApplicable: boolean
  isCustomary?: boolean
  category: 'statutory' | 'disbursement' | 'compliance' | 'rates' | 'admin' | 'adhoc'
  description?: string
  payee?: string
}

export interface AccountCredit {
  id: string
  name: string
  amount: number
  date?: string
  description?: string
  source?: 'buyer_deposit' | 'seller_credit' | 'retention' | 'interest' | 'other'
}

export interface TrustBankingDetails {
  bankName: string
  accountName: string
  accountNumber: string
  branchCode: string
  accountType: string
  referencePrefix: string
}

export interface FirmAccountSettings {
  firmName: string
  registrationNumber?: string
  isVatRegistered: boolean
  vatNumber: string
  vatRate: number // Default 0.15 (15%)
  activeTariffScheduleId: string
  tariffMultiplier: number // Default 1.0 (100%)
  trustAccount: TrustBankingDetails
  defaultDisbursements: DisbursementItem[]
  defaultLodgementDeedsCount: number
}

// -------------------------------------------------------------------------
// Pre-configured LSSA Conveyancing Tariff Schedules
// -------------------------------------------------------------------------

export const LSSA_TARIFF_2026_2027: TariffSchedule = {
  id: 'lssa-2026-2027',
  name: 'LSSA Guideline Tariff (2026/2027)',
  version: '2026.1',
  effectiveDate: '2026-07-01',
  description: 'Law Society of South Africa recommended conveyancing tariff scale (Effective 1 July 2026)',
  isDefault: true,
  brackets: [
    {
      id: 'b1',
      minAmount: 0,
      maxAmount: 100000,
      baseFee: 6875,
      baseThreshold: 0,
      incrementStep: 0,
      incrementFee: 0,
      description: 'R100,000 or less: Fixed R6,875'
    },
    {
      id: 'b2',
      minAmount: 100001,
      maxAmount: 500000,
      baseFee: 6875,
      baseThreshold: 100000,
      incrementStep: 50000,
      incrementFee: 1100,
      description: 'Over R100,000 to R500,000: R6,875 + R1,100 per R50,000 (or part thereof) above R100,000'
    },
    {
      id: 'b3',
      minAmount: 500001,
      maxAmount: 1000000,
      baseFee: 15675,
      baseThreshold: 500000,
      incrementStep: 100000,
      incrementFee: 2120,
      description: 'Over R500,000 to R1,000,000: R15,675 + R2,120 per R100,000 (or part thereof) above R500,000'
    },
    {
      id: 'b4',
      minAmount: 1000001,
      maxAmount: 5000000,
      baseFee: 26275,
      baseThreshold: 1000000,
      incrementStep: 200000,
      incrementFee: 2120,
      description: 'Over R1,000,000 to R5,000,000: R26,275 + R2,120 per R200,000 (or part thereof) above R1,000,000'
    },
    {
      id: 'b5',
      minAmount: 5000001,
      maxAmount: null,
      baseFee: 68675,
      baseThreshold: 5000000,
      incrementStep: 1000000,
      incrementFee: 5340,
      description: 'Over R5,000,000: R68,675 + R5,340 per R1,000,000 (or part thereof) above R5,000,000'
    }
  ]
}

export const LSSA_TARIFF_2025_2026: TariffSchedule = {
  id: 'lssa-2025-2026',
  name: 'LSSA Guideline Tariff (2025/2026)',
  version: '2025.1',
  effectiveDate: '2025-08-01',
  description: 'Law Society of South Africa recommended conveyancing tariff scale (Effective 1 August 2025)',
  brackets: [
    {
      id: 'b1-2025',
      minAmount: 0,
      maxAmount: 100000,
      baseFee: 6640,
      baseThreshold: 0,
      incrementStep: 0,
      incrementFee: 0,
      description: 'R100,000 or less: Fixed R6,640'
    },
    {
      id: 'b2-2025',
      minAmount: 100001,
      maxAmount: 500000,
      baseFee: 6640,
      baseThreshold: 100000,
      incrementStep: 50000,
      incrementFee: 1060,
      description: 'Over R100,000 to R500,000: R6,640 + R1,060 per R50,000 (or part thereof) above R100,000'
    },
    {
      id: 'b3-2025',
      minAmount: 500001,
      maxAmount: 1000000,
      baseFee: 15120,
      baseThreshold: 500000,
      incrementStep: 100000,
      incrementFee: 2050,
      description: 'Over R500,000 to R1,000,000: R15,120 + R2,050 per R100,000 (or part thereof) above R500,000'
    },
    {
      id: 'b4-2025',
      minAmount: 1000001,
      maxAmount: 5000000,
      baseFee: 25370,
      baseThreshold: 1000000,
      incrementStep: 200000,
      incrementFee: 2050,
      description: 'Over R1,000,000 to R5,000,000: R25,370 + R2,050 per R200,000 (or part thereof) above R1,000,000'
    },
    {
      id: 'b5-2025',
      minAmount: 5000001,
      maxAmount: null,
      baseFee: 66370,
      baseThreshold: 5000000,
      incrementStep: 1000000,
      incrementFee: 5160,
      description: 'Over R5,000,000: R66,370 + R5,160 per R1,000,000 (or part thereof) above R5,000,000'
    }
  ]
}

export const ALL_PRESET_TARIFFS: TariffSchedule[] = [
  LSSA_TARIFF_2026_2027,
  LSSA_TARIFF_2025_2026
]

// -------------------------------------------------------------------------
// Deeds Office Schedule (Government Gazette / deeds.gov.za)
// -------------------------------------------------------------------------

export const DEEDS_OFFICE_LODGEMENT_FEE_PER_DEED = 52 // Item 1(a) R52.00 per deed

export const DEEDS_OFFICE_TRANSFER_SCHEDULE: { maxAmount: number; fee: number }[] = [
  { maxAmount: 100000, fee: 55 },
  { maxAmount: 200000, fee: 116 },
  { maxAmount: 300000, fee: 667 },
  { maxAmount: 600000, fee: 836 },
  { maxAmount: 800000, fee: 1211 },
  { maxAmount: 1000000, fee: 1385 },
  { maxAmount: 2000000, fee: 1675 },
  { maxAmount: 4000000, fee: 2096 },
  { maxAmount: 6000000, fee: 2940 },
  { maxAmount: 8000000, fee: 3767 },
  { maxAmount: 10000000, fee: 4611 },
  { maxAmount: 15000000, fee: 5862 },
  { maxAmount: 20000000, fee: 7025 },
  { maxAmount: Infinity, fee: 8390 }
]

export const DEEDS_OFFICE_BOND_SCHEDULE: { maxAmount: number; fee: number }[] = [
  { maxAmount: 150000, fee: 520 },
  { maxAmount: 300000, fee: 667 },
  { maxAmount: 600000, fee: 836 },
  { maxAmount: 800000, fee: 1211 },
  { maxAmount: 1000000, fee: 1385 },
  { maxAmount: 2000000, fee: 1675 },
  { maxAmount: 4000000, fee: 2096 },
  { maxAmount: 6000000, fee: 2940 },
  { maxAmount: 8000000, fee: 3767 },
  { maxAmount: 10000000, fee: 4611 },
  { maxAmount: 15000000, fee: 5862 },
  { maxAmount: 20000000, fee: 7025 },
  { maxAmount: Infinity, fee: 8390 }
]

export const ADHOC_DEEDS_OFFICE_FEES: DeedsOfficeStatutoryFee[] = [
  { id: 'deeds-adhoc-1', code: 'ITEM_1_E', name: 'Lost Title Deed VA Application (Reg 68(1))', category: 'adhoc', fee: 580, description: 'Application for certified copy of lost title deed' },
  { id: 'deeds-adhoc-2', code: 'ITEM_1_F', name: 'Certificate of Consolidated Title', category: 'adhoc', fee: 667, description: 'Consolidation of properties' },
  { id: 'deeds-adhoc-3', code: 'ITEM_1_G', name: 'Certificate of Registered Title', category: 'adhoc', fee: 667, description: 'Issuing of registered title certificate' },
  { id: 'deeds-adhoc-4', code: 'ITEM_1_H', name: 'Section 45 Endorsement', category: 'adhoc', fee: 420, description: 'Matrimonial/Estate endorsement' },
  { id: 'deeds-adhoc-5', code: 'ITEM_1_I', name: 'Expropriation Endorsement', category: 'adhoc', fee: 340, description: 'Endorsement of expropriation' },
  { id: 'deeds-adhoc-6', code: 'ITEM_1_J', name: 'Deed of Cession / Notarial Agreement', category: 'adhoc', fee: 520, description: 'Registration of notarial cession' }
]

// -------------------------------------------------------------------------
// Customary Default Disbursements
// -------------------------------------------------------------------------

export const DEFAULT_FIRM_DISBURSEMENTS: DisbursementItem[] = [
  {
    id: 'disb-fica',
    code: 'FICA',
    name: 'FICA Verification Fee',
    amount: 450,
    isVatApplicable: true,
    isCustomary: true,
    category: 'compliance',
    description: 'Statutory FICA compliance & identity verification check'
  },
  {
    id: 'disb-post-petty',
    code: 'POST_PETTY',
    name: 'Postages and Petties',
    amount: 850,
    isVatApplicable: true,
    isCustomary: true,
    category: 'admin',
    description: 'Postage, couriers, telecommunications and petties'
  },
  {
    id: 'disb-doc-gen',
    code: 'DOC_GEN',
    name: 'Electronic Document Generation Fee',
    amount: 650,
    isVatApplicable: true,
    isCustomary: true,
    category: 'admin',
    description: 'Software platform & electronic document preparation fee'
  },
  {
    id: 'disb-deeds-search',
    code: 'DEEDS_SEARCH',
    name: 'Deeds Office Search Fee',
    amount: 250,
    isVatApplicable: true,
    isCustomary: true,
    category: 'statutory',
    description: 'Electronic search at the Deeds Registry (attorney search fee)'
  },
  {
    id: 'disb-rates-cert',
    code: 'RATES_CERT',
    name: 'Rates Clearance Certificate & Figures Fee',
    amount: 1150,
    isVatApplicable: false,
    isCustomary: true,
    category: 'rates',
    description: 'Municipal application & certificate issuing fee'
  },
  {
    id: 'disb-hoa-consent',
    code: 'HOA_CONSENT',
    name: 'HOA / Body Corporate Consent Fee',
    amount: 950,
    isVatApplicable: false,
    isCustomary: false,
    category: 'compliance',
    description: 'Homeowners Association or Managing Agent consent fee'
  }
]

export const DEFAULT_FIRM_SETTINGS: FirmAccountSettings = {
  firmName: 'Kruger Incorporated Attorneys',
  registrationNumber: '2019/123456/21',
  isVatRegistered: true,
  vatNumber: '4120987654',
  vatRate: 0.15,
  activeTariffScheduleId: 'lssa-2026-2027',
  tariffMultiplier: 1.0,
  trustAccount: {
    bankName: 'Standard Bank',
    accountName: 'Kruger Inc Trust Account',
    accountNumber: '0123456789',
    branchCode: '051001',
    accountType: 'Trust Cheque Account',
    referencePrefix: 'TRF'
  },
  defaultDisbursements: DEFAULT_FIRM_DISBURSEMENTS,
  defaultLodgementDeedsCount: 1
}

// -------------------------------------------------------------------------
// Core Calculation Functions
// -------------------------------------------------------------------------

/**
 * Calculate attorney conveyancing professional fee on sliding scale
 */
export function calculateConveyancingFee(
  propertyValue: number,
  tariffSchedule: TariffSchedule = LSSA_TARIFF_2026_2027,
  multiplier: number = 1.0
): {
  feeExclVat: number
  bracketUsed: TariffBracket | null
  calculationExplanation: string
} {
  const value = Math.max(0, propertyValue || 0)
  if (value === 0) {
    return { feeExclVat: 0, bracketUsed: null, calculationExplanation: 'Property value is R0' }
  }

  // Find corresponding bracket
  const bracket = tariffSchedule.brackets.find(b => {
    if (b.maxAmount === null) {
      return value >= b.minAmount
    }
    return value >= b.minAmount && value <= b.maxAmount
  }) || tariffSchedule.brackets[tariffSchedule.brackets.length - 1]

  let rawFee = bracket.baseFee

  if (bracket.incrementStep > 0 && bracket.incrementFee > 0 && value > bracket.baseThreshold) {
    const excess = value - bracket.baseThreshold
    const steps = Math.ceil(excess / bracket.incrementStep)
    rawFee += steps * bracket.incrementFee
  }

  const finalFee = Math.round(rawFee * (multiplier || 1.0))

  const explanation = bracket.incrementStep > 0
    ? `${bracket.description || 'Bracket'}: Base R${bracket.baseFee.toLocaleString()} + R${bracket.incrementFee.toLocaleString()} per R${bracket.incrementStep.toLocaleString()} above R${bracket.baseThreshold.toLocaleString()}`
    : `Fixed fee: R${bracket.baseFee.toLocaleString()}`

  return {
    feeExclVat: finalFee,
    bracketUsed: bracket,
    calculationExplanation: explanation
  }
}

/**
 * Calculate SARS Transfer Duty (Official South African Revenue Service tax rates)
 */
export function calculateTransferDuty(
  propertyValue: number,
  isVatTransaction: boolean = false
): {
  transferDuty: number
  rateDescription: string
  isExempt: boolean
  bracketTier: string
} {
  if (isVatTransaction) {
    return {
      transferDuty: 0,
      rateDescription: 'Exempt (VAT inclusive developer transaction)',
      isExempt: true,
      bracketTier: 'VAT Transaction'
    }
  }

  const value = Math.max(0, propertyValue || 0)

  if (value <= 1100000) {
    return {
      transferDuty: 0,
      rateDescription: '0% (Exempt up to R1,100,000)',
      isExempt: true,
      bracketTier: 'R0 – R1,100,000'
    }
  } else if (value <= 1512500) {
    const duty = Math.round((value - 1100000) * 0.03)
    return {
      transferDuty: duty,
      rateDescription: '3% of the value above R1,100,000',
      isExempt: false,
      bracketTier: 'R1,100,001 – R1,512,500'
    }
  } else if (value <= 2117500) {
    const duty = Math.round(12375 + (value - 1512500) * 0.06)
    return {
      transferDuty: duty,
      rateDescription: 'R12,375 + 6% of the value above R1,512,500',
      isExempt: false,
      bracketTier: 'R1,512,501 – R2,117,500'
    }
  } else if (value <= 2722500) {
    const duty = Math.round(48675 + (value - 2117500) * 0.08)
    return {
      transferDuty: duty,
      rateDescription: 'R48,675 + 8% of the value above R2,117,500',
      isExempt: false,
      bracketTier: 'R2,117,501 – R2,722,500'
    }
  } else if (value <= 12100000) {
    const duty = Math.round(97075 + (value - 2722500) * 0.11)
    return {
      transferDuty: duty,
      rateDescription: 'R97,075 + 11% of the value above R2,722,500',
      isExempt: false,
      bracketTier: 'R2,722,501 – R12,100,000'
    }
  } else {
    const duty = Math.round(1128600 + (value - 12100000) * 0.13)
    return {
      transferDuty: duty,
      rateDescription: 'R1,128,600 + 13% of the value above R12,100,000',
      isExempt: false,
      bracketTier: 'R12,100,001 and above'
    }
  }
}

/**
 * Calculate Deeds Office Registration Fees
 */
export function calculateDeedsOfficeFee(
  amount: number,
  type: 'transfer' | 'bond' | 'notarial' = 'transfer',
  deedsCount: number = 1,
  adhocFees: DeedsOfficeStatutoryFee[] = []
): {
  item1bTransferFee: number
  item1cLodgementFee: number
  adhocTotal: number
  totalDeedsOfficeFees: number
  explanation: string
} {
  const value = Math.max(0, amount || 0)
  const schedule = type === 'bond' ? DEEDS_OFFICE_BOND_SCHEDULE : DEEDS_OFFICE_TRANSFER_SCHEDULE

  let itemFee = 55
  for (const tier of schedule) {
    if (value <= tier.maxAmount) {
      itemFee = tier.fee
      break
    }
  }

  const lodgementFee = Math.max(0, deedsCount || 1) * DEEDS_OFFICE_LODGEMENT_FEE_PER_DEED
  const adhocTotal = adhocFees.reduce((sum, item) => sum + (item.fee || 0), 0)
  const total = itemFee + lodgementFee + adhocTotal

  return {
    item1bTransferFee: itemFee,
    item1cLodgementFee: lodgementFee,
    adhocTotal,
    totalDeedsOfficeFees: total,
    explanation: `Registration Fee: R${itemFee.toLocaleString()} + Lodgement (${deedsCount} deed${deedsCount > 1 ? 's' : ''} @ R52): R${lodgementFee.toLocaleString()}${adhocTotal > 0 ? ` + Ad-hoc: R${adhocTotal.toLocaleString()}` : ''}`
  }
}

/**
 * Calculate Full Transfer Account Statement
 */
export interface ProformaStatementData {
  id?: string
  transferId?: string
  matterReference?: string
  date: string
  statementType: 'buyer' | 'seller' | 'combined'
  propertyAddress: string
  erfNumber?: string
  purchasePrice: number
  depositAmount: number
  loanAmount: number
  isVatTransaction: boolean
  lodgementDeedsCount: number
  
  // Attorney Fees
  conveyancingFeeExclVat: number
  conveyancingFeeVat: number
  conveyancingFeeInclVat: number
  
  // Transfer Duty (SARS)
  transferDuty: number
  transferDutyDescription: string
  
  // Deeds Office
  deedsOfficeRegistrationFee: number
  deedsOfficeLodgementFee: number
  deedsOfficeAdhocFees: DeedsOfficeStatutoryFee[]
  deedsOfficeTotal: number
  
  // Disbursements
  disbursements: DisbursementItem[]
  disbursementsExclVat: number
  disbursementsVat: number
  disbursementsInclVat: number
  
  // Bond (if applicable)
  bondAttorneyFeeExclVat?: number
  bondAttorneyFeeVat?: number
  bondDeedsOfficeFee?: number
  
  // Totals & Balances
  subtotalExclVat: number
  totalVat: number
  totalCosts: number
  credits: AccountCredit[]
  totalCredits: number
  balanceDue: number
  
  // Notes & Payment Instructions
  notes?: string
  status: 'draft' | 'issued' | 'settled' | 'cancelled'
}

export function generateProformaStatement(params: {
  transferId?: string
  propertyAddress: string
  erfNumber?: string
  purchasePrice: number
  depositAmount?: number
  loanAmount?: number
  isVatTransaction?: boolean
  lodgementDeedsCount?: number
  customConveyancingFee?: number
  tariffSchedule?: TariffSchedule
  tariffMultiplier?: number
  firmSettings?: FirmAccountSettings
  customDisbursements?: DisbursementItem[]
  adhocDeedsFees?: DeedsOfficeStatutoryFee[]
  credits?: AccountCredit[]
  statementType?: 'buyer' | 'seller' | 'combined'
}): ProformaStatementData {
  const settings = params.firmSettings || DEFAULT_FIRM_SETTINGS
  const tariff = params.tariffSchedule || LSSA_TARIFF_2026_2027
  const multiplier = params.tariffMultiplier ?? settings.tariffMultiplier ?? 1.0
  const vatRate = settings.isVatRegistered ? settings.vatRate || 0.15 : 0
  const deedsCount = params.lodgementDeedsCount ?? settings.defaultLodgementDeedsCount ?? 1
  const isVatTx = Boolean(params.isVatTransaction)
  const price = params.purchasePrice || 0
  const deposit = params.depositAmount || 0
  const loan = params.loanAmount || 0

  // 1. Conveyancing Fee
  const convResult = params.customConveyancingFee !== undefined
    ? { feeExclVat: params.customConveyancingFee }
    : calculateConveyancingFee(price, tariff, multiplier)
  
  const conveyancingFeeExclVat = convResult.feeExclVat
  const conveyancingFeeVat = Math.round(conveyancingFeeExclVat * vatRate)
  const conveyancingFeeInclVat = conveyancingFeeExclVat + conveyancingFeeVat

  // 2. Transfer Duty
  const tdResult = calculateTransferDuty(price, isVatTx)
  const transferDuty = tdResult.transferDuty
  const transferDutyDescription = tdResult.rateDescription

  // 3. Deeds Office Fees
  const deedsResult = calculateDeedsOfficeFee(price, 'transfer', deedsCount, params.adhocDeedsFees || [])
  const deedsOfficeRegistrationFee = deedsResult.item1bTransferFee
  const deedsOfficeLodgementFee = deedsResult.item1cLodgementFee
  const deedsOfficeTotal = deedsResult.totalDeedsOfficeFees

  // 4. Disbursements
  const disbursements = params.customDisbursements || settings.defaultDisbursements || DEFAULT_FIRM_DISBURSEMENTS
  let disbursementsExclVat = 0
  let disbursementsVat = 0

  disbursements.forEach(item => {
    const amt = item.amount || 0
    disbursementsExclVat += amt
    if (item.isVatApplicable && settings.isVatRegistered) {
      disbursementsVat += Math.round(amt * vatRate)
    }
  })
  const disbursementsInclVat = disbursementsExclVat + disbursementsVat

  // 5. Credits
  const credits = params.credits || (deposit > 0 ? [
    {
      id: 'cred-1',
      name: 'Deposit Received from Purchaser',
      amount: deposit,
      source: 'buyer_deposit'
    }
  ] : [])
  const totalCredits = credits.reduce((sum, c) => sum + (c.amount || 0), 0)

  // 6. Overall Totals
  const subtotalExclVat = conveyancingFeeExclVat + transferDuty + deedsOfficeTotal + disbursementsExclVat
  const totalVat = conveyancingFeeVat + disbursementsVat
  const totalCosts = conveyancingFeeInclVat + transferDuty + deedsOfficeTotal + disbursementsInclVat
  const balanceDue = totalCosts - totalCredits

  return {
    id: `PF-${Date.now().toString(36).toUpperCase()}`,
    transferId: params.transferId,
    matterReference: params.transferId || 'MAT-2026-TRF',
    date: new Date().toISOString(),
    statementType: params.statementType || 'buyer',
    propertyAddress: params.propertyAddress,
    erfNumber: params.erfNumber,
    purchasePrice: price,
    depositAmount: deposit,
    loanAmount: loan,
    isVatTransaction: isVatTx,
    lodgementDeedsCount: deedsCount,
    
    conveyancingFeeExclVat,
    conveyancingFeeVat,
    conveyancingFeeInclVat,
    
    transferDuty,
    transferDutyDescription,
    
    deedsOfficeRegistrationFee,
    deedsOfficeLodgementFee,
    deedsOfficeAdhocFees: params.adhocDeedsFees || [],
    deedsOfficeTotal,
    
    disbursements,
    disbursementsExclVat,
    disbursementsVat,
    disbursementsInclVat,
    
    subtotalExclVat,
    totalVat,
    totalCosts,
    credits,
    totalCredits,
    balanceDue,
    
    status: 'draft'
  }
}

/**
 * Currency Formatter for South African Rands
 */
export function formatZAR(amount: number | string | null | undefined): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || '0')) || 0
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num)
}
