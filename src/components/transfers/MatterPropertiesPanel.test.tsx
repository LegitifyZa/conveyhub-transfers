import assert from 'node:assert/strict'
import { describe, it, mock, afterEach } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MatterPropertiesPanel } from './MatterPropertiesPanel'

function respond(data: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  }))
}

afterEach(() => mock.restoreAll())

describe('MatterPropertiesPanel', () => {
  it('renders the linked-properties surface with an attach control', () => {
    respond({ message: 'OK', data: { properties: [] } })
    const html = renderToStaticMarkup(createElement(MatterPropertiesPanel, { transferId: 't-1' }))
    assert.match(html, /Linked Properties/)
    assert.match(html, /Attach existing property/)
    // SSR render runs no effects; the loading state is the honest first paint.
    assert.match(html, /Loading linked properties/)
  })
})
