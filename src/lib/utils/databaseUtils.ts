import { db } from '../database'

// Utility functions for database operations

export class DatabaseUtils {
  // Generate unique transfer ID
  static async generateTransferId(): Promise<string> {
    const prefix = 'TRF'
    const year = new Date().getFullYear()
    const timestamp = Date.now().toString().slice(-6)
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    return `${prefix}-${year}-${timestamp}-${random}`
  }

  // Check if transfer ID exists
  static async transferIdExists(transferId: string): Promise<boolean> {
    const query = 'SELECT id FROM transfers WHERE transfer_id = $1'
    const result = await db.query(query, [transferId])
    return result.rows.length > 0
  }

  // Generate unique transfer ID (ensuring uniqueness)
  static async generateUniqueTransferId(): Promise<string> {
    let transferId: string
    let attempts = 0
    const maxAttempts = 10

    do {
      transferId = await this.generateTransferId()
      attempts++
      
      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique transfer ID after multiple attempts')
      }
    } while (await this.transferIdExists(transferId))

    return transferId
  }

  // Validate South African ID number
  static validateSAIdNumber(idNumber: string): boolean {
    // SA ID numbers are 13 digits
    if (!/^\d{13}$/.test(idNumber)) {
      return false
    }

    // Basic validation - check if it's a valid format
    // More sophisticated validation can be added here
    return true
  }

  // Validate South African company registration number
  static validateSARegistrationNumber(regNumber: string): boolean {
    // Basic validation for SA company registration numbers
    // Format can vary, but typically starts with digits
    if (!/^\d{4}\/\d{6}\/\d{2}$/.test(regNumber) && !/^\d+$/.test(regNumber)) {
      return false
    }
    return true
  }

  // Format currency for database storage
  static formatCurrencyForDB(amount: number | string): number {
    const num = typeof amount === 'string' ? parseFloat(amount.replace(/[^0-9.-]/g, '')) : amount
    return Math.round(num * 100) / 100 // Round to 2 decimal places
  }

  // Calculate transfer progress percentage
  static calculateProgress(currentStep: number, totalSteps: number): number {
    return Math.round((currentStep / totalSteps) * 100)
  }

  // Get database table statistics
  static async getTableStats(): Promise<{
    transfers: number
    parties: number
    documents: number
    users: number
  }> {
    const queries = [
      'SELECT COUNT(*) FROM transfers',
      'SELECT COUNT(*) FROM parties',
      'SELECT COUNT(*) FROM documents',
      'SELECT COUNT(*) FROM users'
    ]

    const results = await Promise.all(
      queries.map(query => db.query(query))
    )

    return {
      transfers: parseInt(results[0].rows[0].count),
      parties: parseInt(results[1].rows[0].count),
      documents: parseInt(results[2].rows[0].count),
      users: parseInt(results[3].rows[0].count)
    }
  }

  // Clean up old records (for maintenance)
  static async cleanupOldRecords(daysOld: number = 365): Promise<{
    transfersDeleted: number
    partiesDeleted: number
    documentsDeleted: number
  }> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)

    const queries = [
      'DELETE FROM transfers WHERE created_at < $1 AND status = \'cancelled\'',
      'DELETE FROM parties WHERE transfer_id IN (SELECT id FROM transfers WHERE created_at < $1 AND status = \'cancelled\')',
      'DELETE FROM documents WHERE transfer_id IN (SELECT id FROM transfers WHERE created_at < $1 AND status = \'cancelled\')'
    ]

    const results = await Promise.all(
      queries.map(query => db.query(query, [cutoffDate]))
    )

    return {
      transfersDeleted: results[0].rowCount,
      partiesDeleted: results[1].rowCount,
      documentsDeleted: results[2].rowCount
    }
  }

  // Backup database (export to JSON)
  static async exportDatabase(): Promise<{
    transfers: any[]
    parties: any[]
    documents: any[]
    users: any[]
  }> {
    const queries = [
      'SELECT * FROM transfers ORDER BY created_at',
      'SELECT * FROM parties ORDER BY created_at',
      'SELECT * FROM documents ORDER BY uploaded_at',
      'SELECT * FROM users ORDER BY created_at'
    ]

    const results = await Promise.all(
      queries.map(query => db.query(query))
    )

    return {
      transfers: results[0].rows,
      parties: results[1].rows,
      documents: results[2].rows,
      users: results[3].rows
    }
  }

  // Search across multiple tables
  static async globalSearch(searchTerm: string): Promise<{
    transfers: any[]
    parties: any[]
    documents: any[]
  }> {
    const searchPattern = `%${searchTerm}%`

    const queries = [
      'SELECT * FROM transfers WHERE property_address ILIKE $1 OR transfer_id ILIKE $1',
      'SELECT * FROM parties WHERE name ILIKE $1 OR email ILIKE $1 OR id_number ILIKE $1',
      'SELECT * FROM documents WHERE name ILIKE $1 OR category ILIKE $1'
    ]

    const results = await Promise.all(
      queries.map(query => db.query(query, [searchPattern]))
    )

    return {
      transfers: results[0].rows,
      parties: results[1].rows,
      documents: results[2].rows
    }
  }

  // Get database health metrics
  static async getDatabaseHealth(): Promise<{
    connectionPool: any
    tableStats: any
    oldestRecord: Date | null
    newestRecord: Date | null
  }> {
    const [poolStats, tableStats, oldestResult, newestResult] = await Promise.all([
      Promise.resolve(db.getPoolStats()),
      this.getTableStats(),
      db.query('SELECT MIN(created_at) as oldest FROM transfers'),
      db.query('SELECT MAX(created_at) as newest FROM transfers')
    ])

    return {
      connectionPool: poolStats,
      tableStats,
      oldestRecord: oldestResult.rows[0].oldest ? new Date(oldestResult.rows[0].oldest) : null,
      newestRecord: newestResult.rows[0].newest ? new Date(newestResult.rows[0].newest) : null
    }
  }
}
