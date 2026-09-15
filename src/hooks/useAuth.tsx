import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { apiRequest } from '@/lib/api/http'
import {
  authEnvironmentSupported,
  enqueueAuthOp,
  getLogoutEpoch,
  getSession,
  getSessionUser,
  logoutSession,
  noteLandedSid,
  onSessionChange,
  refreshSession,
  setSession,
  UnsupportedAuthEnvironmentError,
} from '@/lib/api/session'

// Authenticated session backed by the upstream staff login flow:
//   initiate-login (identifier + password) → [account picker] → otp → login.
// The browser holds only the in-memory access token; the refresh credential
// is an HttpOnly cookie managed by the BFF and never touches JavaScript.
// No tokens are minted, stored or fabricated client-side.

export interface AccountOption {
  userId: number
  institutionId: number | null
  institutionName: string | null
  roleId: number | null
  roleName: string | null
}

export type InitiateLoginResult =
  | { kind: 'otp'; userId: number }
  | { kind: 'accounts'; accounts: AccountOption[] }

export interface OtpChallenge {
  confirmationPin?: string
}

interface AuthContextValue {
  isAuthenticated: boolean
  isRestoring: boolean
  user: Record<string, unknown> | null
  initiateLogin: (input: {
    idNumber?: string
    passportNumber?: string
    password: string
    userId?: number
  }) => Promise<InitiateLoginResult>
  requestOtp: (userId: number) => Promise<OtpChallenge>
  completeLogin: (userId: number, otp: number) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface UpstreamEnvelope {
  message?: string
  data?: Record<string, unknown>
}

function asAccountOption(value: unknown): AccountOption | null {
  if (typeof value !== 'object' || value === null) return null
  const option = value as Record<string, unknown>
  if (typeof option.user_id !== 'number' || !Number.isInteger(option.user_id)) return null
  return {
    userId: option.user_id,
    institutionId: typeof option.accountable_institution_id === 'number' ? option.accountable_institution_id : null,
    institutionName: typeof option.accountable_institution_name === 'string' ? option.accountable_institution_name : null,
    roleId: typeof option.role_id === 'number' ? option.role_id : null,
    roleName: typeof option.role_name === 'string' ? option.role_name : null,
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => getSession() !== null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [user, setUser] = useState<Record<string, unknown> | null>(getSessionUser())

  useEffect(() => onSessionChange((next) => {
    setIsAuthenticated(next !== null)
    setUser(next?.user ?? null)
  }), [])

  // Silent session restore: the HttpOnly refresh cookie is the only durable
  // credential, so on load we ask the BFF to exchange it for an access token.
  useEffect(() => {
    let alive = true
    void refreshSession().finally(() => {
      if (alive) setIsRestoring(false)
    })
    return () => { alive = false }
  }, [])

  const initiateLogin = useCallback(async (input: {
    idNumber?: string
    passportNumber?: string
    password: string
    userId?: number
  }): Promise<InitiateLoginResult> => {
    const body: Record<string, unknown> = { password: input.password }
    if (input.idNumber) body.id_number = input.idNumber
    if (input.passportNumber) body.passport_number = input.passportNumber
    if (input.userId !== undefined) body.user_id = input.userId
    const response = await apiRequest<UpstreamEnvelope>('/api/auth/initiate-login', {
      method: 'POST',
      body,
      cache: 'no-store',
    })
    const data = response?.data
    if (data?.requires_otp === true && typeof data.user_id === 'number') {
      return { kind: 'otp', userId: data.user_id }
    }
    if (Array.isArray(data?.accounts)) {
      const accounts = data.accounts.map(asAccountOption).filter((a): a is AccountOption => a !== null)
      if (accounts.length > 0) return { kind: 'accounts', accounts }
    }
    throw new Error('Unexpected authentication response')
  }, [])

  const requestOtp = useCallback(async (userId: number): Promise<OtpChallenge> => {
    const response = await apiRequest<UpstreamEnvelope>('/api/auth/otp', {
      method: 'POST',
      body: { user_id: userId },
      cache: 'no-store',
    })
    const data = response?.data
    return {
      confirmationPin: typeof data?.confirmation_pin === 'string' ? data.confirmation_pin : undefined,
    }
  }, [])

  const completeLogin = useCallback(async (userId: number, otp: number): Promise<void> => {
    if (!authEnvironmentSupported()) throw new UnsupportedAuthEnvironmentError()
    // Captured at call time: a logout requested while this login is queued or
    // in flight discards its result — logout always wins over a pending login.
    const logoutEpochAtCall = getLogoutEpoch()
    // Queued with refresh/logout so a login response is never in flight while
    // another auth operation is applying cookies.
    await enqueueAuthOp(async () => {
      const sidAtStart = getSession()?.sid ?? null
      const response = await apiRequest<UpstreamEnvelope>('/api/auth/login', {
        method: 'POST',
        body: { user_id: userId, otp },
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const data = response?.data
      if (typeof data?.token !== 'string' || !data.token
        || typeof data.expires !== 'number' || !Number.isFinite(data.expires)
        || typeof data.sid !== 'string' || !data.sid) {
        throw new Error('Unexpected authentication response')
      }
      // A logout was requested since this login began, or a session appeared
      // or changed during the login round-trip — discard this response rather
      // than resurrecting or displacing state. The response's Set-Cookie has
      // still landed in the jar, so record the sid: the serialized logout
      // that follows must be able to clear it instead of leaving an orphan.
      if (getLogoutEpoch() !== logoutEpochAtCall || (getSession()?.sid ?? null) !== sidAtStart) {
        noteLandedSid(data.sid)
        return
      }
      setSession({
        accessToken: data.token,
        expires: data.expires,
        user: (typeof data.user === 'object' && data.user !== null ? data.user : null) as Record<string, unknown> | null,
        sid: data.sid,
      })
    })
  }, [])

  const logout = useCallback(async () => {
    await logoutSession()
  }, [])

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      isRestoring,
      user,
      initiateLogin,
      requestOtp,
      completeLogin,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
