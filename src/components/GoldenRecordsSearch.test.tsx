import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GoldenRecordsApi, GoldenRecordSearchError, candidateToGoldenRecord } from '../lib/api/goldenRecordsApi'
import type { GoldenRecord, GoldenRecordCandidate, GoldenRecordEntityType, GoldenRecordSearchData, GoldenRecordSearchRequest } from '../lib/api/goldenRecordsApi'
import * as recordsApi from '../lib/api/goldenRecordsApi'
import * as searchComponent from './GoldenRecordsSearch'
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

const detail = { ...person, name: 'Canonical Jane', phone: '0210000000', address: '1 Test Road' }
const normalizedDetail: GoldenRecord = { ...candidateToGoldenRecord(detail), phone: detail.phone, address: detail.address }

function retrievalError(kind: recordsApi.GoldenRecordRetrievalError['kind']) {
  return (error: unknown) => {
    assert.ok(error instanceof recordsApi.GoldenRecordRetrievalError)
    assert.equal(error.kind, kind)
    assert.doesNotMatch(error.message, /PRIVATE|privateUpstreamData|secret-token|stack trace/)
    return true
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function session() {
  const value = searchComponent.createGoldenRecordSearchSession()
  value.setActive(true)
  value.setSearchTerm('Jane')
  return value
}

describe('Golden Record retrieval API boundary', () => {
  it('fetches details through the BFF with only the UUID, logical type and explicit user token', async () => {
    const fetchMock = respond({ message: 'OK', data: detail })
    const record = await GoldenRecordsApi.retrieve(person.goldenRecordId.toUpperCase(), 'person', { bearerToken: 'caller-provided-token' })
    assert.deepEqual(record, normalizedDetail)
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/golden-records/${person.goldenRecordId}?entity_type=person`)
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    assert.equal(init.cache, 'no-store')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer caller-provided-token')
    assert.equal(new Headers(init.headers).get('X-Service-Key'), null)
    assert.equal(new Headers(init.headers).get('X-Accountable-Institution-Id'), null)
  })

  it('does not manufacture authentication when no user token is available', async () => {
    const fetchMock = respond({ success: false, error: 'Authentication required' }, 401)
    await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'person'), retrievalError('auth'))
    const [, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(new Headers(init.headers).get('Authorization'), null)
    assert.equal(new Headers(init.headers).get('X-Service-Key'), null)
  })

  it('preserves company and trust metadata and passes their logical type unchanged to the BFF', async () => {
    for (const kind of ['company', 'trust'] as const) {
      const data = { ...trust, entityType: kind, isTrust: kind === 'trust', phone: null, address: null }
      const fetchMock = respond({ message: 'OK', data })
      const record = await GoldenRecordsApi.retrieve(trust.goldenRecordId, kind)
      assert.equal(record.entityType, kind)
      assert.equal(record.isTrust, kind === 'trust')
      assert.equal(record.registrationNo, trust.registrationNo)
      assert.equal(record.registrationNumber, trust.registrationNo)
      assert.equal(record.mastersOffice, trust.mastersOffice)
      assert.equal(record.phone, undefined)
      assert.equal(record.address, undefined)
      assert.equal(fetchMock.mock.calls[0].arguments[0], `/api/v1/golden-records/${trust.goldenRecordId}?entity_type=${kind}`)
      fetchMock.mock.restore()
    }
  })

  it('keeps absent canonical details empty and strips fields outside the P0 projection', async () => {
    respond({ message: 'OK', data: { ...detail, name: null, idNumber: null, email: null, phone: null, address: null,
      tenant_id: 'PRIVATE-TENANT', profile: { private: 'PRIVATE-PROFILE' }, propertyAddress: 'PRIVATE-PROPERTY', bankAccounts: ['PRIVATE-BANK'] } })
    const record = await GoldenRecordsApi.retrieve(person.goldenRecordId, 'person')
    assert.equal(record.name, '')
    assert.equal(record.idNumber, '')
    assert.equal(record.email, undefined)
    assert.equal(record.phone, undefined)
    assert.equal(record.address, undefined)
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE|profile|bankAccounts|propertyAddress|tenant_id/)
  })

  it('rejects invalid references before any network access', async () => {
    const fetchMock = respond({ message: 'OK', data: detail })
    for (const id of ['', 'PRIVATE-ID', '../search', `${person.goldenRecordId}?tenant_id=999`]) {
      await assert.rejects(GoldenRecordsApi.retrieve(id, 'person'), retrievalError('invalid'))
    }
    await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'estate' as GoldenRecordEntityType), retrievalError('invalid'))
    assert.equal(fetchMock.mock.callCount(), 0)
  })

  it('rejects malformed, missing, mismatched and contradictory detail payloads', async () => {
    const missingPhone = { ...detail } as Partial<typeof detail>
    delete missingPhone.phone
    for (const data of [null, [], {}, missingPhone, { ...detail, goldenRecordId: trust.goldenRecordId },
      { ...detail, goldenRecordId: 'PRIVATE-ID' }, { ...detail, entityType: 'company' },
      { ...detail, name: {} }, { ...detail, idNumber: 123 }, { ...detail, email: [] },
      { ...detail, phone: 123 }, { ...detail, address: {} }, { ...detail, isTrust: true }]) {
      const fetchMock = respond({ message: 'OK', data })
      await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'person'), retrievalError('server'))
      fetchMock.mock.restore()
    }
    for (const kind of ['company', 'trust'] as const) {
      for (const isTrust of [undefined, null, 'true', 1, kind !== 'trust']) {
        const fetchMock = respond({ message: 'OK', data: { ...trust, entityType: kind, isTrust, phone: null, address: null } })
        await assert.rejects(GoldenRecordsApi.retrieve(trust.goldenRecordId, kind), retrievalError('server'))
        fetchMock.mock.restore()
      }
    }
  })

  for (const [status, kind] of [[400, 'not_visible'], [404, 'not_visible'], [401, 'auth'], [403, 'auth'], [422, 'invalid'], [500, 'server'], [503, 'server'], [504, 'server']] as const) {
    it(`maps retrieval HTTP ${status} to safe ${kind} messaging`, async () => {
      respond({ detail: 'PRIVATE-DATA secret-token stack trace' }, status)
      await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'person'), retrievalError(kind))
    })
  }

  it('handles network, non-JSON and malformed-envelope failures without surfacing upstream details', async () => {
    const network = mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE-NETWORK') })
    await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'person'), retrievalError('server'))
    network.mock.restore()
    const invalidJson = mock.method(globalThis, 'fetch', async () => new Response('PRIVATE-HTML'))
    await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'person'), retrievalError('server'))
    invalidJson.mock.restore()
    for (const envelope of [null, [], {}, { message: 'OK' }]) {
      const fetchMock = respond(envelope)
      await assert.rejects(GoldenRecordsApi.retrieve(person.goldenRecordId, 'person'), retrievalError('server'))
      fetchMock.mock.restore()
    }
  })

  it('rejects malformed search candidates rather than making them selectable', async () => {
    for (const data of [
      { status: 'matched', entityType: 'person', record: { ...person, name: {} } },
      { status: 'matched', entityType: 'person', record: { ...person, entityType: 'trust' } },
      { status: 'ambiguous', entityType: 'person', candidates: [null] },
      { status: 'ambiguous', entityType: 'person', candidates: 'PRIVATE-DATA' },
    ]) {
      const fetchMock = respond({ message: 'OK', data })
      await assert.rejects(GoldenRecordsApi.search({ entity_type: 'person', query: 'Jane' }), safeError('server'))
      fetchMock.mock.restore()
    }
  })
})

describe('Selected-record retrieval state and handoff', () => {
  it('waits for canonical details after a single match and never publishes the candidate as a full record', async () => {
    mock.method(GoldenRecordsApi, 'search', async () => ({ status: 'matched' as const, entityType: 'person' as const, record: person }))
    const result = deferred<GoldenRecord>()
    const retrieve = mock.method(GoldenRecordsApi, 'retrieve', () => result.promise)
    const state = session()
    const task = state.handleSearch()
    await Promise.resolve()
    assert.equal(state.getSnapshot().searchResult, null)
    assert.equal(state.getSnapshot().isRetrieving, true)
    assert.deepEqual(retrieve.mock.calls[0].arguments, [person.goldenRecordId, 'person'])
    result.resolve(normalizedDetail)
    await task
    assert.deepEqual(state.getSnapshot().searchResult, normalizedDetail)
    assert.equal(state.getSnapshot().isRetrieving, false)
    const party = goldenRecordToParty(state.getSnapshot().searchResult!, 'local-party-id')
    assert.equal(party.name, 'Canonical Jane')
    assert.equal(party.phone, detail.phone)
    assert.equal(party.address, detail.address)
  })

  it('retrieves only the explicitly selected ambiguous candidate and blocks duplicate submissions', async () => {
    const other = { ...trust, goldenRecordId: person.goldenRecordId, mastersOffice: 'Pretoria' }
    const search = mock.method(GoldenRecordsApi, 'search', async () => ({ status: 'ambiguous' as const, entityType: 'trust' as const, candidates: [trust, other] }))
    const result = deferred<GoldenRecord>()
    const retrieve = mock.method(GoldenRecordsApi, 'retrieve', () => result.promise)
    const state = session()
    state.setSearchType('trust')
    await state.handleSearch()
    assert.equal(retrieve.mock.callCount(), 0)
    await state.handleSelectCandidate({ ...trust })
    assert.equal(retrieve.mock.callCount(), 0)
    const task = state.handleSelectCandidate(other)
    await state.handleSelectCandidate(other)
    await state.handleSearch()
    assert.equal(search.mock.callCount(), 1)
    assert.equal(retrieve.mock.callCount(), 1)
    assert.equal(state.getSnapshot().searchResult, null)
    result.resolve({ ...candidateToGoldenRecord(other), phone: '0210000000' })
    await task
    assert.equal(state.getSnapshot().searchResult?.mastersOffice, 'Pretoria')
    assert.deepEqual(retrieve.mock.calls[0].arguments, [other.goldenRecordId, 'trust'])
  })

  it('fails closed on retrieval errors and retries the selected reference without rerunning search', async () => {
    const search = mock.method(GoldenRecordsApi, 'search', async () => ({ status: 'matched' as const, entityType: 'person' as const, record: person }))
    const retrieve = mock.method(GoldenRecordsApi, 'retrieve', async () => { throw new recordsApi.GoldenRecordRetrievalError('not_visible') })
    const state = session()
    await state.handleSearch()
    assert.equal(state.getSnapshot().searchResult, null)
    assert.equal(state.getSnapshot().notFound, false)
    assert.match(state.getSnapshot().error!, /Unknown or inaccessible/)
    retrieve.mock.mockImplementation(async () => normalizedDetail)
    await state.retryRetrieval()
    assert.equal(search.mock.callCount(), 1)
    assert.equal(retrieve.mock.callCount(), 2)
    assert.deepEqual(state.getSnapshot().searchResult, normalizedDetail)
    assert.equal(state.getSnapshot().error, null)
  })

  for (const change of ['query', 'type', 'close', 'reset'] as const) {
    it(`ignores a late detail response after ${change} and clears selected data`, async () => {
      mock.method(GoldenRecordsApi, 'search', async () => ({ status: 'matched' as const, entityType: 'person' as const, record: person }))
      const result = deferred<GoldenRecord>()
      mock.method(GoldenRecordsApi, 'retrieve', () => result.promise)
      const state = session()
      const task = state.handleSearch()
      await Promise.resolve()
      if (change === 'query') state.setSearchTerm('Different')
      if (change === 'type') state.setSearchType('trust')
      if (change === 'close') state.setActive(false)
      if (change === 'reset') state.resetSearch()
      result.resolve(normalizedDetail)
      await task
      assert.equal(state.getSnapshot().searchResult, null)
      assert.equal(state.getSnapshot().isRetrieving, false)
      assert.equal(state.getSnapshot().retrievalTarget, null)
    })
  }

  it('ignores old search completions and retrieval failures without overwriting a newer selection', async () => {
    const oldSearch = deferred<GoldenRecordSearchData>()
    const search = mock.method(GoldenRecordsApi, 'search', () => oldSearch.promise)
    const retrieve = mock.method(GoldenRecordsApi, 'retrieve', async () => normalizedDetail)
    const state = session()
    const oldTask = state.handleSearch()
    state.setSearchTerm('New query')
    search.mock.mockImplementation(async () => ({ status: 'matched' as const, entityType: 'person' as const, record: person }))
    await state.handleSearch()
    oldSearch.resolve({ status: 'matched', entityType: 'person', record: person })
    await oldTask
    assert.equal(retrieve.mock.callCount(), 1)
    assert.deepEqual(state.getSnapshot().searchResult, normalizedDetail)

    const oldDetails = deferred<GoldenRecord>()
    retrieve.mock.mockImplementation(() => oldDetails.promise)
    const staleTask = state.handleSearch()
    await Promise.resolve()
    state.setSearchTerm('Latest query')
    retrieve.mock.mockImplementation(async () => normalizedDetail)
    await state.handleSearch()
    oldDetails.reject(new Error('PRIVATE-STALE-ERROR'))
    await staleTask
    assert.deepEqual(state.getSnapshot().searchResult, normalizedDetail)
    assert.equal(state.getSnapshot().error, null)
  })

  it('does not retrieve on no-match, search failure or an inactive view', async () => {
    const search = mock.method(GoldenRecordsApi, 'search', async () => ({ status: 'not_found' as const, entityType: 'person' as const }))
    const retrieve = mock.method(GoldenRecordsApi, 'retrieve', async () => normalizedDetail)
    const state = session()
    await state.handleSearch()
    assert.equal(state.getSnapshot().notFound, true)
    search.mock.mockImplementation(async () => { throw new GoldenRecordSearchError('auth') })
    await state.handleSearch()
    assert.equal(state.getSnapshot().notFound, false)
    assert.equal(state.getSnapshot().searchResult, null)
    state.setActive(false)
    await state.handleSearch()
    await state.retryRetrieval()
    assert.equal(search.mock.callCount(), 2)
    assert.equal(retrieve.mock.callCount(), 0)
  })

  it('uses the real browser API boundary for search followed by canonical detail GET', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      const data = init?.method === 'POST' ? { status: 'matched', entityType: 'person', record: person } : detail
      return new Response(JSON.stringify({ message: 'OK', data }), { headers: { 'Content-Type': 'application/json' } })
    })
    const state = session()
    await state.handleSearch()
    assert.deepEqual(calls.map(call => call.url), ['/api/v1/golden-records/search', `/api/v1/golden-records/${person.goldenRecordId}?entity_type=person`])
    assert.deepEqual(state.getSnapshot().searchResult, normalizedDetail)
    assert.equal(calls[1].init.cache, 'no-store')
  })

  it('keeps view state isolated and discards details when a view is closed and reopened', async () => {
    mock.method(GoldenRecordsApi, 'search', async () => ({ status: 'matched' as const, entityType: 'person' as const, record: person }))
    const retrieve = mock.method(GoldenRecordsApi, 'retrieve', async () => normalizedDetail)
    const first = session()
    const second = session()
    await first.handleSearch()
    assert.deepEqual(first.getSnapshot().searchResult, normalizedDetail)
    assert.equal(second.getSnapshot().searchResult, null)
    first.setActive(false)
    first.setActive(true)
    assert.equal(first.getSnapshot().searchResult, null)
    assert.equal(first.getSnapshot().retrievalTarget, null)
    await first.retryRetrieval()
    assert.equal(retrieve.mock.callCount(), 1)
    await first.handleSearch()
    assert.equal(retrieve.mock.callCount(), 2)
  })

  it('renders the same canonical P0 details for both entry points with escaped content', () => {
    const html = renderToStaticMarkup(<searchComponent.GoldenRecordDetails record={{ ...normalizedDetail, name: '<script>PRIVATE</script>' }} />)
    assert.match(html, /0210000000/)
    assert.match(html, /1 Test Road/)
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /<script>/)
  })
})
