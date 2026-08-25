import { 
  FirmAccountSettings, 
  DEFAULT_FIRM_SETTINGS, 
  TariffSchedule, 
  ALL_PRESET_TARIFFS, 
  LSSA_TARIFF_2026_2027, 
  ProformaStatementData, 
  generateProformaStatement
} from '@/utils/conveyancingAccounts'
import { apiRequest } from './httpClient'

const SETTINGS_STORAGE_KEY = 'conveyhub_firm_account_settings'
const TARIFFS_STORAGE_KEY = 'conveyhub_tariff_schedules'
const STATEMENTS_STORAGE_KEY = 'conveyhub_proforma_statements'

// Local cache for speed and offline resiliency
let localSettingsCache: FirmAccountSettings | null = null
let localTariffsCache: TariffSchedule[] | null = null
const localStatementsCache: Record<string, ProformaStatementData> = {}

function getLocalSettings(): FirmAccountSettings {
  if (localSettingsCache) return localSettingsCache
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      localSettingsCache = JSON.parse(raw)
      return localSettingsCache!
    }
  } catch (e) {
    console.warn('Could not read settings from localStorage:', e)
  }
  localSettingsCache = { ...DEFAULT_FIRM_SETTINGS }
  return localSettingsCache
}

function saveLocalSettings(settings: FirmAccountSettings) {
  localSettingsCache = settings
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('Could not persist settings to localStorage:', e)
  }
}

export class AccountsApi {
  /**
   * Get current firm settings (VAT status, VAT number, disbursements, active tariff, trust banking)
   */
  static async getFirmSettings(): Promise<FirmAccountSettings> {
    try {
      const response = await apiRequest<{ success: boolean; data: FirmAccountSettings }>('/api/accounts/settings')
      if (response && response.success && response.data) {
        saveLocalSettings(response.data)
        return response.data
      }
    } catch (e) {
      console.warn('API error on getFirmSettings, falling back to local cache:', e)
    }
    return getLocalSettings()
  }

  /**
   * Update firm settings
   */
  static async updateFirmSettings(settings: Partial<FirmAccountSettings>): Promise<FirmAccountSettings> {
    try {
      const response = await apiRequest<{ success: boolean; data: FirmAccountSettings; message?: string }>(
        '/api/accounts/settings',
        {
          method: 'PUT',
          body: settings
        }
      )
      if (response && response.success && response.data) {
        saveLocalSettings(response.data)
        return response.data
      }
    } catch (e) {
      console.warn('API error on updateFirmSettings, saving to local cache:', e)
    }

    const current = getLocalSettings()
    const updated: FirmAccountSettings = {
      ...current,
      ...settings,
      trustAccount: {
        ...current.trustAccount,
        ...(settings.trustAccount || {})
      }
    }
    saveLocalSettings(updated)
    return updated
  }

  /**
   * Get all tariff schedules (both built-in and user-customized)
   */
  static async getTariffSchedules(): Promise<TariffSchedule[]> {
    try {
      const response = await apiRequest<{ success: boolean; data: TariffSchedule[] }>('/api/accounts/tariffs')
      if (response && response.success && Array.isArray(response.data)) {
        localTariffsCache = response.data
        try {
          localStorage.setItem(TARIFFS_STORAGE_KEY, JSON.stringify(response.data))
        } catch (e) {
          console.warn('Could not save tariffs to localStorage:', e)
        }
        return response.data
      }
    } catch (e) {
      console.warn('API error on getTariffSchedules, falling back to local cache:', e)
    }

    if (localTariffsCache && localTariffsCache.length > 0) return localTariffsCache
    try {
      const raw = localStorage.getItem(TARIFFS_STORAGE_KEY)
      if (raw) {
        localTariffsCache = JSON.parse(raw)
        return localTariffsCache!
      }
    } catch (e) {
      console.warn('Could not read tariffs from localStorage:', e)
    }
    localTariffsCache = [...ALL_PRESET_TARIFFS]
    return localTariffsCache
  }

  /**
   * Save or update a tariff schedule
   */
  static async saveTariffSchedule(schedule: TariffSchedule): Promise<TariffSchedule> {
    try {
      const response = await apiRequest<{ success: boolean; data: TariffSchedule; message?: string }>(
        '/api/accounts/tariffs',
        {
          method: 'POST',
          body: schedule
        }
      )
      if (response && response.success && response.data) {
        const tariffs = await this.getTariffSchedules()
        const idx = tariffs.findIndex(t => t.id === schedule.id)
        if (idx >= 0) tariffs[idx] = response.data
        else tariffs.push(response.data)
        localTariffsCache = tariffs
        return response.data
      }
    } catch (e) {
      console.warn('API error on saveTariffSchedule, persisting locally:', e)
    }

    const tariffs = await this.getTariffSchedules()
    const index = tariffs.findIndex(t => t.id === schedule.id)
    if (index >= 0) tariffs[index] = schedule
    else tariffs.push(schedule)
    localTariffsCache = tariffs
    try {
      localStorage.setItem(TARIFFS_STORAGE_KEY, JSON.stringify(tariffs))
    } catch (e) {
      console.warn('Could not save tariffs to localStorage:', e)
    }
    return schedule
  }

  /**
   * Get active tariff schedule
   */
  static async getActiveTariffSchedule(): Promise<TariffSchedule> {
    const settings = await this.getFirmSettings()
    const tariffs = await this.getTariffSchedules()
    const active = tariffs.find(t => t.id === settings.activeTariffScheduleId)
    return active || tariffs[0] || LSSA_TARIFF_2026_2027
  }

  /**
   * Get or generate a Proforma Statement for a transfer matter
   */
  static async getProformaStatementForTransfer(
    transferId: string,
    fallbackParams?: {
      propertyAddress: string
      purchasePrice: number
      depositAmount?: number
      loanAmount?: number
      erfNumber?: string
    }
  ): Promise<ProformaStatementData> {
    const params = new URLSearchParams()
    if (fallbackParams?.propertyAddress) params.set('propertyAddress', fallbackParams.propertyAddress)
    if (fallbackParams?.purchasePrice) params.set('purchasePrice', String(fallbackParams.purchasePrice))
    if (fallbackParams?.depositAmount) params.set('depositAmount', String(fallbackParams.depositAmount))
    if (fallbackParams?.loanAmount) params.set('loanAmount', String(fallbackParams.loanAmount))
    if (fallbackParams?.erfNumber) params.set('erfNumber', fallbackParams.erfNumber)

    try {
      const url = `/api/accounts/transfers/${encodeURIComponent(transferId)}/proforma?${params.toString()}`
      const response = await apiRequest<{ success: boolean; data: ProformaStatementData }>(url)
      if (response && response.success && response.data) {
        localStatementsCache[transferId] = response.data
        return response.data
      }
    } catch (e) {
      console.warn('API error on getProformaStatementForTransfer, falling back to local generator:', e)
    }

    if (localStatementsCache[transferId]) {
      return localStatementsCache[transferId]
    }

    try {
      const raw = localStorage.getItem(STATEMENTS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed[transferId]) {
          localStatementsCache[transferId] = parsed[transferId]
          return parsed[transferId]
        }
      }
    } catch (e) {
      console.warn('Could not read statement from localStorage:', e)
    }

    const firmSettings = await this.getFirmSettings()
    const activeTariff = await this.getActiveTariffSchedule()
    const newStatement = generateProformaStatement({
      transferId,
      propertyAddress: fallbackParams?.propertyAddress || '123 Ocean View Drive, Cape Town',
      erfNumber: fallbackParams?.erfNumber || 'Erf 4521',
      purchasePrice: fallbackParams?.purchasePrice || 2500000,
      depositAmount: fallbackParams?.depositAmount || 250000,
      loanAmount: fallbackParams?.loanAmount || 2250000,
      firmSettings,
      tariffSchedule: activeTariff
    })

    localStatementsCache[transferId] = newStatement
    return newStatement
  }

  /**
   * Save a Proforma Statement
   */
  static async saveProformaStatement(statement: ProformaStatementData): Promise<ProformaStatementData> {
    const id = statement.transferId || statement.id || `PF-${Date.now()}`
    try {
      const response = await apiRequest<{ success: boolean; data: ProformaStatementData; message?: string }>(
        `/api/accounts/transfers/${encodeURIComponent(id)}/proforma`,
        {
          method: 'PUT',
          body: statement
        }
      )
      if (response && response.success && response.data) {
        localStatementsCache[id] = response.data
        return response.data
      }
    } catch (e) {
      console.warn('API error on saveProformaStatement, persisting locally:', e)
    }

    localStatementsCache[id] = statement
    try {
      const raw = localStorage.getItem(STATEMENTS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      parsed[id] = statement
      localStorage.setItem(STATEMENTS_STORAGE_KEY, JSON.stringify(parsed))
    } catch (e) {
      console.warn('Could not save proforma to localStorage:', e)
    }
    return statement
  }

  /**
   * Server-side quick calculate
   */
  static async calculate(payload: {
    purchasePrice: number
    bondAmount?: number
    isVatTransaction?: boolean
    lodgementDeedsCount?: number
    tariffScheduleId?: string
  }) {
    return apiRequest<{
      success: boolean
      data: {
        transfer: any
        bond: any
        firmSettings: FirmAccountSettings
      }
    }>('/api/accounts/calculate', {
      method: 'POST',
      body: payload
    })
  }

  /**
   * Reset default settings and tariffs to official LSSA benchmarks
   */
  static async resetToDefaults(): Promise<FirmAccountSettings> {
    try {
      await apiRequest('/api/accounts/reset', { method: 'POST' })
    } catch (e) {
      console.warn('API error on resetToDefaults:', e)
    }
    localSettingsCache = { ...DEFAULT_FIRM_SETTINGS }
    localTariffsCache = [...ALL_PRESET_TARIFFS]
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY)
      localStorage.removeItem(TARIFFS_STORAGE_KEY)
      localStorage.removeItem(STATEMENTS_STORAGE_KEY)
    } catch (e) {
      console.warn('Could not clear local storage:', e)
    }
    return localSettingsCache
  }
}
