import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { createHash } from 'node:crypto'
import { resolveDbTls } from './db-tls.mjs'

config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_TABLE = 'public.transfers_schema_migrations'

// Session-level advisory lock: serializes cooperating migration runners.
// The key is pg_try_advisory_lock(hashtext('deedly-migration-runner')).
// It is held on one dedicated connection for the whole run and survives
// the per-migration BEGIN/COMMIT blocks (session, not transaction, scope).
// It does NOT prevent other clients writing — it is a runner mutex only.
const MIGRATION_LOCK_LABEL = 'deedly-migration-runner'

async function acquireMigrationLock(client) {
  const { rows } = await client.query(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
    [MIGRATION_LOCK_LABEL]
  )
  if (!rows[0]?.acquired) {
    throw new Error(
      `🔒 Another migration runner holds the '${MIGRATION_LOCK_LABEL}' advisory lock. ` +
      'Refusing to proceed — no schema or ledger changes were made.'
    )
  }
}

async function withMigrationLock(client, fn) {
  await acquireMigrationLock(client)
  try {
    return await fn()
  } finally {
    // Never let a release failure mask the run's own error.
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_LABEL])
    } catch (releaseError) {
      console.error('⚠️ Advisory-lock release failed:', releaseError.message)
      // Lock state is now uncertain: the caller must destroy the
      // connection rather than return it to the pool, so a surviving
      // session cannot keep the lock held. The helper never releases a
      // client it does not own — it hands the cause to the owner.
      client.__migrationLockDestroy = releaseError
    }
  }
}

const postgresUrl = process.env.ConveyHub_Transfers_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
const hasPostgresUrl = Boolean(postgresUrl)

// Connection-string validation runs before ANY driver parse or write:
// malformed/unsupported DSNs and known transaction-pooler endpoints
// (e.g. Neon '-pooler' hosts, where session-level advisory locks cannot
// serialize — each client can land on a different backend session) are
// REJECTED here, before a pool or database can be created. The runner
// never derives or silently switches endpoints — the operator must
// configure a direct migration connection.
// LIMITATION: hostname matching cannot prove session affinity for an
// arbitrary proxy — this guard covers known pooler conventions only.
// Error messages carry scheme/host only; credentials never appear.
const KNOWN_POOLER_PATTERNS = [/-pooler[.-]/i, /\.pooler\./i]

function migrationTargetHost() {
  if (postgresUrl) {
    let url
    try {
      url = new URL(postgresUrl)
    } catch {
      throw new Error('❌ Migration connection string is not a valid URL — refusing to start.')
    }
    if (!/^postgres(ql)?:$/i.test(url.protocol)) {
      throw new Error(`❌ Unsupported migration connection scheme '${url.protocol}' — expected postgresql://.`)
    }
    if (!url.hostname) {
      throw new Error('❌ Migration connection string has no hostname — refusing to start.')
    }
    return url.hostname
  }
  return process.env.DB_HOST || 'localhost'
}

function assertDirectMigrationTarget() {
  const host = migrationTargetHost()
  if (KNOWN_POOLER_PATTERNS.some((p) => p.test(host))) {
    throw new Error(
      `❌ Refusing to migrate via '${host}': this is a known transaction-pooler ` +
      'endpoint and the session-level advisory lock cannot serialize runners ' +
      'through it. Configure a direct (non-pooled) connection string or DB_HOST ' +
      'for migration runs — no schema or ledger changes were made.'
    )
  }
}

assertDirectMigrationTarget()

// Certificate and hostname verification are the default whenever TLS is used.
// no-verify is an explicit opt-out only; it never happens silently.
const tls = resolveDbTls(postgresUrl || null, process.env)
for (const warning of tls.warnings) console.warn(`⚠️ ${warning}`)

const dbConfig = hasPostgresUrl
  ? { connectionString: tls.connectionString, ssl: tls.ssl, enableChannelBinding: tls.enableChannelBinding }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'goldenrecordstemp',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'Password@01',
      ssl: tls.ssl,
      enableChannelBinding: tls.enableChannelBinding,
    }

function sha256(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function parseArgs() {
  const args = process.argv.slice(2)
  const baselineIndex = args.indexOf('--baseline-through')
  if (baselineIndex !== -1) {
    const value = args[baselineIndex + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error('--baseline-through requires a filename argument')
    }
    return { baselineThrough: value }
  }
  return {}
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename VARCHAR(255) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function getAppliedMigrations(client) {
  const result = await client.query(`
    SELECT filename, checksum, applied_at
    FROM ${MIGRATIONS_TABLE}
    ORDER BY filename
  `)
  const map = new Map()
  for (const row of result.rows) {
    map.set(row.filename, { checksum: row.checksum, applied_at: row.applied_at })
  }
  return map
}

async function loadMigrations() {
  const migrationsDir = path.join(__dirname, '../src/lib/migrations')
  const files = fs
    .readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort()
  return files.map(file => {
    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, 'utf8')
    return { file, sql, checksum: sha256(sql) }
  })
}

async function createDatabaseIfNeeded() {
  if (hasPostgresUrl) {
    console.log('ℹ️ POSTGRES_URL detected, skipping database creation')
    return
  }
  const postgresPool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: 'postgres',
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl,
  })
  const postgresClient = await postgresPool.connect()
  try {
    await postgresClient.query(`CREATE DATABASE ${dbConfig.database}`)
    console.log(`✅ Database '${dbConfig.database}' created`)
  } catch (error) {
    if (error.code === '42P04') {
      console.log(`ℹ️ Database '${dbConfig.database}' already exists`)
    } else if (error.code === '42501') {
      console.log(`ℹ️ Could not create database '${dbConfig.database}' due to insufficient privileges; will attempt to migrate the existing database`)
    } else {
      console.error('❌ Error creating database:', error.message)
      throw error
    }
  } finally {
    await postgresClient.release()
    await postgresPool.end()
  }
}

async function runMigrations(client, files, applied) {
  for (const { file, sql, checksum } of files) {
    const existing = applied.get(file)
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `❌ Checksum mismatch for ${file}: the migration has been modified since it was applied. ` +
          `Expected ${existing.checksum}, got ${checksum}. Refusing to proceed.`
        )
      }
      console.log(`⏭️ Skipping ${file} (already applied at ${existing.applied_at.toISOString()})`)
      continue
    }
    console.log(`🔧 Running ${file}...`)
    await client.query(sql)
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum, applied_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [file, checksum]
    )
    console.log(`✅ Applied ${file}`)
  }
}

async function runBaseline(client, files, throughFile) {
  const index = files.findIndex(f => f.file === throughFile)
  if (index === -1) {
    throw new Error(`❌ Baseline target file not found: ${throughFile}`)
  }
  const baselineFiles = files.slice(0, index + 1)
  console.log('📌 Baseline mode — the following migrations will be recorded as already applied (no SQL will be executed):')
  for (const { file } of baselineFiles) {
    console.log(`  - ${file}`)
  }
  for (const { file, checksum } of baselineFiles) {
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum, applied_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (filename) DO UPDATE
       SET checksum = EXCLUDED.checksum,
           applied_at = EXCLUDED.applied_at`,
      [file, checksum]
    )
  }
  console.log(`✅ Baseline recorded through ${throughFile}`)
}

async function runMigration() {
  console.log('�️ Running database migrations...')
  assertDirectMigrationTarget() // before any write, including DB creation
  await createDatabaseIfNeeded()
  const pool = new Pool(dbConfig)
  const client = await pool.connect()
  try {
    // One dedicated connection holds the session-level advisory lock for
    // the entire run — including across per-migration BEGIN/COMMIT blocks.
    await withMigrationLock(client, async () => {
      await ensureLedger(client)
      const files = await loadMigrations()
      const args = parseArgs()
      if (args.baselineThrough) {
        await runBaseline(client, files, args.baselineThrough)
      } else {
        const applied = await getAppliedMigrations(client)
        await runMigrations(client, files, applied)
        console.log('✅ Migrations completed successfully')
      }
    })
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    throw error
  } finally {
    // Exactly one release: destroy (err truthy) when the lock helper
    // flagged an unlock failure, else return the client to the pool.
    try { client.release(client.__migrationLockDestroy) } finally { await pool.end() }
  }
}

runMigration().then(() => {
  console.log('🎉 Database migration completed!')
  process.exit(0)
}).catch((error) => {
  console.error('❌ Database migration failed:', error)
  process.exit(1)
})
