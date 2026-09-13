import {
  FirmAccountSettings,
  TariffSchedule,
  LSSA_TARIFF_2026_2027,
  ProformaStatementData,
} from '@/utils/conveyancingAccounts'
import { apiRequest, ApiRequestError, type ApiRequestOptions } from './http'
import type { ApiResponse } from '../types'

// Account data requires a fresh authorised response, not an offline cache.
async function requestAccountData<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiRequest<ApiResponse<T>>(path, { ...options, cache: 'no-store' })
  if (!response?.success || response.data == null) {
    throw new ApiRequestError(503, 'Accounts service unavailable')
  }
  return response.data
}

export class AccountsApi {
  /**
   * Get current firm settings (VAT status, VAT number, disbursements, active tariff, trust banking)
   */
  static async getFirmSettings(): Promise<FirmAccountSettings> {
    return requestAccountData('/api/accounts/settings')
  }

  /**
   * Update firm settings
   */
  static async updateFirmSettings(settings: Partial<FirmAccountSettings>): Promise<FirmAccountSettings> {
    return requestAccountData('/api/accounts/settings', { method: 'PUT', body: settings })
  }

  /**
   * Get all tariff schedules (both built-in and user-customized)
   */
  static async getTariffSchedules(): Promise<TariffSchedule[]> {
    return requestAccountData('/api/accounts/tariffs')
  }

  /**
   * Save or update a tariff schedule
   */
  static async saveTariffSchedule(schedule: TariffSchedule): Promise<TariffSchedule> {
    return requestAccountData('/api/accounts/tariffs', { method: 'POST', body: schedule })
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
    _fallbackParams?: {
      propertyAddress: string
      purchasePrice: number
      depositAmount?: number
      loanAmount?: number
      erfNumber?: string
    }
  ): Promise<ProformaStatementData> {
    return requestAccountData(`/api/accounts/transfers/${encodeURIComponent(transferId)}/proforma`)
  }

  /**
   * Save a Proforma Statement
   */
  static async saveProformaStatement(statement: ProformaStatementData): Promise<ProformaStatementData> {
    if (!statement.transferId) throw new ApiRequestError(422, 'Transfer reference is required')
    return requestAccountData(`/api/accounts/transfers/${encodeURIComponent(statement.transferId)}/proforma`, {
      method: 'PUT', body: statement,
    })
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
      method: 'POST', body: payload, cache: 'no-store',
    })
  }

  /**
   * Reset default settings and tariffs to official LSSA benchmarks
   */
  static async resetToDefaults(): Promise<FirmAccountSettings> {
    return requestAccountData('/api/accounts/reset', { method: 'POST' })
  }
}
