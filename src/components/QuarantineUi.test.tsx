import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnavailableNotice } from './ui'
import { TransferNavigation } from './transfers/TransferNavigation'
import { TransferProvider } from './transfers/TransferForm'
import { ApiRequestError } from '../lib/api/http'
import { TransferApi } from '../lib/api/transferApi'
import {
  isPersistenceDisabled,
  isPersistenceUnavailable,
  probeMatterPersistence,
  serviceUnavailableMessage
} from '../lib/api/serviceStatus'

afterEach(() => mock.restoreAll())

function respond(body: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' }
  }))
}

function buttonIsDisabled(html: string, label: string): boolean {
  const index = html.indexOf(label)
  assert.notEqual(index, -1, `${label} button should render`)
  const tagStart = html.lastIndexOf('<button', index)
  const tagEnd = html.indexOf('>', tagStart)
  return html.slice(tagStart, tagEnd).includes('disabled=""')
}

describe('serviceUnavailableMessage', () => {
  it('returns a status-only unavailable message without leaking error details', () => {
    assert.equal(serviceUnavailableMessage('Documents'), 'Documents is temporarily unavailable.')
    const sensitive = new ApiRequestError(503, 'private detail: connection to db.internal failed')
    const message = serviceUnavailableMessage('Documents', sensitive)
    assert.equal(message, 'Documents is temporarily unavailable (HTTP 503).')
    assert.doesNotMatch(message, /db\.internal|private detail/)
  })
})

describe('UnavailableNotice', () => {
  it('renders an alert with message and detail', () => {
    const html = renderToStaticMarkup(
      <UnavailableNotice message="Transfers are temporarily unavailable." detail="The list below is not live." />
    )
    assert.match(html, /role="alert"/)
    assert.match(html, /Transfers are temporarily unavailable\./)
    assert.match(html, /The list below is not live\./)
  })
})

describe('matter persistence gate', () => {
  it('disables save/submit while the availability check is pending and after failure', () => {
    assert.equal(isPersistenceDisabled(false, null), true)
    assert.equal(isPersistenceDisabled(false, new Error('x')), true)
    assert.equal(isPersistenceDisabled(true, new Error('x')), true)
    assert.equal(isPersistenceDisabled(true, null), false)
  })

  it('reports unavailability when the list endpoint is quarantined', async () => {
    respond({ success: false, error: 'Legacy endpoint unavailable' }, 503)
    const failure = await probeMatterPersistence()
    assert.ok(failure instanceof ApiRequestError)
    assert.equal((failure as ApiRequestError).status, 503)
    assert.equal(isPersistenceUnavailable(failure), true)
  })

  it('reports unavailability on an unsuccessful success-envelope and on network failure', async () => {
    respond({ success: false, error: 'not allowed' })
    const envelope = await probeMatterPersistence()
    assert.ok(envelope instanceof Error)
    assert.equal(envelope.message, 'not allowed')

    mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed') })
    const network = await probeMatterPersistence()
    assert.ok(network instanceof Error)
  })

  it('does not claim write availability when the list endpoint answers', async () => {
    respond({ success: true, data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } })
    assert.equal(await probeMatterPersistence(), null)
  })
})

describe('matter save failure contract', () => {
  const draft = {
    currentStep: 1,
    status: 'draft' as const,
    propertyDetails: { address: '1 Test St', city: '', state: '', zipCode: '', propertyType: '', lotNumber: '', legalDescription: '', yearBuilt: '', squareFootage: '' },
    parties: [],
    financials: { purchasePrice: '100', depositAmount: '', loanAmount: '', interestRate: '', loanTerm: '', transferDuty: '', conveyancingFees: '', deedsOfficeFees: '', vat: '', postPetty: '', clearanceCertificate: '', ratesClearance: '' },
    documents: []
  }

  it('create throws on a quarantined endpoint so persistAggregate surfaces failure', async () => {
    respond({ success: false, error: 'Legacy endpoint unavailable' }, 503)
    await assert.rejects(
      () => TransferApi.createTransfer(draft),
      (error: unknown) => error instanceof ApiRequestError && error.status === 503
    )
  })

  it('create/update never produce a truthy aggregate from an unsuccessful envelope', async () => {
    respond({ success: false, error: 'validation failed' })
    const created = await TransferApi.createTransfer(draft)
    assert.equal(created.success, false)
    assert.ok(!created.data)

    const updated = await TransferApi.updateTransfer('t-1', draft)
    assert.equal(updated.success, false)
    assert.ok(!updated.data)
  })
})

describe('TransferNavigation quarantine handling', () => {
  const renderNav = (persistenceDisabled: boolean) => renderToStaticMarkup(
    <TransferProvider>
      <TransferNavigation
        currentStep={5}
        totalSteps={5}
        onPrevious={() => {}}
        onNext={() => {}}
        onSave={() => {}}
        onSubmit={() => {}}
        persistenceDisabled={persistenceDisabled}
      />
    </TransferProvider>
  )

  it('disables Save Draft and Submit Transfer while matter persistence is unavailable', () => {
    const html = renderNav(true)
    assert.equal(buttonIsDisabled(html, 'Save Draft'), true)
    assert.equal(buttonIsDisabled(html, 'Submit Transfer'), true)
  })

  it('keeps Save Draft and Submit Transfer enabled when persistence is available', () => {
    const html = renderNav(false)
    assert.equal(buttonIsDisabled(html, 'Save Draft'), false)
    assert.equal(buttonIsDisabled(html, 'Submit Transfer'), false)
  })
})
