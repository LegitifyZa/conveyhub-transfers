import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkReadiness, expectedMigrationCount, resetReadinessCache } from '../readiness'
import { validateStartupConfig } from '../startupConfig'

const MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/lib/migrations/manifest.json',
)

const SECRET = 's3cr3t-pr0d-pw'

function prodEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://svc:${SECRET}@db.example.internal:5432/appdb?sslmode=verify-full`,
    SECRET_KEY: 'real-prod-secret-' + 'x'.repeat(32),
    JWT_SECRET: 'real-jwt-secret-' + 'y'.repeat(32),
    LEGITIFY_API_BASE_URL: 'https://api.legitify.example',
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
  const issues = validateStartupConfig(prodEnv({ JWT_SECRET: undefined as unknown as string }))
  assert.ok(issues.some(i => i.name === 'JWT_SECRET'))
})

test('production: loopback upstream and the legacy bridge are rejected', () => {
  assert.ok(validateStartupConfig(prodEnv({ LEGITIFY_API_BASE_URL: 'http://localhost:8000' })).some(i => i.name === 'LEGITIFY_API_BASE_URL'))
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

function fakeQuery(opts: { ledgerRows?: number; dbFails?: boolean; ledgerFails?: boolean }) {
  const calls: string[] = []
  return {
    calls,
    query: async (text: string) => {
      calls.push(text)
      if (opts.dbFails) throw new Error('connection refused — host detail must not leak')
      if (text.includes('transfers_schema_migrations')) {
        if (opts.ledgerFails) throw new Error('relation does not exist')
        return { rows: [{ n: opts.ledgerRows ?? 27 }] }
      }
      return { rows: [{}] }
    },
  }
}

test('ready when database reachable and ledger matches the manifest', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({}).query, manifestPath: MANIFEST })
  assert.equal(r.ready, true)
  assert.deepEqual(r.checks, { config: 'ok', database: 'ok', schema: 'ok' })
})

test('unavailable database means not-ready and no schema probe runs', async () => {
  resetReadinessCache()
  const f = fakeQuery({ dbFails: true })
  const r = await checkReadiness({ query: f.query, manifestPath: MANIFEST })
  assert.equal(r.ready, false)
  assert.equal(r.checks.database, 'unavailable')
  assert.equal(f.calls.length, 1)
  assert.ok(JSON.stringify(r).length < 400)
})

test('missing ledger table and pending migrations are both not-ready', async () => {
  resetReadinessCache()
  const missing = await checkReadiness({ query: fakeQuery({ ledgerFails: true }).query, manifestPath: MANIFEST })
  assert.equal(missing.checks.schema, 'ledger-missing')
  const pending = await checkReadiness({ query: fakeQuery({ ledgerRows: 20 }).query, manifestPath: MANIFEST })
  assert.equal(pending.checks.schema, 'schema-incomplete')
})

test('unreadable manifest fails closed', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({}).query, manifestPath: '/nonexistent/manifest.json' })
  assert.equal(r.checks.schema, 'manifest-unavailable')
  assert.equal(r.ready, false)
})

test('invalid config keeps a reachable service not-ready', async () => {
  resetReadinessCache()
  const r = await checkReadiness({ query: fakeQuery({}).query, configValid: false, manifestPath: MANIFEST })
  assert.equal(r.ready, false)
  assert.equal(r.checks.config, 'invalid-configuration')
})

test('readiness recovers when the dependency returns', async () => {
  resetReadinessCache()
  const f = fakeQuery({ dbFails: true })
  const down = await checkReadiness({ query: f.query, manifestPath: MANIFEST })
  assert.equal(down.ready, false)
  f.query = async (t: string) =>
    t.includes('transfers_schema_migrations') ? { rows: [{ n: 27 }] } : { rows: [{}] }
  const up = await checkReadiness({ query: f.query, manifestPath: MANIFEST })
  assert.equal(up.ready, true)
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
