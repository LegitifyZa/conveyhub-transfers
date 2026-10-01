import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.env.SESSION_TEST_BASE || 'http://127.0.0.1:4292'
const origin = new URL(BASE).origin
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname), 'Use a loopback Vite development server for module-level session tests')
const browser = await chromium.launch()
let passed = 0
let failed = 0
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(condition) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (condition()) return
    await pause(20)
  }
  assert.fail('Expected intercepted request did not arrive')
}
const json = body => ({ contentType: 'application/json', body: JSON.stringify(body) })
const key = name => (name === 'A' ? 'a' : 'b').repeat(64)
const response = name => json({ message: 'OK', data: {
  transfers: [{ id: '22222222-2222-4222-8222-222222222222', transferId: `PRIVATE-${name}`, propertyAddress: `Synthetic ${name} Road`, purchasePrice: 100, status: 'in_progress' }],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  statusTotals: { total: 1, inProgress: 1, completed: 0 },
} })

async function sessionModuleUrl(page, pathname = '/src/lib/api/session.ts') {
  const url = await page.evaluate(pathname => performance.getEntriesByType('resource')
    .map(entry => entry.name).find(name => new URL(name).pathname === pathname), pathname)
  assert.ok(url, 'The app must have loaded its real session module')
  return url
}

async function switchSession(page, context, { sid = 'sid-B', principal = 'B', clearFirst = false } = {}) {
  await context.addCookies([{ name: 'deedly_sid', value: sid, url: BASE }])
  await page.evaluate(async ({ sid, principalKey, clearFirst, moduleUrl }) => {
    const session = await import(moduleUrl)
    if (clearFirst) session.clearSession()
    session.setSession({ sid, principalKey, accessToken: 'token-B', expires: 9999999999, user: { id: 2 } })
  }, { sid, principalKey: key(principal), clearFirst, moduleUrl: await sessionModuleUrl(page) })
}

async function scenario(name, run, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  context.setDefaultTimeout(8000)
  context.setDefaultNavigationTimeout(30000)
  if (options.noBroadcast) await context.addInitScript(() => { window.BroadcastChannel = undefined })
  await context.addCookies([{ name: 'deedly_sid', value: 'sid-A', url: BASE }])
  const state = { holdA: Boolean(options.holdA), holdB: false, pendingA: [], pendingB: [], requests: [] }
  const errors = []
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/refresh') {
      const name = request.headers()['x-deedly-session'] === 'sid-B' ? 'B' : 'A'
      return route.fulfill(json({ message: 'OK', data: { token: `token-${name}`, expires: 9999999999, principalKey: key(name) } }))
    }
    if (url.pathname === '/api/auth/logout') return route.fulfill(json({ success: true }))
    if (url.pathname === '/api/auth/initiate-login') return route.fulfill(json({ data: { requires_otp: true, user_id: 2 } }))
    if (url.pathname === '/api/auth/otp') return route.fulfill(json({ data: { confirmation_pin: 'SYNTHETIC' } }))
    if (url.pathname === '/api/auth/login') {
      await context.addCookies([{ name: 'deedly_sid', value: 'sid-B', url: BASE }])
      return route.fulfill(json({ data: { sid: 'sid-B', principalKey: key('B'), token: 'token-B', expires: 9999999999, user: { id: 2 } } }))
    }
    if (url.pathname === '/api/v1/transfers') {
      const name = request.headers().authorization === 'Bearer token-B' ? 'B' : 'A'
      state.requests.push({ name, params: url.searchParams })
      if (state[`hold${name}`]) {
        state[`pending${name}`].push(route)
        return
      }
      return route.fulfill(response(name))
    }
    return route.fulfill({ ...json({ error: 'Synthetic unavailable service' }), status: 503 })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(BASE + '/transfers', { waitUntil: 'domcontentloaded' })
    await until(() => state.requests.some(request => request.name === 'A'))
    await run({ page, context, state })
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

try {
  await scenario('a new session clears loaded rows, totals and search while its request is outstanding', async ({ page, context, state }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    await page.getByPlaceholder('Search this page...').fill('PRIVATE-A')
    state.holdB = true
    await switchSession(page, context)
    await until(() => state.pendingB.length > 0)
    assert.equal(await page.getByText('PRIVATE-A', { exact: true }).count(), 0)
    assert.equal(await page.getByPlaceholder('Search this page...').inputValue(), '')
    assert.deepEqual(await page.getByLabel('Institution-wide transfer totals').locator('p.text-2xl').allTextContents(), ['—', '—', '—'])
    for (const route of state.pendingB) await route.fulfill(response('B'))
    await page.getByText('PRIVATE-B', { exact: true }).waitFor()
  })

  for (const options of [{}, { sid: 'sid-A' }, { clearFirst: true }]) {
    await scenario('old response cannot populate replacement session: ' + JSON.stringify(options), async ({ page, context, state }) => {
      await until(() => state.pendingA.length > 0)
      await switchSession(page, context, options)
      await page.getByText('PRIVATE-B', { exact: true }).waitFor()
      for (const route of state.pendingA) await route.fulfill(response('A'))
      await pause(100)
      assert.equal(await page.getByText('PRIVATE-A', { exact: true }).count(), 0)
      await page.getByText('PRIVATE-B', { exact: true }).waitFor()
    }, { holdA: true })
  }

  await scenario('real UI logout and mocked OTP login cannot revive a previous request', async ({ page, state }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    state.holdA = true
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await until(() => state.pendingA.length > 0)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Personal Profile', exact: true }).click()
    await page.getByRole('button', { name: 'Sign Out', exact: true }).click()
    await page.getByPlaceholder('13-digit ID number').fill('9002024800081')
    await page.locator('input[type="password"]').fill('synthetic-only')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByPlaceholder('6-digit code').fill('123456')
    await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click()
    await page.getByText('PRIVATE-B', { exact: true }).waitFor()
    for (const route of state.pendingA) await route.fulfill(response('A'))
    await pause(100)
    assert.equal(await page.getByText('PRIVATE-A', { exact: true }).count(), 0)
  })

  await scenario('old intake history cannot repopulate forms after a session change or Back navigation', async ({ page, context }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    await page.evaluate(async moduleUrl => {
      const { bindNavigationState } = await import(moduleUrl)
      history.pushState({ key: 'synthetic-A', idx: 1, usr: bindNavigationState({
        matterDetails: { fileReference: 'PRIVATE-REFERENCE-A', classificationCode: 'transfer.donation' },
        goldenRecord: { propertyAddress: 'PRIVATE-ADDRESS-A' },
      }) }, '', '/transfers/workflow')
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    }, await sessionModuleUrl(page, '/src/lib/navigationState.ts'))
    await page.waitForFunction(() => document.querySelector('#workflow-firm-reference')?.value === 'PRIVATE-REFERENCE-A')
    await switchSession(page, context)
    await page.waitForFunction(() => document.querySelector('#workflow-firm-reference')?.value === '')
    assert.equal(await page.getByPlaceholder('Start typing the address...').inputValue(), '')
    await page.getByRole('link', { name: 'Transfers', exact: true }).click()
    await page.getByText('PRIVATE-B', { exact: true }).waitFor()
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('#workflow-firm-reference')?.value === '')
    assert.equal(await page.getByPlaceholder('Start typing the address...').inputValue(), '')
  })

  await scenario('ordinary same-principal refresh preserves mounted state', async ({ page, state }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    await page.getByPlaceholder('Search this page...').fill('PRIVATE-A')
    const requests = state.requests.length
    await page.evaluate(async moduleUrl => {
      const session = await import(moduleUrl)
      session.setSession({ ...session.getSession(), accessToken: 'token-A-refreshed', expires: 9999999999 })
    }, await sessionModuleUrl(page))
    await pause(100)
    assert.equal(await page.getByPlaceholder('Search this page...').inputValue(), 'PRIVATE-A')
    assert.equal(state.requests.length, requests)
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
  })

  await scenario('another tab changing institution clears the old tab and rejects its pending response', async ({ page, context, state }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    const other = await context.newPage()
    await other.goto(BASE + '/transfers')
    await other.getByText('PRIVATE-A', { exact: true }).waitFor()
    state.holdA = true
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await until(() => state.pendingA.length > 0)
    await switchSession(other, context)
    await page.getByRole('heading', { name: 'DEEDLY', exact: true }).waitFor()
    for (const route of state.pendingA) await route.fulfill(response('A'))
    await pause(100)
    assert.equal(await page.getByText('PRIVATE-A', { exact: true }).count(), 0)
    state.holdA = false
    await page.reload()
    await page.getByText('PRIVATE-B', { exact: true }).waitFor()
  })

  await scenario('another tab logging out clears the active dashboard', async ({ page, context }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    const other = await context.newPage()
    await other.goto(BASE + '/transfers')
    await other.getByText('PRIVATE-A', { exact: true }).waitFor()
    await other.evaluate(async moduleUrl => (await import(moduleUrl)).logoutSession(), await sessionModuleUrl(other))
    await page.getByRole('heading', { name: 'DEEDLY', exact: true }).waitFor()
    assert.equal(await page.getByText('PRIVATE-A', { exact: true }).count(), 0)
  })

  await scenario('focus detects a changed cookie even without BroadcastChannel', async ({ page, context }) => {
    await page.getByText('PRIVATE-A', { exact: true }).waitFor()
    await context.addCookies([{ name: 'deedly_sid', value: 'sid-B', url: BASE }])
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('heading', { name: 'DEEDLY', exact: true }).waitFor()
    assert.equal(await page.getByText('PRIVATE-A', { exact: true }).count(), 0)
  }, { noBroadcast: true })
} finally {
  await browser.close()
}
console.log(`Session isolation: ${passed} passed, ${failed} failed. Mocked auth/API only; no live services.`)
process.exitCode = failed ? 1 : 0
