// South African Transfer Cost Calculations

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
export const formatZAR = (amount: number): string => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

// South African Transfer Duty Brackets (2024 rates)
export const calculateTransferDuty = (propertyValue: number): number => {
  if (propertyValue <= 1000000) {
    return 0 // No transfer duty for properties ≤ R1,000,000
  } else if (propertyValue <= 1250000) {
    return (propertyValue - 1000000) * 0.03 // 3% on amount above R1,000,000
  } else if (propertyValue <= 1500000) {
    return 7500 + (propertyValue - 1250000) * 0.06 // R7,500 + 6% on amount above R1,250,000
  } else if (propertyValue <= 2000000) {
    return 22500 + (propertyValue - 1500000) * 0.08 // R22,500 + 8% on amount above R1,500,000
  } else if (propertyValue <= 2500000) {
    return 62500 + (propertyValue - 2000000) * 0.11 // R62,500 + 11% on amount above R2,000,000
  } else if (propertyValue <= 10000000) {
    return 117500 + (propertyValue - 2500000) * 0.13 // R117,500 + 13% on amount above R2,500,000
  } else {
    return 1092500 + (propertyValue - 10000000) * 0.18 // R1,092,500 + 18% on amount above R10,000,000
  }
}

// Conveyancing Fees (Guideline rates - may vary by attorney)
export const calculateConveyancingFees = (propertyValue: number): number => {
  // These are approximate guideline fees for standard conveyancing
  if (propertyValue <= 500000) {
    return 8000 // R8,000 for properties ≤ R500,000
  } else if (propertyValue <= 1000000) {
    return 12000 // R12,000 for properties ≤ R1,000,000
  } else if (propertyValue <= 2500000) {
    return 15000 // R15,000 for properties ≤ R2,500,000
  } else if (propertyValue <= 5000000) {
    return 20000 // R20,000 for properties ≤ R5,000,000
  } else if (propertyValue <= 10000000) {
    return 25000 // R25,000 for properties ≤ R10,000,000
  } else {
    // For properties above R10M, fees are typically negotiated
    // Using 0.25% as a rough estimate
    return propertyValue * 0.0025
  }
}

// Deeds Office Fees (2024 rates)
export const calculateDeedsOfficeFees = (propertyValue: number): number => {
  if (propertyValue <= 500000) {
    return 1500 // R1,500 for properties ≤ R500,000
  } else if (propertyValue <= 1000000) {
    return 3000 // R3,000 for properties ≤ R1,000,000
  } else if (propertyValue <= 2000000) {
    return 6000 // R6,000 for properties ≤ R2,000,000
  } else if (propertyValue <= 5000000) {
    return 12000 // R12,000 for properties ≤ R5,000,000
  } else if (propertyValue <= 10000000) {
    return 18000 // R18,000 for properties ≤ R10,000,000
  } else {
    return 24000 // R24,000 for properties > R10,000,000
  }
}

// Calculate all transfer costs
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

// Get transfer duty bracket information
export const getTransferDutyBracket = (propertyValue: number): {
  bracket: string
  rate: number
  description: string
} => {
  if (propertyValue <= 1000000) {
    return {
      bracket: '0 - R1,000,000',
      rate: 0,
      description: 'No transfer duty payable'
    }
  } else if (propertyValue <= 1250000) {
    return {
      bracket: 'R1,000,001 - R1,250,000',
      rate: 3,
      description: '3% on amount above R1,000,000'
    }
  } else if (propertyValue <= 1500000) {
    return {
      bracket: 'R1,250,001 - R1,500,000',
      rate: 6,
      description: 'R7,500 + 6% on amount above R1,250,000'
    }
  } else if (propertyValue <= 2000000) {
    return {
      bracket: 'R1,500,001 - R2,000,000',
      rate: 8,
      description: 'R22,500 + 8% on amount above R1,500,000'
    }
  } else if (propertyValue <= 2500000) {
    return {
      bracket: 'R2,000,001 - R2,500,000',
      rate: 11,
      description: 'R62,500 + 11% on amount above R2,000,000'
    }
  } else if (propertyValue <= 10000000) {
    return {
      bracket: 'R2,500,001 - R10,000,000',
      rate: 13,
      description: 'R117,500 + 13% on amount above R2,500,000'
    }
  } else {
    return {
      bracket: 'Above R10,000,000',
      rate: 18,
      description: 'R1,092,500 + 18% on amount above R10,000,000'
    }
  }
}

// Additional costs that might be applicable
export const getAdditionalCosts = (propertyValue: number): {
  vat: number
  postPetty: number
  clearanceCertificate: number
  ratesClearance: number
  totalAdditional: number
} => {
  // VAT on conveyancing fees (if applicable)
  const vat = calculateConveyancingFees(propertyValue) * 0.15 // 15% VAT
  
  // Post and Petties (estimated)
  const postPetty = 500
  
  // Rates Clearance Certificate (estimated)
  const clearanceCertificate = 1000
  
  // Rates Clearance (estimated)
  const ratesClearance = 2000
  
  const totalAdditional = vat + postPetty + clearanceCertificate + ratesClearance
  
  return {
    vat,
    postPetty,
    clearanceCertificate,
    ratesClearance,
    totalAdditional
  }
}

// Calculate total costs including additional fees
export const calculateTotalTransferCosts = (propertyValue: number): {
  transferCosts: SATransferCosts
  additionalCosts: ReturnType<typeof getAdditionalCosts>
  grandTotal: number
  effectiveRate: number
} => {
  const transferCosts = calculateSATransferCosts(propertyValue)
  const additionalCosts = getAdditionalCosts(propertyValue)
  const grandTotal = transferCosts.totalCosts + additionalCosts.totalAdditional
  const effectiveRate = propertyValue > 0 ? (grandTotal / propertyValue) * 100 : 0

  return {
    transferCosts,
    additionalCosts,
    grandTotal,
    effectiveRate
  }
}
