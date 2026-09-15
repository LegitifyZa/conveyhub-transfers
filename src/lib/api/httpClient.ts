import { getAccessToken, refreshSession } from './session'

const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL as string | undefined) ?? ''

function buildUrl(path: string): string {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE
  const requestPath = base && path.startsWith(base + '/') ? path.slice(base.length) : path
  return `${base}${requestPath}`
}

export interface ApiRequestOptions {
  method?: string
  headers?: Record<string, string> | HeadersInit
  body?: unknown
  credentials?: RequestCredentials
  mode?: RequestMode
  cache?: RequestCache
}

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

// Auth-ingress endpoints are excluded from Bearer attachment and from the
// refresh-and-retry loop: a 401 from initiate-login/login means bad
// credentials, not an expired session. Logout is the exception — upstream
// logout requires the Bearer `api` ability, so the token is attached but a
// 401 there still never triggers a refresh.
function isAuthIngress(path: string): boolean {
  return path.startsWith('/api/auth/') && path !== '/api/auth/logout'
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/api/auth/')
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}, allowRefreshRetry = true): Promise<T> {
  const headers: Record<string, string> = {}

  const body = options.body
    ? (typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof Blob) && !(options.body instanceof URLSearchParams) && !(options.body instanceof ArrayBuffer))
      ? JSON.stringify(options.body)
      : (options.body as BodyInit)
    : undefined

  if (body && typeof body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  if (options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)) {
    Object.assign(headers, options.headers as Record<string, string>)
  }

  const token = getAccessToken()
  if (token && !headers['Authorization'] && !isAuthIngress(path)) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: options.credentials,
    mode: options.mode,
    cache: options.cache
  }

  const response = await fetch(buildUrl(path), init)

  // One refresh-and-retry pass on an expired session. A failed refresh clears
  // the session (see session.ts), so the 401 surfaces and the app returns to
  // the login screen. Failed requests stay visibly failed — no swallowing.
  //
  // Retry safety for writes: our 401s are raised before any handler or
  // upstream call (BFF requireJwt / FastAPI auth dependencies reject first),
  // so no partial write can have occurred. The retry reissues the identical
  // options object — the same serialized body — so client_request_id
  // idempotency keys on matter/party creates are preserved and a replay is
  // deduplicated upstream rather than duplicating a row.
  if (response.status === 401 && allowRefreshRetry && !isAuthPath(path)) {
    if (await refreshSession()) {
      return apiRequest<T>(path, options, false)
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => 'Request failed')
    throw new ApiRequestError(response.status, `${response.status} ${response.statusText}: ${text}`)
  }

  return response.json() as Promise<T>
}
