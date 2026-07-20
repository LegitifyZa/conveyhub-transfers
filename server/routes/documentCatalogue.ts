import { Router, Request, Response } from 'express'
import { query, withTransaction } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { isNonEmptyString } from '../utils/validate'

const router = Router()

const VALID_MODULES = ['Transfers', 'Bonds', 'Cancellations', 'General']
const VALID_STATUSES = ['Active', 'Draft', 'Retired']

function mapCatalogueRow(row: any) {
  return {
    id: row.id,
    catalogueCode: row.catalogue_code,
    name: row.name,
    module: row.module,
    matterType: row.matter_type,
    status: row.status,
    legalAuthority: row.legal_authority || '',
    version: row.current_version,
    template: row.template_file_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { module, status, search } = req.query as { module?: string; status?: string; search?: string }
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (isNonEmptyString(module)) {
      conditions.push(`module = $${paramIdx}`)
      params.push(module)
      paramIdx += 1
    }

    if (isNonEmptyString(status) && VALID_STATUSES.includes(status)) {
      conditions.push(`status = $${paramIdx}`)
      params.push(status)
      paramIdx += 1
    }

    if (isNonEmptyString(search)) {
      conditions.push(`(name ILIKE $${paramIdx} OR catalogue_code ILIKE $${paramIdx} OR matter_type ILIKE $${paramIdx})`)
      params.push(`%${search}%`)
      paramIdx += 1
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await query(
      `SELECT * FROM document_catalogue ${whereClause} ORDER BY module, name`,
      params
    )
    res.json(result.rows.map(mapCatalogueRow))
  })
)

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const catalogueResult = await query(
      'SELECT * FROM document_catalogue WHERE id = $1 OR catalogue_code = $1',
      [id]
    )
    if (catalogueResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Catalogue document not found' })
      return
    }

    const row = catalogueResult.rows[0]
    const [fieldsResult, requirementsResult] = await Promise.all([
      query(
        `SELECT f.field_key
         FROM document_catalogue_fields cdf
         JOIN template_data_fields f ON cdf.data_field_id = f.id
         WHERE cdf.catalogue_document_id = $1`,
        [row.id]
      ),
      query(
        `SELECT supporting_document_name
         FROM document_catalogue_requirements
         WHERE catalogue_document_id = $1
         ORDER BY sequence_number`,
        [row.id]
      ),
    ])

    res.json({
      ...mapCatalogueRow(row),
      requiredDataFields: fieldsResult.rows.map((f) => f.field_key),
      requiredSupportingDocuments: requirementsResult.rows.map((r) => r.supporting_document_name),
    })
  })
)

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      name,
      module,
      matterType,
      status,
      legalAuthority,
      version,
      template,
      requiredDataFields,
      requiredSupportingDocuments,
    } = req.body as Record<string, unknown>

    if (!isNonEmptyString(name) || !isNonEmptyString(module) || !VALID_MODULES.includes(module)) {
      res.status(400).json({ success: false, error: 'name and a valid module are required' })
      return
    }

    const created = await withTransaction(async (client) => {
      const catalogueCode = `CAT-${Date.now().toString().slice(-6)}`
      const catalogueStatus = isNonEmptyString(status) && VALID_STATUSES.includes(status) ? status : 'Draft'
      const catalogueVersion = isNonEmptyString(version) ? version : '1.0'

      const catalogueResult = await client.query(
        `INSERT INTO document_catalogue (
          catalogue_code, name, module, matter_type, status, legal_authority, current_version, template_file_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          catalogueCode,
          name,
          module,
          isNonEmptyString(matterType) ? matterType : 'General Conveyancing',
          catalogueStatus,
          isNonEmptyString(legalAuthority) ? legalAuthority : null,
          catalogueVersion,
          isNonEmptyString(template) ? template : null,
        ]
      )
      const catalogueId = catalogueResult.rows[0].id

      const templateIdentifier = `${module.toLowerCase()}-${name.toLowerCase().replace(/\s+/g, '-')}`
      await client.query(
        `INSERT INTO document_templates (catalogue_document_id, name, identifier, status)
         VALUES ($1, $2, $3, $4)`,
        [catalogueId, name, templateIdentifier, catalogueStatus]
      )

      if (Array.isArray(requiredDataFields)) {
        let sequence = 1
        for (const fieldKey of requiredDataFields) {
          if (!isNonEmptyString(fieldKey)) continue
          const fieldResult = await client.query(
            `INSERT INTO template_data_fields (field_key, label, entity_name, data_type, description)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (field_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [fieldKey, fieldKey, 'General', 'Text', 'Auto-created from catalogue']
          )
          await client.query(
            `INSERT INTO document_catalogue_fields (catalogue_document_id, data_field_id, is_required)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (catalogue_document_id, data_field_id) DO NOTHING`,
            [catalogueId, fieldResult.rows[0].id]
          )
          sequence += 1
        }
      }

      if (Array.isArray(requiredSupportingDocuments)) {
        let sequence = 1
        for (const docName of requiredSupportingDocuments) {
          if (!isNonEmptyString(docName)) continue
          await client.query(
            `INSERT INTO document_catalogue_requirements (catalogue_document_id, supporting_document_name, sequence_number)
             VALUES ($1, $2, $3)`,
            [catalogueId, docName, sequence]
          )
          sequence += 1
        }
      }

      return catalogueResult.rows[0]
    })

    res.status(201).json({ success: true, data: mapCatalogueRow(created) })
  })
)

export default router
