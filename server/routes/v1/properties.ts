import { Router, Request, Response } from 'express'
import { query } from '../../db'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'

const router = Router()

const DISCOVERY_LIMIT_MAX = 50
const MANUAL_CAPTURE_SOURCE_SYSTEM = 'manual_capture'

const PROPERTY_READ_COLUMNS = `
  id, property_id, erf_number, street_address, suburb, city, postal_code,
  province, country, property_type, legal_description, year_built,
  square_footage, extent_sqm, status, source_system,
  accountable_institution_id, client_request_id, created_at, updated_at
`

// Allow-listed property projection — never expose every column. `manual`
// marks institution-private manual capture (unverified); verification is
// never inferred from external identifiers.
export function mapProperty(row: any) {
  if (!row) {
    return null
  }
  return {
    id: row.id,
    propertyId: row.property_id,
    erfNumber: row.erf_number,
    streetAddress: row.street_address,
    suburb: row.suburb,
    city: row.city,
    postalCode: row.postal_code,
    province: row.province,
    country: row.country,
    propertyType: row.property_type,
    legalDescription: row.legal_description,
    yearBuilt: row.year_built,
    squareFootage: row.square_footage != null ? Number(row.square_footage) : null,
    extentSqm: row.extent_sqm != null ? Number(row.extent_sqm) : null,
    status: row.status,
    sourceSystem: row.source_system,
    manual: row.source_system === MANUAL_CAPTURE_SOURCE_SYSTEM,
    accountableInstitutionId: row.accountable_institution_id,
    clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get(
  '/',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!

    // Property discovery is a staff surface; clients fail closed.
    if (user.isClient) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    if (!user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const rawQuery = req.query.query ?? req.query.q
    const queryText = typeof rawQuery === 'string' ? rawQuery.trim() : ''

    const limit = Math.min(DISCOVERY_LIMIT_MAX, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25))

    const clauses = ['accountable_institution_id = $1']
    const params: unknown[] = [user.accountable_institution_id]
    if (queryText) {
      const escaped = queryText.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
      params.push(`%${escaped}%`)
      clauses.push(`(
        street_address ILIKE $2 ESCAPE '\\'
        OR city ILIKE $2 ESCAPE '\\'
        OR erf_number ILIKE $2 ESCAPE '\\'
        OR property_id ILIKE $2 ESCAPE '\\'
        OR title_deed_number ILIKE $2 ESCAPE '\\'
      )`)
    }
    params.push(limit)

    const result = await query(
      `SELECT ${PROPERTY_READ_COLUMNS}
       FROM properties
       WHERE ${clauses.join(' AND ')}
       ORDER BY street_address, id
       LIMIT $${params.length}`,
      params
    )

    res.json({
      message: 'OK',
      data: { properties: result.rows.map(mapProperty) },
    })
  })
)

export default router
