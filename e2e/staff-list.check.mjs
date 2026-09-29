import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const BASE = process.env.BASE || 'http://127.0.0.1:4173'
const origin = new URL(BASE).origin
assert.ok(['localhost', '127.0.0.1'].includes(new URL(BASE).hostname), 'Use a loopback static build')
const fixtures = Array.from({ length: 25 }, (_, index) => ({
  id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
  transferId: `SYNTHETIC-${index + 1}`, propertyAddress: `Synthetic Road ${index + 1}`,
  purchasePrice: 100, status: index < 12 ? 'complete' : 'in_progress',
  currentStep: 1, totalSteps: 5, progress: 0,
}))
const statusTotals = { total: 25, inProgress: 13, completed: 12 }
const browser = await chromium.launch()
let passed = 0
let failed = 0

async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  context.setDefaultTimeout(8000)
  const requests = []
  const errors = []
  const state = { unavailable: false, omitTotals: false, held: null }
  await context.addCookies([{ name: 'deedly_sid', value: 'synthetic-staff-list-sid', url: BASE }])
  const json = body => ({ contentType: 'application/json', body: JSON.stringify(body) })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/refresh') {
      return route.fulfill(json({ message: 'OK', data: {
        principalKey: 'a'.repeat(64), token: 'synthetic-staff-list-browser-token', expires: Math.floor(Date.now() / 1000) + 3600,
      } }))
    }
    if (url.pathname === '/api/v1/transfers' && route.request().method() === 'GET') {
      requests.push(url.searchParams)
      const status = url.searchParams.get('status')
      const page = Number(url.searchParams.get('page') || 1)
      const rows = fixtures.filter(row => !status || row.status === status)
      const response = json({ message: 'OK', data: {
        transfers: rows.slice((page - 1) * 10, page * 10),
        pagination: { page, limit: 10, total: rows.length, totalPages: Math.ceil(rows.length / 10) },
        ...(!state.omitTotals ? { statusTotals } : {}),
      } })
      if (state.held && status === 'complete') {
        state.held.release = () => route.fulfill(response)
        state.held.ready()
        return
      }
      return route.fulfill(state.unavailable ? { ...json({ error: 'Synthetic outage' }), status: 503 } : response)
    }
    return route.fulfill({ ...json({ error: 'No backend is available in this mocked check' }), status: 503 })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await run({ page, state, requests })
    assert.deepEqual(errors, [])
    passed++
    console.log('PASS ' + name)
  } catch (error) {
    failed++
    console.error('FAIL ' + name + ': ' + error.message)
  } finally {
    await context.close()
  }
}

async function assertTotals(page, expected = ['25', '12', '13']) {
  const region = page.getByLabel('Institution-wide transfer totals')
  assert.deepEqual(await region.locator('p.text-2xl').allTextContents(), expected)
}

console.log('Synthetic browser checks only: API/auth intercepted, external requests blocked; no database or providers.')
try {
  await scenario('server filtering, pagination and institution-wide totals', async ({ page, requests }) => {
    await page.goto(BASE + '/transfers')
    await page.getByText('Page 1 of 3 · 25 matching transfers').waitFor()
    await assertTotals(page)
    await page.getByRole('button', { name: 'Next Page' }).click()
    await page.getByText('Page 2 of 3 · 25 matching transfers').waitFor()
    await assertTotals(page)
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await page.getByText('Page 1 of 2 · 12 matching transfers').waitFor()
    assert.equal(requests.at(-1).get('status'), 'complete')
    assert.equal(requests.at(-1).get('page'), '1')
    await page.getByRole('button', { name: 'Next Page' }).click()
    await page.getByText('Page 2 of 2 · 12 matching transfers').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Details', exact: true }).count(), 2)
    assert.equal(await page.getByRole('button', { name: 'Next Page' }).isDisabled(), true)
    await assertTotals(page)
    await page.getByPlaceholder('Search this page...').fill('no synthetic match')
    await page.getByText('No matches on this page. Try another page or adjust your search.').waitFor()
    await assertTotals(page)
    await page.getByPlaceholder('Search this page...').fill('')
    await page.getByRole('button', { name: 'In Progress', exact: true }).click()
    await page.getByText('Page 1 of 2 · 13 matching transfers').waitFor()
    assert.equal(requests.at(-1).get('status'), 'in_progress')
    await assertTotals(page)
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await page.getByText('Page 1 of 3 · 25 matching transfers').waitFor()
    assert.equal(requests.at(-1).has('status'), false)
    assert.equal(await page.getByRole('button', { name: 'Draft', exact: true }).count(), 0)
  })

  await scenario('failed and missing totals never become page-local counts', async ({ page, state }) => {
    await page.goto(BASE + '/transfers')
    await page.getByText('Page 1 of 3 · 25 matching transfers').waitFor()
    state.unavailable = true
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await page.getByText('Transfers are temporarily unavailable.', { exact: true }).waitFor()
    await assertTotals(page, ['—', '—', '—'])
    assert.equal(await page.getByRole('button', { name: 'Details', exact: true }).count(), 0)
    state.unavailable = false
    state.omitTotals = true
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await page.getByText('Page 1 of 3 · 25 matching transfers').waitFor()
    await assertTotals(page, ['—', '—', '—'])
  })

  await scenario('late filter responses cannot overwrite the selected list', async ({ page, state }) => {
    await page.goto(BASE + '/transfers')
    await page.getByText('Page 1 of 3 · 25 matching transfers').waitFor()
    const ready = new Promise(resolve => { state.held = { ready: resolve, release: null } })
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await ready
    await assertTotals(page, ['—', '—', '—'])
    await page.getByRole('button', { name: 'In Progress', exact: true }).click()
    await page.getByText('Page 1 of 2 · 13 matching transfers').waitFor()
    const finished = page.waitForResponse(response => new URL(response.url()).searchParams.get('status') === 'complete')
    await state.held.release()
    await finished
    await page.waitForTimeout(100)
    await page.getByText('Page 1 of 2 · 13 matching transfers').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Overview', exact: true }).count(), 10)
    await assertTotals(page)
  })

  await scenario('pilot navigation is pruned without removing hidden routes', async ({ page }) => {
    await page.goto(BASE + '/transfers')
    await page.getByText('Page 1 of 3 · 25 matching transfers').waitFor()
    assert.deepEqual(await page.locator('aside nav a').evaluateAll(links => links.map(link => link.getAttribute('href'))), ['/transfers', '/settings'])
    await page.goto(BASE + '/bonds')
    await page.getByRole('heading', { name: /bond/i }).first().waitFor()
    await page.goto(BASE + '/accounts')
    await page.getByRole('alert').filter({ hasText: 'Accounts are unavailable pending authenticated institution access.' }).waitFor()
  })
} finally {
  await browser.close()
}
console.log(`Staff-list browser results: ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
