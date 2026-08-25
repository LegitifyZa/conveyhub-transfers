import { Router, Request, Response } from 'express'
import { query } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import {
  DEFAULT_FIRM_SETTINGS,
  ALL_PRESET_TARIFFS,
  LSSA_TARIFF_2026_2027,
  FirmAccountSettings,
  TariffSchedule,
  ProformaStatementData,
  calculateConveyancingFee,
  calculateTransferDuty,
  calculateDeedsOfficeFee,
  generateProformaStatement
} from '../utils/conveyancingAccounts'

const router = Router()

// In-memory fallback stores when DB is unavailable
let inMemorySettings: FirmAccountSettings = { ...DEFAULT_FIRM_SETTINGS }
let inMemoryTariffs: TariffSchedule[] = [...ALL_PRESET_TARIFFS]
const inMemoryStatements: Record<string, ProformaStatementData> = {}

// Auto-initialize DB tables if not present
let tablesChecked = false
async function ensureTablesExist() {
  if (tablesChecked) return
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS account_firm_settings (
        id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
        firm_name VARCHAR(255) NOT NULL DEFAULT 'Legitify Conveyancing Practice',
        registration_number VARCHAR(100) DEFAULT '2026/123456/07',
        is_vat_registered BOOLEAN NOT NULL DEFAULT TRUE,
        vat_number VARCHAR(100) DEFAULT '4120987654',
        vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1500,
        active_tariff_schedule_id VARCHAR(100) NOT NULL DEFAULT 'lssa-2026-2027',
        custom_multiplier NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
        trust_account JSONB NOT NULL DEFAULT '{}'::jsonb,
        customary_disbursements JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tariff_schedules (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        effective_date VARCHAR(100) NOT NULL,
        gazette_reference VARCHAR(255),
        is_official BOOLEAN NOT NULL DEFAULT FALSE,
        description TEXT,
        brackets JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS proforma_statements (
        id VARCHAR(100) PRIMARY KEY,
        transfer_id VARCHAR(100) NOT NULL,
        matter_reference VARCHAR(100),
        statement_type VARCHAR(50) NOT NULL DEFAULT 'buyer',
        status VARCHAR(50) NOT NULL DEFAULT 'issued',
        purchase_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        deposit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        loan_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
        property_address TEXT,
        erf_number VARCHAR(100),
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

// -------------------------------------------------------------------------
// GET /api/accounts/settings
// -------------------------------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (_req: Request, res: Response) => {
    await ensureTablesExist()
    try {
      const result = await query(`SELECT * FROM account_firm_settings WHERE id = 'default' LIMIT 1`)
      if (result.rows.length > 0) {
        const row = result.rows[0]
        const settings: FirmAccountSettings = {
          firmName: row.firm_name || DEFAULT_FIRM_SETTINGS.firmName,
          registrationNumber: row.registration_number || DEFAULT_FIRM_SETTINGS.registrationNumber,
          isVatRegistered: row.is_vat_registered ?? DEFAULT_FIRM_SETTINGS.isVatRegistered,
          vatNumber: row.vat_number || DEFAULT_FIRM_SETTINGS.vatNumber,
          vatRate: parseFloat(row.vat_rate) || DEFAULT_FIRM_SETTINGS.vatRate,
          activeTariffScheduleId: row.active_tariff_schedule_id || DEFAULT_FIRM_SETTINGS.activeTariffScheduleId,
          tariffMultiplier: parseFloat(row.custom_multiplier) || DEFAULT_FIRM_SETTINGS.tariffMultiplier,
          trustAccount: row.trust_account && Object.keys(row.trust_account).length > 0 ? row.trust_account : DEFAULT_FIRM_SETTINGS.trustAccount,
          defaultDisbursements: row.customary_disbursements && row.customary_disbursements.length > 0 ? row.customary_disbursements : DEFAULT_FIRM_SETTINGS.defaultDisbursements,
          defaultLodgementDeedsCount: DEFAULT_FIRM_SETTINGS.defaultLodgementDeedsCount
        }
        inMemorySettings = settings
        res.json({ success: true, data: settings })
        return
      }
    } catch (e) {
      console.warn('DB query error on accounts/settings, returning in-memory:', e)
    }

    res.json({ success: true, data: inMemorySettings })
  })
)

// -------------------------------------------------------------------------
// PUT /api/accounts/settings
// -------------------------------------------------------------------------
router.put(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    await ensureTablesExist()
    const body = req.body as Partial<FirmAccountSettings>

    const updated: FirmAccountSettings = {
      ...inMemorySettings,
      ...body,
      trustAccount: {
        ...inMemorySettings.trustAccount,
        ...(body.trustAccount || {})
      },
      defaultDisbursements: body.defaultDisbursements || inMemorySettings.defaultDisbursements
    }
    inMemorySettings = updated

    try {
      await query(
        `INSERT INTO account_firm_settings (
          id, firm_name, registration_number, is_vat_registered, vat_number, vat_rate,
          active_tariff_schedule_id, custom_multiplier, trust_account, customary_disbursements, updated_at
        ) VALUES (
          'default', $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
        ) ON CONFLICT (id) DO UPDATE SET
          firm_name = EXCLUDED.firm_name,
          registration_number = EXCLUDED.registration_number,
          is_vat_registered = EXCLUDED.is_vat_registered,
          vat_number = EXCLUDED.vat_number,
          vat_rate = EXCLUDED.vat_rate,
          active_tariff_schedule_id = EXCLUDED.active_tariff_schedule_id,
          custom_multiplier = EXCLUDED.custom_multiplier,
          trust_account = EXCLUDED.trust_account,
          customary_disbursements = EXCLUDED.customary_disbursements,
          updated_at = CURRENT_TIMESTAMP`,
        [
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
// GET /api/accounts/tariffs
// -------------------------------------------------------------------------
router.get(
  '/tariffs',
  asyncHandler(async (_req: Request, res: Response) => {
    await ensureTablesExist()
    try {
      const result = await query(`SELECT * FROM tariff_schedules ORDER BY is_official DESC, created_at ASC`)
      if (result.rows.length > 0) {
        const tariffs: TariffSchedule[] = result.rows.map(row => ({
          id: row.id,
          name: row.name,
          version: '1.0',
          effectiveDate: row.effective_date,
          description: row.description || '',
          isDefault: row.id === inMemorySettings.activeTariffScheduleId,
          brackets: row.brackets || []
        }))
        inMemoryTariffs = tariffs
        res.json({ success: true, data: tariffs })
        return
      }
    } catch (e) {
      console.warn('DB query error on accounts/tariffs:', e)
    }

    res.json({ success: true, data: inMemoryTariffs })
  })
)

// -------------------------------------------------------------------------
// POST /api/accounts/tariffs
// -------------------------------------------------------------------------
router.post(
  '/tariffs',
  asyncHandler(async (req: Request, res: Response) => {
    await ensureTablesExist()
    const schedule = req.body as TariffSchedule
    if (!schedule || !schedule.id || !schedule.name || !Array.isArray(schedule.brackets)) {
      res.status(400).json({ success: false, error: 'Invalid tariff schedule payload' })
      return
    }

    const idx = inMemoryTariffs.findIndex(t => t.id === schedule.id)
    if (idx >= 0) {
      inMemoryTariffs[idx] = schedule
    } else {
      inMemoryTariffs.push(schedule)
    }

    try {
      await query(
        `INSERT INTO tariff_schedules (
          id, name, effective_date, gazette_reference, is_official, description, brackets, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          effective_date = EXCLUDED.effective_date,
          gazette_reference = EXCLUDED.gazette_reference,
          is_official = EXCLUDED.is_official,
          description = EXCLUDED.description,
          brackets = EXCLUDED.brackets,
          updated_at = CURRENT_TIMESTAMP`,
        [
          schedule.id,
          schedule.name,
          schedule.effectiveDate || new Date().toISOString().split('T')[0],
          '',
          Boolean(schedule.id.startsWith('lssa-')),
          schedule.description || '',
          JSON.stringify(schedule.brackets)
        ]
      )
    } catch (e) {
      console.warn('Could not persist tariff schedule to DB:', e)
    }

    res.json({ success: true, data: schedule, message: 'Tariff schedule saved successfully' })
  })
)

// -------------------------------------------------------------------------
// GET /api/accounts/tariffs/:id
// -------------------------------------------------------------------------
router.get(
  '/tariffs/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    const found = inMemoryTariffs.find(t => t.id === id)
    if (found) {
      res.json({ success: true, data: found })
      return
    }
    res.status(404).json({ success: false, error: 'Tariff schedule not found' })
  })
)

// -------------------------------------------------------------------------
// DELETE /api/accounts/tariffs/:id
// -------------------------------------------------------------------------
router.delete(
  '/tariffs/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params
    if (id.startsWith('lssa-')) {
      res.status(400).json({ success: false, error: 'Cannot delete official LSSA tariff schedule' })
      return
    }

    inMemoryTariffs = inMemoryTariffs.filter(t => t.id !== id)
    try {
      await query(`DELETE FROM tariff_schedules WHERE id = $1`, [id])
    } catch (e) {
      console.warn('Could not delete tariff schedule from DB:', e)
    }

    res.json({ success: true, message: 'Tariff schedule deleted' })
  })
)

// -------------------------------------------------------------------------
// GET /api/accounts/transfers/:transferId/proforma
// -------------------------------------------------------------------------
router.get(
  '/transfers/:transferId/proforma',
  asyncHandler(async (req: Request, res: Response) => {
    await ensureTablesExist()
    const { transferId } = req.params
    const { propertyAddress, purchasePrice, depositAmount, loanAmount, erfNumber } = req.query as {
      propertyAddress?: string
      purchasePrice?: string
      depositAmount?: string
      loanAmount?: string
      erfNumber?: string
    }

    try {
      const result = await query(
        `SELECT * FROM proforma_statements WHERE transfer_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [transferId]
      )
      if (result.rows.length > 0) {
        const stmt = result.rows[0].statement_data as ProformaStatementData
        inMemoryStatements[transferId] = stmt
        res.json({ success: true, data: stmt })
        return
      }
    } catch (e) {
      console.warn('DB query error on proforma_statements:', e)
    }

    if (inMemoryStatements[transferId]) {
      res.json({ success: true, data: inMemoryStatements[transferId] })
      return
    }

    // Auto-generate fresh proforma statement
    const priceNum = purchasePrice ? parseFloat(purchasePrice) : 2500000
    const depNum = depositAmount ? parseFloat(depositAmount) : 250000
    const loanNum = loanAmount ? parseFloat(loanAmount) : 2250000
    const activeTariff = inMemoryTariffs.find(t => t.id === inMemorySettings.activeTariffScheduleId) || LSSA_TARIFF_2026_2027

    const generated = generateProformaStatement({
      transferId,
      propertyAddress: propertyAddress || '123 Ocean View Drive, Cape Town',
      erfNumber: erfNumber || 'Erf 4521',
      purchasePrice: priceNum,
      depositAmount: depNum,
      loanAmount: loanNum,
      firmSettings: inMemorySettings,
      tariffSchedule: activeTariff
    })

    inMemoryStatements[transferId] = generated
    res.json({ success: true, data: generated })
  })
)

// -------------------------------------------------------------------------
// PUT /api/accounts/transfers/:transferId/proforma
// -------------------------------------------------------------------------
router.put(
  '/transfers/:transferId/proforma',
  asyncHandler(async (req: Request, res: Response) => {
    await ensureTablesExist()
    const { transferId } = req.params
    const statement = req.body as ProformaStatementData
    if (!statement) {
      res.status(400).json({ success: false, error: 'Invalid statement payload' })
      return
    }

    const id = statement.id || `PF-${Date.now()}`
    statement.transferId = transferId
    inMemoryStatements[transferId] = statement

    try {
      await query(
        `INSERT INTO proforma_statements (
          id, transfer_id, matter_reference, statement_type, status,
          purchase_price, deposit_amount, loan_amount, property_address, erf_number, statement_data, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP
        ) ON CONFLICT (id) DO UPDATE SET
          statement_type = EXCLUDED.statement_type,
          status = EXCLUDED.status,
          purchase_price = EXCLUDED.purchase_price,
          deposit_amount = EXCLUDED.deposit_amount,
          loan_amount = EXCLUDED.loan_amount,
          property_address = EXCLUDED.property_address,
          erf_number = EXCLUDED.erf_number,
          statement_data = EXCLUDED.statement_data,
          updated_at = CURRENT_TIMESTAMP`,
        [
          id,
          transferId,
          statement.matterReference || transferId,
          statement.statementType || 'buyer',
          statement.status || 'issued',
          statement.purchasePrice || 0,
          statement.depositAmount || 0,
          statement.loanAmount || 0,
          statement.propertyAddress || '',
          statement.erfNumber || '',
          JSON.stringify(statement)
        ]
      )
    } catch (e) {
      console.warn('Could not save proforma statement to DB:', e)
    }

    res.json({ success: true, data: statement, message: 'Proforma statement saved successfully' })
  })
)

// -------------------------------------------------------------------------
// POST /api/accounts/calculate
// -------------------------------------------------------------------------
router.post(
  '/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      purchasePrice = 0,
      bondAmount = 0,
      isVatTransaction = false,
      lodgementDeedsCount = 1,
      tariffScheduleId
    } = req.body as {
      purchasePrice?: number
      bondAmount?: number
      isVatTransaction?: boolean
      lodgementDeedsCount?: number
      tariffScheduleId?: string
    }

    const tariff = inMemoryTariffs.find(t => t.id === (tariffScheduleId || inMemorySettings.activeTariffScheduleId)) || LSSA_TARIFF_2026_2027
    const vatRate = inMemorySettings.isVatRegistered ? inMemorySettings.vatRate : 0

    // Transfer calculations
    const conv = calculateConveyancingFee(purchasePrice, tariff, inMemorySettings.tariffMultiplier)
    const convVat = Math.round(conv.feeExclVat * vatRate)
    const convIncl = conv.feeExclVat + convVat

    const td = calculateTransferDuty(purchasePrice, isVatTransaction)
    const transferDeeds = calculateDeedsOfficeFee(purchasePrice, 'transfer', lodgementDeedsCount)

    // Bond calculations
    const bondConv = calculateConveyancingFee(bondAmount, tariff, inMemorySettings.tariffMultiplier)
    const bondVat = Math.round(bondConv.feeExclVat * vatRate)
    const bondIncl = bondConv.feeExclVat + bondVat
    const bondDeeds = calculateDeedsOfficeFee(bondAmount, 'bond', lodgementDeedsCount)

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
          deedsOfficeFee: transferDeeds.totalDeedsOfficeFees,
          explanation: conv.calculationExplanation
        },
        bond: {
          bondAttorneyFeeExclVat: bondConv.feeExclVat,
          bondAttorneyFeeVat: bondVat,
          bondAttorneyFeeInclVat: bondIncl,
          deedsOfficeBondFee: bondDeeds.totalDeedsOfficeFees
        },
        firmSettings: inMemorySettings
      }
    })
  })
)

// -------------------------------------------------------------------------
// POST /api/accounts/reset
// -------------------------------------------------------------------------
router.post(
  '/reset',
  asyncHandler(async (_req: Request, res: Response) => {
    inMemorySettings = { ...DEFAULT_FIRM_SETTINGS }
    inMemoryTariffs = [...ALL_PRESET_TARIFFS]

    try {
      await query(`DELETE FROM account_firm_settings WHERE id = 'default'`)
      await query(`DELETE FROM tariff_schedules WHERE is_official = FALSE`)
    } catch (e) {
      console.warn('Could not reset accounts in DB:', e)
    }

    res.json({ success: true, data: inMemorySettings, message: 'Reset to official LSSA defaults' })
  })
)

export default router
