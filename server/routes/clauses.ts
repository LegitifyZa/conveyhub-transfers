import { Router, Request, Response } from 'express'
import { query, withTransaction } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { isNonEmptyString, toDateString } from '../utils/validate'

const router = Router()

const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const VALID_CLAUSE_STATUS = ['Active', 'Draft', 'Retired']

interface ClauseVersionRow {
  clause_id: string
  identifier: string
  name: string
  category: string
  version_id: string
  version: string
  status: string
  legal_authority: string | null
  effective_date: string | null
  content: string
  created_at: string
}

function mapFlattenedClause(row: ClauseVersionRow): {
  id: string
  identifier: string
  name: string
  category: string
  version: string
  status: string
  legalAuthority: string
  effectiveDate: string
  content: string
  createdAt: string
  updatedAt: string
} {
  return {
    id: row.version_id,
    identifier: row.identifier,
    name: row.name,
    category: row.category,
    version: row.version,
    status: row.status,
    legalAuthority: row.legal_authority || '',
    effectiveDate: row.effective_date ? new Date(row.effective_date).toISOString().split('T')[0] : '',
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  }
}

async function fetchClauseVersions(whereClause: string, params: unknown[]): Promise<ClauseVersionRow[]> {
  const result = await query<ClauseVersionRow>(
    `SELECT
       c.id as clause_id,
       c.identifier,
       c.name,
       c.category,
       cv.id as version_id,
       cv.version,
       cv.status,
       cv.legal_authority,
       cv.effective_date,
       cv.content,
       cv.created_at
     FROM clauses c
     JOIN clause_versions cv ON c.id = cv.clause_id
     ${whereClause}
     ORDER BY c.identifier, cv.version DESC`,
    params
  )
  return result.rows
}

function pickActiveVersion(rows: ClauseVersionRow[]): ClauseVersionRow | undefined {
  const active = rows.filter((r) => r.status === 'Active')
  if (active.length > 0) return active[0]
  return rows[0]
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { category, status, search } = req.query as { category?: string; status?: string; search?: string }
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (isNonEmptyString(category)) {
      conditions.push(`c.category = $${paramIdx}`)
      params.push(category)
      paramIdx += 1
    }

    if (isNonEmptyString(status) && VALID_CLAUSE_STATUS.includes(status)) {
      conditions.push(`cv.status = $${paramIdx}`)
      params.push(status)
      paramIdx += 1
    }

    if (isNonEmptyString(search)) {
      conditions.push(`(
        c.identifier ILIKE $${paramIdx}
        OR c.name ILIKE $${paramIdx}
        OR c.category ILIKE $${paramIdx}
        OR cv.content ILIKE $${paramIdx}
      )`)
      params.push(`%${search}%`)
      paramIdx += 1
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = await fetchClauseVersions(whereClause, params)

    const grouped = new Map<string, ClauseVersionRow[]>()
    for (const row of rows) {
      const list = grouped.get(row.clause_id) || []
      list.push(row)
      grouped.set(row.clause_id, list)
    }

    const flattened = Array.from(grouped.values())
      .map((versions) => pickActiveVersion(versions))
      .filter((row): row is ClauseVersionRow => row !== undefined)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
      .map(mapFlattenedClause)

    res.json(flattened)
  })
)

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const rows = await fetchClauseVersions(isUuid(id) ? 'WHERE cv.id = $1::uuid OR c.id = $1::uuid' : 'WHERE c.identifier = $1', [id])
    if (rows.length === 0) {
      res.status(404).json({ success: false, error: 'Clause not found' })
      return
    }
    res.json(mapFlattenedClause(pickActiveVersion(rows) || rows[0]))
  })
)

router.get(
  '/:id/versions',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const rows = await fetchClauseVersions(`WHERE c.identifier = $1${isUuid(id) ? ' OR c.id = $1::uuid' : ''}`, [id])
    if (rows.length === 0) {
      res.status(404).json({ success: false, error: 'Clause not found' })
      return
    }
    res.json(rows.map(mapFlattenedClause))
  })
)

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { identifier, name, category, version, status, legalAuthority, effectiveDate, content } = req.body as Record<string, unknown>

    if (!isNonEmptyString(identifier) || !isNonEmptyString(name) || !isNonEmptyString(category) || !isNonEmptyString(content)) {
      res.status(400).json({ success: false, error: 'identifier, name, category, and content are required' })
      return
    }

    const clauseStatus = isNonEmptyString(status) && VALID_CLAUSE_STATUS.includes(status) ? status : 'Draft'
    const clauseVersion = isNonEmptyString(version) ? version : '1.0'
    const effective = toDateString(effectiveDate)

    const created = await withTransaction(async (client) => {
      const clauseResult = await client.query(
        `INSERT INTO clauses (identifier, name, category)
         VALUES ($1, $2, $3)
         ON CONFLICT (identifier) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category
         RETURNING *`,
        [identifier.trim().toLowerCase(), name, category]
      )
      const clauseId = clauseResult.rows[0].id

      const versionResult = await client.query(
        `INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [clauseId, clauseVersion, clauseStatus, isNonEmptyString(legalAuthority) ? legalAuthority : null, effective || null, content]
      )
      return { clause: clauseResult.rows[0], version: versionResult.rows[0] }
    })

    res.status(201).json(mapFlattenedClause({
      clause_id: created.clause.id,
      identifier: created.clause.identifier,
      name: created.clause.name,
      category: created.clause.category,
      version_id: created.version.id,
      version: created.version.version,
      status: created.version.status,
      legal_authority: created.version.legal_authority,
      effective_date: created.version.effective_date,
      content: created.version.content,
      created_at: created.version.created_at,
    }))
  })
)

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const { name, category, version, status, legalAuthority, effectiveDate, content } = req.body as Record<string, unknown>

    const clauseResult = await query(`SELECT id, identifier, name, category FROM clauses WHERE identifier = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (clauseResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Clause not found' })
      return
    }
    const clauseId = clauseResult.rows[0].id

    const updated = await withTransaction(async (client) => {
      if (isNonEmptyString(name) || isNonEmptyString(category)) {
        await client.query(
          `UPDATE clauses SET name = COALESCE($1, name), category = COALESCE($2, category), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [isNonEmptyString(name) ? name : null, isNonEmptyString(category) ? category : null, clauseId]
        )
      }

      let versionRow
      if (isNonEmptyString(content) || isNonEmptyString(version)) {
        const nextVersion = isNonEmptyString(version)
          ? version
          : await (async () => {
              const maxResult = await client.query(
                `SELECT version FROM clause_versions WHERE clause_id = $1 ORDER BY version DESC LIMIT 1`,
                [clauseId]
              )
              const current = maxResult.rows[0]?.version || '0.0'
              const parts = current.split('.').map((p: string) => parseInt(p, 10) || 0)
              parts[parts.length - 1] += 1
              return parts.join('.')
            })()

        const versionResult = await client.query(
          `INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            clauseId,
            nextVersion,
            isNonEmptyString(status) && VALID_CLAUSE_STATUS.includes(status) ? status : 'Draft',
            isNonEmptyString(legalAuthority) ? legalAuthority : null,
            toDateString(effectiveDate) || null,
            content || '',
          ]
        )
        versionRow = versionResult.rows[0]
      } else {
        const latestResult = await client.query(
          'SELECT * FROM clause_versions WHERE clause_id = $1 ORDER BY created_at DESC LIMIT 1',
          [clauseId]
        )
        versionRow = latestResult.rows[0]
      }

      const clause = await client.query('SELECT * FROM clauses WHERE id = $1', [clauseId])
      return { clause: clause.rows[0], version: versionRow }
    })

    res.json(mapFlattenedClause({
      clause_id: updated.clause.id,
      identifier: updated.clause.identifier,
      name: updated.clause.name,
      category: updated.clause.category,
      version_id: updated.version.id,
      version: updated.version.version,
      status: updated.version.status,
      legal_authority: updated.version.legal_authority,
      effective_date: updated.version.effective_date,
      content: updated.version.content,
      created_at: updated.version.created_at,
    }))
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const result = await query(`DELETE FROM clauses WHERE identifier = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ success: false, error: 'Clause not found' })
      return
    }
    res.json({ success: true, data: true, message: 'Clause deleted successfully' })
  })
)

export default router
