import { Pool, PoolConfig, escapeIdentifier } from 'pg'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

interface DatabaseConfig extends PoolConfig {
  min?: number
  max?: number
}

// Database configuration
const config: DatabaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'legitify_convey_hub',
  user: process.env.DB_USER || 'your_username',
  password: process.env.DB_PASSWORD || 'your_password',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  min: parseInt(process.env.DB_MIN_CONNECTIONS || '2'),
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
  // Connection timeout settings
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  // Query timeout
  query_timeout: 30000,
}

// Configure schema search path
const schema = process.env.DB_SCHEMA || 'transfers'
if (schema !== 'public') {
  config.options = `--search_path=${escapeIdentifier(schema)},public`
}

// Create connection pool
const pool = new Pool(config)

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})

// Database connection class
export class Database {
  private static instance: Database
  private pool: Pool

  constructor() {
    this.pool = pool
  }

  // Singleton pattern
  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database()
    }
    return Database.instance
  }

  // Test connection
  public async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect()
      await client.query('SELECT NOW()')
      client.release()
      console.log('✅ Database connection successful')
      return true
    } catch (error) {
      console.error('❌ Database connection failed:', error)
      return false
    }
  }

  // Execute query
  public async query(text: string, params?: any[]): Promise<any> {
    const start = Date.now()
    try {
      const result = await this.pool.query(text, params)
      const duration = Date.now() - start
      console.log('Executed query', { text, duration, rows: result.rowCount })
      return result
    } catch (error) {
      console.error('Query error:', { text, error })
      throw error
    }
  }

  // Get transaction client
  public async getClient(): Promise<any> {
    return await this.pool.connect()
  }

  // Execute transaction
  public async transaction(callback: (client: any) => Promise<any>): Promise<any> {
    const client = await this.getClient()
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

  // Close all connections
  public async close(): Promise<void> {
    await this.pool.end()
    console.log('Database connection pool closed')
  }

  // Get pool stats
  public getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    }
  }
}

// Export singleton instance
export const db = Database.getInstance()

// Database initialization
export const initializeDatabase = async (): Promise<void> => {
  try {
    const connected = await db.testConnection()
    if (!connected) {
      throw new Error('Failed to connect to database')
    }

    // Runtime schema/table creation is intentionally not performed here.
    // SQL migrations via scripts/migrate.mjs are the only supported DDL path.
    console.log('✅ Database connection verified')
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

// Export database utilities
export { pool }
export default db
