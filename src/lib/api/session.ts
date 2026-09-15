// Authenticated session state for the browser.
//
// Design (contract-supported, see server/routes/auth.ts):
// - The upstream-issued access token lives in memory only — never in
//   localStorage/sessionStorage — and is attached as `Authorization: Bearer`
//   by apiRequest to BFF routes. The BFF verifies it and forwards it unchanged
//   to FastAPI on proxied routes, so institution/role/ability claims stay
//   server-verified on every request.
// - The upstream refresh token never reaches JavaScript. The BFF sets it as an
//   HttpOnly, Secure, SameSite=Strict cookie scoped to /api/auth and exchanges
//   it on POST /api/auth/refresh.
// - Session expiry is handled by one refresh-and-retry pass in apiRequest;
//   a failed refresh clears the session and leaves the app unauthenticated.
// - Logout is unconditional locally: memory is cleared and the BFF clears the
//   refresh cookie regardless of whether upstream accepts the logout call.
//
// The module keeps the legacy prototype flag (`legitify_auth`) removed on every
// session transition so no stale "logged in" marker can outlive a session.

const LEGACY_AUTH_KEY = 'legitify_auth'

export interface AuthSession {
  accessToken: string
  expires: number
  user: Record<string, unknown> | null
}

export type SessionListener = (session: AuthSession | null) => void

let session: AuthSession | null = null
let refreshInFlight: Promise<boolean> | null = null
const listeners = new Set<SessionListener>()

function dropLegacyFlag(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_AUTH_KEY)
  } catch {
    // Storage can be unavailable (private mode); never block session teardown.
  }
}

function notify(): void {
  for (const listener of listeners) listener(session)
}

export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSession(): AuthSession | null {
  return session
}

export function getAccessToken(): string | null {
  return session?.accessToken ?? null
}

export function getSessionUser(): Record<string, unknown> | null {
  return session?.user ?? null
}

export function setSession(next: AuthSession): void {
  session = next
  dropLegacyFlag()
  notify()
}

export function clearSession(): void {
  const hadSession = session !== null
  session = null
  dropLegacyFlag()
  if (hadSession) notify()
}

// Single-flight refresh: concurrent 401s share one upstream exchange.
// Any failure (no cookie, upstream rejection, malformed body, transport
// error) clears the session — a refresh we cannot prove succeeded is not
// a session.
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function doRefresh(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) {
      clearSession()
      return false
    }
    const envelope = await response.json()
    const token = envelope?.data?.token
    const expires = envelope?.data?.expires
    if (typeof token !== 'string' || !token || typeof expires !== 'number' || !Number.isFinite(expires)) {
      clearSession()
      return false
    }
    session = { accessToken: token, expires, user: session?.user ?? null }
    notify()
    return true
  } catch {
    clearSession()
    return false
  }
}

// Ends the session. The BFF clears the refresh cookie unconditionally and
// forwards the Bearer token to upstream logout when one is held; upstream
// access/refresh tokens are stateless and expire naturally.
export async function logoutSession(): Promise<void> {
  const token = session?.accessToken
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    // Local teardown proceeds regardless of transport failure.
  }
  clearSession()
}
