import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { createHash } from 'node:crypto'

config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_TABLE = 'public.transfers_schema_migrations'

const postgresUrl = process.env.ConveyHub_Transfers_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
const hasPostgresUrl = Boolean(postgresUrl)

const dbConfig = hasPostgresUrl
  ? { connectionString: postgresUrl, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'goldenrecordstemp',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'Password@01',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
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
  await createDatabaseIfNeeded()
  const pool = new Pool(dbConfig)
  const client = await pool.connect()
  try {
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
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    throw error
  } finally {
    await client.release()
    await pool.end()
  }
}

runMigration().then(() => {
  console.log('🎉 Database migration completed!')
  process.exit(0)
}).catch((error) => {
  console.error('❌ Database migration failed:', error)
  process.exit(1)
})
