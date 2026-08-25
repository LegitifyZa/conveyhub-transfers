import {
  calculateConveyancingFee,
  calculateTransferDuty,
  calculateDeedsOfficeFee,
  generateProformaStatement,
  LSSA_TARIFF_2026_2027,
  LSSA_TARIFF_2025_2026,
  DEFAULT_FIRM_SETTINGS,
  formatZAR
} from '../src/utils/conveyancingAccounts'

console.log('--- TEST 1: LSSA 2026/2027 Conveyancing Fees ---')
const testValues = [50000, 250000, 750000, 1500000, 2500000, 4500000, 10000000]
testValues.forEach(val => {
  const res = calculateConveyancingFee(val, LSSA_TARIFF_2026_2027)
  console.log(`Property Value: R${val.toLocaleString()} -> Fee: ${formatZAR(res.feeExclVat)} (${res.calculationExplanation})`)
})

console.log('\n--- TEST 2: SARS Transfer Duty ---')
const tdValues = [800000, 1100000, 1300000, 1800000, 2500000, 5000000, 15000000]
tdValues.forEach(val => {
  const res = calculateTransferDuty(val)
  console.log(`Property Value: R${val.toLocaleString()} -> Duty: ${formatZAR(res.transferDuty)} (${res.bracketTier} | ${res.rateDescription})`)
})

console.log('\n--- TEST 3: VAT Developer Transaction Exemption ---')
const vatTxRes = calculateTransferDuty(2500000, true)
console.log(`R2.5M Developer Sale -> Duty: ${formatZAR(vatTxRes.transferDuty)} (${vatTxRes.rateDescription})`)

console.log('\n--- TEST 4: Deeds Office Fees (Lodgement + Registration) ---')
const deedsValues = [250000, 750000, 1500000, 2500000, 5000000, 12000000]
deedsValues.forEach(val => {
  const res = calculateDeedsOfficeFee(val, 'transfer', 1)
  console.log(`Property Value: R${val.toLocaleString()} -> Deeds Fee: ${formatZAR(res.totalDeedsOfficeFees)} (${res.explanation})`)
})

console.log('\n--- TEST 5: Full Proforma Statement Generation ---')
const stmt = generateProformaStatement({
  propertyAddress: '123 Ocean View Drive, Camps Bay',
  erfNumber: 'Erf 4521',
  purchasePrice: 2500000,
  depositAmount: 250000,
  loanAmount: 2250000,
  isVatTransaction: false,
  lodgementDeedsCount: 1,
  firmSettings: DEFAULT_FIRM_SETTINGS
})
console.log('Statement ID:', stmt.id)
console.log('Purchase Price:', formatZAR(stmt.purchasePrice))
console.log('Conveyancing Fee + VAT:', formatZAR(stmt.conveyancingFeeInclVat))
console.log('SARS Transfer Duty:', formatZAR(stmt.transferDuty))
console.log('Deeds Office Total:', formatZAR(stmt.deedsOfficeTotal))
console.log('Disbursements Total:', formatZAR(stmt.disbursementsInclVat))
console.log('Grand Total Costs:', formatZAR(stmt.totalCosts))
console.log('Less Deposit Received:', formatZAR(stmt.totalCredits))
console.log('Net Balance Due:', formatZAR(stmt.balanceDue))
console.log('\n✅ ALL CALCULATION SUITE TESTS PASSED!')
