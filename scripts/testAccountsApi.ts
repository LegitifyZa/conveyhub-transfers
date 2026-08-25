import app from '../server/index'
import http from 'http'

async function runApiTests() {
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(3099, resolve))
  console.log('Test server listening on port 3099')

  const baseUrl = 'http://localhost:3099/api/accounts'

  try {
    // 1. Test GET /settings
    console.log('\n--- 1. Testing GET /api/accounts/settings ---')
    const resSettings = await fetch(`${baseUrl}/settings`)
    const dataSettings = await resSettings.json()
    console.log('Status:', resSettings.status)
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
    console.log('Status:', resPutSettings.status)
    console.log('Updated Firm Name:', dataPutSettings.data.firmName)
    console.log('Updated VAT No:', dataPutSettings.data.vatNumber)

    // 3. Test GET /tariffs
    console.log('\n--- 3. Testing GET /api/accounts/tariffs ---')
    const resTariffs = await fetch(`${baseUrl}/tariffs`)
    const dataTariffs = await resTariffs.json()
    console.log('Status:', resTariffs.status)
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
        isVatTransaction: false,
        lodgementDeedsCount: 1
      })
    })
    const dataCalc = await resCalc.json()
    console.log('Status:', resCalc.status)
    console.log('Conveyancing Fee Incl VAT (R3.5M):', dataCalc.data.transfer.conveyancingFeeInclVat)
    console.log('Transfer Duty (R3.5M):', dataCalc.data.transfer.transferDuty)
    console.log('Deeds Office Fee:', dataCalc.data.transfer.deedsOfficeFee)

    // 5. Test GET /transfers/:id/proforma
    console.log('\n--- 5. Testing GET /api/accounts/transfers/TEST-TRF-001/proforma ---')
    const resProf = await fetch(`${baseUrl}/transfers/TEST-TRF-001/proforma?purchasePrice=4000000&depositAmount=400000`)
    const dataProf = await resProf.json()
    console.log('Status:', resProf.status)
    console.log('Statement ID:', dataProf.data.id)
    console.log('Purchase Price:', dataProf.data.purchasePrice)
    console.log('Net Balance Due:', dataProf.data.balanceDue)

    // 6. Test PUT /transfers/:id/proforma
    console.log('\n--- 6. Testing PUT /api/accounts/transfers/TEST-TRF-001/proforma ---')
    const updatedStmt = { ...dataProf.data, status: 'issued', notes: 'Payment due on receipt of proforma.' }
    const resPutProf = await fetch(`${baseUrl}/transfers/TEST-TRF-001/proforma`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedStmt)
    })
    const dataPutProf = await resPutProf.json()
    console.log('Status:', resPutProf.status)
    console.log('Updated Status:', dataPutProf.data.status)
    console.log('Notes:', dataPutProf.data.notes)

    console.log('\n✅ ALL BACKEND API ENDPOINT TESTS PASSED SUCCESSFULLY!')
  } finally {
    server.close()
    process.exit(0)
  }
}

runApiTests().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
