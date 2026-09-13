import { ApiRequestError } from './httpClient'
import { TransferApi } from './transferApi'

export function serviceUnavailableMessage(service: string, error?: unknown): string {
  const status = error instanceof ApiRequestError ? ` (HTTP ${error.status})` : ''
  return `${service} is temporarily unavailable${status}.`
}

/**
 * A successful probe only means the list endpoint answered — it is NOT proof of
 * write permission or save availability. Actual saves must still surface their
 * own failures.
 */
export async function probeMatterPersistence(): Promise<Error | null> {
  try {
    const response = await TransferApi.getTransfers({ limit: 1 })
    return response.success ? null : new Error(response.error || 'Matter persistence unavailable')
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
