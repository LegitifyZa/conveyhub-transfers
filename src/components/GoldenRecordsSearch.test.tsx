import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GoldenRecordsApi, GoldenRecordSearchError, candidateToGoldenRecord } from '../lib/api/goldenRecordsApi'
import type { GoldenRecordCandidate, GoldenRecordEntityType, GoldenRecordSearchRequest } from '../lib/api/goldenRecordsApi'
import { GoldenRecordCandidateDetails, GoldenRecordsSearch } from './GoldenRecordsSearch'
import { goldenRecordToParty } from './transfers/StepParties'

const person: GoldenRecordCandidate = {
  goldenRecordId: '4a472877-dc13-46fa-a827-6f1b18d073e3',
  entityType: 'person', name: 'Jane Example', idNumber: '9001010001081', email: 'jane@example.test'
}
const trust: GoldenRecordCandidate = {
  goldenRecordId: '72872e36-b8b0-46f9-8719-e4fc4a319626',
  entityType: 'trust', name: 'Example Trust', idNumber: null, email: null,
  registrationNo: 'IT123/2020', mastersOffice: 'Cape Town', isTrust: true
}

function respond(data: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  }))
}

function safeError(kind: GoldenRecordSearchError['kind']) {
  return (error: unknown) => {
    assert.ok(error instanceof GoldenRecordSearchError)
    assert.equal(error.kind, kind)
    assert.doesNotMatch(error.message, /privateUpstreamData|secret-token|stack trace/)
    return true
  }
}

afterEach(() => mock.restoreAll())

describe('Golden Record search API boundary', () => {
  it('sends only entity_type and trimmed query for each supported type', async () => {
    for (const entityType of ['person', 'company', 'trust'] as GoldenRecordEntityType[]) {
      const fetchMock = respond({ message: 'OK', data: { status: 'not_found', entityType } })
      const request = {
        entity_type: entityType, query: '  Example  ', tenant_id: 'untrusted',
        actor: 'untrusted', is_company: true, id_number: 'legacy', offset: 50, limit: 1
      }
      await GoldenRecordsApi.search(request)
      const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
      assert.equal(url, '/api/v1/golden-records/search')
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(init.body as string), { entity_type: entityType, query: 'Example' })
      assert.equal(new Headers(init.headers).get('Authorization'), null)
      assert.equal(new Headers(init.headers).get('X-Service-Key'), null)
      fetchMock.mock.restore()
    }
  })

  it('forwards only an explicitly caller-supplied bearer token', async () => {
    const fetchMock = respond({ message: 'OK', data: { status: 'matched', entityType: 'person', record: person } })
    assert.deepEqual(await GoldenRecordsApi.search({ entity_type: 'person', query: 'Jane' }, { bearerToken: 'caller-provided-token' }), {
      status: 'matched', entityType: 'person', record: person
    })
    const [, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer caller-provided-token')
  })

  it('supports name, ID, passport and email queries without country or identity fields', async () => {
    const fetchMock = respond({ message: 'OK', data: { status: 'not_found', entityType: 'person' } })
    for (const query of ['Jane Example', '9001010001081', 'P1234567', 'jane@example.test']) {
      await GoldenRecordsApi.search({ entity_type: 'person', query })
      const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!.arguments as unknown as [string, RequestInit]
      assert.deepEqual(JSON.parse(init.body as string), { entity_type: 'person', query })
    }
  })

  it('rejects invalid input before network access and accepts the 200-character boundary', async () => {
    const fetchMock = respond({ message: 'OK', data: { status: 'not_found', entityType: 'person' } })
    for (const query of ['', ' \n\t ', 'a'.repeat(201)]) {
      await assert.rejects(GoldenRecordsApi.search({ entity_type: 'person', query }), safeError('invalid'))
    }
    await assert.rejects(GoldenRecordsApi.search({ entity_type: 'other', query: 'Example' } as unknown as GoldenRecordSearchRequest), safeError('invalid'))
    assert.equal(fetchMock.mock.callCount(), 0)
    await GoldenRecordsApi.search({ entity_type: 'person', query: 'a'.repeat(200) })
    assert.equal(fetchMock.mock.callCount(), 1)
  })

  it('preserves normalized not-found and ambiguous results rather than treating them as failures', async () => {
    for (const data of [
      { status: 'not_found', entityType: 'trust' },
      { status: 'ambiguous', entityType: 'trust', candidates: [trust, { ...trust, goldenRecordId: person.goldenRecordId, mastersOffice: 'Pretoria' }] }
    ]) {
      const fetchMock = respond({ message: 'OK', data })
      assert.deepEqual(await GoldenRecordsApi.search({ entity_type: 'trust', query: 'IT123/2020' }), data)
      fetchMock.mock.restore()
    }
  })

  for (const [status, kind] of [[400, 'invalid'], [422, 'invalid'], [401, 'auth'], [403, 'auth'], [404, 'server'], [500, 'server'], [503, 'server']] as const) {
    it(`maps HTTP ${status} to safe ${kind} messaging`, async () => {
      respond({ detail: 'privateUpstreamData secret-token stack trace' }, status)
      await assert.rejects(GoldenRecordsApi.search({ entity_type: 'person', query: 'Jane' }), safeError(kind))
    })
  }

  it('maps network failures and malformed responses to safe server messaging', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('privateUpstreamData') })
    await assert.rejects(GoldenRecordsApi.search({ entity_type: 'person', query: 'Jane' }), safeError('server'))
    fetchMock.mock.restore()
    for (const data of [null, {}, { status: 'unsupported', detail: 'privateUpstreamData' }, { status: 'matched', entityType: 'person' }, { status: 'not_found', entityType: 'trust' }]) {
      const invalidResponse = respond({ message: 'OK', data })
      await assert.rejects(GoldenRecordsApi.search({ entity_type: 'person', query: 'Jane' }), safeError('server'))
      invalidResponse.mock.restore()
    }
  })
})

describe('Golden Record selection, handoff and rendering', () => {
  it('retains logical type, UUID, registration and office for same-number trusts', () => {
    const otherTrust = { ...trust, goldenRecordId: person.goldenRecordId, mastersOffice: 'Pretoria' }
    for (const candidate of [trust, otherTrust, { ...trust, entityType: 'company' as const, isTrust: false, mastersOffice: null }, person]) {
      const selected = candidateToGoldenRecord(candidate)
      const party = goldenRecordToParty(selected, 'local-party-id')
      assert.equal(selected.id, candidate.goldenRecordId)
      assert.equal(selected.goldenRecordId, candidate.goldenRecordId)
      assert.equal(selected.entityType, candidate.entityType)
      assert.equal(party.id, 'local-party-id')
      assert.equal(party.goldenRecordId, candidate.goldenRecordId)
      assert.equal(party.entityType, candidate.entityType)
      assert.equal(party.registrationNo, candidate.registrationNo)
      assert.equal(party.mastersOffice, candidate.mastersOffice)
      assert.equal(party.isTrust, candidate.isTrust)
      assert.equal(party.idNumber, candidate.entityType === 'person' ? candidate.idNumber : candidate.registrationNo)
    }
    assert.notDeepEqual(candidateToGoldenRecord(trust), candidateToGoldenRecord(otherTrust))
  })

  it('does not assign company/trust metadata to person selections', () => {
    const selected = candidateToGoldenRecord({ ...person, registrationNo: 'unexpected', isTrust: false })
    assert.equal('registrationNo' in selected, false)
    assert.equal('isTrust' in selected, false)
  })

  it('renders trust registration and office distinctly with escaped names', () => {
    const capeTown = renderToStaticMarkup(<GoldenRecordCandidateDetails candidate={{ ...trust, name: '<script>unsafe</script>' }} />)
    const pretoria = renderToStaticMarkup(<GoldenRecordCandidateDetails candidate={{ ...trust, mastersOffice: 'Pretoria' }} />)
    assert.match(capeTown, /Trust/)
    assert.match(capeTown, /Registration: IT123\/2020/)
    assert.match(capeTown, /Master’s Office: Cape Town/)
    assert.match(pretoria, /Master’s Office: Pretoria/)
    assert.doesNotMatch(capeTown, /<script>/)
    assert.match(capeTown, /&lt;script&gt;/)
  })

  it('renders one generic person query with all three entity choices and no country filter', () => {
    const html = renderToStaticMarkup(<GoldenRecordsSearch isOpen onClose={() => {}} onRecordFound={() => {}} />)
    assert.match(html, />Person<\/button>/)
    assert.match(html, />Company<\/button>/)
    assert.match(html, />Trust<\/button>/)
    assert.match(html, /Enter name, ID, passport or email/)
    assert.equal((html.match(/<input/g) ?? []).length, 1)
    assert.doesNotMatch(html, /Passport Country|passport_country/)
    assert.equal(renderToStaticMarkup(<GoldenRecordsSearch isOpen={false} onClose={() => {}} onRecordFound={() => {}} />), '')
  })
})
