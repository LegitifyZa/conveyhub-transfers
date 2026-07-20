const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL as string | undefined) ?? ''

export interface ApiRequestOptions {
  method?: string
  headers?: Record<string, string> | HeadersInit
  body?: unknown
  credentials?: RequestCredentials
  mode?: RequestMode
  cache?: RequestCache
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
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

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: options.credentials,
    mode: options.mode,
    cache: options.cache
  }

  const response = await fetch(`${API_BASE}${path}`, init)

  if (!response.ok) {
    const text = await response.text().catch(() => 'Request failed')
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }

  return response.json() as Promise<T>
}
