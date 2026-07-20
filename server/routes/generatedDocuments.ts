import { Router, Request, Response } from 'express'
import { query, withTransaction } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { isNonEmptyString } from '../utils/validate'

const router = Router()
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function mapGeneratedDocumentList(row: any) {
  const input = row.generation_input || {}
  return {
    id: row.id,
    documentId: row.document_id,
    matterId: row.matter_id,
    fileName: row.file_name,
    templateVersion: input.templateVersion || '',
    clauseVersions: input.clauseVersions || [],
    generatedDate: row.generated_at,
    generatorVersion: row.generator_version,
    format: row.output_format,
    actor: row.actor_name || row.generated_by || '',
  }
}

async function resolveMatterIdForTransferReference(reference: string): Promise<string | null> {
  const transferResult = await query<{ id: string }>(
    `SELECT id FROM transfers WHERE transfer_id = $1${isUuid(reference) ? ' OR id = $1::uuid' : ''}`,
    [reference]
  )
  if (transferResult.rows.length === 0) return null
  const transferUuid = transferResult.rows[0].id

  const matterResult = await query<{ id: string }>(
    `SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' LIMIT 1`,
    [transferUuid]
  )
  if (matterResult.rows[0]) return matterResult.rows[0].id

  const insertResult = await query<{ id: string }>(
    `INSERT INTO matters (reference_number, matter_type, title, status, source_record_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [reference, 'transfer', `Transfer ${reference}`, 'draft', transferUuid]
  )
  return insertResult.rows[0]?.id ?? null
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId, transferId } = req.query as { matterId?: string; transferId?: string }
    let where = ''
    const params: unknown[] = []

    if (matterId) {
      where = 'WHERE gd.matter_id = $1'
      params.push(matterId)
    } else if (transferId) {
      const matterUuid = await resolveMatterIdForTransferReference(transferId)
      if (matterUuid) {
        where = 'WHERE gd.matter_id = $1'
        params.push(matterUuid)
      }
    }

    const result = await query(
      `SELECT id, document_id, matter_id, file_name, output_format, generator_version, generated_by, actor_name, generated_at
       FROM generated_documents gd
       ${where}
       ORDER BY generated_at DESC`,
      params
    )
    res.json(result.rows.map(mapGeneratedDocumentList))
  })
)

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      documentId,
      fileName,
      templateVersion,
      clauseVersions,
      generatedDate,
      matterId,
      generatorVersion,
      format,
      actor,
    } = req.body as Record<string, unknown>

    if (!isNonEmptyString(fileName) || !isNonEmptyString(matterId) || !isNonEmptyString(format)) {
      res.status(400).json({ success: false, error: 'fileName, matterId, and format are required' })
      return
    }

    const matterUuid = await resolveMatterIdForTransferReference(matterId)
    if (!matterUuid) {
      res.status(400).json({ success: false, error: 'Unable to resolve matter for generated document' })
      return
    }

    const created = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO generated_documents (
          document_id, matter_id, file_name, output_format, generator_version,
          resolved_fields, unresolved_fields, undefined_fields, unresolved_clauses, generation_input,
          generated_by, actor_name, generated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          isNonEmptyString(documentId) ? documentId : null,
          matterUuid,
          fileName,
          format,
          isNonEmptyString(generatorVersion) ? generatorVersion : '1.0.0',
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify({
            templateVersion: isNonEmptyString(templateVersion) ? templateVersion : '',
            clauseVersions: Array.isArray(clauseVersions) ? clauseVersions : [],
          }),
          isNonEmptyString(actor) && isUuid(actor) ? actor : null,
          isNonEmptyString(actor) ? actor : null,
          isNonEmptyString(generatedDate) ? generatedDate : new Date().toISOString(),
        ]
      )
      return result.rows[0]
    })

    res.status(201).json({ success: true, data: mapGeneratedDocumentList(created) })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const result = await query('SELECT * FROM generated_documents WHERE id = $1', [id])
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Generated document not found' })
      return
    }

    const row = result.rows[0]
    const clausesResult = await query(
      `SELECT cv.id, cv.version, c.identifier as clause_identifier, c.name as clause_name, gdc.sequence_number
       FROM generated_document_clauses gdc
       JOIN clause_versions cv ON gdc.clause_version_id = cv.id
       JOIN clauses c ON cv.clause_id = c.id
       WHERE gdc.generated_document_id = $1
       ORDER BY gdc.sequence_number`,
      [id]
    )

    res.json({
      id: row.id,
      documentId: row.document_id,
      matterId: row.matter_id,
      fileName: row.file_name,
      outputFormat: row.output_format,
      generatorVersion: row.generator_version,
      resolvedContent: row.resolved_content,
      resolvedFields: row.resolved_fields,
      unresolvedFields: row.unresolved_fields,
      undefinedFields: row.undefined_fields,
      unresolvedClauses: row.unresolved_clauses,
      generationInput: row.generation_input,
      generatedBy: row.generated_by,
      actorName: row.actor_name,
      generatedAt: row.generated_at,
      clauses: clausesResult.rows.map((r) => ({
        id: r.id,
        identifier: r.clause_identifier,
        name: r.clause_name,
        version: r.version,
        sequenceNumber: r.sequence_number,
      })),
    })
  })
)

export default router
