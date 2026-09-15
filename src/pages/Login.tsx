import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, AccountOption, OtpChallenge } from '@/hooks/useAuth'
import { ApiRequestError } from '@/lib/api/http'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'

type Step = 'credentials' | 'accounts' | 'otp'
type IdentifierMode = 'id' | 'passport'

function credentialError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Invalid credentials'
    if (error.status === 400) return 'Check the details you entered and try again'
  }
  return 'Sign-in is temporarily unavailable. Please try again.'
}

function otpError(error: unknown): string {
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 400)) {
    return 'Invalid or expired verification code'
  }
  return 'Verification is temporarily unavailable. Please try again.'
}

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, isRestoring, initiateLogin, requestOtp, completeLogin } = useAuth()

  const [step, setStep] = useState<Step>('credentials')
  const [identifierMode, setIdentifierMode] = useState<IdentifierMode>('id')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [userId, setUserId] = useState<number | null>(null)
  const [challenge, setChallenge] = useState<OtpChallenge>({})
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-navy-900">
        <p className="text-gray-700 dark:text-gray-300">Restoring session…</p>
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-navy-900">
        <p className="text-gray-700 dark:text-gray-300">Already logged in.</p>
      </div>
    )
  }

  const credentialsPayload = (selectedUserId?: number) => ({
    ...(identifierMode === 'id' ? { idNumber: identifier.trim() } : { passportNumber: identifier.trim() }),
    password,
    ...(selectedUserId !== undefined ? { userId: selectedUserId } : {}),
  })

  const moveToOtp = async (resolvedUserId: number) => {
    const next = await requestOtp(resolvedUserId)
    setUserId(resolvedUserId)
    setChallenge(next)
    setOtp('')
    setStep('otp')
  }

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await initiateLogin(credentialsPayload())
      if (result.kind === 'otp') {
        await moveToOtp(result.userId)
      } else {
        setAccounts(result.accounts)
        setStep('accounts')
      }
    } catch (err) {
      setError(credentialError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleAccountSelect = async (account: AccountOption) => {
    setBusy(true)
    setError(null)
    try {
      const result = await initiateLogin(credentialsPayload(account.userId))
      if (result.kind === 'otp') {
        await moveToOtp(result.userId)
      } else {
        setError('Unexpected authentication response')
      }
    } catch (err) {
      setError(credentialError(err))
      setStep('credentials')
    } finally {
      setBusy(false)
    }
  }

  const handleOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (userId === null) {
      setError('Session expired. Start again.')
      setStep('credentials')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await completeLogin(userId, Number(otp))
      navigate('/transfers', { replace: true })
    } catch (err) {
      setError(otpError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleResend = async () => {
    if (userId === null) return
    setBusy(true)
    setError(null)
    try {
      setChallenge(await requestOtp(userId))
    } catch (err) {
      setError(otpError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-navy-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>DEEDLY</CardTitle>
          <CardDescription>
            {step === 'credentials' && 'Sign in with your Legitify credentials'}
            {step === 'accounts' && 'Select the account to sign in to'}
            {step === 'otp' && 'Enter the verification code sent to you'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'credentials' && (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => { setIdentifierMode('id'); setIdentifier('') }}
                  className={identifierMode === 'id' ? 'font-semibold text-navy-600 dark:text-navy-300' : 'text-gray-500'}
                >
                  SA ID number
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => { setIdentifierMode('passport'); setIdentifier('') }}
                  className={identifierMode === 'passport' ? 'font-semibold text-navy-600 dark:text-navy-300' : 'text-gray-500'}
                >
                  Passport
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {identifierMode === 'id' ? 'SA ID number' : 'Passport number'}
                </label>
                <Input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={identifierMode === 'id' ? '13-digit ID number' : 'Passport number'}
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
              <Button type="submit" disabled={busy} className="w-full bg-navy-600 text-white hover:bg-navy-700">
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}

          {step === 'accounts' && (
            <div className="space-y-2">
              {accounts.map((account) => (
                <button
                  key={account.userId}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAccountSelect(account)}
                  className="w-full text-left rounded border border-gray-200 dark:border-navy-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-navy-800"
                >
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                    {account.institutionName ?? 'Account'} {account.roleName ? `— ${account.roleName}` : ''}
                  </span>
                </button>
              ))}
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
              <button
                type="button"
                onClick={() => { setStep('credentials'); setError(null) }}
                className="text-sm text-navy-600 dark:text-navy-300"
              >
                Back
              </button>
            </div>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtp} className="space-y-4">
              {challenge.confirmationPin && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Check that the message shows confirmation PIN{' '}
                  <span className="font-mono font-semibold">{challenge.confirmationPin}</span>
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Verification code
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  autoComplete="one-time-code"
                />
              </div>
              {challenge.devOtp !== undefined && (
                <p className="text-xs text-amber-600">Development OTP: {challenge.devOtp}</p>
              )}
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
              <Button type="submit" disabled={busy || otp.length !== 6} className="w-full bg-navy-600 text-white hover:bg-navy-700">
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" onClick={() => void handleResend()} disabled={busy} className="text-navy-600 dark:text-navy-300">
                  Resend code
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setError(null); setUserId(null) }}
                  className="text-gray-500"
                >
                  Start over
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export { Login }
