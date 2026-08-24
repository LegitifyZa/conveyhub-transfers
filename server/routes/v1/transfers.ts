import { Router, Request, Response } from 'express'
import { query } from '../../db'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'
import { isCrossTenant } from '../../auth/policy'
import { CurrentUser } from '../../auth/currentUser'

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

function mapTransferParty(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    goldenRecordId: row.golden_record_id,
    entityType: row.entity_type,
    role: row.role,
    accountableInstitutionId: row.accountable_institution_id,
    cachedName: row.cached_name,
    cachedIdNumber: row.cached_id_number,
    cachedEmail: row.cached_email,
    syncedAt: row.synced_at,
  }
}

// Client party projection is intentionally conservative. The handover defines
// that a client may only see matters where their golden_record_id is a party
// (server/auth/policy.ts), but it does not define what party fields or rows
// a client may view. Until that contract is documented, the client receives
// only their own transfer_parties row and a minimal set of cached display fields.
function mapClientTransferParty(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    goldenRecordId: row.golden_record_id,
    entityType: row.entity_type,
    role: row.role,
    cachedName: row.cached_name,
    syncedAt: row.synced_at,
  }
}

function mapTransferDocument(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    catalogueDocumentId: row.catalogue_document_id,
    name: row.name,
    status: row.status,
    notes: row.notes,
    fileSize: row.file_size,
    fileType: row.file_type,
    originalFileName: row.original_file_name,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMilestone(row: any) {
  return {
    id: row.id,
    matterId: row.matter_id,
    definitionId: row.definition_id,
    code: row.code,
    definitionName: row.definition_name,
    name: row.name,
    statusLabel: row.status_label,
    status: row.status,
    sequenceNumber: row.sequence_number,
    dueDate: row.due_date,
    completedDate: row.completed_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapTransferFinancials(row: any) {
  if (!row) {
    return null
  }
  return {
    transferId: row.transfer_id,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : undefined,
    depositAmount: row.deposit_amount != null ? Number(row.deposit_amount) : undefined,
    loanAmount: row.loan_amount != null ? Number(row.loan_amount) : undefined,
    interestRate: row.interest_rate != null ? Number(row.interest_rate) : undefined,
    loanTerm: row.loan_term_years != null ? Number(row.loan_term_years) : undefined,
    transferDuty: row.transfer_duty != null ? Number(row.transfer_duty) : undefined,
    conveyancingFees: row.conveyancing_fees != null ? Number(row.conveyancing_fees) : undefined,
    deedsOfficeFees: row.deeds_office_fees != null ? Number(row.deeds_office_fees) : undefined,
    vat: row.vat != null ? Number(row.vat) : undefined,
    postAndPetties: row.post_and_petties != null ? Number(row.post_and_petties) : undefined,
    clearanceCertificateFee: row.clearance_certificate_fee != null ? Number(row.clearance_certificate_fee) : undefined,
    ratesClearanceAmount: row.rates_clearance_amount != null ? Number(row.rates_clearance_amount) : undefined,
    totalCosts: row.total_costs != null ? Number(row.total_costs) : undefined,
    netProceeds: row.net_proceeds != null ? Number(row.net_proceeds) : undefined,
    effectiveRate: row.effective_rate != null ? Number(row.effective_rate) : undefined,
    loanToValueRatio: row.loan_to_value_ratio != null ? Number(row.loan_to_value_ratio) : undefined,
    currencyCode: row.currency_code,
    calculationVersion: row.calculation_version,
    calculationDetails: row.calculation_details,
    calculatedAt: row.calculated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const SELECT_TRANSFER_COLUMNS = `
  SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
         t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
`

async function authorizeTransfer(user: CurrentUser, id: string): Promise<any | null> {
  if (!isUuid(id)) {
    return null
  }

  if (user.isClient) {
    if (!user.golden_record_id) {
      return null
    }

    const clientQuery = `${SELECT_TRANSFER_COLUMNS}
      FROM transfers t
      WHERE t.id = $1
        AND EXISTS (
          SELECT 1 FROM transfer_parties tp
          WHERE tp.transfer_id = t.id AND tp.golden_record_id = $2::uuid
        )
    `
    const clientResult = await query(clientQuery, [id, user.golden_record_id])
    return clientResult.rows[0] || null
  }

  // Staff ability check is performed by the caller.
  const crossTenant = isCrossTenant(user)
  const detailQuery = crossTenant
    ? `${SELECT_TRANSFER_COLUMNS} FROM transfers t WHERE t.id = $1`
    : `${SELECT_TRANSFER_COLUMNS} FROM transfers t WHERE t.id = $1 AND t.accountable_institution_id = $2`

  const detailParams = crossTenant ? [id] : [id, user.accountable_institution_id]
  const detailResult = await query(detailQuery, detailParams)
  return detailResult.rows[0] || null
}

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
  '/:id/parties',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!
    const { id } = req.params

    // Staff must hold the documented transfers:read ability (handover §4.5).
    // Role 4 (Client) is not in the canonical transfers:read assignment; client
    // access is governed by the GR party rule implemented in authorizeTransfer.
    if (!user.isClient && !user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const transfer = await authorizeTransfer(user, id)
    if (!transfer) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    const crossTenant = isCrossTenant(user)

    // Clients are restricted to their own transfer_parties row.
    // The client projection is intentionally conservative: the handover does not
    // define which party fields/rows a client may view, so we return only the
    // matching row and a minimal cache subset until that platform contract exists.
    if (user.isClient) {
      const clientPartiesQuery = `
        SELECT id, transfer_id, golden_record_id, entity_type, role, cached_name, synced_at
        FROM transfer_parties
        WHERE transfer_id = $1
          AND golden_record_id = $2::uuid
          AND accountable_institution_id = (
            SELECT accountable_institution_id FROM transfers WHERE id = $1
          )
      `
      const clientPartiesResult = await query(clientPartiesQuery, [id, user.golden_record_id])
      res.json({
        message: 'OK',
        data: {
          parties: clientPartiesResult.rows.map(mapClientTransferParty),
        },
      })
      return
    }

    // Tenant-defence in depth: ordinary staff only see parties for their AI.
    // Cross-tenant staff see all parties for the already-authorised transfer.
    const partiesQuery = crossTenant
      ? `
        SELECT id, transfer_id, golden_record_id, entity_type, role,
               accountable_institution_id, cached_name, cached_id_number, cached_email, synced_at
        FROM transfer_parties
        WHERE transfer_id = $1
        ORDER BY cached_name
      `
      : `
        SELECT id, transfer_id, golden_record_id, entity_type, role,
               accountable_institution_id, cached_name, cached_id_number, cached_email, synced_at
        FROM transfer_parties
        WHERE transfer_id = $1 AND accountable_institution_id = $2
        ORDER BY cached_name
      `

    const partiesParams = crossTenant ? [id] : [id, user.accountable_institution_id]
    const partiesResult = await query(partiesQuery, partiesParams)

    res.json({
      message: 'OK',
      data: {
        parties: partiesResult.rows.map(mapTransferParty),
      },
    })
  })
)

router.get(
  '/:id/milestones',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!
    const { id } = req.params

    // Client milestone visibility is not documented. Fail closed.
    if (user.isClient) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    // No separate milestones:read ability is documented; reuse transfers:read.
    if (!user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const transfer = await authorizeTransfer(user, id)
    if (!transfer) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    // The verified transfer-to-matter relationship is matters.source_record_id = transfers.id::text.
    // transfers.matter_id is not populated in the prototype dataset.
    const milestonesQuery = `
      SELECT mm.id, mm.matter_id, mm.definition_id, md.code,
             md.name AS definition_name, mm.name, mm.status_label, mm.status,
             mm.sequence_number, mm.due_date, mm.completed_date, mm.notes,
             mm.created_at, mm.updated_at
      FROM matter_milestones mm
      JOIN matters m ON m.id = mm.matter_id
      LEFT JOIN milestone_definitions md ON md.id = mm.definition_id
      WHERE m.source_record_id = $1
      ORDER BY mm.sequence_number
    `
    const milestonesResult = await query(milestonesQuery, [id])

    res.json({
      message: 'OK',
      data: {
        milestones: milestonesResult.rows.map(mapMilestone),
      },
    })
  })
)

router.get(
  '/:id/documents',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!
    const { id } = req.params

    // Client document visibility is not documented. Fail closed.
    if (user.isClient) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    // No separate documents:read ability is documented; reuse transfers:read.
    if (!user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const transfer = await authorizeTransfer(user, id)
    if (!transfer) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    const documentsQuery = `
      SELECT id, transfer_id, catalogue_document_id, name, status, notes,
             file_size, file_type, original_file_name, uploaded_at, created_at, updated_at
      FROM transfer_documents
      WHERE transfer_id = $1
      ORDER BY created_at
    `
    const documentsResult = await query(documentsQuery, [id])

    res.json({
      message: 'OK',
      data: {
        documents: documentsResult.rows.map(mapTransferDocument),
      },
    })
  })
)

router.get(
  '/:id/financials',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.currentUser!
    const { id } = req.params

    // Client financial visibility is not documented. Fail closed.
    if (user.isClient) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    // No separate financials:read ability is documented; reuse transfers:read.
    if (!user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const transfer = await authorizeTransfer(user, id)
    if (!transfer) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    const financialsQuery = `
      SELECT tf.*
      FROM transfer_financials tf
      WHERE tf.transfer_id = $1
    `
    const financialsResult = await query(financialsQuery, [id])
    const financials = financialsResult.rows[0]
      ? mapTransferFinancials(financialsResult.rows[0])
      : null

    res.json({
      message: 'OK',
      data: {
        financials,
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

    // Staff must hold the documented transfers:read ability (handover §4.5).
    // Role 4 (Client) is not in the canonical transfers:read assignment; client
    // access is governed by the GR party rule implemented in authorizeTransfer.
    if (!user.isClient && !user.hasAbility('transfers:read')) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const transfer = await authorizeTransfer(user, id)
    if (!transfer) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }

    res.json({
      message: 'OK',
      data: mapTransferRow(transfer),
    })
  })
)

export default router
