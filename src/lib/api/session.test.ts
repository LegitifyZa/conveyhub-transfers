import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { apiRequest, ApiRequestError } from './httpClient'
import {
  clearSession,
  getAccessToken,
  getSession,
  logoutSession,
  onSessionChange,
  refreshSession,
  setSession,
} from './session'

// Mocked transport only — no upstream or BFF is contacted. The fetch stub
// dispatches on URL so the refresh/refresh-retry paths can be exercised
// through the real module code.
type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>

let handler: FetchHandler = () => Promise.resolve(new Response('{}', { status: 200 }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function callsTo(path: string) {
  return (fetchMock.mock.calls as unknown as { arguments: [string, RequestInit] }[])
    .filter((c) => c.arguments[0] === path)
}

const fetchMock = mock.method(globalThis, 'fetch', (url: unknown, init?: RequestInit) =>
  handler(String(url), init))

const fakeStorage = {
  data: new Map<string, string>(),
  getItem(k: string) { return this.data.get(k) ?? null },
  setItem(k: string, v: string) { this.data.set(k, String(v)) },
  removeItem(k: string) { this.data.delete(k) },
  clear() { this.data.clear() },
}

beforeEach(() => {
  clearSession()
  fakeStorage.data.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage
  fetchMock.mock.resetCalls()
  handler = () => Promise.resolve(jsonResponse({ success: true }))
})

afterEach(() => {
  clearSession()
  delete (globalThis as { localStorage?: unknown }).localStorage
})

function makeSession(token = 'access-token-1') {
  setSession({ accessToken: token, expires: 9999999999, user: { id: 42 } })
}

describe('credential attachment', () => {
  it('attaches the in-memory access token as Bearer on protected paths', async () => {
    makeSession('token-abc')
    let seen: string | null = null
    handler = (_url, init) => {
      seen = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(jsonResponse({ success: true }))
    }
    await apiRequest('/api/v1/transfers/')
    assert.equal(seen, 'Bearer token-abc')
  })

  it('sends no Authorization header when no session exists', async () => {
    let seen: string | null = 'unset'
    handler = (_url, init) => {
      seen = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(jsonResponse({ success: true }))
    }
    await apiRequest('/api/v1/transfers/')
    assert.equal(seen, null)
  })

  it('never attaches the token to auth-ingress endpoints, but does on logout', async () => {
    makeSession('token-abc')
    const seen: Record<string, string | null> = {}
    handler = (url, init) => {
      seen[url] = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(jsonResponse({ message: 'ok', data: {} }))
    }
    await apiRequest('/api/auth/initiate-login', { method: 'POST', body: {} }).catch(() => {})
    await apiRequest('/api/auth/login', { method: 'POST', body: {} }).catch(() => {})
    await apiRequest('/api/auth/refresh', { method: 'POST', body: {} }).catch(() => {})
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {})
    assert.equal(seen['/api/auth/initiate-login'], null)
    assert.equal(seen['/api/auth/login'], null)
    assert.equal(seen['/api/auth/refresh'], null)
    assert.equal(seen['/api/auth/logout'], 'Bearer token-abc')
  })

  it('respects an explicitly caller-supplied Authorization header', async () => {
    makeSession('token-abc')
    let seen: string | null = null
    handler = (_url, init) => {
      seen = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(jsonResponse({ success: true }))
    }
    await apiRequest('/api/v1/transfers/', { headers: { Authorization: 'Bearer caller-token' } })
    assert.equal(seen, 'Bearer caller-token')
  })
})

describe('expired-session refresh and retry', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    makeSession('expired-token')
    const authHeaders: (string | null)[] = []
    handler = (url, init) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve(jsonResponse({ message: 'Token refreshed', data: { token: 'fresh-token', expires: 1 } }))
      }
      authHeaders.push(new Headers(init?.headers).get('Authorization'))
      return Promise.resolve(
        authHeaders.length === 1 ? jsonResponse({ error: 'expired' }, 401) : jsonResponse({ success: true })
      )
    }
    const result = await apiRequest<{ success: boolean }>('/api/v1/transfers/')
    assert.equal(result.success, true)
    assert.deepEqual(authHeaders, ['Bearer expired-token', 'Bearer fresh-token'])
    assert.equal(getAccessToken(), 'fresh-token')
    assert.equal(callsTo('/api/auth/refresh').length, 1)
  })

  it('clears the session and surfaces 401 when refresh fails', async () => {
    makeSession('expired-token')
    handler = (url) =>
      url === '/api/auth/refresh'
        ? Promise.resolve(jsonResponse({ message: 'Invalid refresh token' }, 401))
        : Promise.resolve(jsonResponse({ error: 'expired' }, 401))
    await assert.rejects(() => apiRequest('/api/v1/transfers/'), (err: unknown) => {
      assert.ok(err instanceof ApiRequestError)
      assert.equal(err.status, 401)
      return true
    })
    assert.equal(getSession(), null)
    assert.equal(getAccessToken(), null)
  })

  it('does not loop when the retried request still returns 401', async () => {
    makeSession('expired-token')
    handler = (url) =>
      url === '/api/auth/refresh'
        ? Promise.resolve(jsonResponse({ data: { token: 'fresh', expires: 1 } }))
        : Promise.resolve(jsonResponse({ error: 'denied' }, 401))
    await assert.rejects(() => apiRequest('/api/v1/transfers/'), ApiRequestError)
    assert.equal(callsTo('/api/v1/transfers/').length, 2)
    assert.equal(callsTo('/api/auth/refresh').length, 1)
  })

  it('never triggers a refresh for auth-endpoint 401s (bad credentials/OTP surface directly)', async () => {
    makeSession('token')
    handler = () => Promise.resolve(jsonResponse({ message: 'Invalid credentials' }, 401))
    await assert.rejects(() => apiRequest('/api/auth/login', { method: 'POST', body: {} }), ApiRequestError)
    assert.equal(callsTo('/api/auth/refresh').length, 0)
    // Session is untouched — a bad OTP attempt must not log the user out.
    assert.equal(getAccessToken(), 'token')
  })
})

describe('refreshSession', () => {
  it('exchanges the HttpOnly cookie via the BFF and stores only the access token', async () => {
    makeSession('old')
    handler = (url, init) => {
      assert.equal(url, '/api/auth/refresh')
      assert.equal(init?.credentials, 'same-origin')
      assert.equal(init?.method, 'POST')
      return Promise.resolve(jsonResponse({ data: { token: 'new-access', expires: 42 } }))
    }
    assert.equal(await refreshSession(), true)
    assert.equal(getAccessToken(), 'new-access')
    assert.equal(getSession()?.expires, 42)
    assert.deepEqual(getSession()?.user, { id: 42 })
  })

  it('fails and clears the session on a malformed refresh body', async () => {
    makeSession('old')
    handler = () => Promise.resolve(jsonResponse({ data: { token: 123 } }))
    assert.equal(await refreshSession(), false)
    assert.equal(getSession(), null)
  })

  it('fails and clears the session on transport error', async () => {
    makeSession('old')
    handler = () => Promise.reject(new Error('network down'))
    assert.equal(await refreshSession(), false)
    assert.equal(getSession(), null)
  })

  it('shares one upstream exchange across concurrent refreshes', async () => {
    handler = () => Promise.resolve(jsonResponse({ data: { token: 't', expires: 1 } }))
    const [a, b] = await Promise.all([refreshSession(), refreshSession()])
    assert.equal(a, true)
    assert.equal(b, true)
    assert.equal(callsTo('/api/auth/refresh').length, 1)
  })
})

describe('stale-response invalidation', () => {
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

  it('a refresh resolving after logout cannot restore the cleared session', async () => {
    makeSession('old-token')
    let resolveRefresh: (r: Response) => void = () => {}
    handler = (url) =>
      url === '/api/auth/refresh'
        ? new Promise<Response>((resolve) => { resolveRefresh = resolve })
        : Promise.resolve(jsonResponse({ error: 'expired' }, 401))
    const request = apiRequest('/api/v1/transfers/')
    await tick() // let the refresh exchange start
    await logoutSession()
    resolveRefresh(jsonResponse({ data: { token: 'stale-token', expires: 1 } }))
    await assert.rejects(request, ApiRequestError)
    assert.equal(getSession(), null)
    assert.equal(getAccessToken(), null)
  })

  it('a refresh resolving after a newer login cannot overwrite the new session', async () => {
    let resolveRefresh: (r: Response) => void = () => {}
    handler = (url) =>
      url === '/api/auth/refresh'
        ? new Promise<Response>((resolve) => { resolveRefresh = resolve })
        : Promise.resolve(jsonResponse({ success: true }))
    const pending = refreshSession()
    await tick()
    setSession({ accessToken: 'new-login-token', expires: 2, user: { id: 7 } })
    resolveRefresh(jsonResponse({ data: { token: 'old-refresh-token', expires: 1 } }))
    assert.equal(await pending, false)
    assert.equal(getAccessToken(), 'new-login-token')
    assert.deepEqual(getSession()?.user, { id: 7 })
  })

  it('a failed refresh resolving after a session change does not clear the new session', async () => {
    let resolveRefresh: (r: Response) => void = () => {}
    handler = (url) =>
      url === '/api/auth/refresh'
        ? new Promise<Response>((resolve) => { resolveRefresh = resolve })
        : Promise.resolve(jsonResponse({ success: true }))
    const pending = refreshSession()
    await tick()
    setSession({ accessToken: 'new-login-token', expires: 2, user: { id: 7 } })
    resolveRefresh(jsonResponse({ message: 'Invalid refresh token' }, 401))
    assert.equal(await pending, false)
    assert.equal(getAccessToken(), 'new-login-token')
  })

  it('a retried write repeats the identical body so client_request_id deduplicates upstream', async () => {
    makeSession('expired')
    const bodies: string[] = []
    handler = (url, init) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve(jsonResponse({ data: { token: 'fresh', expires: 1 } }))
      }
      bodies.push(String(init?.body))
      return Promise.resolve(
        bodies.length === 1 ? jsonResponse({ error: 'expired' }, 401) : jsonResponse({ success: true })
      )
    }
    const payload = { propertyAddress: '1 Main St', client_request_id: 'b6f0c0f0-1111-4222-8333-444455556666' }
    await apiRequest('/api/v1/transfers/', { method: 'POST', body: payload })
    assert.equal(bodies.length, 2)
    assert.equal(bodies[0], bodies[1])
    assert.match(bodies[1], /client_request_id/)
  })
})

describe('logout and session transitions', () => {
  it('sends the Bearer token to the BFF logout and clears the session', async () => {
    makeSession('token-logout')
    let seen: string | null = null
    handler = (url, init) => {
      assert.equal(url, '/api/auth/logout')
      seen = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(jsonResponse({ success: true }))
    }
    await logoutSession()
    assert.equal(seen, 'Bearer token-logout')
    assert.equal(getSession(), null)
  })

  it('clears the session even when the logout request fails', async () => {
    makeSession('token')
    handler = () => Promise.reject(new Error('network down'))
    await logoutSession()
    assert.equal(getSession(), null)
  })

  it('notifies listeners on session change so user-scoped state can be dropped', async () => {
    const events: (object | null)[] = []
    const unsubscribe = onSessionChange((s) => events.push(s))
    makeSession('token')
    clearSession()
    unsubscribe()
    clearSession()
    assert.equal(events.length, 2)
    assert.equal(events[1], null)
  })

  it('removes the legacy prototype flag and never persists tokens to storage', async () => {
    fakeStorage.setItem('legitify_auth', '1')
    makeSession('secret-access-token')
    assert.equal(fakeStorage.getItem('legitify_auth'), null)
    for (const value of fakeStorage.data.values()) {
      assert.doesNotMatch(value, /secret-access-token/)
    }
    fakeStorage.setItem('legitify_auth', '1')
    clearSession()
    assert.equal(fakeStorage.getItem('legitify_auth'), null)
  })
})
