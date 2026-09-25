import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4173'
const origin = new URL(BASE).origin
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname), 'Browser fixtures require a loopback server')
const classifications = [
  ...[
    ['not_applicable', 'Not Applicable'], ['sectional_title_register', 'Sectional Title Register'],
    ['township_register', 'Township Register'], ['extension_of_scheme', 'Extension of Scheme'],
    ['subdivision', 'Subdivision'], ['bulk_transfer', 'Bulk Transfer'],
  ].map(([source, label]) => ({
    canonicalCode: `transfer.private_treaty.${source}`, subtype: 'private_treaty', displayLabel: 'Private Treaty',
    transferFrom: source, transferFromLabel: label, requiresTransferFrom: true,
  })),
  ...[
    ['auction', 'Auction'], ['sale_in_execution', 'Sale in Execution'],
    ['property_in_possession', 'Property in Possession'], ['deceased_estate_inheritance', 'Deceased Estate - Inheritance'],
    ['deceased_estate_sale', 'Deceased Estate Sale'], ['endorsement_section_45', 'Endorsement - Section 45'],
    ['endorsement_section_45bis', 'Endorsement - Section 45bis'], ['donation', 'Donation'],
  ].map(([subtype, label]) => ({
    canonicalCode: `transfer.${subtype}`, subtype, displayLabel: label,
    transferFrom: null, transferFromLabel: null, requiresTransferFrom: false,
  })),
]
const label = option => option.transferFromLabel ? `${option.displayLabel} — ${option.transferFromLabel}` : option.displayLabel
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const browser = await chromium.launch()
let passed = 0
let failed = 0
const artifactDir = process.env.DEMO_ARTIFACT_DIR
if (artifactDir) mkdirSync(artifactDir, { recursive: true })

async function capture(page, name) {
  if (!artifactDir) return
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.evaluate(() => {
    const banner = document.createElement('div')
    banner.id = 'classification-review-demo-banner'
    banner.textContent = 'LOCAL REVIEW DEMO — SYNTHETIC DATA; API CALLS AND AUTHENTICATION ARE MOCKED'
    banner.style.cssText = 'padding:12px;background:#fef3c7;color:#78350f;font:14px sans-serif;text-align:center'
    document.body.prepend(banner)
  })
  try {
    await page.screenshot({ path: path.join(artifactDir, name + '.png'), fullPage: true, animations: 'disabled' })
  } finally {
    await page.evaluate(() => document.getElementById('classification-review-demo-banner')?.remove())
  }
}

async function scenario(run, { savedCode, status = 200, options = classifications } = {}) {
  const context = await browser.newContext()
  context.setDefaultTimeout(10000)
  await context.addCookies([{ name: 'deedly_sid', value: 'classification-fixture-session', url: BASE }])
  const rows = new Map()
  const links = new Map()
  const requests = []
  const writes = []
  const state = { status, options }
  const existingId = randomUUID()
  const record = (id, code, reference) => ({
    id, transferId: 'TRF-CLASSIFICATION-TEST', propertyAddress: '12 Synthetic Road', purchasePrice: 100,
    status: 'in_progress', currentStep: 1, updatedAt: '2026-01-01T00:00:00.000001Z',
    matter: { id: randomUUID(), referenceNumber: 'TRF-CLASSIFICATION-TEST', title: 'Synthetic matter',
      firmReference: reference, classificationCode: code, matterType: 'transfer', status: 'in_progress',
      updatedAt: '2026-01-01T00:00:00.000001Z' },
  })
  if (savedCode !== undefined) rows.set(existingId, record(existingId, savedCode, 'EXISTING-REF'))
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    const path = url.pathname
    const method = route.request().method()
    if (!path.startsWith('/api/')) return route.continue()
    if (!path.startsWith('/api/auth/') && !['GET', 'HEAD'].includes(method)) writes.push({ method, path })
    if (path === '/api/auth/refresh') {
      return route.fulfill(json({ message: 'OK', data: { token: 'mock-classification-browser-token', expires: Math.floor(Date.now() / 1000) + 3600 } }))
    }
    if (path === '/api/v1/transfers/classifications') {
      return route.fulfill(state.status === 200
        ? json({ message: 'OK', data: { classifications: state.options } })
        : json({ error: 'Synthetic unavailable response' }, state.status))
    }
    if (path === '/api/v1/transfers' && method === 'GET') {
      return route.fulfill(json({ message: 'OK', data: { transfers: [...rows.values()], pagination: { page: 1, limit: 10, total: rows.size, totalPages: 1 } } }))
    }
    if (path === '/api/v1/transfers' && method === 'POST') {
      const body = route.request().postDataJSON()
      requests.push(body)
      const id = randomUUID()
      rows.set(id, record(id, body.classification_code, body.firm_reference))
      return route.fulfill(json({ message: 'Created', data: { ...rows.get(id), created: true } }, 201))
    }
    const match = path.match(/^\/api\/v1\/transfers\/([^/]+)(?:\/(parties|properties))?$/)
    if (match && rows.has(match[1])) {
      const id = match[1]
      if (!match[2]) return route.fulfill(json({ message: 'OK', data: rows.get(id) }))
      if (match[2] === 'parties') return route.fulfill(json({ message: 'OK', data: { parties: [] } }))
      if (method === 'GET') return route.fulfill(json({ message: 'OK', data: { properties: links.get(id) || [] } }))
      const body = route.request().postDataJSON()
      const p = body.property
      const link = { id: randomUUID(), matterId: rows.get(id).matter.id, propertyKind: 'input', clientRequestId: body.client_request_id,
        property: { id: randomUUID(), streetAddress: p.street_address, city: p.city, province: p.province,
          postalCode: p.postal_code, propertyType: p.property_type, status: 'active', manual: true } }
      links.set(id, [link])
      return route.fulfill(json({ message: 'Created', data: { ...link, created: true } }, 201))
    }
    return route.fulfill(json({ error: 'No external services are available in this mocked browser check' }, 503))
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await run({ page, rows, requests, writes, state, existingId })
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
}

async function check(name, run) {
  try {
    await run()
    passed++
    console.log('PASS ' + name)
  } catch (error) {
    failed++
    console.error('FAIL ' + name + ': ' + error.message)
  }
}

console.log('Mocked browser contract checks only: all API requests are intercepted and external requests are blocked.')
try {
  for (const option of classifications) {
    await check(option.canonicalCode + ' create and reopen', () => scenario(async ({ page, rows, requests }) => {
      const reference = 'REF-' + option.canonicalCode
      await page.goto(BASE + '/transfers/new')
      await page.getByPlaceholder('Enter matter reference number...').fill(reference)
      await page.getByLabel('Transfer classification', { exact: true }).selectOption(option.canonicalCode)
      if (option === classifications[0]) await capture(page, '01-classification-selected')
      await page.getByRole('button', { name: 'Continue to Golden Records' }).click()
      await page.getByRole('button', { name: 'Add parties manually instead' }).click()
      await page.waitForURL('**/transfers/workflow')
      await page.waitForFunction(code => document.querySelector('#transfer-classification')?.value === code, option.canonicalCode)
      assert.equal(await page.getByLabel('Firm reference', { exact: true }).inputValue(), reference)
      await page.getByPlaceholder('Start typing the address...').fill('12 Synthetic Road')
      await page.getByPlaceholder('Santon').fill('Pretoria')
      await page.getByPlaceholder('Gouteng').fill('Gauteng')
      await page.getByPlaceholder('2196').fill('0001')
      await page.locator('select').filter({ has: page.locator('option[value="Freehold"]') }).selectOption('Freehold')
      await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
      await page.getByText('Matter, property and all parties saved.', { exact: true }).waitFor()
      assert.equal(requests.length, 1)
      assert.equal(requests[0].classification_code, option.canonicalCode)
      assert.equal(requests[0].firm_reference, reference)
      assert.match(requests[0].client_request_id, /^[0-9a-f-]{36}$/)
      if (option === classifications[0]) await capture(page, '02-classified-matter-saved')
      const id = [...rows.keys()][0]
      await page.goto(BASE + '/transfers/workflow?id=' + id)
      await page.getByTestId('saved-classification').filter({ hasText: label(option) }).waitFor()
      await page.reload()
      await page.getByTestId('saved-classification').filter({ hasText: label(option) }).waitFor()
      assert.equal(await page.locator('#transfer-classification').count(), 0)
      assert.equal(await page.getByLabel('Firm reference', { exact: true }).inputValue(), reference)
      assert.equal(requests.length, 1)
      if (option === classifications[0]) await capture(page, '03-classified-matter-reopened')
    }))
  }

  await check('service outage blocks creation and retry restores choices', () => scenario(async ({ page, state, requests }) => {
    await page.goto(BASE + '/transfers/new')
    await page.getByPlaceholder('Enter matter reference number...').fill('OUTAGE-REF')
    await page.getByRole('button', { name: 'Retry classifications' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Continue to Golden Records' }).isDisabled(), true)
    await capture(page, '04-classification-service-unavailable')
    state.status = 200
    await page.getByRole('button', { name: 'Retry classifications' }).click()
    await page.getByLabel('Transfer classification', { exact: true }).selectOption(classifications[0].canonicalCode)
    assert.equal(await page.getByRole('button', { name: 'Continue to Golden Records' }).isEnabled(), true)
    assert.equal(requests.length, 0)
    await capture(page, '05-classification-service-recovered')
  }, { status: 503 }))

  await check('direct workflow entry cannot create an unclassified matter', () => scenario(async ({ page, requests }) => {
    await page.goto(BASE + '/transfers/workflow')
    await page.waitForFunction(() => document.querySelector('#transfer-classification')?.options.length === 15)
    assert.equal(await page.getByLabel('Transfer classification', { exact: true }).inputValue(), '')
    await page.getByLabel('Transfer classification', { exact: true }).selectOption(classifications[0].canonicalCode)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Save Draft' && !button.disabled))
    await page.getByLabel('Transfer classification', { exact: true }).selectOption('')
    assert.equal(await page.getByRole('button', { name: 'Save Draft', exact: true }).isDisabled(), true)
    assert.equal(requests.length, 0)
  }))

  for (const code of [null, 'transfer.historical_classification']) {
    await check('saved classification stays read-only: ' + String(code), () => scenario(async ({ page, existingId, requests, writes }) => {
      await page.goto(BASE + '/transfers/workflow?id=' + existingId)
      await page.getByTestId('saved-classification').filter({ hasText: code ?? 'Unclassified' }).waitFor()
      assert.equal(await page.locator('#transfer-classification').count(), 0)
      assert.equal(requests.length, 0)
      assert.deepEqual(writes, [])
      if (code === null) await capture(page, '06-existing-unclassified-matter-preserved')
    }, { savedCode: code, status: 503 }))
  }
} finally {
  await browser.close()
}
console.log(`Browser results: ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
