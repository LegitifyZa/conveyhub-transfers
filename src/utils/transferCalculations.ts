// South African Transfer Cost Calculations
// Powered by the comprehensive LSSA & Deeds Office Statutory Calculation Engine

import {
  calculateConveyancingFee,
  calculateTransferDuty as calcTransferDuty,
  calculateDeedsOfficeFee as calcDeedsFee,
  formatZAR as formatCurrencyZAR,
  LSSA_TARIFF_2026_2027,
  DEFAULT_FIRM_SETTINGS
} from './conveyancingAccounts'

export interface SATransferCosts {
  transferDuty: number
  conveyancingFees: number
  deedsOfficeFees: number
  totalCosts: number
  breakdown: {
    transferDutyRate: number
    conveyancingFeeRate: number
    deedsOfficeFeeRate: number
  }
}

// Format currency as ZAR
export const formatZAR = formatCurrencyZAR

// South African Transfer Duty (Official SARS Graduated Rates)
export const calculateTransferDuty = (propertyValue: number, isVatTransaction = false): number => {
  return calcTransferDuty(propertyValue, isVatTransaction).transferDuty
}

// Conveyancing Fees (Law Society of South Africa Sliding Scale Guideline)
export const calculateConveyancingFees = (propertyValue: number): number => {
  return calculateConveyancingFee(propertyValue, LSSA_TARIFF_2026_2027).feeExclVat
}

// Deeds Office Statutory Fees (Item 1(a) Lodgement + Item 1(b) Registration)
export const calculateDeedsOfficeFees = (propertyValue: number, deedsCount = 1): number => {
  return calcDeedsFee(propertyValue, 'transfer', deedsCount).totalDeedsOfficeFees
}

// Calculate all statutory & professional transfer costs
export const calculateSATransferCosts = (propertyValue: number): SATransferCosts => {
  const transferDuty = calculateTransferDuty(propertyValue)
  const conveyancingFees = calculateConveyancingFees(propertyValue)
  const deedsOfficeFees = calculateDeedsOfficeFees(propertyValue)
  const totalCosts = transferDuty + conveyancingFees + deedsOfficeFees

  return {
    transferDuty,
    conveyancingFees,
    deedsOfficeFees,
    totalCosts,
    breakdown: {
      transferDutyRate: propertyValue > 0 ? (transferDuty / propertyValue) * 100 : 0,
      conveyancingFeeRate: propertyValue > 0 ? (conveyancingFees / propertyValue) * 100 : 0,
      deedsOfficeFeeRate: propertyValue > 0 ? (deedsOfficeFees / propertyValue) * 100 : 0
    }
  }
}

// Get transfer duty bracket description
export const getTransferDutyBracket = (propertyValue: number): {
  bracket: string
  rate: number
  description: string
} => {
  const res = calcTransferDuty(propertyValue)
  return {
    bracket: res.bracketTier,
    rate: propertyValue > 0 ? (res.transferDuty / propertyValue) * 100 : 0,
    description: res.rateDescription
  }
}

// Customary disbursements and VAT
export const getAdditionalCosts = (propertyValue: number, isVatRegistered = true): {
  vat: number
  postPetty: number
  clearanceCertificate: number
  ratesClearance: number
  ficaFee: number
  docGenFee: number
  deedsSearchFee: number
  totalAdditional: number
} => {
  const convFee = calculateConveyancingFees(propertyValue)
  const postPetty = 850
  const ficaFee = 450
  const docGenFee = 650
  const deedsSearchFee = 250
  const clearanceCertificate = 1150
  const ratesClearance = 2000

  // 15% VAT on VAT-bearing legal fees & administrative services
  const vatRate = isVatRegistered ? 0.15 : 0
  const vat = Math.round((convFee + postPetty + ficaFee + docGenFee + deedsSearchFee) * vatRate)
  const totalAdditional = vat + postPetty + ficaFee + docGenFee + deedsSearchFee + clearanceCertificate + ratesClearance

  return {
    vat,
    postPetty,
    clearanceCertificate,
    ratesClearance,
    ficaFee,
    docGenFee,
    deedsSearchFee,
    totalAdditional
  }
}

// Calculate total costs including disbursements and VAT
export const calculateTotalTransferCosts = (propertyValue: number): {
  transferCosts: SATransferCosts
  additionalCosts: ReturnType<typeof getAdditionalCosts>
  grandTotal: number
  effectiveRate: number
} => {
  const transferCosts = calculateSATransferCosts(propertyValue)
  const additionalCosts = getAdditionalCosts(propertyValue, DEFAULT_FIRM_SETTINGS.isVatRegistered)
  const grandTotal = transferCosts.totalCosts + additionalCosts.totalAdditional
  const effectiveRate = propertyValue > 0 ? (grandTotal / propertyValue) * 100 : 0

  return {
    transferCosts,
    additionalCosts,
    grandTotal,
    effectiveRate
  }
}
