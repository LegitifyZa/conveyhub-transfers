import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config()

async function runMigration() {
  console.log('🗄️ Running database migration...')
  
  const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'goldenrecordstemp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Password@01',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
}
  
  try {
    // Read migration file
    const migrationFile = path.join(__dirname, '../src/lib/migrations/001_initial_schema.sql')
    const migrationSQL = fs.readFileSync(migrationFile, 'utf8')
    
    // Connect to postgres database first to create the target database
    const pool = new Pool(dbConfig)

    try {
      const postgresClient = await pool.connect()
      
      // Create the database if it doesn't exist
      await postgresClient.query(`CREATE DATABASE ${dbConfig.database}`)
      console.log(`✅ Database '${dbConfig.database}' created or already exists`)
      
      await postgresClient.release()
    } catch (error) {
      if (error.code !== '42P04') { // Ignore "database already exists" error
        console.log(`ℹ️ Database '${config.database}' already exists`)
      } else {
        console.error('❌ Error creating database:', error.message)
        throw error
      }
    } finally {
      await postgresPool.end()
    }

    // Now connect to the target database and run migration
    const client = await pool.connect()
    
    try {
      // Split migration SQL by semicolons and execute each statement
      const statements = migrationSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0)
      
      for (const statement of statements) {
        if (statement) {
          console.log(`🔧 Executing: ${statement.substring(0, 50)}...`)
          await client.query(statement)
        }
      }
      
      console.log('✅ Migration completed successfully')
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message)
      throw error
    } finally {
      client.release()
      await pool.end()
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  }
}

// Run migration
runMigration().then(() => {
  console.log('🎉 Database migration completed!')
  process.exit(0)
}).catch((error) => {
  console.error('❌ Migration failed:', error)
  process.exit(1)
})
