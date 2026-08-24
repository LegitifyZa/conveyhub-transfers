import { Router, Request, Response } from 'express'
import { query } from '../../db'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'
import { isCrossTenant } from '../../auth/policy'

const router = Router()

const DEFAULT_SORT_COLUMNS = ['created_at', 'updated_at', 'property_address', 'status', 'purchase_price']

interface TransferFilters {
  page: number
  limit: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

function parseFilters(req: Request): TransferFilters {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10))
  const sortBy = DEFAULT_SORT_COLUMNS.includes(String(req.query.sortBy)) ? String(req.query.sortBy) : 'created_at'
  const sortOrder = String(req.query.sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc'
  return { page, limit, sortBy, sortOrder }
}

function mapTransferRow(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    propertyAddress: row.property_address,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : undefined,
    status: row.status,
    currentStep: row.current_step,
    totalSteps: row.total_steps,
    progress: row.progress != null ? Number(row.progress) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parties: [],
  }
}

const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

router.get(
  '/',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!

    // Clients (role 4) must prove Golden Record party membership before seeing any transfer.
    // transfer_parties is currently empty, so the safe default is an empty list.
    if (user.isClient) {
      res.json({
        message: 'OK',
        data: {
          transfers: [],
          pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
        },
      })
      return
    }

    // Staff must hold the documented transfers:read ability (handover §4.5).
    if (!user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const filters = parseFilters(req)
    const sortColumn = DEFAULT_SORT_COLUMNS.includes(filters.sortBy) ? filters.sortBy : 'created_at'
    const offset = (filters.page - 1) * filters.limit

    const crossTenant = isCrossTenant(user)
    const tenantPredicate = crossTenant ? '' : 'WHERE t.accountable_institution_id = $1'
    const tenantParams = crossTenant ? [] : [user.accountable_institution_id]

    const countQuery = `SELECT COUNT(*) FROM transfers t ${tenantPredicate}`
    const countResult = await query<{ count: string }>(countQuery, tenantParams)
    const total = parseInt(countResult.rows[0].count, 10)

    const pageParams = crossTenant
      ? [filters.limit, offset]
      : [user.accountable_institution_id, filters.limit, offset]

    const dataQuery = `
      SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
             t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
      FROM transfers t
      ${tenantPredicate}
      ORDER BY t.${sortColumn} ${filters.sortOrder.toUpperCase()}
      LIMIT $${crossTenant ? 1 : 2} OFFSET $${crossTenant ? 2 : 3}
    `

    const dataResult = await query(dataQuery, pageParams)

    res.json({
      message: 'OK',
      data: {
        transfers: dataResult.rows.map(mapTransferRow),
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit) || 1,
        },
      },
    })
  })
)

router.get(
  '/:id',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!
    const { id } = req.params

    if (!isUuid(id)) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    if (user.isClient) {
      if (!user.golden_record_id) {
        res.status(404).json({ success: false, error: 'Not found' })
        return
      }

      const clientQuery = `
        SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
               t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
        FROM transfers t
        WHERE t.id = $1
          AND EXISTS (
            SELECT 1 FROM transfer_parties tp
            WHERE tp.transfer_id = t.id AND tp.golden_record_id = $2::uuid
          )
      `
      const clientResult = await query(clientQuery, [id, user.golden_record_id])

      if (clientResult.rows.length === 0) {
        res.status(404).json({ success: false, error: 'Not found' })
        return
      }

      res.json({
        message: 'OK',
        data: mapTransferRow(clientResult.rows[0]),
      })
      return
    }

    // Staff must hold the documented transfers:read ability (handover §4.5).
    if (!user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const crossTenant = isCrossTenant(user)
    const detailQuery = crossTenant
      ? `
        SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
               t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
        FROM transfers t
        WHERE t.id = $1
      `
      : `
        SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
               t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
        FROM transfers t
        WHERE t.id = $1 AND t.accountable_institution_id = $2
      `

    const detailParams = crossTenant ? [id] : [id, user.accountable_institution_id]
    const detailResult = await query(detailQuery, detailParams)

    if (detailResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    res.json({
      message: 'OK',
      data: mapTransferRow(detailResult.rows[0]),
    })
  })
)

export default router
