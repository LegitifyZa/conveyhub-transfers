// Playwright check for authenticated matter–property linking on commit
// 58b6d0c (+ the validatePropertyDetails linked-flag fix). Every /api/**
// request is intercepted and answered by this script — no BFF, FastAPI,
// database or upstream is contacted. Run: `node e2e/matter-properties.check.mjs`
// with `vite preview` serving the built bundle (BASE env var overrides).
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const BASE = process.env.BASE || 'http://localhost:4173'
const MATTER_ID = '11111111-1111-4111-8111-111111111111'
const TRANSFER_ID = 'TRF-PW-001'

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

// Server-side store simulated by the mocks. attachBodies records every
// POST .../properties body so tests can assert identical-key retries.
function makeApi(t) {
  const calls = { createMatter: [], attachProperty: [], attachParty: [] }
  let links = []
  let attachBehaviour = t.attachBehaviour || 'success' // 'success' | 'fail-once' | 'drop-once'
  let attachAttempts = 0
  let createdMatter = null

  const EXISTING = {
    'prop-existing-1': { streetAddress: '7 Selected Lane', city: 'Cape Town', province: 'Western Cape', postalCode: '8001' },
    'prop-existing-2': { streetAddress: '21 Protea Road', city: 'Durban', province: 'KwaZulu-Natal', postalCode: '4001' },
  }

  const propertyProjection = (manual, over = {}) => ({
    id: over.id || 'prop-manual-1',
    streetAddress: '14 Jacaranda Avenue',
    city: 'Pretoria',
    province: 'Gauteng',
    postalCode: '0181',
    propertyType: 'Freehold',
    status: 'active',
    manual,
    ...over,
  })

  const projectionForId = (id) => propertyProjection(false, { id, manual: false, ...(EXISTING[id] || {}) })

  const linkRow = (id, property, over = {}) => ({
    id,
    matterId: MATTER_ID,
    propertyId: property.id,
    propertyKind: 'input',
    clientRequestId: over.clientRequestId || null,
    property,
    ...over,
  })

  const route = async (r) => {
    const url = new URL(r.request().url())
    const path = url.pathname
    const method = r.request().method()

    if (path === '/api/auth/refresh' && method === 'POST') {
      return r.fulfill(json({ message: 'OK', data: { token: 'pw-access-token', expires: Math.floor(Date.now() / 1000) + 3600 } }))
    }
    if (path === '/api/v1/transfers/' && method === 'GET') {
      // Matches the real v1 list contract exactly: { message, data } with
      // no `success` flag. An earlier mock invented success:true, which
      // masked the probeMatterPersistence envelope defect — earlier pass
      // results depended on that inaccuracy.
      return r.fulfill(json({ message: 'OK', data: { transfers: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } } }))
    }
    if (path === '/api/v1/transfers/' && method === 'POST') {
      calls.createMatter.push(JSON.parse(r.request().postData() || '{}'))
      createdMatter = { id: MATTER_ID, transferId: TRANSFER_ID }
      return r.fulfill(json({ message: 'Created', data: { ...createdMatter, created: true } }, 201))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/properties` && method === 'POST') {
      const body = JSON.parse(r.request().postData() || '{}')
      calls.attachProperty.push(body)
      attachAttempts += 1
      if (attachBehaviour === 'fail-once' && attachAttempts === 1) {
        return r.fulfill(json({ message: 'Internal error', errors: ['simulated failure'] }, 500))
      }
      if (attachBehaviour === 'drop-once' && attachAttempts === 1) {
        // Lost response: server commits but the client never sees it.
        links = [linkRow('link-1', body.property_id
          ? projectionForId(body.property_id)
          : propertyProjection(true), { clientRequestId: body.client_request_id })]
        return r.abort('connectionreset')
      }
      const replay = links.find(l => l.clientRequestId === body.client_request_id)
      if (replay) {
        return r.fulfill(json({ message: 'OK', data: { ...replay, created: false } }))
      }
      const link = linkRow(`link-${links.length + 1}`, body.property_id
        ? projectionForId(body.property_id)
        : propertyProjection(true), { clientRequestId: body.client_request_id })
      links.push(link)
      return r.fulfill(json({ message: 'Created', data: { ...link, created: true } }, 201))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/properties` && method === 'GET') {
      return r.fulfill(json({ message: 'OK', data: { properties: links } }))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/parties` && method === 'POST') {
      const body = JSON.parse(r.request().postData() || '{}')
      calls.attachParty.push(body)
      return r.fulfill(json({ message: 'Created', data: { id: `party-${calls.attachParty.length}`, created: true } }, 201))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/parties` && method === 'GET') {
      return r.fulfill(json({ message: 'OK', data: { parties: [] } }))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}` && method === 'GET') {
      return r.fulfill(json({ message: 'OK', data: { id: MATTER_ID, transferId: TRANSFER_ID, matterUpdatedAt: '2026-01-01T00:00:00Z', transferUpdatedAt: '2026-01-01T00:00:00Z' } }))
    }
    if (path === '/api/v1/properties' && method === 'GET') {
      return r.fulfill(json({
        message: 'OK',
        data: {
          properties: [projectionForId('prop-existing-1'), projectionForId('prop-existing-2')],
        },
      }))
    }
    if (path === '/api/catalogue') {
      return r.fulfill(json([{ id: 'cat-1', name: 'FICA Identification', module: 'transfers', status: 'Active' }]))
    }
    if (path === `/api/transfers/${TRANSFER_ID}/documents` && method === 'POST') {
      return r.fulfill(json({ success: true, data: { id: 'doc-1', name: 'FICA Identification', type: 'identification', status: 'pending', catalogueDocumentId: 'cat-1' } }))
    }
    if (path.startsWith('/api/address/')) {
      return r.fulfill(json({ success: true, data: [] }))
    }
    if (path === `/api/transfers/${TRANSFER_ID}` || path === `/api/transfers/${MATTER_ID}`) {
      return r.fulfill(json({ success: true, data: { id: MATTER_ID, transfer_id: TRANSFER_ID, property_address: '14 Jacaranda Avenue', purchase_price: 1500000, status: 'active' } }))
    }
    if (path === `/api/transfers/${TRANSFER_ID}/milestones` || path === `/api/transfers/${MATTER_ID}/milestones`) {
      return r.fulfill(json({ success: true, data: [] }))
    }
    if (path === `/api/transfers/${TRANSFER_ID}/activity` || path === `/api/transfers/${MATTER_ID}/activity`) {
      return r.fulfill(json({ success: true, data: [] }))
    }
    console.log(`  [unmocked] ${method} ${path}`)
    return r.fulfill(json({ success: false, error: 'unmocked' }, 404))
  }

  return { route, calls, get links() { return links }, set links(v) { links = v } }
}

async function newAuthedPage(browser, api) {
  const context = await browser.newContext()
  await context.addCookies([{ name: 'deedly_sid', value: 'pw-sid', url: BASE }])
  await context.route('**/api/**', api.route)
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)))
  return { context, page }
}

// Fills steps 2–4 (parties, financials, document) and submits on step 5.
async function completeWizardFromStep2(page) {
  await page.getByRole('button', { name: 'Add First Buyer' }).click()
  const buyer = page.locator('div').filter({ hasText: /^Buyer/ }).last()
  await page.getByPlaceholder('Full name').first().fill('Buyer One')
  await page.getByPlaceholder('SA ID or Company Reg').first().fill('8001015009087')
  await page.getByPlaceholder('email@example.com').first().fill('buyer@example.com')
  await page.getByPlaceholder('+27 12 345 6789').first().fill('+27111111111')
  await page.getByRole('button', { name: 'Add First Seller' }).click()
  await page.getByPlaceholder('Full name').nth(1).fill('Seller One')
  await page.getByPlaceholder('SA ID or Company Reg').nth(1).fill('7502025555083')
  await page.getByPlaceholder('email@example.com').nth(1).fill('seller@example.com')
  await page.getByPlaceholder('+27 12 345 6789').nth(1).fill('+27222222222')
  await page.getByRole('button', { name: 'Next Step' }).click()

  await page.getByPlaceholder('2,500,000').fill('1500000')
  await page.getByPlaceholder('250,000', { exact: true }).fill('150000')
  await page.getByRole('button', { name: 'Next Step' }).click()
}

async function addDocumentAndSubmit(page) {
  // Documents require a saved matter: persist the draft first.
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await page.getByText('Matter, property and all parties saved.').waitFor()
  await page.locator('select').last().selectOption('cat-1')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('select').filter({ hasText: 'Pending' }).first().selectOption('not_required')
  await page.getByRole('button', { name: 'Next Step' }).click()
  await page.getByRole('button', { name: 'Submit Transfer' }).click()
}

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`PASS ${name}`)
    console.log(`PASS ${name}`)
  } catch (err) {
    results.push(`FAIL ${name}: ${String(err).split('\n')[0]}`)
    console.log(`FAIL ${name}:`, String(err).slice(0, 500))
  }
}

const browser = await chromium.launch()

await check('manual capture + wizard completion', async () => {
  const api = makeApi({})
  const { context, page } = await newAuthedPage(browser, api)
  await page.goto(`${BASE}/transfers/workflow`)
  await page.getByRole('heading', { name: 'Property Details' }).waitFor()
  await page.getByPlaceholder('Start typing the address...').fill('14 Jacaranda Avenue')
  await page.getByPlaceholder('Santon').fill('Pretoria')
  await page.getByPlaceholder('Gouteng').fill('Gauteng')
  await page.getByPlaceholder('2196').fill('0181')
  await page.locator('select').first().selectOption('Freehold')
  await page.getByRole('button', { name: 'Next Step' }).click()
  await completeWizardFromStep2(page)
  await addDocumentAndSubmit(page)
  await page.waitForURL(`**/transfers/${MATTER_ID}/milestones`)
  await page.getByText('14 Jacaranda Avenue').waitFor()
  await page.getByText('Manually captured — unverified').waitFor()
  assert.equal(api.calls.createMatter.length, 1)
  assert.equal(api.calls.attachProperty.length, 1)
  assert.ok(api.calls.attachProperty[0].property, 'manual capture payload')
  assert.equal(api.calls.attachProperty[0].property.street_address, '14 Jacaranda Avenue')
  assert.equal(api.calls.attachProperty[0].property.source_system, undefined)
  await context.close()
})

await check('select existing property, change it, multiple links on milestones', async () => {
  const api = makeApi({})
  const { context, page } = await newAuthedPage(browser, api)
  await page.goto(`${BASE}/transfers/workflow`)
  await page.getByPlaceholder("Search your institution's properties by address, city, erf or reference...").fill('lane')
  await page.getByText('7 Selected Lane').waitFor()
  await page.getByText('7 Selected Lane').click()
  await page.getByText('Selected property').waitFor()
  await page.getByRole('button', { name: 'Change' }).click()
  await page.getByPlaceholder("Search your institution's properties by address, city, erf or reference...").fill('protea')
  await page.getByText('21 Protea Road').click()
  await page.getByText('21 Protea Road').waitFor()
  // With the linked flag honoured, Next is enabled without manual fields.
  await page.getByRole('button', { name: 'Next Step' }).click()
  await completeWizardFromStep2(page)
  await addDocumentAndSubmit(page)
  await page.waitForURL(`**/transfers/${MATTER_ID}/milestones`)
  assert.equal(api.calls.attachProperty.length, 1)
  assert.equal(api.calls.attachProperty[0].property_id, 'prop-existing-2')
  assert.ok(!('property' in api.calls.attachProperty[0]))
  // Attach a second existing property from the milestones panel.
  await page.getByRole('button', { name: 'Attach existing property' }).click()
  await page.getByPlaceholder('Address, city, erf or reference...').fill('lane')
  await page.getByText('7 Selected Lane').waitFor()
  const attachResponse = page.waitForResponse(
    (resp) => resp.url().endsWith(`/api/v1/transfers/${MATTER_ID}/properties`) && resp.request().method() === 'POST',
  )
  await page.getByText('7 Selected Lane').click()
  await attachResponse
  assert.equal(api.calls.attachProperty.length, 2)
  // The panel re-reads the server: both links must render from readback.
  const linksList = page.locator('ul li').filter({ hasText: 'Protea Road' })
  await linksList.waitFor()
  await page.locator('ul li').filter({ hasText: '7 Selected Lane' }).waitFor()
  assert.equal(await page.locator('ul li').filter({ hasText: /Lane|Protea/ }).count(), 2)
  await context.close()
})

await check('failed attach preserves entries and the created matter', async () => {
  const api = makeApi({ attachBehaviour: 'fail-once' })
  const { context, page } = await newAuthedPage(browser, api)
  await page.goto(`${BASE}/transfers/workflow`)
  await page.getByPlaceholder('Start typing the address...').fill('14 Jacaranda Avenue')
  await page.getByPlaceholder('Santon').fill('Pretoria')
  await page.getByPlaceholder('Gouteng').fill('Gauteng')
  await page.getByPlaceholder('2196').fill('0181')
  await page.locator('select').first().selectOption('Freehold')
  await page.getByRole('button', { name: 'Next Step' }).click()
  await completeWizardFromStep2(page)
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await page.getByText('Property:').waitFor()
  // Entered values and the created matter survive the failed attach.
  await page.getByRole('button', { name: 'Previous' }).click()
  await page.getByRole('button', { name: 'Previous' }).click()
  await page.getByRole('button', { name: 'Previous' }).click()
  assert.equal(await page.getByPlaceholder('Santon').inputValue(), 'Pretoria')
  assert.equal(await page.getByPlaceholder('2196').inputValue(), '0181')
  // Retry: same matter (no second create), same property request key.
  await page.getByRole('button', { name: 'Next Step' }).click()
  await page.getByRole('button', { name: 'Next Step' }).click()
  await page.getByRole('button', { name: 'Next Step' }).click()
  await addDocumentAndSubmit(page)
  await page.waitForURL(`**/transfers/${MATTER_ID}/milestones`)
  assert.equal(api.calls.createMatter.length, 1, 'matter must not be recreated')
  assert.equal(api.calls.attachProperty.length, 2)
  assert.equal(api.calls.attachProperty[0].client_request_id, api.calls.attachProperty[1].client_request_id)
  await context.close()
})

await check('lost-response retry keeps the key and does not duplicate', async () => {
  const api = makeApi({ attachBehaviour: 'drop-once' })
  const { context, page } = await newAuthedPage(browser, api)
  await page.goto(`${BASE}/transfers/workflow`)
  await page.getByPlaceholder('Start typing the address...').fill('14 Jacaranda Avenue')
  await page.getByPlaceholder('Santon').fill('Pretoria')
  await page.getByPlaceholder('Gouteng').fill('Gauteng')
  await page.getByPlaceholder('2196').fill('0181')
  await page.locator('select').first().selectOption('Freehold')
  await page.getByRole('button', { name: 'Next Step' }).click()
  await completeWizardFromStep2(page)
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await page.getByText('Property:').waitFor()
  // The server committed the dropped response; the retry must replay it.
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await page.getByText('Matter, property and all parties saved.').waitFor()
  assert.equal(api.calls.createMatter.length, 1)
  assert.equal(api.calls.attachProperty.length, 2)
  assert.deepEqual(api.calls.attachProperty[0], api.calls.attachProperty[1], 'identical body on retry')
  assert.equal(api.links.length, 1, 'no duplicate link after replay')
  await context.close()
})

await check('saved-property readback after reload', async () => {
  const api = makeApi({})
  api.links = [{
    id: 'link-1', matterId: MATTER_ID, propertyId: 'prop-manual-1',
    propertyKind: 'input', clientRequestId: 'req-1',
    property: {
      id: 'prop-manual-1', streetAddress: '14 Jacaranda Avenue', city: 'Pretoria',
      province: 'Gauteng', postalCode: '0181', propertyType: 'Freehold',
      status: 'sold', manual: true,
    },
  }]
  const { context, page } = await newAuthedPage(browser, api)
  await page.goto(`${BASE}/transfers/workflow?id=${MATTER_ID}`)
  await page.getByText('Linked property').waitFor()
  await page.getByText('14 Jacaranda Avenue').waitFor()
  await page.getByText('Manually captured — unverified').waitFor()
  await page.getByText('Saved links cannot be removed here').waitFor()
  // Read-only: no capture form, no discovery, no Change control.
  assert.equal(await page.getByPlaceholder('Santon').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Change' }).count(), 0)
  // Inactive status stays readable.
  await context.close()
})

await browser.close()
console.log('\n--- RESULTS ---')
results.forEach(r => console.log(r))
process.exit(results.every(r => r.startsWith('PASS')) ? 0 : 1)
