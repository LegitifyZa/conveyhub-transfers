import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findPotentialDuplicates, partyIdType } from './partyDuplicates'
import { buildAttachPartyRequest, transferPartyToFormParty } from '../api/transferApi'
import type { Party } from '../../components/transfers/TransferForm'
import type { TransferPartyApi } from '../api/transferApi'

const baseParty = (overrides: Partial<Party>): Party => ({
  id: 'local-1',
  source: 'manual',
  type: 'seller',
  name: '',
  idNumber: '',
  email: '',
  phone: '',
  address: '',
  ...overrides,
})

describe('partyIdType', () => {
  it('honours an explicit id type over format inference', () => {
    assert.equal(partyIdType(baseParty({ idNumber: 'A1', idType: 'passport' })), 'passport')
  })

  it('infers a 13-digit value as an SA ID and anything else as other', () => {
    assert.equal(partyIdType(baseParty({ idNumber: '9001010001081' })), 'sa_id')
    assert.equal(partyIdType(baseParty({ idNumber: 'A1234567' })), 'other')
    assert.equal(partyIdType(baseParty({ idNumber: '' })), null)
  })
})

describe('findPotentialDuplicates (advisory, never merging)', () => {
  it('flags a same-type identifier match', () => {
    const candidate = baseParty({ id: 'a', idNumber: '9001010001081' })
    const existing = baseParty({ id: 'b', idNumber: '9001 010 001 081' })
    const result = findPotentialDuplicates(candidate, [existing])
    assert.equal(result.identifierMatches.length, 1)
  })

  it('does not match identifiers of different types', () => {
    const candidate = baseParty({ id: 'a', idNumber: 'P12345', idType: 'passport', passportCountry: 'DE' })
    const existing = baseParty({ id: 'b', idNumber: 'P12345', idType: 'other' })
    const result = findPotentialDuplicates(candidate, [existing])
    assert.equal(result.identifierMatches.length, 0)
  })

  it('compares passport country when both sides carry one', () => {
    const candidate = baseParty({ id: 'a', idNumber: 'P12345', idType: 'passport', passportCountry: 'DE' })
    const sameCountry = baseParty({ id: 'b', idNumber: 'P12345', idType: 'passport', passportCountry: 'de' })
    const otherCountry = baseParty({ id: 'c', idNumber: 'P12345', idType: 'passport', passportCountry: 'FR' })
    const result = findPotentialDuplicates(candidate, [sameCountry, otherCountry])
    assert.deepEqual(result.identifierMatches.map(p => p.id), ['b'])
  })

  it('flags a normalized name match as the weak signal', () => {
    const candidate = baseParty({ id: 'a', name: 'Jane  Example' })
    const existing = baseParty({ id: 'b', name: 'jane example' })
    const result = findPotentialDuplicates(candidate, [existing])
    assert.equal(result.identifierMatches.length, 0)
    assert.equal(result.nameMatches.length, 1)
  })

  it('never compares a party against itself and never mutates input', () => {
    const candidate = baseParty({ id: 'a', idNumber: '9001010001081', name: 'Jane' })
    const result = findPotentialDuplicates(candidate, [candidate])
    assert.equal(result.identifierMatches.length, 0)
    assert.equal(result.nameMatches.length, 0)
  })
})

describe('buildAttachPartyRequest', () => {
  it('maps a manual person party with explicit source, entity type and role', () => {
    const party = baseParty({
      type: 'seller',
      name: 'Jane Example',
      idNumber: '9001010001081',
      idType: 'sa_id',
      email: 'jane@example.test',
      clientRequestId: 'req-1',
      acknowledgedDuplicate: true,
    })
    const request = buildAttachPartyRequest(party)
    assert.ok(!('error' in request))
    if ('error' in request) return
    assert.equal(request.party_source, 'manual')
    assert.equal(request.entity_type, 'person')
    assert.equal(request.role, 'transferor')
    assert.equal(request.client_request_id, 'req-1')
    assert.equal(request.acknowledged_duplicate, true)
    if (request.party_source === 'manual') {
      assert.equal(request.manual.name, 'Jane Example')
      assert.equal(request.manual.id_type, 'sa_id')
      assert.equal(request.manual.passport_country, null)
    }
  })

  it('maps buyer to transferee and a GR party to its record id', () => {
    const request = buildAttachPartyRequest(baseParty({
      source: 'golden_record',
      type: 'buyer',
      goldenRecordId: '11111111-1111-4111-8111-111111111111',
      entityType: 'company',
    }))
    assert.ok(!('error' in request))
    if ('error' in request) return
    assert.equal(request.role, 'transferee')
    if (request.party_source === 'golden_record') {
      assert.equal(request.golden_record_id, '11111111-1111-4111-8111-111111111111')
      assert.equal(request.entity_type, 'company')
    }
  })

  it('refuses a manual company/trust and a GR party without an id', () => {
    const manualCompany = buildAttachPartyRequest(baseParty({ source: 'manual', entityType: 'company' }))
    assert.ok('error' in manualCompany)
    const noId = buildAttachPartyRequest(baseParty({ source: 'golden_record' }))
    assert.ok('error' in noId)
  })

  it('only sends passport_country for passport identifiers', () => {
    const request = buildAttachPartyRequest(baseParty({
      idNumber: '9001010001081', idType: 'sa_id', passportCountry: 'DE',
    }))
    assert.ok(!('error' in request))
    if ('error' in request) return
    if (request.party_source === 'manual') {
      assert.equal(request.manual.passport_country, null)
    }
  })
})

describe('transferPartyToFormParty', () => {
  const apiRow = (overrides: Partial<TransferPartyApi>): TransferPartyApi => ({
    id: 'tp-1',
    transferId: 'tr-1',
    partySource: 'manual',
    goldenRecordId: null,
    entityType: 'person',
    role: 'transferor',
    accountableInstitutionId: 5,
    ...overrides,
  })

  it('restores manual source, identity fields and role', () => {
    const party = transferPartyToFormParty(apiRow({
      manualName: 'Jane Example',
      manualIdNumber: '9001010001081',
      manualEmail: 'jane@example.test',
      acknowledgedDuplicate: true,
      clientRequestId: 'req-9',
    }))
    assert.equal(party.source, 'manual')
    assert.equal(party.type, 'seller')
    assert.equal(party.name, 'Jane Example')
    assert.equal(party.idNumber, '9001010001081')
    assert.equal(party.persistedPartyId, 'tp-1')
    assert.equal(party.clientRequestId, 'req-9')
    assert.equal(party.acknowledgedDuplicate, true)
  })

  it('restores a GR-linked party from its cache fields', () => {
    const party = transferPartyToFormParty(apiRow({
      partySource: 'golden_record',
      goldenRecordId: 'gr-1',
      role: 'transferee',
      cachedName: 'Dean Smith',
      cachedIdNumber: '8001010001081',
    }))
    assert.equal(party.source, 'golden_record')
    assert.equal(party.type, 'buyer')
    assert.equal(party.name, 'Dean Smith')
    assert.equal(party.goldenRecordId, 'gr-1')
  })
})
