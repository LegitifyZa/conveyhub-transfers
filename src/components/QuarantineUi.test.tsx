import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnavailableNotice } from './ui'
import { TransferNavigation } from './transfers/TransferNavigation'
import { TransferProvider } from './transfers/TransferForm'
import { ApiRequestError } from '../lib/api/http'
import { serviceUnavailableMessage } from '../lib/api/serviceStatus'

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
