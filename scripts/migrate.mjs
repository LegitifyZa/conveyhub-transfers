import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'

config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

async function runMigration() {
  console.log('🗄️ Running database migrations...')

  try {
    const targetPool = new Pool(dbConfig)

  if (!hasPostgresUrl) {
    const postgresPool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: 'postgres',
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: dbConfig.ssl,
    })

    try {
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
      }
    } finally {
      await postgresPool.end()
    }
  } else {
    console.log('ℹ️ POSTGRES_URL detected, skipping database creation')
  }

  const migrationsDir = path.join(__dirname, '../src/lib/migrations')
    const files = fs
      .readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort()

    const client = await targetPool.connect()
    try {
      for (const file of files) {
        const filePath = path.join(migrationsDir, file)
        const sql = fs.readFileSync(filePath, 'utf8')
        console.log(`🔧 Running ${file}...`)
        await client.query(sql)
      }
      console.log('✅ Migrations completed successfully')
    } finally {
      await client.release()
    }
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    await targetPool.end()
  }
}

runMigration().then(() => {
  console.log('🎉 Database migration completed!')
  process.exit(0)
}).catch((error) => {
  console.error('❌ Migration failed:', error)
  process.exit(1)
})
