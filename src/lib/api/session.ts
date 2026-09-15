// Authenticated session state for the browser.
//
// Design (contract-supported, see server/routes/auth.ts):
// - The upstream-issued access token lives in memory only — never in
//   localStorage/sessionStorage — and is attached as `Authorization: Bearer`
//   by apiRequest to BFF routes. The BFF verifies it and forwards it unchanged
//   to FastAPI on proxied routes, so institution/role/ability claims stay
//   server-verified on every request.
// - The upstream refresh token never reaches JavaScript. The BFF binds it to a
//   per-login session id (sid): `deedly_refresh=<sid>.<token>` stays HttpOnly
//   while `deedly_sid=<sid>` is readable so a post-reload page can still prove
//   the pair. Refresh/logout echo the sid in `X-Deedly-Session`; the BFF
//   refuses a mismatch before touching upstream.
// - The sid doubles as the session-generation token: async flows capture it
//   before awaiting and discard their result when it changed, so a late
//   refresh or login response cannot resurrect a session that logout or a
//   newer login replaced.
// - Login-complete, refresh and logout run through a single promise queue so
//   their requests (and the browser's Set-Cookie handling) cannot interleave:
//   a login response is never in flight while logout executes, and a logout
//   clear can never land on top of a newer login's cookie. The queue is
//   additionally wrapped in a Web Locks cross-tab mutex ('deedly-auth') so the
//   same guarantee holds between tabs: a tab holds the lock for its whole
//   request/response window, keeping the BFF's request-time sid check
//   effective against delayed responses from other tabs. Web Locks support is
//   REQUIRED — where navigator.locks is unavailable, login/refresh and other
//   cookie-changing auth requests are refused entirely (the Login page shows
//   an unsupported-browser message); local session teardown still runs
//   immediately.
// - logoutSession additionally bumps a logout epoch at call time. Refresh and
//   login-complete capture it before enqueuing and discard their result when
//   it changed — a logout requested while an op was still queued wins over
//   that op even though the op's own network request runs afterwards.
// - Session expiry is handled by one refresh-and-retry pass in apiRequest;
//   the retry is refused when the session's sid changed mid-flight, so a
//   pending write is never replayed under a different user or institution.
//
// The module keeps the legacy prototype flag (`legitify_auth`) removed on every
// session transition so no stale "logged in" marker can outlive a session.

const LEGACY_AUTH_KEY = 'legitify_auth'
const SID_COOKIE = 'deedly_sid'
const SID_HEADER = 'X-Deedly-Session'

export interface AuthSession {
  accessToken: string
  expires: number
  user: Record<string, unknown> | null
  sid: string
}

export type SessionListener = (session: AuthSession | null) => void

let session: AuthSession | null = null
let refreshInFlight: Promise<boolean> | null = null
// Bumped by every logoutSession call: a tombstone that lets ops enqueued
// before the logout discard themselves even though their request runs after.
let logoutEpoch = 0
// Sids whose cookies this tab's auth pipeline caused (a login response this
// tab received, or a session it installed). A logout may clear a newer
// login's cookie only when that login happened through this tab — a foreign
// sid in the jar (another tab's session) is never presented, so the BFF's
// match-before-clear rule preserves it. Emptied by clearSession: dead sids
// are per-login UUIDs and can never legitimately reappear in the jar.
const tabSessionSids = new Set<string>()
// Serializes login/refresh/logout so overlapping auth operations can never
// reorder their HTTP requests or the browser's application of Set-Cookie.
let authQueue: Promise<unknown> = Promise.resolve()
const listeners = new Set<SessionListener>()

const AUTH_LOCK = 'deedly-auth'

export class UnsupportedAuthEnvironmentError extends Error {
  constructor() {
    super('This browser does not support the Web Locks API required for secure sign-in')
    this.name = 'UnsupportedAuthEnvironmentError'
  }
}

// Web Locks are mandatory for cookie-changing auth requests: without a
// cross-tab mutex the BFF's request-time sid check cannot be made effective
// against delayed responses from other tabs.
export function authEnvironmentSupported(): boolean {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as { locks?: { request?: unknown } }).locks
    : undefined
  return typeof locks?.request === 'function'
}

export function getLogoutEpoch(): number {
  return logoutEpoch
}

// Cross-tab mutex via Web Locks: the lock is held across the operation's full
// fetch round-trip, so a delayed response in one tab cannot interleave its
// Set-Cookie with another tab's login/logout.
function withCrossTabLock<T>(op: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } }).locks
    : undefined
  if (!locks || typeof locks.request !== 'function') {
    return Promise.reject(new UnsupportedAuthEnvironmentError())
  }
  return locks.request(AUTH_LOCK, () => op())
}

export function enqueueAuthOp<T>(op: () => Promise<T>): Promise<T> {
  const run = authQueue.then(() => withCrossTabLock(op), () => withCrossTabLock(op))
  authQueue = run.then(() => undefined, () => undefined)
  return run
}

function dropLegacyFlag(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_AUTH_KEY)
  } catch {
    // Storage can be unavailable (private mode); never block session teardown.
  }
}

function readSidCookie(): string | null {
  try {
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null
    for (const part of document.cookie.split(';')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      if (part.slice(0, eq).trim() === SID_COOKIE) {
        const value = decodeURIComponent(part.slice(eq + 1).trim())
        return value || null
      }
    }
  } catch {
    // Cookie access can be blocked; treat as no sid.
  }
  return null
}

// Deletes the readable sid cookie only when it still belongs to this session —
// mirrors the BFF's match-before-clear rule so a logout cannot strip a newer
// login's cookie either.
function deleteSidCookieIfOurs(sid: string | null): void {
  if (sid === null || readSidCookie() !== sid) return
  try {
    document.cookie = `${SID_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`
  } catch {
    // Best-effort hygiene; the BFF clears it authoritatively on sid match.
  }
}

// The sid proving ownership of the refresh credential: the in-memory session's
// sid, falling back to the readable cookie (post-reload restore).
export function getSessionSid(): string | null {
  return session?.sid ?? readSidCookie()
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
  if (next.sid) tabSessionSids.add(next.sid)
  dropLegacyFlag()
  notify()
}

// Records that a Set-Cookie for this sid landed in this tab even though the
// login result was discarded (e.g. a logout was requested first). The cookie
// exists in the jar regardless, so the logout that follows must be allowed to
// clear it rather than leaving an orphaned refresh credential that would
// resurrect the session on reload.
export function noteLandedSid(sid: string): void {
  if (sid) tabSessionSids.add(sid)
}

export function clearSession(): void {
  const hadSession = session !== null
  session = null
  tabSessionSids.clear()
  dropLegacyFlag()
  if (hadSession) notify()
}

// Single-flight refresh on top of the serialized queue: concurrent 401s share
// one upstream exchange, and a logout can never start while a refresh is mid-
// flight (it queues behind it). Any failure (no cookie, sid mismatch, upstream
// rejection, malformed body, transport error) clears the session — a refresh
// we cannot prove succeeded is not a session. Without Web Locks the refresh
// request is refused entirely and the session is cleared.
export function refreshSession(): Promise<boolean> {
  if (!authEnvironmentSupported()) {
    clearSession()
    return Promise.resolve(false)
  }
  const callLogoutEpoch = logoutEpoch
  if (!refreshInFlight) {
    const pending = enqueueAuthOp(() => doRefresh(callLogoutEpoch)).then(
      (ok) => ok,
      () => false,
    )
    refreshInFlight = pending
    void pending.finally(() => {
      if (refreshInFlight === pending) refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function doRefresh(callLogoutEpoch: number): Promise<boolean> {
  // A logout was requested while this op sat in the queue — discard without
  // firing the request.
  if (logoutEpoch !== callLogoutEpoch) return false
  const startSid = session?.sid ?? null
  const sid = getSessionSid()
  let envelope: { data?: { token?: unknown; expires?: unknown } }
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(sid ? { [SID_HEADER]: sid } : {}),
      },
      body: '{}',
    })
    envelope = response.ok ? await response.json() : {}
  } catch {
    if (logoutEpoch === callLogoutEpoch && (session?.sid ?? null) === startSid) clearSession()
    return false
  }
  // The session was cleared, logged out or replaced while the exchange was in
  // flight — this response is stale and must not touch it.
  if (logoutEpoch !== callLogoutEpoch || (session?.sid ?? null) !== startSid) return false
  const token = envelope.data?.token
  const expires = envelope.data?.expires
  if (typeof token !== 'string' || !token || typeof expires !== 'number' || !Number.isFinite(expires)) {
    clearSession()
    return false
  }
  setSession({ accessToken: token, expires, user: session?.user ?? null, sid: sid ?? '' })
  return true
}

// Ends the session. Memory is cleared immediately — it does not wait for the
// lock or queued ops — and the logout epoch invalidates any exchange still
// queued or in flight. The BFF request runs serialized under the lock and
// presents the sid this logout can legitimately end: the call-time session
// sid, or the jar's sid when it was installed by this tab's own login
// (a login that merely completed earlier in the same queue). A foreign sid —
// e.g. a newer login from another tab — is never presented, so its cookie
// survives. Without Web Locks only local teardown runs — the cookie-changing
// request is refused like every other auth mutation. Upstream access/refresh
// tokens are stateless and expire naturally — this is local teardown, not
// upstream revocation.
export function logoutSession(): Promise<void> {
  const token = session?.accessToken
  const sidAtCall = getSessionSid()
  clearSession()
  logoutEpoch++
  deleteSidCookieIfOurs(sidAtCall)
  if (!authEnvironmentSupported()) {
    // Local teardown only; the HttpOnly pair stays for upstream expiry — no
    // cookie-changing request is made without coordination.
    return Promise.resolve()
  }
  return enqueueAuthOp(async () => {
    const jarSid = readSidCookie()
    const sid = jarSid !== null && tabSessionSids.has(jarSid) ? jarSid : sidAtCall
    deleteSidCookieIfOurs(sid)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(sid ? { [SID_HEADER]: sid } : {}),
        },
      })
    } catch {
      // Local teardown already done; transport failure cannot undo it.
    }
  }).catch(() => undefined)
}
