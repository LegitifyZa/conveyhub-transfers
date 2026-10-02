// Startup configuration validation (M1 readiness).
// In production, missing or unsafe configuration must stop the process —
// never silently fall back to development credentials. Issue strings carry
// the variable NAME and reason only — never the offending value.
//
// Development keeps its permissive behaviour: validation is a no-op
// outside production so local workflows are preserved.

export interface StartupIssue {
  name: string
  reason: string
}

const PLACEHOLDER_VALUES = new Set([
  'your_username',
  'your_password',
  'dev-secret-change-me',
  'changeme',
  'password',
])

const DSN_ENV_KEYS = [
  'ConveyHub_Transfers_POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NON_POOLING',
  'ConveyHub_Transfers_POSTGRES_URL',
  'POSTGRES_URL',
  'DATABASE_URL',
]

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

function isPlaceholder(value: string | undefined): boolean {
  return !value || PLACEHOLDER_VALUES.has(value.trim().toLowerCase())
}

export function validateStartupConfig(env: NodeJS.ProcessEnv): StartupIssue[] {
  if (env.NODE_ENV !== 'production') return []
  const issues: StartupIssue[] = []

  const dsn = DSN_ENV_KEYS.map(k => env[k]).find(v => v && v.trim())
  if (dsn) {
    let url: URL
    try {
      url = new URL(dsn)
    } catch {
      issues.push({ name: 'database connection string', reason: 'is not a valid URL' })
      return issues // cannot inspect further — stop here
    }
    if (!/^postgres(ql)?:$/i.test(url.protocol)) {
      issues.push({ name: 'database connection string', reason: `unsupported scheme '${url.protocol}'` })
    }
    if (!url.hostname) {
      issues.push({ name: 'database connection string', reason: 'has no hostname' })
    }
    if (!url.password) {
      issues.push({ name: 'database connection string', reason: 'carries no password' })
    }
    const sslmode = url.searchParams.get('sslmode')
    if (sslmode === 'disable' || sslmode === 'no-verify') {
      issues.push({ name: 'database connection string', reason: `sslmode=${sslmode} is not allowed in production` })
    }
  } else {
    for (const name of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
      if (isPlaceholder(env[name])) {
        issues.push({ name, reason: 'missing or still a placeholder value' })
      }
    }
  }

  for (const name of ['SECRET_KEY', 'JWT_SECRET']) {
    if (isPlaceholder(env[name])) {
      issues.push({ name, reason: 'missing or still a placeholder value' })
    }
  }

  // Upstreams carry bearer tokens and personal data — production requires
  // https, not merely "a URL". Plain-http internal lanes are a deployment
  // contract decision that is not yet made, so this fails closed.
  for (const name of ['LEGITIFY_API_BASE_URL', 'DEEDLY_API_BASE_URL']) {
    const upstream = env[name]
    if (!upstream || !upstream.trim()) {
      issues.push({ name, reason: 'missing' })
      continue
    }
    try {
      const u = new URL(upstream)
      if (u.protocol !== 'https:') {
        issues.push({ name, reason: 'must be an https URL in production' })
      } else if (LOOPBACK_HOSTS.has(u.hostname)) {
        issues.push({ name, reason: 'loopback is not a valid upstream in production' })
      }
    } catch {
      issues.push({ name, reason: 'is not a valid URL' })
    }
  }

  if (env.LEGACY_ACCOUNTABLE_INSTITUTION_ID) {
    issues.push({
      name: 'LEGACY_ACCOUNTABLE_INSTITUTION_ID',
      reason: 'the unauthenticated legacy-tenant bridge must not be configured in production',
    })
  }

  return issues
}
