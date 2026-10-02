import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDbTls } from './db-tls.mjs'

const DSN = 'postgresql://u:p@db.example.com/app'
const caFile = path.join(os.tmpdir(), `db-tls-test-${process.pid}.pem`)
fs.writeFileSync(caFile, 'TEST-CA-PEM-DATA')
test.after(() => fs.rmSync(caFile, { force: true }))

test('sslmode=require resolves to full verification and is stripped from the DSN', () => {
  const r = resolveDbTls(`${DSN}?sslmode=require&channel_binding=require`, {})
  assert.equal(r.ssl.rejectUnauthorized, true)
  assert.equal(r.ssl.ca, undefined)
  assert.ok(!r.connectionString.includes('sslmode'))
  assert.ok(r.connectionString.includes('channel_binding=require')) // kept for pg to honour
  assert.deepEqual(r.warnings, [])
})

test('verify-ca and verify-full also resolve to full verification', () => {
  for (const mode of ['verify-ca', 'verify-full', 'prefer', 'allow']) {
    const r = resolveDbTls(`${DSN}?sslmode=${mode}`, {})
    assert.equal(r.ssl.rejectUnauthorized, true, mode)
  }
})

test('sslmode=disable turns TLS off', () => {
  assert.equal(resolveDbTls(`${DSN}?sslmode=disable`, {}).ssl, false)
})

test('no-verify is explicit-only, downgrade-flagged, never silent', () => {
  const r = resolveDbTls(`${DSN}?sslmode=no-verify`, {})
  assert.equal(r.ssl.rejectUnauthorized, false)
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /no-verify/i)
})

test('a DSN without sslmode defaults to verified TLS (previous unverified default closed)', () => {
  const r = resolveDbTls(DSN, {})
  assert.equal(r.ssl.rejectUnauthorized, true)
})

test('sslrootcert DSN param loads the trusted CA and is stripped', () => {
  const r = resolveDbTls(`${DSN}?sslmode=require&sslrootcert=${encodeURIComponent(caFile)}`, {})
  assert.equal(r.ssl.ca, 'TEST-CA-PEM-DATA')
  assert.ok(!r.connectionString.includes('sslrootcert'))
})

test('PGSSLROOTCERT env supplies the trusted CA', () => {
  const r = resolveDbTls(`${DSN}?sslmode=require`, { PGSSLROOTCERT: caFile })
  assert.equal(r.ssl.ca, 'TEST-CA-PEM-DATA')
})

test('DSN sslrootcert beats env CA sources', () => {
  const r = resolveDbTls(`${DSN}?sslrootcert=${encodeURIComponent(caFile)}`, {
    PGSSLROOTCERT: '/nonexistent/other.pem', DB_SSL_CA_FILE: '/nonexistent/third.pem',
  })
  assert.equal(r.ssl.ca, 'TEST-CA-PEM-DATA')
})

test('PGSSLMODE applies only when the DSN has no sslmode', () => {
  assert.equal(resolveDbTls(DSN, { PGSSLMODE: 'disable' }).ssl, false)
  assert.equal(resolveDbTls(`${DSN}?sslmode=require`, { PGSSLMODE: 'disable' }).ssl.rejectUnauthorized, true)
})

test('non-DSN path: DB_SSL=true verified, unset disables, no-verify warns', () => {
  assert.equal(resolveDbTls(null, { DB_SSL: 'true' }).ssl.rejectUnauthorized, true)
  assert.equal(resolveDbTls(null, {}).ssl, false)
  const nv = resolveDbTls(null, { DB_SSL: 'no-verify' })
  assert.equal(nv.ssl.rejectUnauthorized, false)
  assert.equal(nv.warnings.length, 1)
})

test('a missing CA file fails closed', () => {
  assert.throws(
    () => resolveDbTls(`${DSN}?sslrootcert=/definitely/missing/ca.pem`, {}),
    /CA file not found/,
  )
})
