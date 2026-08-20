import { Pool, PoolConfig, QueryResultRow } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

interface DatabaseConfig extends PoolConfig {
  min?: number
  max?: number
}

const connectionString = process.env.ConveyHub_Transfers_POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING || process.env.ConveyHub_Transfers_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL

const config: DatabaseConfig = connectionString
  ? {
      connectionString,
      ssl: { rejectUnauthorized: false },
      min: parseInt(process.env.DB_MIN_CONNECTIONS || '2', 10),
      max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      query_timeout: 30000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'legitify_convey_hub',
      user: process.env.DB_USER || 'your_username',
      password: process.env.DB_PASSWORD || 'your_password',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      min: parseInt(process.env.DB_MIN_CONNECTIONS || '2', 10),
      max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      query_timeout: 30000,
    }

const schema = process.env.DB_SCHEMA || 'transfers'
if (schema !== 'public') {
  config.options = `-c search_path=${schema},public`
}

export const pool = new Pool(config)

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
})

export interface QueryLog {
  text: string
  duration: number
  rows: number | null
}

export async function query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now()
  try {
    const result = await pool.query<T>(text, params)
    const duration = Date.now() - start
    if (process.env.NODE_ENV !== 'production') {
      console.log('Executed query', { text: text.slice(0, 200), duration, rows: result.rowCount })
    }
    return result
  } catch (error) {
    console.error('Query error:', { text, params, error })
    throw error
  }
}

export async function withTransaction<T>(callback: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function checkDatabaseHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    await query('SELECT NOW()')
    return { healthy: true, latencyMs: Date.now() - start }
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  }
}
