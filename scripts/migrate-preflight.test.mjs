import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  analyzeLedger,
  buildReport,
  loadMigrationFiles,
  migrationsDir,
  parseExpectations,
  resolveTarget,
  runPreflight,
  sha256,
} from './migrate-preflight.mjs'

const files = loadMigrationFiles(migrationsDir())
const F001 = files[0]
const F002 = files[1]
const EXPECT = { host: 'db.example.internal', database: 'deedly_verify', environment: 'disposable' }
const TARGET = { host: 'db.example.internal', port: 5432, database: 'deedly_verify', user: 'verifier' }

// Fake client: records every statement, serves the identity probe and a
// canned ledger. `ledger` of null simulates a missing ledger table (42P01).
function fakeClient({ ledger = [], readOnly = 'on', database = 'deedly_verify' } = {}) {
  const statements = []
  return {
    statements,
    query: async sql => {
      statements.push(sql)
      if (sql.includes('transfers_schema_migrations')) {
        if (ledger === null) {
          const e = new Error('relation "public.transfers_schema_migrations" does not exist')
          e.code = '42P01'
          throw e
        }
        return { rows: ledger }
      }
      if (sql.includes('current_database()')) {
        return { rows: [{ database, host: '10.0.0.8', port: 5432, version: '17.11', read_only: readOnly }] }
      }
      return { rows: [] }
    },
  }
}

const ledgerRow = (file, checksum = file.checksum) => ({
  filename: file.file, checksum, applied_at: new Date('2026-10-01T00:00:00Z'),
})

test('expectations require all three flags and a non-production label', () => {
  assert.throws(() => parseExpectations([]), /--expect-host/)
  assert.throws(
    () => parseExpectations(['--expect-host=h', '--expect-database=d', '--expect-environment=production']),
    /Refusing to run/
  )
  assert.deepEqual(
    parseExpectations(['--expect-host=h', '--expect-database=d', '--expect-environment=pilot']),
    { host: 'h', database: 'd', environment: 'pilot' }
  )
})

test('target resolution parses a DSN without exposing the password', () => {
  const t = resolveTarget({ DATABASE_URL: 'postgres://u:s3cret@db.internal:5544/preflight_db' })
  assert.equal(t.host, 'db.internal')
  assert.equal(t.port, 5544)
  assert.equal(t.database, 'preflight_db')
  assert.equal(t.user, 'u')
  assert.equal(t.connectionString.includes('s3cret'), true)
})

test('fresh target (no ledger) passes with every file pending in order', async () => {
  const client = fakeClient({ ledger: null })
  const report = await runPreflight({ client, files, expectations: EXPECT, target: TARGET })
  assert.equal(report.status, 'PASS')
  assert.equal(report.ledger.fresh, true)
  assert.equal(report.ledger.pendingCount, files.length)
  assert.deepEqual(report.ledger.pending, files.map(f => f.file))
  assert.equal(report.target.readOnlyEnforced, true)
})

test('fully applied clean history passes with nothing pending', async () => {
  const client = fakeClient({ ledger: files.map(f => ledgerRow(f)) })
  const report = await runPreflight({ client, files, expectations: EXPECT, target: TARGET })
  assert.equal(report.status, 'PASS')
  assert.deepEqual(report.ledger.pending, [])
  assert.deepEqual(report.ledger.violations, [])
})

test('partially applied history passes and lists the pending tail in order', async () => {
  const client = fakeClient({ ledger: [ledgerRow(F001), ledgerRow(F002)] })
  const report = await runPreflight({ client, files, expectations: EXPECT, target: TARGET })
  assert.equal(report.status, 'PASS')
  assert.deepEqual(report.ledger.pending, files.slice(2).map(f => f.file))
})

test('checksum mismatch is a FAIL, not a warning', async () => {
  const bad = { filename: F002.file, checksum: 'f'.repeat(64), applied_at: new Date() }
  const analysis = analyzeLedger(files, [ledgerRow(F001), bad])
  assert.equal(analysis.status, 'FAIL')
  assert.equal(analysis.violations[0].kind, 'checksum-mismatch')
  assert.equal(analysis.violations[0].filename, F002.file)
})

test('a ledger row naming a file absent from the checkout is a FAIL', () => {
  const ghost = { filename: '030_future.sql', checksum: 'a'.repeat(64), applied_at: new Date() }
  const analysis = analyzeLedger(files, [ledgerRow(F001), ghost])
  assert.equal(analysis.status, 'FAIL')
  assert.equal(analysis.violations[0].kind, 'unknown-applied')
})

test('an applied file after a pending one is a FAIL (skipped history)', () => {
  // 001 applied, 002 pending, 003 applied → 003 landed while 002 was skipped.
  const third = files[2]
  const analysis = analyzeLedger(files, [ledgerRow(F001), ledgerRow(third)])
  assert.equal(analysis.status, 'FAIL')
  assert.equal(analysis.violations[0].kind, 'applied-out-of-order')
  assert.equal(analysis.violations[0].filename, F002.file)
})

test('numbering gaps (reserved 022/027) are not violations', () => {
  const analysis = analyzeLedger(files, files.map(f => ledgerRow(f)))
  assert.equal(analysis.status, 'PASS')
})

test('database or host mismatch refuses before touching the ledger', async () => {
  const client = fakeClient({ database: 'production_db' })
  await assert.rejects(
    runPreflight({ client, files, expectations: EXPECT, target: TARGET }),
    /database: expected 'deedly_verify', connected to 'production_db'/
  )
  assert.equal(client.statements.filter(s => s.includes('transfers_schema_migrations')).length, 0)

  const wrongHost = fakeClient()
  await assert.rejects(
    runPreflight({ client: wrongHost, files, expectations: EXPECT, target: { ...TARGET, host: 'elsewhere' } }),
    /configured host/
  )
})

test('a session that is not read-only is refused', async () => {
  const client = fakeClient({ readOnly: 'off' })
  await assert.rejects(
    runPreflight({ client, files, expectations: EXPECT, target: TARGET }),
    /not read-only/
  )
})

test('the report carries only safe metadata — no credentials or DSNs', async () => {
  const target = resolveTarget({ DATABASE_URL: 'postgres://u:s3cret@db.example.internal:5432/deedly_verify' })
  const client = fakeClient()
  const report = await runPreflight({ client, files, expectations: EXPECT, target })
  const serialized = JSON.stringify(report)
  assert.ok(!serialized.includes('s3cret'))
  assert.ok(!serialized.includes('postgres://'))
  assert.ok(!serialized.includes('verifier'))
  assert.equal(report.target.database, 'deedly_verify')
  assert.equal(report.target.serverVersion, '17.11')
})

test('report shape: pending list, counts and status are all present', async () => {
  const client = fakeClient({ ledger: [ledgerRow(F001)] })
  const report = await runPreflight({ client, files, expectations: EXPECT, target: TARGET })
  assert.equal(report.ledger.appliedCount, 1)
  assert.equal(report.ledger.pendingCount, files.length - 1)
  assert.equal(report.preflight, 'transfers-migrations')
  assert.ok(report.checkedAt)
})

// Keep loadMigrationFiles honest: the manifest and the directory must agree
// on membership and ordering (the deep check lives in migration-manifest's
// own test).
test('migration directory loads the 27 committed files in canonical order', () => {
  assert.equal(files.length, 27)
  assert.deepEqual(files.map(f => f.file), [...files.map(f => f.file)].sort())
  assert.ok(files.every(f => /^[0-9]{3}_.+\.sql$/.test(f.file)))
  assert.equal(files.find(f => f.file.startsWith('022_')), undefined)
  assert.equal(files.find(f => f.file.startsWith('027_')), undefined)
})
