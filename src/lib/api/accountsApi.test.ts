import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountsCalculator } from '../../pages/AccountsCalculator'
import { AccountsApi } from './accountsApi'
import { ApiRequestError } from './http'
import { DEFAULT_FIRM_SETTINGS, LSSA_TARIFF_2026_2027, type ProformaStatementData } from '../../utils/conveyancingAccounts'

const TRANSFER = '22222222-2222-4222-8222-222222222222'
const PRIVATE = 'previous-institution-private-cache'
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let storageCalls: string[] = []
const storedSettings = { ...DEFAULT_FIRM_SETTINGS, accountableInstitutionId: 7, firmName: PRIVATE }
const storedStatement = { transferId: TRANSFER, accountableInstitutionId: 7, propertyAddress: PRIVATE } as ProformaStatementData

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key: string) {
    storageCalls.push(`get:${key}`)
    return JSON.stringify(key.includes('statements') ? { [TRANSFER]: storedStatement }
      : key.includes('tariff') ? [LSSA_TARIFF_2026_2027] : storedSettings)
  },
  setItem(key: string) { storageCalls.push(`set:${key}`) },
  removeItem(key: string) { storageCalls.push(`remove:${key}`) },
} })

// Session teardown may remove the legacy auth flag — that is required cleanup,
// not institution-scoped data access. The assertions below exclude it.
function institutionStorageCalls() {
  return storageCalls.filter((call) => call !== 'remove:legitify_auth')
}

// A 401 response triggers one session-refresh attempt via /api/auth/refresh;
// the data path itself must still be hit exactly once.
function dataCalls(fetchMock: { mock: { calls: { arguments: unknown[] }[] } }) {
  return fetchMock.mock.calls.filter((call) => !String(call.arguments[0]).startsWith('/api/auth/'))
}

beforeEach(() => { storageCalls = [] })
afterEach(() => mock.restoreAll())
after(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

const operations: Array<[string, () => Promise<unknown>]> = [
  ['read settings', () => AccountsApi.getFirmSettings()],
  ['save settings', () => AccountsApi.updateFirmSettings({ firmName: 'Own institution' })],
  ['read tariffs', () => AccountsApi.getTariffSchedules()],
  ['save tariff', () => AccountsApi.saveTariffSchedule(LSSA_TARIFF_2026_2027)],
  ['read active tariff', () => AccountsApi.getActiveTariffSchedule()],
  ['read statement', () => AccountsApi.getProformaStatementForTransfer(TRANSFER)],
  ['save statement', () => AccountsApi.saveProformaStatement(storedStatement)],
  ['reset defaults', () => AccountsApi.resetToDefaults()],
]

describe('Accounts fail closed without institution-safe offline fallbacks', () => {
  it('does not render firm defaults or proforma actions before authenticated settings load', () => {
    const markup = renderToStaticMarkup(createElement(AccountsCalculator))
    assert.match(markup, /Loading accounts/)
    assert.doesNotMatch(markup, /Generate Proforma/)
  })

  for (const [name, operation] of operations) {
    it(`does not ${name} using previous-institution data after authentication or quarantine failures`, async () => {
      for (const status of [401, 403, 503]) {
        const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(
          JSON.stringify({ success: false, error: 'Service unavailable' }),
          { status, headers: { 'Content-Type': 'application/json' } },
        ))
        await assert.rejects(operation, (error: unknown) => error instanceof ApiRequestError && error.status === status)
        assert.equal(dataCalls(fetchMock).length, 1)
        assert.deepEqual(institutionStorageCalls(), [])
        mock.restoreAll()
      }
    })
  }

  it('does not fabricate a successful offline save after a network failure', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('Network unavailable') })
    await assert.rejects(() => AccountsApi.saveProformaStatement(storedStatement))
    assert.deepEqual(storageCalls, [])
  })

  it('does not retain an earlier authorised response when a later request is denied', async () => {
    let count = 0
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      count += 1
      return new Response(JSON.stringify(count === 1
        ? { success: true, data: storedSettings }
        : { success: false, error: 'Authentication required' }), {
        status: count === 1 ? 200 : 401, headers: { 'Content-Type': 'application/json' },
      })
    })
    assert.equal((await AccountsApi.getFirmSettings()).firmName, PRIVATE)
    await assert.rejects(() => AccountsApi.getFirmSettings(), ApiRequestError)
    assert.deepEqual(institutionStorageCalls(), [])
    for (const call of fetchMock.mock.calls) assert.equal(call.arguments[1]?.cache, 'no-store')
  })

  it('rejects unsuccessful envelopes instead of returning stored defaults', async () => {
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    await assert.rejects(() => AccountsApi.getFirmSettings())
    assert.deepEqual(storageCalls, [])
  })
})
