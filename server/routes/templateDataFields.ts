import { Router, Request, Response } from 'express'
import { query } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { isNonEmptyString } from '../utils/validate'

const router = Router()

function mapFieldRow(row: any) {
  return {
    id: row.id,
    key: row.field_key,
    label: row.label,
    entity: row.entity_name,
    dataType: row.data_type,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { entity, search } = req.query as { entity?: string; search?: string }
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (isNonEmptyString(entity)) {
      conditions.push(`entity_name = $${paramIdx}`)
      params.push(entity)
      paramIdx += 1
    }

    if (isNonEmptyString(search)) {
      conditions.push(`(field_key ILIKE $${paramIdx} OR label ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`)
      params.push(`%${search}%`)
      paramIdx += 1
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await query(
      `SELECT * FROM template_data_fields ${whereClause} ORDER BY entity_name, field_key`,
      params
    )
    res.json(result.rows.map(mapFieldRow))
  })
)

export default router
