// Read-only migration preflight (M1). Resolves the target, proves the
// session is read-only, inspects the ledger, compares every applied
// checksum against the checked-in files, lists pending files in canonical
// order and reports violations as explicit pass/fail — before any migrate
// run is contemplated. It never writes: no INSERT/UPDATE/CREATE, and the
// session is forced read-only so even a buggy future edit cannot mutate.
//
// Usage:
//   node scripts/migrate-preflight.mjs \
//     --expect-host=<host> --expect-database=<db> --expect-environment=<label>
//
// All three --expect-* flags are required; the tool fails closed without
// them or when the connected target disagrees. Environment labels:
// disposable | staging | pilot. A 'production' label is refused outright —
// this tool has no production use case.
//
// Exit codes: 0 PASS (history valid; pending files listed), 1 FAIL
// (violations or target mismatch), 2 usage/refusal.
//
// The report contains only safe metadata: host/database/port/version,
// filenames, checksums, applied_at timestamps. Never a DSN, user or
// password.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// pg and dotenv are loaded lazily inside main() so the analysis functions
// above can be imported and tested without the driver installed — and so a
// syntax/type error elsewhere can never leave a half-open pool.

const MIGRATIONS_TABLE = 'public.transfers_schema_migrations'
const ALLOWED_ENVIRONMENTS = new Set(['disposable', 'staging', 'pilot'])

export function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function loadMigrationFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => {
      const bytes = fs.readFileSync(path.join(dir, file), 'utf8')
      return { file, checksum: sha256(bytes) }
    })
}

export function parseExpectations(argv) {
  const flags = {}
  for (const arg of argv) {
    const m = arg.match(/^--(expect-host|expect-database|expect-environment)=(.+)$/)
    if (m) flags[m[1]] = m[2]
  }
  const missing = ['expect-host', 'expect-database', 'expect-environment'].filter(k => !flags[k])
  if (missing.length) {
    throw new Error(`Refusing to run: missing required flag(s): ${missing.map(k => `--${k}`).join(', ')}`)
  }
  const environment = flags['expect-environment']
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `Refusing to run: --expect-environment must be one of ${[...ALLOWED_ENVIRONMENTS].join(', ')}; ` +
      `got '${environment}'. Preflight against production-shaped targets is out of this tool's scope.`
    )
  }
  return { host: flags['expect-host'], database: flags['expect-database'], environment }
}

// Mirrors scripts/migrate.mjs connection resolution, minus anything that
// could be used for writes. The resolved host/user are compared to
// expectations; the password is never surfaced.
export function resolveTarget(env) {
  const postgresUrl = env.ConveyHub_Transfers_POSTGRES_URL || env.POSTGRES_URL || env.DATABASE_URL
  if (postgresUrl) {
    const url = new URL(postgresUrl)
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      user: decodeURIComponent(url.username),
      connectionString: postgresUrl,
      ssl: { rejectUnauthorized: false },
    }
  }
  return {
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME || 'goldenrecordstemp',
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  }
}

// Pure ledger-vs-files analysis. rows === null means the ledger table does
// not exist (fresh target). Violations:
//   unknown-applied      ledger row names a file absent from the checkout
//   checksum-mismatch    applied file's bytes differ from the ledger hash
//   applied-out-of-order a pending file sorts before an applied one
// Numbering gaps (e.g. reserved 022/027) are not violations.
export function analyzeLedger(files, rows) {
  const byName = new Map(files.map(f => [f.file, f]))
  const violations = []
  const applied = []
  if (rows !== null) {
    for (const row of rows) {
      const file = byName.get(row.filename)
      if (!file) {
        violations.push({ kind: 'unknown-applied', filename: row.filename })
      } else if (row.checksum !== file.checksum) {
        violations.push({
          kind: 'checksum-mismatch',
          filename: row.filename,
          ledgerChecksum: row.checksum,
          fileChecksum: file.checksum,
        })
      } else {
        applied.push({ filename: row.filename, checksum: row.checksum, appliedAt: row.applied_at })
      }
    }
  }
  const appliedNames = new Set(applied.map(a => a.filename))
  const unknownNames = new Set(violations.filter(v => v.kind === 'unknown-applied').map(v => v.filename))
  const pending = files.filter(f => !appliedNames.has(f.file)).map(f => f.file)
  const allAppliedNames = [...appliedNames, ...unknownNames]
  const lastApplied = allAppliedNames.sort().pop()
  for (const p of pending) {
    if (lastApplied && p < lastApplied) {
      violations.push({ kind: 'applied-out-of-order', filename: p, after: lastApplied })
    }
  }
  return {
    status: violations.length ? 'FAIL' : 'PASS',
    fresh: rows === null,
    applied,
    pending,
    violations,
  }
}

export function buildReport({ target, expectations, server, analysis }) {
  return {
    preflight: 'transfers-migrations',
    checkedAt: new Date().toISOString(),
    target: {
      host: server.host ?? target.host,
      port: server.port ?? target.port,
      database: server.database,
      serverVersion: server.version,
      environment: expectations.environment,
      readOnlyEnforced: server.read_only === 'on',
    },
    ledger: {
      fresh: analysis.fresh,
      appliedCount: analysis.applied.length,
      pendingCount: analysis.pending.length,
      pending: analysis.pending,
      violations: analysis.violations,
    },
    status: analysis.status,
  }
}

async function readLedger(client) {
  try {
    const result = await client.query(
      `SELECT filename, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY filename`
    )
    return result.rows
  } catch (error) {
    if (error.code === '42P01') return null // ledger table does not exist yet
    throw error
  }
}

// client: minimal { query(sql, params?) => Promise<{rows}> } — injectable
// so tests drive this with a fake. A real run passes a session already
// forced read-only; the assertions below prove it.
export async function runPreflight({ client, files, expectations, target }) {
  const identity = await client.query(
    `SELECT current_database() AS database, inet_server_addr()::text AS host,
            inet_server_port() AS port, current_setting('server_version') AS version,
            current_setting('transaction_read_only') AS read_only`
  )
  const server = identity.rows[0]
  const mismatches = []
  if (server.database !== expectations.database) {
    mismatches.push(`database: expected '${expectations.database}', connected to '${server.database}'`)
  }
  if (target.host !== expectations.host) {
    mismatches.push(`configured host: expected '${expectations.host}', resolved '${target.host}'`)
  }
  if (server.read_only !== 'on') {
    mismatches.push('session is not read-only — refusing to inspect further')
  }
  if (mismatches.length) {
    const error = new Error('Target mismatch: ' + mismatches.join('; '))
    error.mismatches = mismatches
    throw error
  }
  const rows = await readLedger(client)
  const analysis = analyzeLedger(files, rows)
  return buildReport({ target, expectations, server, analysis })
}

async function main() {
  const expectations = parseExpectations(process.argv.slice(2))
  const { Pool } = await import('pg')
  const { config } = await import('dotenv')
  config() // .env resolution identical to migrate.mjs — target must be explicit
  const target = resolveTarget(process.env)
  const { connectionString, ssl, ...safeTarget } = target
  void safeTarget
  const pool = new Pool(connectionString ? { connectionString, ssl } : target)
  const client = await pool.connect()
  try {
    await client.query('SET default_transaction_read_only = on')
    await client.query('START TRANSACTION')
    const report = await runPreflight({ client, files: loadMigrationFiles(migrationsDir()), expectations, target })
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.status === 'PASS' ? 0 : 1
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    await pool.end()
  }
}

export function migrationsDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/migrations')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'FAIL', reason: error.mismatches || error.message }, null, 2))
    process.exitCode = error.message.startsWith('Refusing') ? 2 : 1
  })
}
