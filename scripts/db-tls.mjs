// Shared TLS resolution for Node database tooling (M1 hardening).
//
// Default is full certificate + hostname verification whenever TLS is used.
// Previously both migrate.mjs and migrate-preflight.mjs passed
// { rejectUnauthorized: false } — encrypted but unverified.
//
// Modes (libpq names; the unresolved pg fallback is closed here):
//   disable            no TLS
//   require / prefer / verify-ca / verify-full / allow
//                      TLS with full chain + hostname verification.
//                      pg 8.x already treats these as verify-full; this
//                      module makes that explicit instead of inherited.
//   no-verify          TLS without verification — explicit downgrade only;
//                      always emits a warning, never the default.
//
// CA trust, in precedence order: sslrootcert DSN param > PGSSLROOTCERT >
// DB_SSL_CA_FILE. A missing/unreadable CA file fails closed.
//
// sslmode precedence: DSN sslmode > PGSSLMODE > DB_SSL ('true' => require,
// 'no-verify' => no-verify). A DSN without sslmode defaults to verified TLS
// (the previous tooling enabled TLS unconditionally — now it is verified).
//
// The ssl-related params are stripped from the returned connectionString so
// pg-connection-string's parse cannot override the resolved ssl object.

import fs from 'node:fs'

const TLS_DSN_PARAMS = [
  'sslmode', 'sslcert', 'sslkey', 'sslpassword', 'sslrootcert', 'sslcrl',
  'ssl_min_protocol_version', 'ssl_max_protocol_version', 'sslnegotiation',
  'sslcompression', 'sslsni', 'uselibpqcompat',
]

const NO_VERIFY = { rejectUnauthorized: false }

function readCa(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`TLS CA file not found: ${path} (refusing to downgrade verification)`)
  }
  return fs.readFileSync(path, 'utf8')
}

export function resolveDbTls(dsn, env = {}) {
  const warnings = []
  let url = null
  let sslmodeParam = null
  let sslrootcert = null
  if (dsn) {
    url = new URL(dsn)
    sslmodeParam = url.searchParams.get('sslmode')
    sslrootcert = url.searchParams.get('sslrootcert')
  }

  let mode = sslmodeParam || env.PGSSLMODE || null
  if (!mode) {
    if (env.DB_SSL === 'true') mode = 'require'
    else if (env.DB_SSL === 'no-verify') mode = 'no-verify'
    else if (dsn) mode = 'require' // DSN: TLS was already unconditional — keep it, now verified
    else mode = 'disable'
  }

  const caFile = sslrootcert || env.PGSSLROOTCERT || env.DB_SSL_CA_FILE || null

  let ssl
  if (mode === 'disable') {
    ssl = false
  } else if (mode === 'no-verify') {
    warnings.push('TLS verification disabled by explicit no-verify configuration — do not use against production-shaped data')
    ssl = { ...NO_VERIFY }
  } else {
    ssl = { rejectUnauthorized: true }
    if (caFile) ssl.ca = readCa(caFile)
  }

  if (!dsn) return { connectionString: null, ssl, warnings }

  // Strip ssl params so pg's DSN parse cannot clobber the resolved ssl object.
  for (const p of TLS_DSN_PARAMS) url.searchParams.delete(p)
  return { connectionString: url.toString(), ssl, warnings }
}
