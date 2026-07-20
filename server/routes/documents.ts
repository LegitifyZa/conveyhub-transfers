import { Router, Request, Response } from 'express'
import { query } from '../db'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()

function mapDocumentRow(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    name: row.name,
    category: row.category,
    status: row.status,
    filePath: row.file_path,
    fileSize: row.file_size,
    fileType: row.file_type,
    description: row.description,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
    transferReference: row.transfer_reference,
    buyerName: row.buyer_name
  }
}

// GET /api/documents - List all documents across all transfers
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : ''
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50))
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0)

    let sql = `
      SELECT d.*,
             t.transfer_id AS transfer_reference,
             (SELECT p.name FROM parties p WHERE p.transfer_id = d.transfer_id AND p.type = 'buyer' LIMIT 1) AS buyer_name
      FROM documents d
      LEFT JOIN transfers t ON t.id = d.transfer_id
    `
    const params: unknown[] = []
    let paramIndex = 1

    if (search) {
      sql += ` WHERE d.name ILIKE $${paramIndex} OR d.category ILIKE $${paramIndex}`
      params.push(`%${search}%`)
      paramIndex += 1
    }

    sql += ` ORDER BY d.uploaded_at DESC NULLS LAST LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limit, offset)

    const result = await query(sql, params)

    const countSql = search
      ? `SELECT COUNT(*) FROM documents WHERE name ILIKE $1 OR category ILIKE $1`
      : `SELECT COUNT(*) FROM documents`
    const countParams = search ? [`%${search}%`] : []
    const countResult = await query(countSql, countParams)
    const total = parseInt(countResult.rows[0]?.count || '0', 10)

    res.json({
      success: true,
      data: result.rows.map(mapDocumentRow),
      total
    })
  })
)

export default router
