import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import {
  TransferApi,
  buildManualPropertyRequest,
  type AttachMatterPropertyRequest,
} from './transferApi'
import type { PropertyDetails } from '../../components/transfers/TransferForm'

const DETAILS: PropertyDetails = {
  address: '12 Test Street',
  city: 'Johannesburg',
  state: 'Gauteng',
  zipCode: '2196',
  propertyType: 'Freehold',
  lotNumber: '1234',
  legalDescription: 'ERF 1234 SANDTON',
  yearBuilt: '2020',
  squareFootage: '2500',
}

function respond(data: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  }))
}

afterEach(() => mock.restoreAll())

describe('buildManualPropertyRequest', () => {
  it('maps erf and legal description only to their own columns', () => {
    const request = buildManualPropertyRequest(DETAILS, 'req-1')
    assert.ok(!('error' in request))
    if ('error' in request) return
    assert.equal(request.client_request_id, 'req-1')
    assert.ok('property' in request)
    if (!('property' in request)) return
    const property = request.property
    assert.equal(property.street_address, '12 Test Street')
    assert.equal(property.city, 'Johannesburg')
    assert.equal(property.province, 'Gauteng')
    assert.equal(property.postal_code, '2196')
    assert.equal(property.property_type, 'Freehold')
    // "Erf number" writes only erf_number; legal description only
    // legal_description — no lot_number/description dual-write.
    assert.equal(property.erf_number, '1234')
    assert.equal(property.legal_description, 'ERF 1234 SANDTON')
    assert.equal(property.year_built, 2020)
    for (const forbidden of ['lot_number', 'description', 'square_footage', 'extent_sqm']) {
      assert.ok(!(forbidden in property), forbidden)
    }
  })

  it('requires the DB floor including property type', () => {
    for (const field of ['address', 'city', 'state', 'propertyType'] as const) {
      const request = buildManualPropertyRequest({ ...DETAILS, [field]: '' }, 'req-1')
      assert.ok('error' in request, field)
    }
  })

  it('rejects a malformed supplied postal code instead of nulling it', () => {
    for (const bad of ['219', '21960', 'ABCD']) {
      const request = buildManualPropertyRequest({ ...DETAILS, zipCode: bad }, 'req-1')
      assert.ok('error' in request, bad)
    }
    const ok = buildManualPropertyRequest({ ...DETAILS, zipCode: '' }, 'req-1')
    assert.ok(!('error' in ok))
    if (!('error' in ok) && 'property' in ok) {
      assert.equal(ok.property.postal_code, null)
    }
  })

  it('rejects unsupported property types and bad year values', () => {
    assert.ok('error' in buildManualPropertyRequest({ ...DETAILS, propertyType: 'Castle' }, 'r'))
    assert.ok('error' in buildManualPropertyRequest({ ...DETAILS, yearBuilt: 'twenty' }, 'r'))
  })
})

describe('matter–property API calls', () => {
  it('posts the link request to the transfer subresource', async () => {
    const fetchMock = respond({ message: 'Created', data: { id: 'link-1' } }, 201)
    const request: AttachMatterPropertyRequest = { client_request_id: 'req-1', property_id: 'prop-uuid' }
    await TransferApi.attachMatterProperty('transfer-uuid', request)
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, '/api/v1/transfers/transfer-uuid/properties')
    assert.equal(init.method, 'POST')
    assert.deepEqual(JSON.parse(init.body as string), request)
  })

  it('posts the capture request to the transfer subresource', async () => {
    const fetchMock = respond({ message: 'Created', data: { id: 'link-1' } }, 201)
    const request = buildManualPropertyRequest(DETAILS, 'req-9')
    assert.ok(!('error' in request))
    if ('error' in request) return
    await TransferApi.attachMatterProperty('transfer-uuid', request)
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, '/api/v1/transfers/transfer-uuid/properties')
    assert.deepEqual(JSON.parse(init.body as string), request)
  })

  it('encodes the discovery query and unwraps the properties array', async () => {
    const fetchMock = respond({ message: 'OK', data: { properties: [{ id: 'p1' }] } })
    const response = await TransferApi.searchProperties('  main street  ', 10)
    const [url] = fetchMock.mock.calls[0].arguments as unknown as [string]
    assert.equal(url, '/api/v1/properties?query=main+street&limit=10')
    assert.deepEqual(response.data, [{ id: 'p1' }])
  })

  it('unwraps the readback properties array', async () => {
    respond({ message: 'OK', data: { properties: [{ id: 'l1' }, { id: 'l2' }] } })
    const response = await TransferApi.getMatterProperties('transfer-uuid')
    assert.equal(response.data?.length, 2)
  })
})
