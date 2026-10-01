let navigationScope: string | null = null

export function resetNavigationScope(): void {
  navigationScope = null
}

export function bindNavigationState<T extends object>(state: T): T & { navigationScope: string } {
  navigationScope ??= crypto.randomUUID()
  return { ...state, navigationScope }
}

export function readNavigationState<T>(state: T): T | null {
  if (!navigationScope || !state || typeof state !== 'object') return null
  return (state as { navigationScope?: unknown }).navigationScope === navigationScope ? state : null
}
