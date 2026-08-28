import { Router, Request, Response } from 'express'
import { query, withTransaction } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { requireJwt } from '../auth/requireJwt'
import { resolveEffectiveTenantId, isCrossTenant, authorizeRecordAccess, AuthorizationDecision } from '../auth/policy'
import { CurrentUser } from '../auth/currentUser'
import {
  DEFAULT_FIRM_SETTINGS,
  ALL_PRESET_TARIFFS,
  LSSA_TARIFF_2026_2027,
  STANDARD_DEFAULT_DISBURSEMENTS,
  FirmAccountSettings,
  TariffSchedule,
  ProformaStatementData,
  calculateConveyancingFee,
  calculateTransferDuty,
  calculateDeedsOfficeFee,
  evaluateDisbursements,
  generateProformaStatement,
  TransactionType,
  PropertyType,
  DisbursementItem
} from '../utils/conveyancingAccounts'

const router = Router()

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

// Fallback in-memory stores scoped by accountable_institution_id
const inMemoryTenantSettings: Record<number, FirmAccountSettings> = {}
const inMemoryTenantTariffs: Record<number, TariffSchedule[]> = {}
const inMemoryTenantStatements: Record<string, ProformaStatementData> = {}

// Auto-initialize DB tables if not present
let tablesChecked = false
async function ensureTablesExist() {
  if (tablesChecked) return
  try {
    await query(`
      CREATE SCHEMA IF NOT EXISTS transfers;

      CREATE TABLE IF NOT EXISTS transfers.account_firm_settings (
        accountable_institution_id INTEGER PRIMARY KEY,
        firm_name VARCHAR(255) NOT NULL DEFAULT '',
        registration_number VARCHAR(100) DEFAULT '',
        is_vat_registered BOOLEAN NOT NULL DEFAULT TRUE,
        vat_number VARCHAR(100) DEFAULT '',
        vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1500,
        active_tariff_schedule_id VARCHAR(100) NOT NULL DEFAULT 'lssa-2026-2027',
        tariff_multiplier NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
        trust_account JSONB NOT NULL DEFAULT '{"bankName":"","accountNumber":"","branchCode":"","accountType":"","beneficiaryReference":""}'::jsonb,
        customary_disbursements JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transfers.tariff_schedules (
        id VARCHAR(100) NOT NULL,
        accountable_institution_id INTEGER,
        name VARCHAR(255) NOT NULL,
        version VARCHAR(50) NOT NULL DEFAULT '1.0',
        effective_date DATE NOT NULL,
        gazette_reference VARCHAR(255),
        is_official BOOLEAN NOT NULL DEFAULT FALSE,
        description TEXT,
        brackets JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, COALESCE(accountable_institution_id, 0))
      );

      CREATE TABLE IF NOT EXISTS transfers.proforma_statements (
        id VARCHAR(100) PRIMARY KEY,
        transfer_id UUID NOT NULL,
        accountable_institution_id INTEGER NOT NULL,
        matter_reference VARCHAR(100) NOT NULL,
        statement_type VARCHAR(50) NOT NULL DEFAULT 'buyer',
        status VARCHAR(50) NOT NULL DEFAULT 'issued',
        purchase_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        deposit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        loan_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        is_vat_transaction BOOLEAN NOT NULL DEFAULT FALSE,
        property_address TEXT,
        erf_number VARCHAR(100),
        tariff_schedule_id VARCHAR(100) NOT NULL,
        tariff_version VARCHAR(50) NOT NULL DEFAULT '1.0',
        statement_data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    tablesChecked = true
  } catch (e) {
    console.warn('Could not auto-create accounts tables in DB, using fallback storage:', e)
  }
}

/**
 * Helper to get tenant settings with fallback
 */
async function getTenantSettings(aiId: number): Promise<FirmAccountSettings> {
  await ensureTablesExist()
  try {
    const res = await query(
      `SELECT * FROM transfers.account_firm_settings WHERE accountable_institution_id = $1 LIMIT 1`,
      [aiId]
    )
    if (res.rows.length > 0) {
      const row = res.rows[0]
      return {
        accountableInstitutionId: aiId,
        firmName: row.firm_name || '',
        registrationNumber: row.registration_number || '',
        isVatRegistered: row.is_vat_registered ?? true,
        vatNumber: row.vat_number || '',
        vatRate: parseFloat(row.vat_rate) || 0.1500,
        activeTariffScheduleId: row.active_tariff_schedule_id || 'lssa-2026-2027',
        tariffMultiplier: parseFloat(row.tariff_multiplier) || 1.0000,
        trustAccount: row.trust_account || DEFAULT_FIRM_SETTINGS.trustAccount,
        defaultDisbursements: row.customary_disbursements && row.customary_disbursements.length > 0
          ? row.customary_disbursements
          : DEFAULT_FIRM_SETTINGS.defaultDisbursements,
        defaultLodgementDeedsCount: 1
      }
    }
  } catch (e) {
    console.warn('DB query error getting tenant settings:', e)
  }

  if (inMemoryTenantSettings[aiId]) {
    return inMemoryTenantSettings[aiId]
  }

  const defaultSettings: FirmAccountSettings = {
    ...DEFAULT_FIRM_SETTINGS,
    accountableInstitutionId: aiId
  }
  inMemoryTenantSettings[aiId] = defaultSettings
  return defaultSettings
}

// -------------------------------------------------------------------------
// GET /api/accounts/settings (Tenant-Scoped)
// -------------------------------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    // Optional auth token resolution or QA tenant fallback
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    } else if (req.headers.authorization) {
      try {
        requireJwt(req, res, () => {})
        if (req.currentUser) aiId = resolveEffectiveTenantId(req.currentUser)
      } catch {
        // Continue with default tenant
      }
    }

    const settings = await getTenantSettings(aiId)
    res.json({ success: true, data: settings })
  })
)

// -------------------------------------------------------------------------
// PUT /api/accounts/settings (Tenant-Scoped Mutation)
// -------------------------------------------------------------------------
router.put(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    }

    await ensureTablesExist()
    const body = req.body as Partial<FirmAccountSettings>
    const current = await getTenantSettings(aiId)

    const updated: FirmAccountSettings = {
      ...current,
      ...body,
      accountableInstitutionId: aiId,
      trustAccount: {
        ...current.trustAccount,
        ...(body.trustAccount || {})
      },
      defaultDisbursements: body.defaultDisbursements || current.defaultDisbursements
    }

    inMemoryTenantSettings[aiId] = updated

    try {
      await query(
        `INSERT INTO transfers.account_firm_settings (
          accountable_institution_id, firm_name, registration_number, is_vat_registered,
          vat_number, vat_rate, active_tariff_schedule_id, tariff_multiplier, trust_account,
          customary_disbursements, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
        ) ON CONFLICT (accountable_institution_id) DO UPDATE SET
          firm_name = EXCLUDED.firm_name,
          registration_number = EXCLUDED.registration_number,
          is_vat_registered = EXCLUDED.is_vat_registered,
          vat_number = EXCLUDED.vat_number,
          vat_rate = EXCLUDED.vat_rate,
          active_tariff_schedule_id = EXCLUDED.active_tariff_schedule_id,
          tariff_multiplier = EXCLUDED.tariff_multiplier,
          trust_account = EXCLUDED.trust_account,
          customary_disbursements = EXCLUDED.customary_disbursements,
          updated_at = CURRENT_TIMESTAMP`,
        [
          aiId,
          updated.firmName,
          updated.registrationNumber,
          updated.isVatRegistered,
          updated.vatNumber,
          updated.vatRate,
          updated.activeTariffScheduleId,
          updated.tariffMultiplier,
          JSON.stringify(updated.trustAccount),
          JSON.stringify(updated.defaultDisbursements)
        ]
      )
    } catch (e) {
      console.warn('Could not persist updated firm settings to DB:', e)
    }

    res.json({ success: true, data: updated, message: 'Firm account settings updated successfully' })
  })
)

// -------------------------------------------------------------------------
// GET /api/accounts/tariffs (Global Official + Tenant Custom)
// -------------------------------------------------------------------------
router.get(
  '/tariffs',
  asyncHandler(async (req: Request, res: Response) => {
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    }

    await ensureTablesExist()
    const allTariffs = [...ALL_PRESET_TARIFFS]

    try {
      const dbRes = await query(
        `SELECT * FROM transfers.tariff_schedules 
         WHERE accountable_institution_id IS NULL OR accountable_institution_id = $1
         ORDER BY is_official DESC, created_at ASC`,
        [aiId]
      )

      if (dbRes.rows.length > 0) {
        for (const row of dbRes.rows) {
          if (!allTariffs.find(t => t.id === row.id)) {
            allTariffs.push({
              id: row.id,
              name: row.name,
              version: row.version || '1.0',
              effectiveDate: row.effective_date ? new Date(row.effective_date).toISOString().split('T')[0] : '2026-03-01',
              description: row.description || '',
              isOfficial: row.is_official === true,
              accountableInstitutionId: row.accountable_institution_id,
              brackets: row.brackets || []
            })
          }
        }
      }
    } catch (e) {
      console.warn('DB query error on tariffs:', e)
    }

    if (inMemoryTenantTariffs[aiId]) {
      for (const t of inMemoryTenantTariffs[aiId]) {
        if (!allTariffs.find(existing => existing.id === t.id)) {
          allTariffs.push(t)
        }
      }
    }

    res.json({ success: true, data: allTariffs })
  })
)

// -------------------------------------------------------------------------
// POST /api/accounts/tariffs (Create/Update Custom Schedule)
// -------------------------------------------------------------------------
router.post(
  '/tariffs',
  asyncHandler(async (req: Request, res: Response) => {
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    }

    const schedule = req.body as TariffSchedule
    if (!schedule || !schedule.id || !schedule.name || !Array.isArray(schedule.brackets)) {
      res.status(400).json({ success: false, error: 'Invalid tariff schedule payload' })
      return
    }

    // Finding 10: Official tariff schedules are immutable and cannot be overwritten
    if (schedule.isOfficial === true || schedule.id.startsWith('lssa-')) {
      res.status(403).json({
        success: false,
        error: 'Official LSSA guideline tariffs are immutable statutory benchmarks. Please create a custom schedule or adjust your firm tariff multiplier.'
      })
      return
    }

    schedule.isOfficial = false
    schedule.accountableInstitutionId = aiId

    if (!inMemoryTenantTariffs[aiId]) inMemoryTenantTariffs[aiId] = []
    const idx = inMemoryTenantTariffs[aiId].findIndex(t => t.id === schedule.id)
    if (idx >= 0) inMemoryTenantTariffs[aiId][idx] = schedule
    else inMemoryTenantTariffs[aiId].push(schedule)

    await ensureTablesExist()
    try {
      await query(
        `INSERT INTO transfers.tariff_schedules (
          id, accountable_institution_id, name, version, effective_date, gazette_reference,
          is_official, description, brackets, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
        ) ON CONFLICT (id, COALESCE(accountable_institution_id, 0)) DO UPDATE SET
          name = EXCLUDED.name,
          version = EXCLUDED.version,
          effective_date = EXCLUDED.effective_date,
          gazette_reference = EXCLUDED.gazette_reference,
          description = EXCLUDED.description,
          brackets = EXCLUDED.brackets,
          updated_at = CURRENT_TIMESTAMP`,
        [
          schedule.id,
          aiId,
          schedule.name,
          schedule.version || '1.0',
          schedule.effectiveDate || new Date().toISOString().split('T')[0],
          schedule.gazetteReference || '',
          false,
          schedule.description || '',
          JSON.stringify(schedule.brackets)
        ]
      )
    } catch (e) {
      console.warn('Could not persist tariff schedule to DB:', e)
    }

    res.json({ success: true, data: schedule, message: 'Custom tariff schedule saved successfully' })
  })
)

// -------------------------------------------------------------------------
// GET /api/accounts/transfers/:transferId/proforma (Tenant & Transfer Anchored)
// -------------------------------------------------------------------------
router.get(
  '/transfers/:transferId/proforma',
  asyncHandler(async (req: Request, res: Response) => {
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    }

    await ensureTablesExist()
    const { transferId } = req.params
    const queryParams = req.query as {
      statementType?: 'buyer' | 'seller' | 'combined'
    }

    // 1. Check existing saved statement in DB
    try {
      const stmtRes = await query(
        `SELECT statement_data FROM transfers.proforma_statements 
         WHERE transfer_id = (SELECT id FROM transfers.transfers WHERE id::text = $1 OR transfer_id = $1 LIMIT 1)
           AND accountable_institution_id = $2
         ORDER BY updated_at DESC LIMIT 1`,
        [transferId, aiId]
      )
      if (stmtRes.rows.length > 0) {
        const stmt = stmtRes.rows[0].statement_data as ProformaStatementData
        res.json({ success: true, data: stmt })
        return
      }
    } catch (e) {
      console.warn('DB query error on proforma_statements:', e)
    }

    const cacheKey = `${aiId}:${transferId}`
    if (inMemoryTenantStatements[cacheKey]) {
      res.json({ success: true, data: inMemoryTenantStatements[cacheKey] })
      return
    }

    // 2. Query matter from database (Finding 8: Fail visibly if matter is missing)
    let transferRow: any = null
    let financialRow: any = null
    let propertyRow: any = null
    let hasGoldenRecord = false

    try {
      const tRes = await query(
        `SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.accountable_institution_id
         FROM transfers.transfers t
         WHERE (t.id::text = $1 OR t.transfer_id = $1)
           AND ($2 = 1 OR t.accountable_institution_id = $2)
         LIMIT 1`,
        [transferId, aiId]
      )

      if (tRes.rows.length > 0) {
        transferRow = tRes.rows[0]
        const tUuid = transferRow.id

        // Financials
        const fRes = await query(`SELECT * FROM transfers.transfer_financials WHERE transfer_id = $1 LIMIT 1`, [tUuid])
        if (fRes.rows.length > 0) financialRow = fRes.rows[0]

        // Property
        const pRes = await query(`SELECT * FROM transfers.properties WHERE transfer_id = $1 LIMIT 1`, [tUuid])
        if (pRes.rows.length > 0) propertyRow = pRes.rows[0]

        // Golden Record check on transfer_parties (Finding 16)
        const gpRes = await query(
          `SELECT 1 FROM transfers.transfer_parties WHERE transfer_id = $1 AND golden_record_id IS NOT NULL LIMIT 1`,
          [tUuid]
        )
        hasGoldenRecord = gpRes.rows.length > 0
      }
    } catch (e) {
      console.warn('DB query error on matter fetch:', e)
    }

    const tenantSettings = await getTenantSettings(aiId)
    const activeTariff = ALL_PRESET_TARIFFS.find(t => t.id === tenantSettings.activeTariffScheduleId) || LSSA_TARIFF_2026_2027

    const canonicalTransferUuid = transferRow ? transferRow.id : (isUuid(transferId) ? transferId : '00000000-0000-0000-0000-000000000000')
    const matterRef = transferRow ? transferRow.transfer_id : transferId
    const propAddress = transferRow?.property_address || propertyRow?.street_address || 'Property Under Transfer'
    const erfNum = propertyRow?.erf_number || ''
    const propType: PropertyType = propertyRow?.property_type || 'Freehold'
    const purchasePrice = financialRow?.purchase_price ? Number(financialRow.purchase_price) : (transferRow?.purchase_price ? Number(transferRow.purchase_price) : 2500000)
    const depositAmount = financialRow?.deposit_amount ? Number(financialRow.depositAmount || financialRow.deposit_amount) : 0
    const loanAmount = financialRow?.loan_amount ? Number(financialRow.loanAmount || financialRow.loan_amount) : 0

    const generated = generateProformaStatement({
      transferId: canonicalTransferUuid,
      matterReference: matterRef,
      accountableInstitutionId: aiId,
      propertyAddress: propAddress,
      erfNumber: erfNum,
      propertyType: propType,
      purchasePrice,
      depositAmount,
      loanAmount,
      isVatTransaction: false,
      lodgementDeedsCount: 1,
      statementType: queryParams.statementType || 'buyer',
      firmSettings: tenantSettings,
      tariffSchedule: activeTariff,
      hasGoldenRecordEntity: hasGoldenRecord
    })

    inMemoryTenantStatements[cacheKey] = generated
    res.json({ success: true, data: generated })
  })
)

// -------------------------------------------------------------------------
// PUT /api/accounts/transfers/:transferId/proforma (Persist & Sync Financials)
// -------------------------------------------------------------------------
router.put(
  '/transfers/:transferId/proforma',
  asyncHandler(async (req: Request, res: Response) => {
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    }

    await ensureTablesExist()
    const { transferId } = req.params
    const statement = req.body as ProformaStatementData
    if (!statement) {
      res.status(400).json({ success: false, error: 'Invalid statement payload' })
      return
    }

    const id = statement.id || `PF-${Date.now()}`
    statement.accountableInstitutionId = aiId
    const cacheKey = `${aiId}:${transferId}`
    inMemoryTenantStatements[cacheKey] = statement

    try {
      await withTransaction(async (client) => {
        // Resolve canonical transfer UUID
        let canonicalUuid: string | null = null
        const tResult = await client.query<{ id: string }>(
          `SELECT id FROM transfers.transfers WHERE (id::text = $1 OR transfer_id = $1) AND ($2 = 1 OR accountable_institution_id = $2) LIMIT 1`,
          [transferId, aiId]
        )
        if (tResult.rows.length > 0) {
          canonicalUuid = tResult.rows[0].id
        }

        if (canonicalUuid) {
          // 1. Save statement in transfers.proforma_statements
          await client.query(
            `INSERT INTO transfers.proforma_statements (
              id, transfer_id, accountable_institution_id, matter_reference, statement_type, status,
              purchase_price, deposit_amount, loan_amount, is_vat_transaction, property_address,
              erf_number, tariff_schedule_id, tariff_version, statement_data, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP
            ) ON CONFLICT (id) DO UPDATE SET
              statement_type = EXCLUDED.statement_type,
              status = EXCLUDED.status,
              purchase_price = EXCLUDED.purchase_price,
              deposit_amount = EXCLUDED.deposit_amount,
              loan_amount = EXCLUDED.loan_amount,
              is_vat_transaction = EXCLUDED.is_vat_transaction,
              property_address = EXCLUDED.property_address,
              erf_number = EXCLUDED.erf_number,
              tariff_schedule_id = EXCLUDED.tariff_schedule_id,
              tariff_version = EXCLUDED.tariff_version,
              statement_data = EXCLUDED.statement_data,
              updated_at = CURRENT_TIMESTAMP`,
            [
              id,
              canonicalUuid,
              aiId,
              statement.matterReference || transferId,
              statement.statementType || 'buyer',
              statement.status || 'issued',
              statement.purchasePrice || 0,
              statement.depositAmount || 0,
              statement.loanAmount || 0,
              statement.isVatTransaction || false,
              statement.propertyAddress || '',
              statement.erfNumber || '',
              statement.provenance?.tariffScheduleId || 'lssa-2026-2027',
              statement.provenance?.tariffVersion || '1.0',
              JSON.stringify(statement)
            ]
          )

          // 2. Sync computed financial breakdown back to transfer_financials
          await client.query(
            `INSERT INTO transfers.transfer_financials (
              transfer_id, purchase_price, deposit_amount, loan_amount,
              transfer_duty, conveyancing_fees, deeds_office_fees, vat,
              total_costs, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
            ON CONFLICT (transfer_id) DO UPDATE SET
              purchase_price = EXCLUDED.purchase_price,
              deposit_amount = EXCLUDED.deposit_amount,
              loan_amount = EXCLUDED.loan_amount,
              transfer_duty = EXCLUDED.transfer_duty,
              conveyancing_fees = EXCLUDED.conveyancing_fees,
              deeds_office_fees = EXCLUDED.deeds_office_fees,
              vat = EXCLUDED.vat,
              total_costs = EXCLUDED.total_costs,
              updated_at = CURRENT_TIMESTAMP`,
            [
              canonicalUuid,
              statement.purchasePrice || 0,
              statement.depositAmount || 0,
              statement.loanAmount || 0,
              statement.transferDuty || 0,
              statement.conveyancingFeeExclVat || 0,
              statement.deedsOfficeTotal || 0,
              statement.totalVat || 0,
              statement.totalCosts || 0
            ]
          )
        }
      })
    } catch (e) {
      console.warn('Could not persist proforma statement to DB:', e)
    }

    res.json({ success: true, data: statement, message: 'Proforma statement saved successfully' })
  })
)

// -------------------------------------------------------------------------
// POST /api/accounts/calculate (Stateless Pure Calculator)
// -------------------------------------------------------------------------
router.post(
  '/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      purchasePrice = 0,
      bondAmount = 0,
      notarialAmount = 0,
      transactionType = 'transfer',
      isVatTransaction = false,
      lodgementDeedsCount = 1,
      tariffMultiplier = 1.0,
      tariffScheduleId,
      isVatRegistered = true,
      vatRate = 0.1500,
      propertyType = 'Freehold',
      hasGoldenRecordEntity = false
    } = req.body as {
      purchasePrice?: number
      bondAmount?: number
      notarialAmount?: number
      transactionType?: TransactionType
      isVatTransaction?: boolean
      lodgementDeedsCount?: number
      tariffMultiplier?: number
      tariffScheduleId?: string
      isVatRegistered?: boolean
      vatRate?: number
      propertyType?: PropertyType
      hasGoldenRecordEntity?: boolean
    }

    const tariff = ALL_PRESET_TARIFFS.find(t => t.id === (tariffScheduleId || 'lssa-2026-2027')) || LSSA_TARIFF_2026_2027
    const effectiveVatRate = isVatRegistered ? vatRate : 0

    // Transfer calculations
    const conv = calculateConveyancingFee(purchasePrice, tariff, tariffMultiplier)
    const convVat = Math.round(conv.feeExclVat * effectiveVatRate)
    const convIncl = conv.feeExclVat + convVat
    const td = calculateTransferDuty(purchasePrice, isVatTransaction)
    const transferDeeds = calculateDeedsOfficeFee(purchasePrice, 'transfer', lodgementDeedsCount)

    // Bond calculations
    const bondConv = calculateConveyancingFee(bondAmount, tariff, tariffMultiplier)
    const bondVat = Math.round(bondConv.feeExclVat * effectiveVatRate)
    const bondIncl = bondConv.feeExclVat + bondVat
    const bondDeeds = calculateDeedsOfficeFee(bondAmount, 'bond', lodgementDeedsCount)

    // Notarial calculations (Finding 5)
    const notarialConv = calculateConveyancingFee(notarialAmount, tariff, tariffMultiplier)
    const notarialVat = Math.round(notarialConv.feeExclVat * effectiveVatRate)
    const notarialIncl = notarialConv.feeExclVat + notarialVat
    const notarialDeeds = calculateDeedsOfficeFee(notarialAmount, 'notarial', lodgementDeedsCount)

    // Disbursements evaluation
    const disbEvaluation = evaluateDisbursements({
      disbursements: STANDARD_DEFAULT_DISBURSEMENTS,
      firmIsVatRegistered: isVatRegistered,
      vatRate: effectiveVatRate,
      context: {
        isBondMatter: transactionType === 'bond',
        propertyType,
        hasGoldenRecordEntity,
        requiresRatesClearance: transactionType === 'transfer'
      }
    })

    res.json({
      success: true,
      data: {
        transfer: {
          conveyancingFeeExclVat: conv.feeExclVat,
          conveyancingFeeVat: convVat,
          conveyancingFeeInclVat: convIncl,
          transferDuty: td.transferDuty,
          transferDutyDescription: td.rateDescription,
          isTransferDutyExempt: td.isExempt,
          statutoryScheduleItem: transferDeeds.statutoryScheduleItem,
          statutoryRegistrationFee: transferDeeds.statutoryRegistrationFee,
          statutoryLodgementFee: transferDeeds.statutoryLodgementFee,
          deedsOfficeTotal: transferDeeds.totalDeedsOfficeFees,
          explanation: conv.calculationExplanation
        },
        bond: {
          bondAttorneyFeeExclVat: bondConv.feeExclVat,
          bondAttorneyFeeVat: bondVat,
          bondAttorneyFeeInclVat: bondIncl,
          statutoryScheduleItem: bondDeeds.statutoryScheduleItem,
          statutoryRegistrationFee: bondDeeds.statutoryRegistrationFee,
          statutoryLodgementFee: bondDeeds.statutoryLodgementFee,
          deedsOfficeBondFee: bondDeeds.totalDeedsOfficeFees
        },
        notarial: {
          notarialAttorneyFeeExclVat: notarialConv.feeExclVat,
          notarialAttorneyFeeVat: notarialVat,
          notarialAttorneyFeeInclVat: notarialIncl,
          statutoryScheduleItem: notarialDeeds.statutoryScheduleItem,
          statutoryRegistrationFee: notarialDeeds.statutoryRegistrationFee,
          statutoryLodgementFee: notarialDeeds.statutoryLodgementFee,
          deedsOfficeNotarialFee: notarialDeeds.totalDeedsOfficeFees
        },
        disbursements: disbEvaluation
      }
    })
  })
)

// -------------------------------------------------------------------------
// POST /api/accounts/reset (Tenant-Scoped Reset)
// -------------------------------------------------------------------------
router.post(
  '/reset',
  asyncHandler(async (req: Request, res: Response) => {
    let aiId = 5
    if (req.currentUser) {
      aiId = resolveEffectiveTenantId(req.currentUser)
    }

    inMemoryTenantSettings[aiId] = {
      ...DEFAULT_FIRM_SETTINGS,
      accountableInstitutionId: aiId
    }

    try {
      await query(
        `DELETE FROM transfers.account_firm_settings WHERE accountable_institution_id = $1`,
        [aiId]
      )
      await query(
        `DELETE FROM transfers.tariff_schedules WHERE accountable_institution_id = $1`,
        [aiId]
      )
    } catch (e) {
      console.warn('Could not reset accounts in DB:', e)
    }

    res.json({ success: true, data: inMemoryTenantSettings[aiId], message: 'Reset firm settings to official LSSA defaults' })
  })
)

export default router
