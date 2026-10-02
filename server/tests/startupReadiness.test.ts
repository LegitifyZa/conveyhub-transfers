import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  checkReadiness,
  expectedMigrationCount,
  loadManifest,
  resetReadinessCache,
} from '../readiness'
import { validateStartupConfig } from '../startupConfig'

const MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/lib/migrations/manifest.json',
)
const MANIFEST_ENTRIES = loadManifest(MANIFEST)!

const SECRET = 's3cr3t-pr0d-pw'

function prodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://svc:${SECRET}@db.example.internal:5432/appdb?sslmode=verify-full`,
    SECRET_KEY: 'real-prod-secret-' + 'x'.repeat(32),
    JWT_SECRET: 'real-jwt-secret-' + 'y'.repeat(32),
    LEGITIFY_API_BASE_URL: 'https://api.legitify.example',
    DEEDLY_API_BASE_URL: 'https://deedly-internal.example',
    ...overrides,
  }
}

// --- startup config ---

test('production: a complete safe configuration passes', () => {
  assert.deepEqual(validateStartupConfig(prodEnv()), [])
})

test('development: placeholder credentials are allowed (local dev preserved)', () => {
  const issues = validateStartupConfig({
    NODE_ENV: 'development',
    DB_USER: 'your_username',
    DB_PASSWORD: 'your_password',
  })
  assert.deepEqual(issues, [])
})

test('production: discrete credentials must be real values', () => {
  const env = prodEnv()
  delete env.DATABASE_URL
  const issues = validateStartupConfig({ ...env, DB_HOST: 'db.example.internal', DB_NAME: 'appdb', DB_USER: 'svc', DB_PASSWORD: SECRET })
  assert.deepEqual(issues, [])
  const bad = validateStartupConfig({ ...env, DB_HOST: 'localhost', DB_NAME: 'x', DB_USER: 'your_username', DB_PASSWORD: 'your_password' })
  const names = bad.map(i => i.name)
  assert.ok(names.includes('DB_USER') && names.includes('DB_PASSWORD'))
})

test('production: a malformed or scheme-less DSN is rejected', () => {
  assert.ok(validateStartupConfig(prodEnv({ DATABASE_URL: 'not-a-url' })).some(i => /valid URL/.test(i.reason)))
  assert.ok(validateStartupConfig(prodEnv({ DATABASE_URL: 'mysql://u:p@h/db' })).some(i => /scheme/.test(i.reason)))
})

test('production: sslmode=disable / no-verify DSNs are rejected', () => {
  for (const mode of ['disable', 'no-verify']) {
    const issues = validateStartupConfig(prodEnv({ DATABASE_URL: `postgresql://svc:${SECRET}@h/db?sslmode=${mode}` }))
    assert.ok(issues.some(i => new RegExp(`sslmode=${mode}`).test(i.reason)), mode)
  }
})

test('production: missing secrets are named without values', () => {
  const issues = validateStartupConfig(prodEnv({ JWT_SECRET: undefined }))
  assert.ok(issues.some(i => i.name === 'JWT_SECRET'))
})

test('production: both upstream base URLs are required, https-only, non-loopback', () => {
  for (const name of ['LEGITIFY_API_BASE_URL', 'DEEDLY_API_BASE_URL'] as const) {
    assert.ok(validateStartupConfig(prodEnv({ [name]: undefined })).some(i => i.name === name), `${name} missing`)
    assert.ok(validateStartupConfig(prodEnv({ [name]: 'http://svc.internal:8000' })).some(i => i.name === name && /https/.test(i.reason)), `${name} http`)
    assert.ok(validateStartupConfig(prodEnv({ [name]: 'https://localhost' })).some(i => i.name === name && /loopback/.test(i.reason)), `${name} loopback`)
  }
})

test('production: the legacy bridge is rejected', () => {
  assert.ok(validateStartupConfig(prodEnv({ LEGACY_ACCOUNTABLE_INSTITUTION_ID: '42' })).some(i => i.name === 'LEGACY_ACCOUNTABLE_INSTITUTION_ID'))
})

test('issue strings never contain the supplied secret values', () => {
  const issues = validateStartupConfig(prodEnv({
    DATABASE_URL: `postgresql://svc:${SECRET}@h/db?sslmode=disable`,
    JWT_SECRET: '',
  }))
  for (const i of issues) {
    assert.ok(!i.reason.includes(SECRET) && !i.name.includes(SECRET), `${i.name}: ${i.reason}`)
  }
})

// --- readiness ---

function ledgerRows(entries = MANIFEST_ENTRIES) {
  return entries.map(e => ({ filename: e.file, checksum: e.sha256 }))
}

function fakeQuery(opts: {
  ledger?: Record<string, string>[]
  dbFails?: boolean
  ledgerFails?: boolean
  hang?: boolean
}) {
  const calls: string[] = []
  let active = 0
  let maxActive = 0
  return {
    calls,
    get maxActive() { return maxActive },
    query: async (text: string) => {
      calls.push(text)
      active++
      maxActive = Math.max(maxActive, active)
      try {
        if (opts.hang) return await new Promise<never>(() => {})
        if (opts.dbFails) throw new Error('connection refused — host detail must not leak')
        if (text.includes('transfers_schema_migrations')) {
          if (opts.ledgerFails) throw new Error('relation does not exist')
          return { rows: opts.ledger ?? ledgerRows() }
        }
        return { rows: [{}] }
      } finally {
        active--
      }
    },
  }
}

const okFetch: typeof fetch = async () => new Response('{"status":"ok"}', { status: 200 })

test('ready when ledger matches every manifest file and checksum', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({}).query, manifestPath: MANIFEST })
  assert.equal(r.ready, true)
  assert.deepEqual(r.checks, { config: 'ok', database: 'ok', schema: 'ok', upstream: 'not-configured' })
})

test('equal count but wrong filename is not ready', async () => {
  resetReadinessCache()
  const wrong = ledgerRows()
  wrong[0] = { filename: '999_not_in_manifest.sql', checksum: MANIFEST_ENTRIES[0].sha256 }
  const r = await checkReadiness({ query: fakeQuery({ ledger: wrong }).query, manifestPath: MANIFEST })
  assert.equal(r.checks.schema, 'schema-missing-migrations')
  assert.equal(r.ready, false)
})

test('equal count but wrong checksum is not ready', async () => {
  resetReadinessCache()
  const wrong = ledgerRows()
  wrong[1] = { filename: MANIFEST_ENTRIES[1].file, checksum: 'f'.repeat(64) }
  const r = await checkReadiness({ query: fakeQuery({ ledger: wrong }).query, manifestPath: MANIFEST })
  assert.equal(r.checks.schema, 'schema-checksum-mismatch')
  assert.equal(r.ready, false)
})

test('a ledger row beyond the approved manifest is schema-drift', async () => {
  resetReadinessCache()
  const extra = [...ledgerRows(), { filename: '028_extra.sql', checksum: 'a'.repeat(64) }]
  const r = await checkReadiness({ query: fakeQuery({ ledger: extra }).query, manifestPath: MANIFEST })
  assert.equal(r.checks.schema, 'schema-drift')
  assert.equal(r.ready, false)
})

test('unavailable database means not-ready and no schema probe runs', async () => {
  resetReadinessCache()
  const f = fakeQuery({ dbFails: true })
  const r = await checkReadiness({ query: f.query, manifestPath: MANIFEST })
  assert.equal(r.ready, false)
  assert.equal(r.checks.database, 'unavailable')
  assert.equal(f.calls.length, 1)
})

test('missing ledger table is not-ready', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({ ledgerFails: true }).query, manifestPath: MANIFEST })
  assert.equal(r.checks.schema, 'ledger-missing')
})

test('unreadable manifest fails closed', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({}).query, manifestPath: '/nonexistent/manifest.json' })
  assert.equal(r.checks.schema, 'manifest-unavailable')
  assert.equal(r.ready, false)
})

test('a hung probe is bounded by the explicit timeout', async () => {
  resetReadinessCache()
  const start = Date.now()
  const r = await checkReadiness({ query: fakeQuery({ hang: true }).query, manifestPath: MANIFEST, timeoutMs: 50 })
  assert.equal(r.ready, false)
  assert.equal(r.checks.database, 'unavailable')
  assert.ok(Date.now() - start < 2000)
})

test('configured upstream is probed; down upstream means not-ready', async () => {
  resetReadinessCache()
  const down = await checkReadiness({
    query: fakeQuery({}).query,
    manifestPath: MANIFEST,
    upstreamBaseUrl: 'https://deedly.internal',
    fetchImpl: async () => { throw new Error('unreachable') },
  })
  assert.equal(down.checks.upstream, 'unavailable')
  assert.equal(down.ready, false)

  resetReadinessCache()
  const up = await checkReadiness({
    query: fakeQuery({}).query,
    manifestPath: MANIFEST,
    upstreamBaseUrl: 'https://deedly.internal',
    fetchImpl: okFetch,
  })
  assert.equal(up.checks.upstream, 'ok')
  assert.equal(up.ready, true)
})

test('invalid config keeps a reachable service not-ready', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({}).query, configValid: false, manifestPath: MANIFEST })
  assert.equal(r.ready, false)
  assert.equal(r.checks.config, 'invalid-configuration')
})

test('concurrent outage probes are independent and recover cleanly', async () => {
  resetReadinessCache()
  const f = fakeQuery({ dbFails: true })
  const probes = Array.from({ length: 8 }, () =>
    checkReadiness({ query: f.query, manifestPath: MANIFEST }))
  const results = await Promise.all(probes)
  for (const r of results) {
    assert.equal(r.ready, false)
    assert.equal(r.checks.database, 'unavailable')
  }
  // Each probe ran exactly its own probe sequence; all released.
  assert.equal(f.calls.length, 8)
  f.query = fakeQuery({}).query
  const recovered = await Promise.all(
    Array.from({ length: 4 }, () => checkReadiness({ query: f.query, manifestPath: MANIFEST })))
  for (const r of recovered) assert.equal(r.ready, true)
})

test('readiness output contains only fixed labels — no connection details', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({ dbFails: true }).query, manifestPath: MANIFEST })
  const body = JSON.stringify(r)
  for (const bad of [SECRET, 'db.example.internal', 'connection refused', 'host']) {
    assert.ok(!body.includes(bad), body)
  }
  assert.equal(expectedMigrationCount(MANIFEST), 27)
})
