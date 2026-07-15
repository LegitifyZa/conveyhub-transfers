import { db } from '../database'
import { 
  Transfer, 
  Party, 
  Document, 
  TransferFilters, 
  CreateTransferData, 
  UpdateTransferData,
  PaginatedResponse 
} from '../types'

export class TransferService {
  // Get all transfers with filtering and pagination
  static async getTransfers(filters: TransferFilters = {}): Promise<PaginatedResponse<Transfer>> {
    const {
      status,
      search,
      page = 1,
      limit = 10,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = filters

    let query = `
      SELECT * FROM transfers
      WHERE 1=1
    `
    const params: any[] = []
    let paramIndex = 1

    // Add filters
    if (status) {
      query += ` AND status = $${paramIndex}`
      params.push(status)
      paramIndex++
    }

    if (search) {
      query += ` AND (
        property_address ILIKE $${paramIndex} OR 
        transfer_id ILIKE $${paramIndex}
      )`
      params.push(`%${search}%`)
      paramIndex++
    }

    // Add sorting
    const validSortColumns = ['created_at', 'updated_at', 'property_address', 'status', 'purchase_price']
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at'
    query += ` ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}`

    // Get total count
    const countQuery = query.replace('SELECT * FROM transfers', 'SELECT COUNT(*) FROM transfers').split(' ORDER BY ')[0]
    const countResult = await db.query(countQuery, params)
    const total = parseInt(countResult.rows[0].count)

    // Add pagination
    const offset = (page - 1) * limit
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limit, offset)

    const result = await db.query(query, params)
    const totalPages = Math.ceil(total / limit)

    return {
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    }
  }

  // Get transfer by ID
  static async getTransferById(id: string): Promise<Transfer | null> {
    const query = 'SELECT * FROM transfers WHERE id = $1'
    const result = await db.query(query, [id])
    return result.rows[0] || null
  }

  // Get transfer by transfer_id
  static async getTransferByTransferId(transferId: string): Promise<Transfer | null> {
    const query = 'SELECT * FROM transfers WHERE transfer_id = $1'
    const result = await db.query(query, [transferId])
    return result.rows[0] || null
  }

  // Create new transfer
  static async createTransfer(data: CreateTransferData): Promise<Transfer> {
    const query = `
      INSERT INTO transfers (transfer_id, property_address, purchase_price)
      VALUES ($1, $2, $3)
      RETURNING *
    `
    const result = await db.query(query, [data.transfer_id, data.property_address, data.purchase_price])
    return result.rows[0]
  }

  // Update transfer
  static async updateTransfer(id: string, data: UpdateTransferData): Promise<Transfer | null> {
    const updates: string[] = []
    const params: any[] = []
    let paramIndex = 1

    // Build dynamic update query
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = $${paramIndex}`)
        params.push(value)
        paramIndex++
      }
    })

    if (updates.length === 0) {
      return await this.getTransferById(id)
    }

    // Add updated_at timestamp
    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    params.push(id)

    const query = `
      UPDATE transfers 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `

    const result = await db.query(query, params)
    return result.rows[0] || null
  }

  // Delete transfer
  static async deleteTransfer(id: string): Promise<boolean> {
    const query = 'DELETE FROM transfers WHERE id = $1'
    const result = await db.query(query, [id])
    return result.rowCount > 0
  }

  // Get transfer statistics
  static async getTransferStats(): Promise<{
    total: number
    completed: number
    inProgress: number
    draft: number
    cancelled: number
  }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'draft') as draft,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM transfers
    `
    const result = await db.query(query)
    return result.rows[0]
  }

  // Get parties for a transfer
  static async getTransferParties(transferId: string): Promise<Party[]> {
    const query = 'SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name'
    const result = await db.query(query, [transferId])
    return result.rows
  }

  // Get documents for a transfer
  static async getTransferDocuments(transferId: string): Promise<Document[]> {
    const query = 'SELECT * FROM documents WHERE transfer_id = $1 ORDER BY uploaded_at DESC'
    const result = await db.query(query, [transferId])
    return result.rows
  }

  // Create party
  static async createParty(data: {
    transfer_id: string
    name: string
    type: 'buyer' | 'seller'
    id_number?: string
    registration_number?: string
    email?: string
    phone?: string
    address?: string
  }): Promise<Party> {
    const query = `
      INSERT INTO parties (transfer_id, name, type, id_number, registration_number, email, phone, address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `
    const result = await db.query(query, [
      data.transfer_id,
      data.name,
      data.type,
      data.id_number,
      data.registration_number,
      data.email,
      data.phone,
      data.address
    ])
    return result.rows[0]
  }

  // Update party
  static async updateParty(id: string, data: {
    name?: string
    email?: string
    phone?: string
    address?: string
  }): Promise<Party | null> {
    const updates: string[] = []
    const params: any[] = []
    let paramIndex = 1

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = $${paramIndex}`)
        params.push(value)
        paramIndex++
      }
    })

    if (updates.length === 0) {
      return null
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    params.push(id)

    const query = `
      UPDATE parties 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `

    const result = await db.query(query, params)
    return result.rows[0] || null
  }

  // Delete party
  static async deleteParty(id: string): Promise<boolean> {
    const query = 'DELETE FROM parties WHERE id = $1'
    const result = await db.query(query, [id])
    return result.rowCount > 0
  }

  // Create document
  static async createDocument(data: {
    transfer_id: string
    name: string
    file_path?: string
    file_size?: number
    file_type?: string
    category?: string
  }): Promise<Document> {
    const query = `
      INSERT INTO documents (transfer_id, name, file_path, file_size, file_type, category)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `
    const result = await db.query(query, [
      data.transfer_id,
      data.name,
      data.file_path,
      data.file_size,
      data.file_type,
      data.category
    ])
    return result.rows[0]
  }

  // Update document status
  static async updateDocumentStatus(id: string, status: string): Promise<Document | null> {
    const query = `
      UPDATE documents 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `
    const result = await db.query(query, [status, id])
    return result.rows[0] || null
  }

  // Delete document
  static async deleteDocument(id: string): Promise<boolean> {
    const query = 'DELETE FROM documents WHERE id = $1'
    const result = await db.query(query, [id])
    return result.rowCount > 0
  }
}
