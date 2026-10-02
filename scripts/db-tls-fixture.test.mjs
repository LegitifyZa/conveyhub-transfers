// End-to-end TLS regression fixture for the Node DB path (M1).
// Drives resolveDbTls -> pg Client against a local TLS fixture server that
// speaks the real SSLRequest negotiation. Certificates are generated
// locally by openssl — no live credentials involved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolveDbTls } from './db-tls.mjs'
import { generateTestCerts, haveOpenssl, startTlsServer } from './tls-test-fixture.mjs'

const CERT_ERROR = /CERT|ALTNAME|issuer|self.signed|verify/i
const havePg = (() => {
  try { createRequire(import.meta.url)('pg'); return true } catch { return false }
})()

// Local runs may skip when the toolchain is absent; CI must have it.
const missingPrereqs = !(haveOpenssl() && havePg)
const skip = missingPrereqs && !process.env.CI && 'needs openssl + pg'

test('pg client TLS behaviour through resolveDbTls', { skip }, async (t) => {
  const certs = generateTestCerts()
  const good = await startTlsServer(certs.good)
  const badName = await startTlsServer(certs.badName)
  const { Client } = await import('pg')
  t.after(() => { good.close(); badName.close() })

  const attempt = async (dsn, server) => {
    server.events.length = 0
    try {
      const r = resolveDbTls(dsn, {})
      const c = new Client({ connectionString: r.connectionString, ssl: r.ssl, connectionTimeoutMillis: 4000 })
      await c.connect()
      await c.end()
      return { connected: true }
    } catch (e) {
      return {
        error: e.code || e.message,
        certificateRejection: CERT_ERROR.test(e.code || '') || CERT_ERROR.test(e.message),
        handshook: server.events.includes('secureConnection'),
      }
    }
  }

  await t.test('trusted CA + matching DNS host: handshake completes', async () => {
    const r = await attempt(
      `postgresql://u:p@localhost:${good.port}/x?sslmode=require&sslrootcert=${encodeURIComponent(certs.ca)}`, good)
    // TLS handshake completed; failure is post-TLS (server closes), not a cert error.
    assert.equal(r.handshook, true)
    assert.equal(r.certificateRejection, false)
  })

  await t.test('untrusted CA: certificate chain refused', async () => {
    // Node's ca: option is exclusive — trusting only an unrelated CA fails.
    const r = await attempt(
      `postgresql://u:p@localhost:${good.port}/x?sslmode=require&sslrootcert=${encodeURIComponent(certs.bogusCa)}`, good)
    assert.equal(r.certificateRejection, true)
    assert.equal(r.handshook, false)
  })

  await t.test('DNS hostname mismatch: cert for not-localhost.test refused on localhost', async () => {
    const r = await attempt(
      `postgresql://u:p@localhost:${badName.port}/x?sslmode=require&sslrootcert=${encodeURIComponent(certs.ca)}`, badName)
    assert.equal(r.certificateRejection, true)
    assert.match(r.error, /ALTNAME_INVALID/)
  })

  await t.test('IP-literal host: cert without IP SAN refused (servername gap closed)', async () => {
    const r = await attempt(
      `postgresql://u:p@127.0.0.1:${good.port}/x?sslmode=require&sslrootcert=${encodeURIComponent(certs.ca)}`, good)
    assert.equal(r.certificateRejection, true)
    assert.match(r.error, /ALTNAME_INVALID/)
  })

  await t.test('explicit no-verify connects despite untrusted/mismatched cert', async () => {
    const r = await attempt(`postgresql://u:p@127.0.0.1:${good.port}/x?sslmode=no-verify`, good)
    assert.equal(r.handshook, true)
  })

  await t.test('channel_binding=require is rejected before any connection', async () => {
    const eventsBefore = good.events.length
    assert.throws(
      () => resolveDbTls(`postgresql://u:p@localhost:${good.port}/x?sslmode=require&channel_binding=require`, {}),
      /not supported/,
    )
    assert.equal(good.events.length, eventsBefore) // no connection attempt was made
  })

  await t.test('channel_binding=prefer maps to enableChannelBinding', async () => {
    const r = resolveDbTls(`postgresql://u:p@localhost:${good.port}/x?sslmode=require&channel_binding=prefer`, {})
    assert.equal(r.enableChannelBinding, true)
  })
})
