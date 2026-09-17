import { apiRequest, ApiRequestError } from './httpClient'
import type { ApiResponse } from '../types'

export function serviceUnavailableMessage(service: string, error?: unknown): string {
  const status = error instanceof ApiRequestError ? ` (HTTP ${error.status})` : ''
  return `${service} is temporarily unavailable${status}.`
}

/**
 * A successful probe only means the authenticated v1 list endpoint answered —
 * it is NOT proof of write permission or save availability. Actual saves must
 * still surface their own failures.
 */
export async function probeMatterPersistence(): Promise<Error | null> {
  try {
    const response = await apiRequest<ApiResponse<{ transfers?: unknown }>>('/api/v1/transfers/?limit=1')
    // v1 success envelopes are { message, data } — there is no `success`
    // flag. Validate the actual contract: a paged list payload with a
    // transfers array. Anything else is malformed; fail closed.
    const transfers = response.data?.transfers
    return Array.isArray(transfers)
      ? null
      : new Error(response.error || 'Matter persistence unavailable')
  } catch (err) {
    return err instanceof Error ? err : new Error('Matter persistence unavailable')
  }
}

/** Save/submit stay disabled while the availability check is pending and after failure. */
export function isPersistenceDisabled(checked: boolean, error: Error | null): boolean {
  return !checked || error !== null
}

/** True when a save failure indicates the persistence lane itself is unavailable. */
export function isPersistenceUnavailable(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.status === 503)
}
