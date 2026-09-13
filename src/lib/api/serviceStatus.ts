import { ApiRequestError } from './httpClient'

export function serviceUnavailableMessage(service: string, error?: unknown): string {
  const status = error instanceof ApiRequestError ? ` (HTTP ${error.status})` : ''
  return `${service} is temporarily unavailable${status}.`
}
