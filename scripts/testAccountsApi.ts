import assert from 'assert'

async function runApiTests() {
  const baseUrl = 'http://localhost:3001/api/accounts'
  console.log(`Testing backend API at ${baseUrl}`)

  // 1. Test GET /settings
  console.log('\n--- 1. Testing GET /api/accounts/settings ---')
  const resSettings = await fetch(`${baseUrl}/settings`)
  const dataSettings = await resSettings.json()
  assert.strictEqual(resSettings.status, 200)
  assert.strictEqual(dataSettings.success, true)
  assert.ok(dataSettings.data.vatRate !== undefined)
  console.log('Status: 200 OK')
  console.log('Firm Name:', dataSettings.data.firmName)
  console.log('VAT Registered:', dataSettings.data.isVatRegistered, 'VAT No:', dataSettings.data.vatNumber)

  // 2. Test PUT /settings
  console.log('\n--- 2. Testing PUT /api/accounts/settings ---')
  const resPutSettings = await fetch(`${baseUrl}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firmName: 'Kruger & Partners Conveyancers',
      vatNumber: '4990123456'
    })
  })
  const dataPutSettings = await resPutSettings.json()
  assert.strictEqual(resPutSettings.status, 200)
  assert.strictEqual(dataPutSettings.data.firmName, 'Kruger & Partners Conveyancers')
  assert.strictEqual(dataPutSettings.data.vatNumber, '4990123456')
  console.log('Status: 200 OK')
  console.log('Updated Firm Name:', dataPutSettings.data.firmName)
  console.log('Updated VAT No:', dataPutSettings.data.vatNumber)

  // 3. Test GET /tariffs
  console.log('\n--- 3. Testing GET /api/accounts/tariffs ---')
  const resTariffs = await fetch(`${baseUrl}/tariffs`)
  const dataTariffs = await resTariffs.json()
  assert.strictEqual(resTariffs.status, 200)
  assert.ok(Array.isArray(dataTariffs.data))
  assert.ok(dataTariffs.data.length >= 2)
  console.log('Status: 200 OK')
  console.log('Found Tariffs Count:', dataTariffs.data.length)
  console.log('Tariff Names:', dataTariffs.data.map((t: any) => t.name))

  // 4. Test POST /calculate
  console.log('\n--- 4. Testing POST /api/accounts/calculate ---')
  const resCalc = await fetch(`${baseUrl}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purchasePrice: 3500000,
      bondAmount: 2800000,
      notarialAmount: 2000000,
      isVatTransaction: false,
      lodgementDeedsCount: 1
    })
  })
  const dataCalc = await resCalc.json()
  assert.strictEqual(resCalc.status, 200)
  assert.strictEqual(dataCalc.data.transfer.conveyancingFeeExclVat, 37900)
  assert.strictEqual(dataCalc.data.transfer.transferDuty, 182600)
  assert.strictEqual(dataCalc.data.transfer.deedsOfficeTotal, 2148)
  assert.strictEqual(dataCalc.data.notarial.statutoryScheduleItem, 'Item 1(d)')
  assert.strictEqual(dataCalc.data.notarial.statutoryRegistrationFee, 1675)
  console.log('Status: 200 OK')
  console.log('Conveyancing Fee Excl VAT (R3.5M):', dataCalc.data.transfer.conveyancingFeeExclVat)
  console.log('Transfer Duty (R3.5M):', dataCalc.data.transfer.transferDuty)
  console.log('Deeds Office Transfer Fee:', dataCalc.data.transfer.deedsOfficeTotal)
  console.log('Deeds Office Notarial Fee (Item 1(d)):', dataCalc.data.notarial.deedsOfficeNotarialFee)

  // 5. Test GET /transfers/:id/proforma
  console.log('\n--- 5. Testing GET /api/accounts/transfers/TEST-TRF-001/proforma ---')
  const resProf = await fetch(`${baseUrl}/transfers/TEST-TRF-001/proforma`)
  const dataProf = await resProf.json()
  assert.strictEqual(resProf.status, 200)
  assert.ok(dataProf.data.id)
  assert.ok(dataProf.data.provenance)
  assert.strictEqual(dataProf.data.provenance.tariffScheduleId, 'lssa-2026-2027')
  console.log('Status: 200 OK')
  console.log('Statement ID:', dataProf.data.id)
  console.log('Provenance Tariff:', dataProf.data.provenance.tariffName)

  // 6. Test PUT /transfers/:id/proforma
  console.log('\n--- 6. Testing PUT /api/accounts/transfers/TEST-TRF-001/proforma ---')
  const updatedStmt = { ...dataProf.data, status: 'issued', notes: 'Payment due on receipt of proforma.' }
  const resPutProf = await fetch(`${baseUrl}/transfers/TEST-TRF-001/proforma`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedStmt)
  })
  const dataPutProf = await resPutProf.json()
  assert.strictEqual(resPutProf.status, 200)
  assert.strictEqual(dataPutProf.data.status, 'issued')
  assert.strictEqual(dataPutProf.data.notes, 'Payment due on receipt of proforma.')
  console.log('Status: 200 OK')
  console.log('Updated Status:', dataPutProf.data.status)
  console.log('Notes:', dataPutProf.data.notes)

  console.log('\n✅ ALL BACKEND API ENDPOINT TESTS PASSED WITH EXACT ASSERTIONS ON PORT 3001!')
}

runApiTests().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
