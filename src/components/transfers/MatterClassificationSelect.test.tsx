import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatterClassificationSelect } from './MatterClassificationSelect'
import { ApiRequestError } from '@/lib/api/http'

const option = {
  canonicalCode: 'transfer.private_treaty.not_applicable', subtype: 'private_treaty',
  displayLabel: 'Private Treaty', transferFrom: 'not_applicable',
  transferFromLabel: 'Not Applicable', requiresTransferFrom: true,
}
const props = {
  options: [option], loading: false, error: null,
  onChange: () => {}, onRetry: () => {},
}

describe('transfer classification selection', () => {
  it('uses a canonical option value and a complete human-readable label', () => {
    const html = renderToStaticMarkup(<MatterClassificationSelect {...props} value={option.canonicalCode} />)
    assert.match(html, /value="transfer\.private_treaty\.not_applicable" selected=""/)
    assert.match(html, /Private Treaty — Not Applicable/)
    assert.match(html, /does not certify document readiness/)
  })

  it('disables selection while loading or when the service is unavailable', () => {
    for (const extra of [{ loading: true }, { error: new ApiRequestError(503, 'private database detail') }]) {
      const html = renderToStaticMarkup(<MatterClassificationSelect {...props} {...extra} />)
      assert.match(html, /<select[^>]*disabled=""/)
      assert.doesNotMatch(html, /private database detail/)
    }
  })

  it('shows empty configuration and invalid selection without guessing a default', () => {
    const empty = renderToStaticMarkup(<MatterClassificationSelect {...props} options={[]} />)
    assert.match(empty, /No active transfer classifications are configured/)
    assert.match(empty, /Retry classifications/)
    assert.doesNotMatch(empty, /value="transfer\./)
    const unknown = renderToStaticMarkup(<MatterClassificationSelect {...props} value="transfer.retired" />)
    assert.match(unknown, /selected classification is unavailable/)
  })

  it('renders saved classifications read-only and preserves historical codes', () => {
    for (const value of [option.canonicalCode, 'transfer.retired']) {
      const html = renderToStaticMarkup(<MatterClassificationSelect {...props} value={value} readOnly />)
      assert.ok(html.includes(value))
      assert.doesNotMatch(html, /<select/)
      assert.match(html, /Saved classifications cannot be changed/)
    }
  })

  it('distinguishes a known unclassified matter from details that did not load', () => {
    const unclassified = renderToStaticMarkup(<MatterClassificationSelect {...props} value={null} readOnly />)
    const unavailable = renderToStaticMarkup(<MatterClassificationSelect {...props} readOnly />)
    assert.match(unclassified, /Unclassified — no classification was recorded/)
    assert.doesNotMatch(unclassified, /Private Treaty/)
    assert.match(unavailable, /Classification not loaded/)
    assert.doesNotMatch(unavailable, /Unclassified/)
  })
})
