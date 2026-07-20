export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function isValidStatus(status: unknown): status is 'draft' | 'in_progress' | 'completed' | 'cancelled' {
  return typeof status === 'string' && ['draft', 'in_progress', 'completed', 'cancelled'].includes(status)
}

export function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

export function toDateString(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : value
}
