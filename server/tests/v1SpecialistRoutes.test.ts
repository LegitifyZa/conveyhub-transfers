import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { after, before, describe, it } from 'node:test'

import jwt from 'jsonwebtoken'

// Prevent the Express app from binding to a fixed port during import.
process.env.VERCEL = '1'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-bytes-long!!'

const JWT_SECRET = process.env.JWT_SECRET

const TRANSFER_CODE_PREFIX = 'TX-SPEC-'
const OTHER_TRANSFER_CODE_PREFIX = 'TX-OTHER-'
const RELATIONSHIP_CODE_A = 'test_spc_surviving_spouse'
const RELATIONSHIP_CODE_B = 'test_spc_co_heir'
const RELATIONSHIP_CODE_INACTIVE = 'test_spc_inactive'

const { default: app } = await import('../index')
const { pool, query } = await import('../db')

interface FixtureIds {
  transferId: string
  partyId: string
  trustPartyId: string
  otherTransferId: string
  otherPartyId: string
  estateAId: string
  estateBId: string
  representativeEstateId: string
  representativePartyId: string
}

let server: Server
let baseUrl: string
let fixtures: FixtureIds

function makeToken(role: number, ai: number, abilities: string[] = ['api', 'transfers:read']) {
  return jwt.sign(
    {
      type: 'access',
      user_id: 1,
      golden_record_id: randomUUID(),
      abilities,
      accountable_institution_id: ai,
      user_roles_id: role,
      tenant_id: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  )
}

function authHeader(role: number, ai: number, abilities?: string[]) {
  return { Authorization: `Bearer ${makeToken(role, ai, abilities)}` }
}

async function httpGet(path: string, headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'GET', headers })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function httpPost(path: string, headers: Record<string, string>, json: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function preClean() {
  // Delete module-owned transfers first so their cascade-owned rows are removed
  // before we delete the shared relationship-definition codes they reference.
  await query('DELETE FROM transfers WHERE transfer_id LIKE $1', [`${TRANSFER_CODE_PREFIX}%`])
  await query('DELETE FROM transfers WHERE transfer_id LIKE $1', [`${OTHER_TRANSFER_CODE_PREFIX}%`])
  await query('DELETE FROM party_relationship_definitions WHERE code LIKE $1', ['test_spc_%'])
}

async function seedFixtures(): Promise<FixtureIds> {
  const transferId = randomUUID()
  const transferCode = `${TRANSFER_CODE_PREFIX}${transferId.slice(0, 8)}`
  await query(
    `INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status,
                            current_step, total_steps, progress, accountable_institution_id)
     VALUES ($1::uuid, $2, $3, $4, 'in_progress', 1, 5, 0, 5)`,
    [transferId, transferCode, '1 Specialist Street, Cape Town', 1000000]
  )

  const partyId = randomUUID()
  await query(
    `INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type,
                                  role, accountable_institution_id, cached_name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'person', 'buyer', 5, 'Test Party')`,
    [partyId, transferId, randomUUID()]
  )

  const otherTransferId = randomUUID()
  const otherTransferCode = `${OTHER_TRANSFER_CODE_PREFIX}${otherTransferId.slice(0, 8)}`
  await query(
    `INSERT INTO transfers (id, transfer_id, property_address, purchase_price, status,
                            current_step, total_steps, progress, accountable_institution_id)
     VALUES ($1::uuid, $2, $3, $4, 'in_progress', 1, 5, 0, 5)`,
    [otherTransferId, otherTransferCode, '2 Other Street, Cape Town', 500000]
  )

  const otherPartyId = randomUUID()
  await query(
    `INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type,
                                  role, accountable_institution_id, cached_name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'person', 'buyer', 5, 'Other Party')`,
    [otherPartyId, otherTransferId, randomUUID()]
  )

  const estateAId = randomUUID()
  const estateA = await query(
    `INSERT INTO matter_estate_contexts (id, transfer_id, deceased_golden_record_id,
                                         masters_estate_reference)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'ME-001')
     RETURNING id`,
    [estateAId, transferId, randomUUID()]
  )

  const estateBId = randomUUID()
  const estateB = await query(
    `INSERT INTO matter_estate_contexts (id, transfer_id, deceased_golden_record_id,
                                         masters_estate_reference)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'ME-002')
     RETURNING id`,
    [estateBId, transferId, randomUUID()]
  )

  await query(
    `INSERT INTO party_relationship_definitions (code, label, is_active) VALUES
       ($1, 'Surviving Spouse', TRUE),
       ($2, 'Co-heir', TRUE),
       ($3, 'Inactive Relationship', FALSE)
     ON CONFLICT (code) DO UPDATE SET
       label = EXCLUDED.label,
       is_active = EXCLUDED.is_active`,
    [RELATIONSHIP_CODE_A, RELATIONSHIP_CODE_B, RELATIONSHIP_CODE_INACTIVE]
  )

  await query(
    `INSERT INTO party_relationship_assignments (
       transfer_party_id, relationship_code, created_by_user_id, updated_by_user_id
     ) VALUES ($1, $2, 1, 1)`,
    [partyId, RELATIONSHIP_CODE_A]
  )

  const trustPartyId = randomUUID()
  await query(
    `INSERT INTO transfer_parties (id, transfer_id, golden_record_id, entity_type,
                                  role, accountable_institution_id, cached_name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'trust', 'trustee', 5, 'Test Trust')`,
    [trustPartyId, transferId, randomUUID()]
  )

  const representativeEstate = await query(
    `INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity,
                                            represented_estate_context_id)
     VALUES ($1::uuid, $2::uuid, 'executor', $3::uuid)
     RETURNING id`,
    [transferId, randomUUID(), estateAId]
  )

  const representativeParty = await query(
    `INSERT INTO representative_assignments (transfer_id, person_golden_record_id, capacity,
                                            represented_transfer_party_id)
     VALUES ($1::uuid, $2::uuid, 'trustee', $3::uuid)
     RETURNING id`,
    [transferId, randomUUID(), trustPartyId]
  )

  return {
    transferId,
    partyId,
    trustPartyId,
    otherTransferId,
    otherPartyId,
    estateAId: String(estateA.rows[0].id),
    estateBId: String(estateB.rows[0].id),
    representativeEstateId: String(representativeEstate.rows[0].id),
    representativePartyId: String(representativeParty.rows[0].id),
  }
}

async function cleanup() {
  // Same order as preClean: transfer-owned rows cascade away first, then shared codes.
  await query('DELETE FROM transfers WHERE transfer_id LIKE $1', [`${TRANSFER_CODE_PREFIX}%`])
  await query('DELETE FROM transfers WHERE transfer_id LIKE $1', [`${OTHER_TRANSFER_CODE_PREFIX}%`])
  await query('DELETE FROM party_relationship_definitions WHERE code LIKE $1', ['test_spc_%'])
}

before(async () => {
  await preClean()
  fixtures = await seedFixtures()
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address !== 'string') {
        baseUrl = `http://127.0.0.1:${address.port}`
      }
      resolve()
    })
  })
})

after(async () => {
  await cleanup()
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  await pool.end()
})

describe('Estate contexts', async () => {
  it('lists estate contexts for an authorised tenant', async () => {
    const { status, body } = await httpGet(`/api/v1/transfers/${fixtures.transferId}/estate-contexts`, authHeader(3, 5))
    assert.equal(status, 200)
    assert.equal(body.message, 'OK')
    const contexts = body.data.estateContexts as any[]
    assert.equal(contexts.length, 2)
    assert.ok(contexts[0].createdAt <= contexts[1].createdAt, 'list order is deterministic by created_at')
    const refs = contexts.map((c) => c.mastersEstateReference)
    assert.ok(refs.includes('ME-001'))
    assert.ok(refs.includes('ME-002'))
    for (const c of contexts) {
      assert.equal(typeof c.id, 'string')
      assert.equal(c.transferId, fixtures.transferId)
      assert.equal(typeof c.deceasedGoldenRecordId, 'string')
      assert.equal(typeof c.mastersEstateReference, 'string')
      assert.equal(typeof c.createdAt, 'string')
      assert.equal(typeof c.updatedAt, 'string')
      assert.ok(!('accountableInstitutionId' in c), 'accountableInstitutionId must not leak')
      assert.ok(!('estateReference' in c), 'estateReference must not leak')
      assert.ok(!('createdByUserId' in c), 'createdByUserId must not leak')
      assert.ok(!('updatedByUserId' in c), 'updatedByUserId must not leak')
    }
  })

  it('returns a single estate context for an authorised tenant', async () => {
    const { status, body } = await httpGet(
      `/api/v1/transfers/${fixtures.transferId}/estate-contexts/${fixtures.estateAId}`,
      authHeader(3, 5)
    )
    assert.equal(status, 200)
    assert.equal(body.data.id, fixtures.estateAId)
    assert.equal(body.data.transferId, fixtures.transferId)
    assert.equal(body.data.mastersEstateReference, 'ME-001')
  })

  it('returns 404 for a foreign tenant', async () => {
    const { status } = await httpGet(`/api/v1/transfers/${fixtures.transferId}/estate-contexts`, authHeader(3, 999))
    assert.equal(status, 404)
  })

  it('returns 404 when the estate context belongs to a different transfer', async () => {
    const { status } = await httpGet(
      `/api/v1/transfers/${fixtures.otherTransferId}/estate-contexts/${fixtures.estateAId}`,
      authHeader(3, 5)
    )
    assert.equal(status, 404)
  })
})

describe('Representative assignments', async () => {
  it('lists representative assignments for an authorised tenant', async () => {
    const { status, body } = await httpGet(
      `/api/v1/transfers/${fixtures.transferId}/representative-assignments`,
      authHeader(3, 5)
    )
    assert.equal(status, 200)
    const assignments = body.data.representativeAssignments as any[]
    assert.equal(assignments.length, 2)
    const byCapacity: Record<string, any> = {}
    for (const a of assignments) {
      assert.equal(a.transferId, fixtures.transferId)
      assert.equal(typeof a.personGoldenRecordId, 'string')
      assert.equal(typeof a.capacity, 'string')
      assert.equal(typeof a.createdAt, 'string')
      assert.equal(typeof a.updatedAt, 'string')
      assert.ok(a.representedTarget)
      assert.ok(['estate_context', 'transfer_party'].includes(a.representedTarget.type))
      assert.equal(typeof a.representedTarget.id, 'string')
      assert.ok(!('representedEstateContextId' in a), 'representedEstateContextId must not leak')
      assert.ok(!('representedTransferPartyId' in a), 'representedTransferPartyId must not leak')
      assert.ok(!('accountableInstitutionId' in a), 'accountableInstitutionId must not leak')
      assert.ok(!('createdByUserId' in a), 'createdByUserId must not leak')
      assert.ok(!('updatedByUserId' in a), 'updatedByUserId must not leak')
      byCapacity[a.capacity] = a
    }
    assert.equal(byCapacity.executor.representedTarget.type, 'estate_context')
    assert.equal(byCapacity.executor.representedTarget.id, fixtures.estateAId)
    assert.equal(byCapacity.trustee.representedTarget.type, 'transfer_party')
    assert.equal(byCapacity.trustee.representedTarget.id, fixtures.trustPartyId)
  })

  it('returns a representative assignment for an authorised tenant', async () => {
    const { status, body } = await httpGet(
      `/api/v1/transfers/${fixtures.transferId}/representative-assignments/${fixtures.representativeEstateId}`,
      authHeader(3, 5)
    )
    assert.equal(status, 200)
    assert.equal(body.data.id, fixtures.representativeEstateId)
    assert.equal(body.data.capacity, 'executor')
    assert.equal(body.data.representedTarget.type, 'estate_context')
  })

  it('returns 404 for a foreign tenant', async () => {
    const { status } = await httpGet(
      `/api/v1/transfers/${fixtures.transferId}/representative-assignments`,
      authHeader(3, 999)
    )
    assert.equal(status, 404)
  })

  it('returns 404 when the assignment belongs to a different transfer', async () => {
    const { status } = await httpGet(
      `/api/v1/transfers/${fixtures.otherTransferId}/representative-assignments/${fixtures.representativeEstateId}`,
      authHeader(3, 5)
    )
    assert.equal(status, 404)
  })
})

describe('Party relationships', async () => {
  it('lists relationships for an authorised tenant', async () => {
    const { status, body } = await httpGet(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5)
    )
    assert.equal(status, 200)
    const relationships = body.data.relationships as any[]
    assert.equal(relationships.length, 1)
    assert.equal(relationships[0].relationshipCode, RELATIONSHIP_CODE_A)
    assert.equal(relationships[0].transferPartyId, fixtures.partyId)
    assert.equal(typeof relationships[0].createdAt, 'string')
    assert.equal(typeof relationships[0].updatedAt, 'string')
    assert.ok(!('accountableInstitutionId' in relationships[0]), 'accountableInstitutionId must not leak')
    assert.ok(!('createdByUserId' in relationships[0]), 'createdByUserId must not leak')
    assert.ok(!('updatedByUserId' in relationships[0]), 'updatedByUserId must not leak')
  })

  it('creates a relationship with an active definition', async () => {
    const before = await query('SELECT role, is_primary_contact FROM transfer_parties WHERE id = $1::uuid', [fixtures.partyId])
    const originalRole = before.rows[0].role

    const { status, body } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_B }
    )
    assert.equal(status, 201)
    assert.equal(body.message, 'Created')
    assert.equal(body.data.relationshipCode, RELATIONSHIP_CODE_B)
    assert.equal(body.data.transferPartyId, fixtures.partyId)

    const after = await query('SELECT role, is_primary_contact FROM transfer_parties WHERE id = $1::uuid', [fixtures.partyId])
    assert.equal(after.rows[0].role, originalRole, 'canonical party role must not change')
  })

  it('rejects creation with an inactive relationship definition', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_INACTIVE }
    )
    assert.equal(status, 400)
  })

  it('rejects creation with an unknown relationship definition', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: 'test_spc_nonexistent' }
    )
    assert.equal(status, 400)
  })

  it('rejects duplicate relationship assignments', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_A }
    )
    assert.equal(status, 409)
  })

  it('rejects creation without transfers:write', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:read']),
      { relationship_code: RELATIONSHIP_CODE_B }
    )
    assert.equal(status, 403)
  })

  it('rejects extra fields in the request body', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_B, accountable_institution_id: 999 }
    )
    assert.equal(status, 422)
  })

  it('rejects caller-supplied tenant in the request body', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_B, tenant_id: randomUUID() }
    )
    assert.equal(status, 422)
  })

  it('rejects caller-supplied actor in the request body', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_B, created_by_user_id: 99, updated_by_user_id: 99 }
    )
    assert.equal(status, 422)
  })

  it('rejects a party from a different transfer', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.otherPartyId}/relationships`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_B }
    )
    assert.equal(status, 404)
  })

  it('rejects a foreign-tenant user', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/parties/${fixtures.partyId}/relationships`,
      authHeader(3, 999, ['api', 'transfers:write']),
      { relationship_code: RELATIONSHIP_CODE_B }
    )
    assert.equal(status, 404)
  })
})

describe('Deferred routes', async () => {
  it('does not register POST /estate-contexts', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/estate-contexts`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { deceased_golden_record_id: randomUUID() }
    )
    assert.equal(status, 404)
  })

  it('does not register POST /representative-assignments', async () => {
    const { status } = await httpPost(
      `/api/v1/transfers/${fixtures.transferId}/representative-assignments`,
      authHeader(3, 5, ['api', 'transfers:write']),
      { person_golden_record_id: randomUUID(), capacity: 'executor' }
    )
    assert.equal(status, 404)
  })
})
