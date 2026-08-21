import { Router, Request, Response } from 'express'
import { query, withTransaction } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { isNonEmptyString, isSaPostalCode, isValidStatus, toNumber } from '../utils/validate'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads')

const router = Router()

const DEFAULT_SORT_COLUMNS = ['created_at', 'updated_at', 'property_address', 'status', 'purchase_price']
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const VALID_PROPERTY_TYPES = [
  'Freehold', 'Sectional Title', 'Share Block', 'Life Rights',
  'Agricultural Holding', 'Farm', 'Commercial', 'Mixed Use', 'Vacant Land'
]
const toPropertyType = (value: unknown): string =>
  isNonEmptyString(value)
    ? (VALID_PROPERTY_TYPES.find(t => t.toLowerCase() === value.toLowerCase()) ?? 'Freehold')
    : 'Freehold'

interface TransferFilters {
  status?: string
  search?: string
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
  return {
    status: isNonEmptyString(req.query.status) ? req.query.status : undefined,
    search: isNonEmptyString(req.query.search) ? req.query.search : undefined,
    page,
    limit,
    sortBy,
    sortOrder,
  }
}

function mapTransferRow(row: any) {
  const milestoneProgress = row.milestone_progress != null ? Number(row.milestone_progress) : undefined
  const milestoneCompleted = row.milestone_completed === true
  return {
    id: row.id,
    transferId: row.transfer_id,
    propertyAddress: row.property_address,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : undefined,
    status: milestoneCompleted ? 'completed' : row.status,
    currentStep: row.current_step,
    totalSteps: row.total_steps,
    progress: milestoneProgress != null ? milestoneProgress : (row.progress != null ? Number(row.progress) : undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextDueDate: row.next_due_date,
    parties: Array.isArray(row.parties) ? row.parties.map(mapPartyRow) : [],
  }
}

function mapPartyRow(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    name: row.name,
    type: row.type,
    idNumber: row.id_number,
    registrationNumber: row.registration_number,
    email: row.email,
    phone: row.phone,
    address: row.address,
    companyName: row.company_name,
    roleTitle: row.role_title,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDocumentRow(row: any) {
  return {
    id: row.id,
    transferId: row.transfer_id,
    catalogueDocumentId: row.catalogue_document_id,
    name: row.name,
    type: row.catalogue_document_id || row.category || row.type,
    category: row.category,
    status: row.status,
    filePath: row.file_path,
    fileSize: row.file_size != null ? Number(row.file_size) : undefined,
    fileType: row.file_type,
    description: row.notes ?? row.description,
    notes: row.notes,
    originalFileName: row.original_file_name,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  }
}

function mapFinancialRow(row: any) {
  if (!row) return {}
  return {
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
  }
}

function mapPropertyRow(row: any) {
  if (!row) return undefined
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
    titleDeedNumber: row.title_deed_number,
    extentSqm: row.extent_sqm != null ? Number(row.extent_sqm) : undefined,
    description: row.description,
    legalDescription: row.legal_description,
    lotNumber: row.lot_number,
    yearBuilt: row.year_built,
    squareFootage: row.square_footage,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function generateUniqueTransferId(client: import('pg').PoolClient): Promise<string> {
  const prefix = 'TRF'
  const year = new Date().getFullYear()
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const timestamp = Date.now().toString().slice(-6)
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    const transferId = `${prefix}-${year}-${timestamp}-${random}`
    const existing = await client.query('SELECT id FROM transfers WHERE transfer_id = $1', [transferId])
    if (existing.rowCount === 0) return transferId
  }
  throw new Error('Failed to generate unique transfer ID')
}

async function generateUniquePropertyId(client: import('pg').PoolClient): Promise<string> {
  const year = new Date().getFullYear()
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
    const propertyId = `PROP-${year}-${random}`
    const existing = await client.query('SELECT id FROM properties WHERE property_id = $1', [propertyId])
    if (existing.rowCount === 0) return propertyId
  }
  throw new Error('Failed to generate unique property ID')
}

async function seedTransferDocuments(
  client: import('pg').PoolClient,
  transferUuid: string
): Promise<void> {
  const existing = await client.query('SELECT 1 FROM transfer_documents WHERE transfer_id = $1 LIMIT 1', [transferUuid])
  if (existing.rowCount && existing.rowCount > 0) return

  const catalogueResult = await client.query(
    `SELECT id, name, module, matter_type
     FROM document_catalogue
     WHERE status = 'Active' AND module = 'Transfers'
     ORDER BY name`,
    []
  )

  for (const row of catalogueResult.rows) {
    await client.query(
      `INSERT INTO transfer_documents (transfer_id, catalogue_document_id, name, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (transfer_id, catalogue_document_id) DO NOTHING`,
      [transferUuid, row.id, row.name]
    )
  }
}

function extensionFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  return ext || '.bin'
}

function sanitiseFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/_{2,}/g, '_')
}

async function saveTransferDocumentUpload(
  client: import('pg').PoolClient,
  transferUuid: string,
  transferDocumentId: string,
  fileName: string,
  fileType: string,
  base64Data: string
) {
  const match = base64Data.match(/^data:.*?;base64,(.*)$/)
  const rawBase64 = match ? match[1] : base64Data

  if (!rawBase64) {
    throw new Error('Invalid file data')
  }

  const buffer = Buffer.from(rawBase64, 'base64')
  if (buffer.length === 0) {
    throw new Error('Empty file')
  }

  const safeName = sanitiseFileName(fileName)
  const extension = extensionFromFileName(safeName)
  const uploadDir = path.join(UPLOAD_DIR, 'transfers', transferUuid)
  fs.mkdirSync(uploadDir, { recursive: true })

  const storageName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`
  const filePath = path.join(uploadDir, storageName)
  fs.writeFileSync(filePath, buffer)

  const relativeFilePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/')

  const result = await client.query(
    `UPDATE transfer_documents
     SET status = 'uploaded',
         file_path = $1,
         file_size = $2,
         file_type = $3,
         original_file_name = $4,
         uploaded_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 AND transfer_id = $6
     RETURNING *`,
    [relativeFilePath, buffer.length, fileType, fileName, transferDocumentId, transferUuid]
  )

  return result.rows[0]
}

async function getOrCreateMatterForTransfer(
  client: import('pg').PoolClient,
  transferId: string,
  transferReference: string
): Promise<string> {
  const matterResult = await client.query(
    'SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = $2 LIMIT 1',
    [transferId, 'transfer']
  )
  if (matterResult.rows[0]) return matterResult.rows[0].id

  const insertResult = await client.query(
    `INSERT INTO matters (reference_number, matter_type, title, status, source_record_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [transferReference, 'transfer', `Transfer ${transferReference}`, 'draft', transferId]
  )
  return insertResult.rows[0].id
}

async function ensureMilestoneDefinitions(client: import('pg').PoolClient): Promise<void> {
  const countResult = await client.query('SELECT COUNT(*) FROM milestone_definitions')
  if (parseInt(countResult.rows[0].count, 10) > 0) return

  const defaults = [
    { code: 'TRANSFEROR_FICA', name: 'Transferor', label: 'FICA Received', seq: 1 },
    { code: 'TRANSFEREE_FICA', name: 'Transferee', label: 'FICA Received', seq: 2 },
    { code: 'GUARANTEES', name: 'Guarantees', label: 'Guarantee/s Due Date', seq: 3 },
    { code: 'TRANSFER_DUTY', name: 'Transfer Duty', label: 'Applied', seq: 4 },
    { code: 'RATES', name: 'Rates', label: 'Figures Requested', seq: 5 },
    { code: 'LEVIES', name: 'Levies', label: 'Figures Requested', seq: 6 },
    { code: 'HOME_OWNERS', name: 'Home Owners', label: 'Consent Requested', seq: 7 },
    { code: 'ELECTRICAL', name: 'Electrical', label: 'Certificate Requested', seq: 8 },
    { code: 'ENTOMOLOGIST', name: 'Entomologist', label: 'Certificate Requested', seq: 9 },
    { code: 'ELECTRIC_FENCE', name: 'Electric Fence', label: 'Certificate Received', seq: 10 },
    { code: 'GAS_CONFORMITY', name: 'Gas Conformity', label: 'Certificate Requested', seq: 11 },
    { code: 'PLUMBING', name: 'Plumbing', label: 'Certificate Requested', seq: 12 },
    { code: 'INSTRUCTION', name: 'Instruction', label: 'Instruction received', seq: 13 },
    { code: 'DEPOSIT', name: 'Deposit', label: 'Deposit Due', seq: 14 },
    { code: 'NEW_BOND', name: 'New Bond', label: 'Bond Grant Due', seq: 15 },
    { code: 'SUBJECT_TO_SALE', name: 'Subject to Sale', label: 'Due Date', seq: 16 },
    { code: 'SUSPENSIVE_CONDITIONS', name: "Suspensive Cond's", label: 'All Conditions met', seq: 17 },
    { code: 'BOND_CANCELLATION', name: 'Bond Cancellation', label: 'Figures Requested', seq: 18 },
    { code: 'TITLE_DEED', name: 'Title Deed', label: 'Title Deed Requested', seq: 19 },
    { code: 'TRANSFER_COSTS', name: 'Transfer Costs', label: 'Proforma Sent', seq: 20 },
    { code: 'FICA', name: 'FICA', label: 'Certified', seq: 21 },
    { code: 'POOL', name: 'Pool', label: 'Certificate Requested', seq: 22 },
    { code: 'REGISTRATION_COMPLETE', name: 'Transfer Registration Complete', label: '5 days after reg', seq: 23 },
  ]

  for (const def of defaults) {
    await client.query(
      `INSERT INTO milestone_definitions (code, name, default_status_label, matter_type, sequence_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [def.code, def.name, def.label, 'transfer', def.seq]
    )
  }
}

async function createDefaultMilestones(client: import('pg').PoolClient, matterId: string): Promise<void> {
  await ensureMilestoneDefinitions(client)
  const definitions = await client.query(
    'SELECT id, name, default_status_label, sequence_number FROM milestone_definitions WHERE matter_type = $1 AND is_active = TRUE ORDER BY sequence_number',
    ['transfer']
  )
  for (const def of definitions.rows) {
    await client.query(
      `INSERT INTO matter_milestones (matter_id, definition_id, name, status_label, sequence_number, status)
       VALUES ($1, $2, $3, $4, $5, 'not_started')
       ON CONFLICT (matter_id, sequence_number) DO NOTHING`,
      [matterId, def.id, def.name, def.default_status_label, def.sequence_number]
    )
  }
}

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const filters = parseFilters(req)
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (filters.status) {
      conditions.push(`status = $${paramIndex}`)
      params.push(filters.status)
      paramIndex += 1
    }

    if (filters.search) {
      conditions.push(`(property_address ILIKE $${paramIndex} OR transfer_id ILIKE $${paramIndex})`)
      params.push(`%${filters.search}%`)
      paramIndex += 1
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sortColumn = DEFAULT_SORT_COLUMNS.includes(filters.sortBy) ? filters.sortBy : 'created_at'

    const countQuery = `SELECT COUNT(*) FROM transfers ${whereClause}`
    const countResult = await query<{ count: string }>(countQuery, params)
    const total = parseInt(countResult.rows[0].count, 10)

    const offset = (filters.page - 1) * filters.limit
    const dataQuery = `
      SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status, t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at,
        COALESCE((SELECT json_agg(parties.*) FROM parties WHERE parties.transfer_id = t.id), '[]'::json) AS parties,
        (SELECT ROUND(COUNT(*) FILTER (WHERE mm.status = 'completed') * 100.0 / NULLIF(COUNT(*) FILTER (WHERE mm.status != 'not_required'), 0))
         FROM matter_milestones mm
         JOIN matters m ON m.id = mm.matter_id
         WHERE m.source_record_id::uuid = t.id) AS milestone_progress,
        (SELECT COUNT(*) FILTER (WHERE mm.status != 'not_required') > 0
           AND COUNT(*) FILTER (WHERE mm.status = 'completed') = COUNT(*) FILTER (WHERE mm.status != 'not_required')
         FROM matter_milestones mm
         JOIN matters m ON m.id = mm.matter_id
         WHERE m.source_record_id::uuid = t.id) AS milestone_completed,
        (SELECT MIN(mm.due_date) FILTER (WHERE mm.due_date IS NOT NULL AND mm.status NOT IN ('completed', 'not_required'))
         FROM matter_milestones mm
         JOIN matters m ON m.id = mm.matter_id
         WHERE m.source_record_id::uuid = t.id) AS next_due_date
      FROM transfers t
      ${whereClause}
      ORDER BY ${sortColumn} ${filters.sortOrder.toUpperCase()}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `
    const dataResult = await query(dataQuery, [...params, filters.limit, offset])

    res.json({
      success: true,
      data: dataResult.rows.map(mapTransferRow),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    })
  })
)

router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'draft') as draft,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM transfers
    `)
    res.json({ success: true, data: result.rows[0] })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const transferResult = await query(
      `SELECT t.*, p.id as property_row_id, p.property_id, p.erf_number, p.street_address, p.suburb, p.city,
              p.postal_code, p.province, p.country, p.property_type, p.title_deed_number, p.extent_sqm,
              p.description as property_description, p.legal_description, p.lot_number, p.year_built, p.square_footage,
              p.status as property_status, p.created_at as property_created_at, p.updated_at as property_updated_at,
              (SELECT ROUND(COUNT(*) FILTER (WHERE mm.status = 'completed') * 100.0 / NULLIF(COUNT(*) FILTER (WHERE mm.status != 'not_required'), 0))
               FROM matter_milestones mm
               JOIN matters m ON m.id = mm.matter_id
               WHERE m.source_record_id::uuid = t.id) AS milestone_progress,
              (SELECT COUNT(*) FILTER (WHERE mm.status != 'not_required') > 0
                 AND COUNT(*) FILTER (WHERE mm.status = 'completed') = COUNT(*) FILTER (WHERE mm.status != 'not_required')
               FROM matter_milestones mm
               JOIN matters m ON m.id = mm.matter_id
               WHERE m.source_record_id::uuid = t.id) AS milestone_completed
       FROM transfers t
       LEFT JOIN properties p ON t.property_id = p.id
       WHERE t.transfer_id = $1${isUuid(id) ? ' OR t.id = $1::uuid' : ''}`,
      [id]
    )

    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }

    const transferRow = transferResult.rows[0]
    const transferUuid = transferRow.id

    const [partiesResult, documentsResult, financialsResult] = await Promise.all([
      query('SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name', [transferUuid]),
      query(
        `SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
         FROM transfer_documents td
         LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
         WHERE td.transfer_id = $1
         ORDER BY td.created_at`,
        [transferUuid]
      ),
      query('SELECT * FROM transfer_financials WHERE transfer_id = $1', [transferUuid]),
    ])

    const property = mapPropertyRow({
      id: transferRow.property_row_id,
      property_id: transferRow.property_id,
      erf_number: transferRow.erf_number,
      street_address: transferRow.street_address || transferRow.property_address,
      suburb: transferRow.suburb,
      city: transferRow.city,
      postal_code: transferRow.postal_code,
      province: transferRow.province,
      country: transferRow.country,
      property_type: transferRow.property_type,
      title_deed_number: transferRow.title_deed_number,
      extent_sqm: transferRow.extent_sqm,
      description: transferRow.property_description,
      legal_description: transferRow.legal_description,
      lot_number: transferRow.lot_number,
      year_built: transferRow.year_built,
      square_footage: transferRow.square_footage,
      status: transferRow.property_status,
      created_at: transferRow.property_created_at,
      updated_at: transferRow.property_updated_at,
    })

    const milestoneProgress = transferRow.milestone_progress != null ? Number(transferRow.milestone_progress) : undefined
    const milestoneCompleted = transferRow.milestone_completed === true

    res.json({
      success: true,
      data: {
        id: transferRow.id,
        transferId: transferRow.transfer_id,
        status: milestoneCompleted ? 'completed' : transferRow.status,
        currentStep: transferRow.current_step,
        totalSteps: transferRow.total_steps,
        progress: milestoneProgress != null ? milestoneProgress : (transferRow.progress != null ? Number(transferRow.progress) : undefined),
        property,
        parties: partiesResult.rows.map(mapPartyRow),
        financials: mapFinancialRow(financialsResult.rows[0]),
        documents: documentsResult.rows.map(mapDocumentRow),
        createdAt: transferRow.created_at,
        updatedAt: transferRow.updated_at,
      },
    })
  })
)

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>
    const property = (body.property ?? undefined) as Record<string, unknown> | undefined
    const parties = (body.parties ?? undefined) as unknown[] | undefined
    const financials = (body.financials ?? undefined) as Record<string, unknown> | undefined
    const status = body.status
    const currentStep = body.currentStep
    const totalSteps = body.totalSteps
    const progress = body.progress

    const propertyAddress = property && isNonEmptyString(property.address) ? property.address : undefined
    const purchasePrice = toNumber(financials?.purchasePrice) ?? toNumber(body.purchasePrice) ?? 0

    if (!propertyAddress) {
      res.status(400).json({ success: false, error: 'Property address is required' })
      return
    }

    const newTransfer = await withTransaction(async (client) => {
      const transferId = await generateUniqueTransferId(client)

      const propertyCity = property && isNonEmptyString(property.city) ? property.city : 'Unknown'
      const propertyProvince = property && isNonEmptyString(property.province) ? property.province : 'Unknown'
      const propertyType = toPropertyType(property?.propertyType)

      let propertyId: string | null = null
      if (property) {
        const propertyIdValue = await generateUniquePropertyId(client)
        const propertyResult = await client.query(
          `INSERT INTO properties (
            property_id, street_address, suburb, city, postal_code, province,
            country, property_type, erf_number, title_deed_number, extent_sqm, description,
            legal_description, lot_number, year_built, square_footage, created_for_transfer_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING id`,
          [
            propertyIdValue,
            propertyAddress,
            isNonEmptyString(property.city) ? property.city : null,
            propertyCity,
            isSaPostalCode(property.postalCode) ? property.postalCode : null,
            propertyProvince,
            isNonEmptyString(property.country) ? property.country : 'South Africa',
            propertyType,
            isNonEmptyString(property.erfNumber) ? property.erfNumber : null,
            isNonEmptyString(property.titleDeedNumber) ? property.titleDeedNumber : null,
            toNumber(property.extentSqm),
            isNonEmptyString(property.description) ? property.description : null,
            isNonEmptyString(property.legalDescription) ? property.legalDescription : null,
            isNonEmptyString(property.lotNumber) ? property.lotNumber : null,
            toNumber(property.yearBuilt),
            toNumber(property.squareFootage),
            transferId,
          ]
        )
        propertyId = propertyResult.rows[0].id
      }

      const statusValue = isValidStatus(status) ? status : 'draft'
      const currentStepValue = typeof currentStep === 'number' ? currentStep : 1
      const totalStepsValue = typeof totalSteps === 'number' ? totalSteps : 5
      const progressValue = typeof progress === 'number' ? progress : 0

      const transferResult = await client.query(
        `INSERT INTO transfers (
          transfer_id, property_id, property_address, purchase_price, status,
          current_step, total_steps, progress
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          transferId,
          propertyId,
          propertyAddress,
          purchasePrice,
          statusValue,
          currentStepValue,
          totalStepsValue,
          progressValue,
        ]
      )
      const transferRow = transferResult.rows[0]
      const transferUuid = transferRow.id

      await client.query(
        `INSERT INTO transfer_financials (
          transfer_id, purchase_price, deposit_amount, loan_amount, interest_rate, loan_term_years,
          transfer_duty, conveyancing_fees, deeds_office_fees, vat, post_and_petties,
          clearance_certificate_fee, rates_clearance_amount, total_costs, net_proceeds
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          transferUuid,
          purchasePrice,
          toNumber(financials?.depositAmount) ?? 0,
          toNumber(financials?.loanAmount) ?? 0,
          toNumber(financials?.interestRate),
          toNumber(financials?.loanTerm),
          toNumber(financials?.transferDuty) ?? 0,
          toNumber(financials?.conveyancingFees) ?? 0,
          toNumber(financials?.deedsOfficeFees) ?? 0,
          toNumber(financials?.vat) ?? 0,
          toNumber(financials?.postAndPetties) ?? 0,
          toNumber(financials?.clearanceCertificateFee) ?? 0,
          toNumber(financials?.ratesClearanceAmount) ?? 0,
          toNumber(financials?.totalCosts) ?? 0,
          toNumber(financials?.netProceeds),
        ]
      )

      const createdParties: any[] = []
      if (Array.isArray(parties)) {
        for (const raw of parties) {
          const party = raw as Record<string, unknown>
          const partyName = isNonEmptyString(party.name) ? party.name : undefined
          const partyType = typeof party.type === 'string' && ['buyer', 'seller'].includes(party.type) ? party.type : undefined
          if (!partyName || !partyType) continue
          const partyResult = await client.query(
            `INSERT INTO parties (transfer_id, name, type, id_number, registration_number, email, phone, address, company_name, role_title, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              transferUuid,
              partyName,
              partyType,
              isNonEmptyString(party.idNumber) ? party.idNumber : null,
              isNonEmptyString(party.registrationNumber) ? party.registrationNumber : null,
              isNonEmptyString(party.email) ? party.email : null,
              isNonEmptyString(party.phone) ? party.phone : null,
              isNonEmptyString(party.address) ? party.address : null,
              isNonEmptyString(party.company) ? party.company : null,
              isNonEmptyString(party.role) ? party.role : null,
              party.isPrimary === true,
            ]
          )
          createdParties.push(mapPartyRow(partyResult.rows[0]))
        }
      }

      const matterId = await getOrCreateMatterForTransfer(client, transferUuid, transferId)
      await createDefaultMilestones(client, matterId)
      await seedTransferDocuments(client, transferUuid)

      const financialsResult = await client.query('SELECT * FROM transfer_financials WHERE transfer_id = $1', [transferUuid])
      const documentsResult = await client.query(
        `SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
         FROM transfer_documents td
         LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
         WHERE td.transfer_id = $1
         ORDER BY td.created_at`,
        [transferUuid]
      )

      return {
        ...mapTransferRow(transferRow),
        property: mapPropertyRow({
          ...transferRow,
          street_address: propertyAddress,
          city: propertyCity,
          province: propertyProvince,
          property_type: propertyType,
        }),
        parties: createdParties,
        financials: mapFinancialRow(financialsResult.rows[0]),
        documents: documentsResult.rows.map(mapDocumentRow),
      }
    })

    res.status(201).json({ success: true, data: newTransfer, message: 'Transfer created successfully' })
  })
)

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const transferResult = await query(`SELECT id, transfer_id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    const transferUuid = transferResult.rows[0].id
    const transferReference = transferResult.rows[0].transfer_id

    const body = req.body as Record<string, unknown>
    const property = (body.property ?? undefined) as Record<string, unknown> | undefined
    const parties = (body.parties ?? undefined) as unknown[] | undefined
    const financials = (body.financials ?? undefined) as Record<string, unknown> | undefined
    const documents = (body.documents ?? undefined) as unknown[] | undefined
    const status = body.status
    const currentStep = body.currentStep
    const totalSteps = body.totalSteps
    const progress = body.progress

    const updated = await withTransaction(async (client) => {
      const transferUpdates: string[] = []
      const transferParams: unknown[] = []
      let paramIdx = 1

      if (property && isNonEmptyString(property.address)) {
        transferUpdates.push(`property_address = $${paramIdx}`)
        transferParams.push(property.address)
        paramIdx += 1
      }

      const purchasePrice = toNumber(financials?.purchasePrice)
      if (purchasePrice !== undefined) {
        transferUpdates.push(`purchase_price = $${paramIdx}`)
        transferParams.push(purchasePrice)
        paramIdx += 1
      }

      if (isValidStatus(status)) {
        transferUpdates.push(`status = $${paramIdx}`)
        transferParams.push(status)
        paramIdx += 1
      }

      if (typeof currentStep === 'number') {
        transferUpdates.push(`current_step = $${paramIdx}`)
        transferParams.push(currentStep)
        paramIdx += 1
      }

      if (typeof totalSteps === 'number') {
        transferUpdates.push(`total_steps = $${paramIdx}`)
        transferParams.push(totalSteps)
        paramIdx += 1
      }

      if (typeof progress === 'number') {
        transferUpdates.push(`progress = $${paramIdx}`)
        transferParams.push(progress)
        paramIdx += 1
      }

      if (transferUpdates.length > 0) {
        transferUpdates.push(`updated_at = CURRENT_TIMESTAMP`)
        transferParams.push(transferUuid)
        await client.query(
          `UPDATE transfers SET ${transferUpdates.join(', ')} WHERE id = $${paramIdx}`,
          transferParams
        )
      }

      if (property && transferUpdates.length > 0) {
        const propertyResult = await client.query('SELECT property_id FROM transfers WHERE id = $1', [transferUuid])
        let propertyId = propertyResult.rows[0]?.property_id

        if (!propertyId && isNonEmptyString(property.address)) {
          const propertyIdValue = await generateUniquePropertyId(client)
          const insertResult = await client.query(
            `INSERT INTO properties (
              property_id, street_address, suburb, city, postal_code, province,
              country, property_type, erf_number, title_deed_number, extent_sqm, description,
              legal_description, lot_number, year_built, square_footage
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id`,
            [
              propertyIdValue,
              property.address,
              isNonEmptyString(property.city) ? property.city : null,
              isNonEmptyString(property.city) ? property.city : null,
              isSaPostalCode(property.postalCode) ? property.postalCode : null,
              isNonEmptyString(property.province) ? property.province : null,
              isNonEmptyString(property.country) ? property.country : 'South Africa',
              toPropertyType(property.propertyType),
              isNonEmptyString(property.erfNumber) ? property.erfNumber : null,
              isNonEmptyString(property.titleDeedNumber) ? property.titleDeedNumber : null,
              toNumber(property.extentSqm),
              isNonEmptyString(property.description) ? property.description : null,
              isNonEmptyString(property.legalDescription) ? property.legalDescription : null,
              isNonEmptyString(property.lotNumber) ? property.lotNumber : null,
              toNumber(property.yearBuilt),
              toNumber(property.squareFootage),
            ]
          )
          propertyId = insertResult.rows[0].id
          await client.query('UPDATE transfers SET property_id = $1 WHERE id = $2', [propertyId, transferUuid])
        }

        if (propertyId) {
          const propertyUpdates: string[] = []
          const propertyParams: unknown[] = []
          let pIdx = 1
          const add = (key: string, value: unknown) => {
            propertyUpdates.push(`${key} = $${pIdx}`)
            propertyParams.push(value)
            pIdx += 1
          }
          if (isNonEmptyString(property.address)) add('street_address', property.address)
          if (isNonEmptyString(property.city)) add('city', property.city)
          if (isNonEmptyString(property.province)) add('province', property.province)
          if (isSaPostalCode(property.postalCode)) add('postal_code', property.postalCode)
          if (isNonEmptyString(property.country)) add('country', property.country)
          if (isNonEmptyString(property.propertyType)) add('property_type', toPropertyType(property.propertyType))
          if (isNonEmptyString(property.erfNumber)) add('erf_number', property.erfNumber)
          if (isNonEmptyString(property.titleDeedNumber)) add('title_deed_number', property.titleDeedNumber)
          if (toNumber(property.extentSqm) !== undefined) add('extent_sqm', toNumber(property.extentSqm))
          if (isNonEmptyString(property.description)) add('description', property.description)
          if (isNonEmptyString(property.legalDescription)) add('legal_description', property.legalDescription)
          if (isNonEmptyString(property.lotNumber)) add('lot_number', property.lotNumber)
          if (toNumber(property.yearBuilt) !== undefined) add('year_built', toNumber(property.yearBuilt))
          if (toNumber(property.squareFootage) !== undefined) add('square_footage', toNumber(property.squareFootage))
          if (propertyUpdates.length > 0) {
            propertyUpdates.push(`updated_at = CURRENT_TIMESTAMP`)
            propertyParams.push(propertyId)
            await client.query(
              `UPDATE properties SET ${propertyUpdates.join(', ')} WHERE id = $${pIdx}`,
              propertyParams
            )
          }
        }
      }

      if (financials && Object.keys(financials).length > 0) {
        const existing = await client.query('SELECT 1 FROM transfer_financials WHERE transfer_id = $1', [transferUuid])
        const finExists = existing.rowCount && existing.rowCount > 0
        const fields: Record<string, { col: string; val: unknown }> = {
          purchasePrice: { col: 'purchase_price', val: purchasePrice },
          depositAmount: { col: 'deposit_amount', val: toNumber(financials.depositAmount) },
          loanAmount: { col: 'loan_amount', val: toNumber(financials.loanAmount) },
          interestRate: { col: 'interest_rate', val: toNumber(financials.interestRate) },
          loanTerm: { col: 'loan_term_years', val: toNumber(financials.loanTerm) },
          transferDuty: { col: 'transfer_duty', val: toNumber(financials.transferDuty) },
          conveyancingFees: { col: 'conveyancing_fees', val: toNumber(financials.conveyancingFees) },
          deedsOfficeFees: { col: 'deeds_office_fees', val: toNumber(financials.deedsOfficeFees) },
          vat: { col: 'vat', val: toNumber(financials.vat) },
          postAndPetties: { col: 'post_and_petties', val: toNumber(financials.postAndPetties) },
          clearanceCertificateFee: { col: 'clearance_certificate_fee', val: toNumber(financials.clearanceCertificateFee) },
          ratesClearanceAmount: { col: 'rates_clearance_amount', val: toNumber(financials.ratesClearanceAmount) },
          totalCosts: { col: 'total_costs', val: toNumber(financials.totalCosts) },
          netProceeds: { col: 'net_proceeds', val: toNumber(financials.netProceeds) },
        }

        const updates = Object.entries(fields)
          .filter(([, { val }]) => val !== undefined)
          .map(([, { col, val }]) => ({ col, val }))

        if (finExists) {
          if (updates.length > 0) {
            const setClause = updates.map((u, i) => `${u.col} = $${i + 1}`).join(', ')
            const values = [...updates.map((u) => u.val), transferUuid]
            await client.query(
              `UPDATE transfer_financials SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE transfer_id = $${updates.length + 1}`,
              values
            )
          }
        } else {
          await client.query(
            `INSERT INTO transfer_financials (
              transfer_id, purchase_price, deposit_amount, loan_amount, interest_rate, loan_term_years,
              transfer_duty, conveyancing_fees, deeds_office_fees, vat, post_and_petties,
              clearance_certificate_fee, rates_clearance_amount, total_costs, net_proceeds
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              transferUuid,
              fields.purchasePrice.val,
              fields.depositAmount.val,
              fields.loanAmount.val,
              fields.interestRate.val,
              fields.loanTerm.val,
              fields.transferDuty.val,
              fields.conveyancingFees.val,
              fields.deedsOfficeFees.val,
              fields.vat.val,
              fields.postAndPetties.val,
              fields.clearanceCertificateFee.val,
              fields.ratesClearanceAmount.val,
              fields.totalCosts.val,
              fields.netProceeds.val,
            ]
          )
        }
      }

      if (Array.isArray(parties)) {
        const retainedPartyIds = parties
          .map(raw => raw as Record<string, unknown>)
          .filter(party => isUuid(party.id))
          .map(party => party.id as string)
        if (retainedPartyIds.length > 0) {
          await client.query('DELETE FROM parties WHERE transfer_id = $1 AND NOT (id = ANY($2::uuid[]))', [transferUuid, retainedPartyIds])
        } else {
          await client.query('DELETE FROM parties WHERE transfer_id = $1', [transferUuid])
        }
        for (const raw of parties) {
          const party = raw as Record<string, unknown>
          const partyId = isUuid(party.id) ? party.id : undefined
          const partyName = isNonEmptyString(party.name) ? party.name : undefined
          const partyType = typeof party.type === 'string' && ['buyer', 'seller'].includes(party.type) ? party.type : undefined

          if (!partyName || !partyType) continue

          if (partyId) {
            const existing = await client.query('SELECT id FROM parties WHERE id = $1 AND transfer_id = $2', [partyId, transferUuid])
            if (existing.rowCount && existing.rowCount > 0) {
              await client.query(
                `UPDATE parties SET
                  name = $1, type = $2, id_number = $3, registration_number = $4, email = $5, phone = $6, address = $7,
                  company_name = $8, role_title = $9, is_primary = $10, updated_at = CURRENT_TIMESTAMP
                WHERE id = $11 AND transfer_id = $12`,
                [
                  partyName,
                  partyType,
                  isNonEmptyString(party.idNumber) ? party.idNumber : null,
                  isNonEmptyString(party.registrationNumber) ? party.registrationNumber : null,
                  isNonEmptyString(party.email) ? party.email : null,
                  isNonEmptyString(party.phone) ? party.phone : null,
                  isNonEmptyString(party.address) ? party.address : null,
                  isNonEmptyString(party.company) ? party.company : null,
                  isNonEmptyString(party.role) ? party.role : null,
                  party.isPrimary === true,
                  partyId,
                  transferUuid,
                ]
              )
            }
          } else {
            await client.query(
              `INSERT INTO parties (transfer_id, name, type, id_number, registration_number, email, phone, address, company_name, role_title, is_primary)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                transferUuid,
                partyName,
                partyType,
                isNonEmptyString(party.idNumber) ? party.idNumber : null,
                isNonEmptyString(party.registrationNumber) ? party.registrationNumber : null,
                isNonEmptyString(party.email) ? party.email : null,
                isNonEmptyString(party.phone) ? party.phone : null,
                isNonEmptyString(party.address) ? party.address : null,
                isNonEmptyString(party.company) ? party.company : null,
                isNonEmptyString(party.role) ? party.role : null,
                party.isPrimary === true,
              ]
            )
          }
        }
      }

      if (Array.isArray(documents)) {
        for (const raw of documents) {
          const doc = raw as Record<string, unknown>
          const docId = isUuid(doc.id) ? doc.id : undefined
          const catalogueDocumentId = isUuid(doc.catalogueDocumentId) ? doc.catalogueDocumentId : undefined
          if (!docId && !catalogueDocumentId) continue

          const notes = isNonEmptyString(doc.notes)
            ? doc.notes
            : isNonEmptyString(doc.description)
              ? doc.description
              : null

          if (docId) {
            await client.query(
              `UPDATE transfer_documents
               SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
               WHERE id = $3 AND transfer_id = $4`,
              [
                typeof doc.status === 'string' ? doc.status : 'pending',
                notes,
                docId,
                transferUuid,
              ]
            )
          } else if (catalogueDocumentId) {
            await client.query(
              `UPDATE transfer_documents
               SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
               WHERE transfer_id = $3 AND catalogue_document_id = $4`,
              [
                typeof doc.status === 'string' ? doc.status : 'pending',
                notes,
                transferUuid,
                catalogueDocumentId,
              ]
            )
          }
        }
      }

      await getOrCreateMatterForTransfer(client, transferUuid, transferReference)

      const finalTransfer = await client.query(
        `SELECT t.*, p.id as property_row_id, p.property_id, p.erf_number, p.street_address, p.suburb, p.city,
                p.postal_code, p.province, p.country, p.property_type, p.title_deed_number, p.extent_sqm,
                p.description as property_description, p.legal_description, p.lot_number, p.year_built, p.square_footage,
              p.status as property_status, p.created_at as property_created_at, p.updated_at as property_updated_at
         FROM transfers t
         LEFT JOIN properties p ON t.property_id = p.id
         WHERE t.id = $1`,
        [transferUuid]
      )
      const finalParties = await client.query('SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name', [transferUuid])
      const finalDocs = await client.query(
        `SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
         FROM transfer_documents td
         LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
         WHERE td.transfer_id = $1
         ORDER BY td.created_at`,
        [transferUuid]
      )
      const finalFinancials = await client.query('SELECT * FROM transfer_financials WHERE transfer_id = $1', [transferUuid])

      const finalRow = finalTransfer.rows[0]
      return {
        ...mapTransferRow(finalRow),
        property: mapPropertyRow({
          id: finalRow.property_row_id,
          property_id: finalRow.property_id,
          erf_number: finalRow.erf_number,
          street_address: finalRow.street_address || finalRow.property_address,
          suburb: finalRow.suburb,
          city: finalRow.city,
          postal_code: finalRow.postal_code,
          province: finalRow.province,
          country: finalRow.country,
          property_type: finalRow.property_type,
          title_deed_number: finalRow.title_deed_number,
          extent_sqm: finalRow.extent_sqm,
          description: finalRow.property_description,
          legal_description: finalRow.legal_description,
          lot_number: finalRow.lot_number,
          year_built: finalRow.year_built,
          square_footage: finalRow.square_footage,
          status: finalRow.property_status,
          created_at: finalRow.property_created_at,
          updated_at: finalRow.property_updated_at,
        }),
        parties: finalParties.rows.map(mapPartyRow),
        financials: mapFinancialRow(finalFinancials.rows[0]),
        documents: finalDocs.rows.map(mapDocumentRow),
      }
    })

    res.json({ success: true, data: updated, message: 'Transfer updated successfully' })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const result = await query(`DELETE FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    res.json({ success: true, data: true, message: 'Transfer deleted successfully' })
  })
)

router.get(
  '/:id/parties',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const transferResult = await query(`SELECT id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    const partiesResult = await query('SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name', [transferResult.rows[0].id])
    res.json({ success: true, data: partiesResult.rows.map(mapPartyRow) })
  })
)

router.get(
  '/:id/documents',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const transferResult = await query(`SELECT id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    const documentsResult = await query(
      `SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
       FROM transfer_documents td
       LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
       WHERE td.transfer_id = $1
       ORDER BY td.created_at`,
      [transferResult.rows[0].id]
    )
    res.json({ success: true, data: documentsResult.rows.map(mapDocumentRow) })
  })
)

router.post(
  '/:id/documents/:documentId/upload',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, documentId } = req.params
    const { fileName, fileType, fileData } = req.body as Record<string, unknown>

    if (!isNonEmptyString(fileName) || !isNonEmptyString(fileData)) {
      res.status(400).json({ success: false, error: 'fileName and fileData are required' })
      return
    }

    const transferResult = await query(`SELECT id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    const transferUuid = transferResult.rows[0].id

    const updated = await withTransaction(async (client) => {
      return saveTransferDocumentUpload(
        client,
        transferUuid,
        documentId,
        fileName,
        typeof fileType === 'string' ? fileType : 'application/octet-stream',
        fileData
      )
    })

    if (!updated) {
      res.status(404).json({ success: false, error: 'Transfer document not found' })
      return
    }

    res.json({ success: true, data: mapDocumentRow(updated), message: 'Document uploaded successfully' })
  })
)

router.post(
  '/:id/documents',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const { catalogueDocumentId, name } = req.body as { catalogueDocumentId?: unknown; name?: unknown }

    const transferResult = await query(`SELECT id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    const transferUuid = transferResult.rows[0].id

    const newDocument = await withTransaction(async (client) => {
      if (isUuid(catalogueDocumentId)) {
        const catalogueResult = await client.query('SELECT name FROM document_catalogue WHERE id = $1', [catalogueDocumentId])
        if (catalogueResult.rows.length === 0) {
          res.status(404).json({ success: false, error: 'Catalogue document not found' })
          return null
        }
        const catalogueName = catalogueResult.rows[0].name
        const insertResult = await client.query(
          `INSERT INTO transfer_documents (transfer_id, catalogue_document_id, name, status)
           VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (transfer_id, catalogue_document_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [transferUuid, catalogueDocumentId, catalogueName]
        )
        return insertResult.rows[0]
      }

      if (!isNonEmptyString(name)) {
        res.status(400).json({ success: false, error: 'catalogueDocumentId or name is required' })
        return null
      }

      const insertResult = await client.query(
        `INSERT INTO transfer_documents (transfer_id, name, status)
         VALUES ($1, $2, 'pending')
         RETURNING *`,
        [transferUuid, name]
      )
      return insertResult.rows[0]
    })

    if (!newDocument) return

    res.status(201).json({ success: true, data: mapDocumentRow(newDocument), message: 'Document added to transfer' })
  })
)

router.patch(
  '/:id/documents/:documentId',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, documentId } = req.params
    const { status, notes } = req.body as { status?: unknown; notes?: unknown }

    const transferResult = await query(`SELECT id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`, [id])
    if (transferResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer not found' })
      return
    }
    const transferUuid = transferResult.rows[0].id

    const updates: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    const validStatuses = ['pending', 'uploaded', 'verified', 'rejected', 'not_required']
    if (typeof status === 'string' && validStatuses.includes(status)) {
      updates.push(`status = $${paramIdx}`)
      params.push(status)
      paramIdx += 1
    }

    if (typeof notes === 'string') {
      updates.push(`notes = $${paramIdx}`)
      params.push(notes)
      paramIdx += 1
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'status or notes is required' })
      return
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    params.push(documentId, transferUuid)
    const result = await query(
      `UPDATE transfer_documents SET ${updates.join(', ')} WHERE id = $${paramIdx} AND transfer_id = $${paramIdx + 1} RETURNING *`,
      params
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Transfer document not found' })
      return
    }

    res.json({ success: true, data: mapDocumentRow(result.rows[0]), message: 'Document updated successfully' })
  })
)

export default router
