import { Client, Pool, PoolConfig, QueryResultRow } from 'pg'
import dotenv from 'dotenv'
// Shared M1 resolver: verified TLS by default, explicit no-verify refused in
// production, channel_binding=require rejected (pg cannot enforce it).
import { resolveDbTls } from '../scripts/db-tls.mjs'

dotenv.config()

interface DatabaseConfig extends PoolConfig {
  min?: number
  max?: number
  enableChannelBinding?: boolean
}

// The specialist DB suite may redirect this whole process — including the
// Express app — at an explicitly approved test database. The override is
// honoured only alongside the suite opt-in, and a missing URL then fails
// fast rather than silently falling back to the ordinary configuration.
let specialistTestUrl: string | undefined
if (process.env.RUN_SPECIALIST_DB_TESTS === '1') {
  specialistTestUrl = process.env.SPECIALIST_TEST_DATABASE_URL
  if (!specialistTestUrl) {
    throw new Error('RUN_SPECIALIST_DB_TESTS requires SPECIALIST_TEST_DATABASE_URL to be set')
  }
}

const connectionString = specialistTestUrl || process.env.ConveyHub_Transfers_POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING || process.env.ConveyHub_Transfers_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL

const tls = resolveDbTls(connectionString || null, process.env)
for (const warning of tls.warnings) {
  console.warn(`Database TLS: ${warning}`)
}

const poolBounds = {
  min: parseInt(process.env.DB_MIN_CONNECTIONS || '2', 10),
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  query_timeout: 30000,
}

const config: DatabaseConfig = tls.connectionString
  ? {
      connectionString: tls.connectionString,
      ssl: tls.ssl,
      enableChannelBinding: tls.enableChannelBinding,
      ...poolBounds,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'legitify_convey_hub',
      user: process.env.DB_USER || 'your_username',
      password: process.env.DB_PASSWORD || 'your_password',
      ssl: tls.ssl,
      enableChannelBinding: tls.enableChannelBinding,
      ...poolBounds,
    }

const schema = process.env.DB_SCHEMA || 'transfers'

export const pool = new Pool(config)

pool.on('connect', (client) => {
  client.query(`SET search_path = ${schema}, public`)
})

pool.on('error', () => {
  console.error('Unexpected error on idle database client')
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
      console.log('Executed query', { duration, rows: result.rowCount })
    }
    return result
  } catch (error) {
    console.error('Database query failed')
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
      error: 'Database unavailable',
    }
  }
}

// Readiness probes deliberately run on a dedicated short-lived Client, not
// the shared pool: pg's `query_timeout` only fails the local call and
// dequeues the query — it sends NO CancelRequest, so a statement that
// outlives the race would keep running on a pooled connection. With a
// dedicated client, `end()` while a query is in flight force-destroys the
// socket (pg does this explicitly so a hung query can't block end), which
// terminates the backend session and its statement. `connectionTimeoutMillis`
// likewise destroys the socket on connect timeout. Net effect: each probe
// uses at most one transient connection that is always torn down at the
// deadline — no abandoned work, no pool-slot burn, no accumulation.
export interface ProbeClientLike {
  connect(): Promise<void>
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>
  end(): Promise<unknown>
}

export function makeProbeQuery(
  newClient: () => ProbeClientLike = () => new Client(config) as unknown as ProbeClientLike,
  timeoutMs = 5000,
): (text: string) => Promise<{ rows: Record<string, unknown>[] }> {
  return async (text) => {
    const client = newClient()
    const work = (async () => {
      await client.connect()
      return client.query(text)
    })()
    let timer: ReturnType<typeof setTimeout>
    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('probe timed out')), timeoutMs)
        }),
      ])
      return result
    } finally {
      clearTimeout(timer!)
      // Late settlement of the raced-out work must not be unhandled.
      work.catch(() => {})
      // end() destroys the socket when a query is still in flight — the
      // statement dies with the session. Bound the teardown itself.
      await Promise.race([
        client.end().catch(() => {}),
        new Promise(r => setTimeout(r, 1000)),
      ])
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
