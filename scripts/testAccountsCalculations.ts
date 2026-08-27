import assert from 'assert'
import {
  calculateConveyancingFee,
  calculateTransferDuty,
  calculateDeedsOfficeFee,
  evaluateDisbursements,
  generateProformaStatement,
  formatZAR,
  LSSA_TARIFF_2026_2027,
  LSSA_TARIFF_2025_2026,
  STANDARD_DEFAULT_DISBURSEMENTS
} from '../src/utils/conveyancingAccounts'

console.log('=== RUNNING CONVEYANCING ACCOUNTS & STATUTORY CALCULATION ENGINE TESTS ===\n')

// ---------------------------------------------------------------------------
// TEST 1: LSSA Conveyancing Fee Sliding Scale & Continuous Boundaries
// ---------------------------------------------------------------------------
console.log('--- TEST 1: LSSA 2026/2027 Tariff Sliding Scale & Continuous Boundaries ---')

// 1.1 R100k exactly
const res100k = calculateConveyancingFee(100000, LSSA_TARIFF_2026_2027)
assert.strictEqual(res100k.feeExclVat, 4700, 'Fee for R100k should be R4,700')
console.log('✓ R100,000 fee:', formatZAR(res100k.feeExclVat))

// 1.2 Decimal boundary test: R100,000.50 (Finding 4: must not gap)
const res100kDec = calculateConveyancingFee(100000.50, LSSA_TARIFF_2026_2027)
assert.strictEqual(res100kDec.feeExclVat, 5500, 'Fee for R100,000.50 should step up to R5,500 (R4,700 + R800)')
console.log('✓ R100,000.50 (decimal boundary) fee:', formatZAR(res100kDec.feeExclVat))

// 1.3 R500k exactly
const res500k = calculateConveyancingFee(500000, LSSA_TARIFF_2026_2027)
assert.strictEqual(res500k.feeExclVat, 11100, 'Fee for R500k should be R11,100 (4700 + 8*800)')
console.log('✓ R500,000 fee:', formatZAR(res500k.feeExclVat))

// 1.4 Decimal boundary test: R500,000.01
const res500kDec = calculateConveyancingFee(500000.01, LSSA_TARIFF_2026_2027)
assert.strictEqual(res500kDec.feeExclVat, 12300, 'Fee for R500,000.01 should step up to R12,300 (11100 + 1200)')
console.log('✓ R500,000.01 (decimal boundary) fee:', formatZAR(res500kDec.feeExclVat))

// 1.5 R1M exactly
const res1M = calculateConveyancingFee(1000000, LSSA_TARIFF_2026_2027)
assert.strictEqual(res1M.feeExclVat, 17100, 'Fee for R1M should be R17,100 (11100 + 5*1200)')
console.log('✓ R1,000,000 fee:', formatZAR(res1M.feeExclVat))

// 1.6 R2.5M
const res2_5M = calculateConveyancingFee(2500000, LSSA_TARIFF_2026_2027)
assert.strictEqual(res2_5M.feeExclVat, 29900, 'Fee for R2.5M should be R29,900 (17100 + 8*1600)')
console.log('✓ R2,500,000 fee:', formatZAR(res2_5M.feeExclVat))

// 1.7 R3.5M
const res3_5M = calculateConveyancingFee(3500000, LSSA_TARIFF_2026_2027)
assert.strictEqual(res3_5M.feeExclVat, 37900, 'Fee for R3.5M should be R37,900 (17100 + 13*1600)')
console.log('✓ R3,500,000 fee:', formatZAR(res3_5M.feeExclVat))

// 1.8 R5M
const res5M = calculateConveyancingFee(5000000, LSSA_TARIFF_2026_2027)
assert.strictEqual(res5M.feeExclVat, 49100, 'Fee for R5M should be R49,100 (17100 + 20*1600)')
console.log('✓ R5,000,000 fee:', formatZAR(res5M.feeExclVat))

// 1.9 Multiplier test (1.10x firm multiplier)
const resMult = calculateConveyancingFee(2500000, LSSA_TARIFF_2026_2027, 1.10)
assert.strictEqual(resMult.feeExclVat, 32890, 'Fee for R2.5M with 1.1x multiplier should be R32,890')
console.log('✓ R2,500,000 with 1.10x multiplier:', formatZAR(resMult.feeExclVat))

// ---------------------------------------------------------------------------
// TEST 2: Official SARS Transfer Duty Statutory Schedule
// ---------------------------------------------------------------------------
console.log('\n--- TEST 2: Official SARS Transfer Duty Rates ---')

// 2.1 Under exemption (R1M)
const td1M = calculateTransferDuty(1000000)
assert.strictEqual(td1M.transferDuty, 0, 'Transfer duty for R1M should be R0 (exempt)')
assert.strictEqual(td1M.isExempt, true)
console.log('✓ R1,000,000 Transfer Duty:', formatZAR(td1M.transferDuty), `(${td1M.rateDescription})`)

// 2.2 At exemption threshold (R1.1M)
const td1_1M = calculateTransferDuty(1100000)
assert.strictEqual(td1_1M.transferDuty, 0, 'Transfer duty for R1.1M should be R0')
console.log('✓ R1,100,000 Transfer Duty:', formatZAR(td1_1M.transferDuty))

// 2.3 Tier 2 (R1.5M => 3% on amount above R1.1M = R12,000)
const td1_5M = calculateTransferDuty(1500000)
assert.strictEqual(td1_5M.transferDuty, 12000, 'Transfer duty for R1.5M should be R12,000 (400,000 * 3%)')
console.log('✓ R1,500,000 Transfer Duty:', formatZAR(td1_5M.transferDuty))

// 2.4 Tier 3 (R2.0M => R12,375 + 6% of (2M - 1,512,500) = R12,375 + R29,250 = R41,625)
const td2M = calculateTransferDuty(2000000)
assert.strictEqual(td2M.transferDuty, 41625, 'Transfer duty for R2.0M should be R41,625')
console.log('✓ R2,000,000 Transfer Duty:', formatZAR(td2M.transferDuty))

// 2.5 Tier 4 (R2.5M => R48,675 + 8% of (2.5M - 2,117,500) = R48,675 + R30,600 = R79,275)
const td2_5M = calculateTransferDuty(2500000)
assert.strictEqual(td2_5M.transferDuty, 79275, 'Transfer duty for R2.5M should be R79,275')
console.log('✓ R2,500,000 Transfer Duty:', formatZAR(td2_5M.transferDuty))

// 2.6 Tier 5 (R3.5M => R97,075 + 11% of (3.5M - 2,722,500) = R97,075 + R85,525 = R182,600)
const td3_5M = calculateTransferDuty(3500000)
assert.strictEqual(td3_5M.transferDuty, 182600, 'Transfer duty for R3.5M should be R182,600')
console.log('✓ R3,500,000 Transfer Duty:', formatZAR(td3_5M.transferDuty))

// 2.7 Developer Sale / VAT Transaction Exemption (Finding 18)
const tdDev = calculateTransferDuty(3500000, true)
assert.strictEqual(tdDev.transferDuty, 0, 'Transfer duty for developer sale should be R0')
assert.strictEqual(tdDev.isExempt, true)
console.log('✓ R3,500,000 Developer Sale (VAT transaction):', formatZAR(tdDev.transferDuty), `(${tdDev.rateDescription})`)

// ---------------------------------------------------------------------------
// TEST 3: Deeds Office Statutory Schedules & Neutral Branching
// ---------------------------------------------------------------------------
console.log('\n--- TEST 3: Deeds Office Fees (Items 1(a), 1(b), 1(c), 1(d)) ---')

// 3.1 Item 1(b) Transfer on R2.5M
const deedsTransfer = calculateDeedsOfficeFee(2500000, 'transfer', 1)
assert.strictEqual(deedsTransfer.statutoryScheduleItem, 'Item 1(b)')
assert.strictEqual(deedsTransfer.statutoryRegistrationFee, 2096, 'Item 1(b) registration for R2.5M should be R2,096')
assert.strictEqual(deedsTransfer.statutoryLodgementFee, 52, 'Item 1(a) lodgement should be R52')
assert.strictEqual(deedsTransfer.totalDeedsOfficeFees, 2148, 'Total transfer deeds fee should be R2,148')
console.log('✓ Transfer Deeds Fee (R2.5M, 1 deed):', formatZAR(deedsTransfer.totalDeedsOfficeFees))

// 3.2 Multi-deed lodgement (3 deeds)
const deedsMulti = calculateDeedsOfficeFee(2500000, 'transfer', 3)
assert.strictEqual(deedsMulti.statutoryLodgementFee, 156, '3 deeds lodgement should be R156 (3 * R52)')
assert.strictEqual(deedsMulti.totalDeedsOfficeFees, 2252, 'Total for 3 deeds should be R2,252 (2096 + 156)')
console.log('✓ Transfer Deeds Fee (R2.5M, 3 deeds):', formatZAR(deedsMulti.totalDeedsOfficeFees))

// 3.3 Item 1(c) Bond on R2.0M
const deedsBond = calculateDeedsOfficeFee(2000000, 'bond', 1)
assert.strictEqual(deedsBond.statutoryScheduleItem, 'Item 1(c)')
assert.strictEqual(deedsBond.statutoryRegistrationFee, 1675, 'Item 1(c) bond fee for R2.0M should be R1,675')
assert.strictEqual(deedsBond.totalDeedsOfficeFees, 1727, 'Total bond deeds fee should be R1,727 (1675 + 52)')
console.log('✓ Bond Deeds Fee (R2.0M, Item 1(c)):', formatZAR(deedsBond.totalDeedsOfficeFees))

// 3.4 Item 1(d) Notarial Bond on R2.0M (Finding 5)
const deedsNotarial = calculateDeedsOfficeFee(2000000, 'notarial', 1)
assert.strictEqual(deedsNotarial.statutoryScheduleItem, 'Item 1(d)')
assert.strictEqual(deedsNotarial.statutoryRegistrationFee, 1675, 'Item 1(d) notarial fee for R2.0M should be R1,675')
assert.strictEqual(deedsNotarial.totalDeedsOfficeFees, 1727, 'Total notarial deeds fee should be R1,727 (1675 + 52)')
console.log('✓ Notarial Bond Deeds Fee (R2.0M, Item 1(d)):', formatZAR(deedsNotarial.totalDeedsOfficeFees))

// ---------------------------------------------------------------------------
// TEST 4: Configurable Disbursements & Conditional Application Rules
// ---------------------------------------------------------------------------
console.log('\n--- TEST 4: Disbursements & Matter Triggers (Golden Record, HOA) ---')

// 4.1 Standard transfer without Golden Record
const disbStandard = evaluateDisbursements({
  disbursements: STANDARD_DEFAULT_DISBURSEMENTS,
  firmIsVatRegistered: true,
  vatRate: 0.15,
  context: {
    isBondMatter: false,
    propertyType: 'Freehold',
    hasGoldenRecordEntity: false
  }
})
const hasGoldenInStandard = disbStandard.appliedLines.some(l => l.code === 'GOLDEN_RECORD_SEARCH')
assert.strictEqual(hasGoldenInStandard, false, 'Golden Record fee should NOT apply when no entity is linked')
const hasHoaInStandard = disbStandard.appliedLines.some(l => l.code === 'HOA_CONSENT')
assert.strictEqual(hasHoaInStandard, false, 'HOA consent fee should NOT apply to Freehold property')
console.log('✓ Freehold transfer disbursements (excl Golden Record/HOA):', formatZAR(disbStandard.totalInclVat))

// 4.2 Sectional Title with Golden Record linked (Finding 16 & 17)
const disbSectionalGolden = evaluateDisbursements({
  disbursements: STANDARD_DEFAULT_DISBURSEMENTS,
  firmIsVatRegistered: true,
  vatRate: 0.15,
  context: {
    isBondMatter: false,
    propertyType: 'Sectional Title',
    hasGoldenRecordEntity: true
  }
})
const hasGoldenInSec = disbSectionalGolden.appliedLines.some(l => l.code === 'GOLDEN_RECORD_SEARCH')
assert.strictEqual(hasGoldenInSec, true, 'Golden Record fee MUST apply when entity is linked')
const hasHoaInSec = disbSectionalGolden.appliedLines.some(l => l.code === 'HOA_CONSENT')
assert.strictEqual(hasHoaInSec, true, 'HOA consent fee MUST apply to Sectional Title property')
console.log('✓ Sectional Title + Golden Record disbursements:', formatZAR(disbSectionalGolden.totalInclVat))

// ---------------------------------------------------------------------------
// TEST 5: Complete Proforma Statement Generation & Provenance
// ---------------------------------------------------------------------------
console.log('\n--- TEST 5: Proforma Statement Full Generation & Provenance ---')
const statement = generateProformaStatement({
  transferId: 'c2e8a1d0-1234-4567-89ab-cdef01234567',
  matterReference: 'TRF-2026-001',
  propertyAddress: '12 Victoria Road, Clifton, Cape Town',
  erfNumber: 'Erf 1092',
  propertyType: 'Sectional Title',
  purchasePrice: 4000000,
  depositAmount: 400000,
  loanAmount: 2500000,
  isVatTransaction: false,
  hasGoldenRecordEntity: true
})

assert.strictEqual(statement.conveyancingFeeExclVat, 41100, 'Conv fee for R4M should be R41,100 (17100 + 15*1600)')
assert.strictEqual(statement.conveyancingFeeVat, 6165, 'Conv fee VAT (15%) should be R6,165')
assert.strictEqual(statement.transferDuty, 237600, 'Transfer duty for R4M should be R237,600 (97075 + 11% of 1,277,500)')
assert.strictEqual(statement.deedsOfficeTotal, 2148, 'Deeds office total for R4M should be R2,148 (2096 + 52)')
assert.strictEqual(statement.totalCredits, 400000, 'Credits should be R400,000')
assert.strictEqual(statement.provenance.tariffScheduleId, 'lssa-2026-2027')
assert.strictEqual(statement.provenance.isVatTransaction, false)

console.log('✓ Statement Matter Reference:', statement.matterReference)
console.log('✓ Conveyancing Fee (incl VAT):', formatZAR(statement.conveyancingFeeInclVat))
console.log('✓ Transfer Duty:', formatZAR(statement.transferDuty))
console.log('✓ Deeds Office Total:', formatZAR(statement.deedsOfficeTotal))
console.log('✓ Total Costs:', formatZAR(statement.totalCosts))
console.log('✓ Total Credits:', formatZAR(statement.totalCredits))
console.log('✓ Net Balance Due:', formatZAR(statement.balanceDue))
console.log('✓ Provenance Recorded:', JSON.stringify(statement.provenance))

console.log('\n🎉 ALL 25 STATUTORY, TARIFF, BOUNDARY, AND DISBURSEMENT TESTS PASSED WITH 100% EXACT ASSERTIONS!')
