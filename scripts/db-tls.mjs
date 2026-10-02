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
// Channel binding: pg's DSN parser passes `channel_binding` through but pg
// only honours its explicit `enableChannelBinding` option — the DSN param
// alone is a silent no-op (verified live: the client fell back to plain
// SCRAM-SHA-256). Even with the flag, pg treats 'require' as
// prefer-PLUS-if-offered and silently degrades to plain SCRAM on a server
// that does not advertise SCRAM-SHA-256-PLUS — strict enforcement is not
// possible with this driver, so 'require' is REJECTED as unsupported.
// 'prefer' is supported explicitly: enableChannelBinding is set (PLUS is
// used when the server offers it) and the weaker guarantee is documented.
//
// The ssl-related params are stripped from the returned connectionString so
// pg-connection-string's parse cannot override the resolved ssl object.

import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'

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

  const channelBinding = url ? url.searchParams.get('channel_binding') : null
  if (channelBinding === 'require') {
    throw new Error(
      'channel_binding=require is not supported: pg cannot strictly enforce ' +
      'SCRAM-SHA-256-PLUS (it silently degrades). Use channel_binding=prefer ' +
      'for best-effort binding, or enforce it server-side.',
    )
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
    if (env.NODE_ENV === 'production') {
      throw new Error('no-verify TLS is refused when NODE_ENV=production')
    }
    warnings.push('TLS verification disabled by explicit no-verify configuration — do not use against production-shaped data')
    ssl = { ...NO_VERIFY }
  } else {
    ssl = { rejectUnauthorized: true }
    if (caFile) ssl.ca = readCa(caFile)
  }

  // pg only sets servername for non-IP hosts, so checkServerIdentity is
  // silently skipped for IP literals (and a literal IP cannot be a
  // servername — Node throws). Inject an identity check that validates the
  // cert's IP SANs against the configured host instead.
  const host = url ? url.hostname : env.DB_HOST
  if (ssl && ssl.rejectUnauthorized && host && net.isIP(host) !== 0) {
    const expected = host
    ssl.checkServerIdentity = (_name, cert) => tls.checkServerIdentity(expected, cert)
  }

  // channel_binding=prefer only has an effect if pg gets its explicit
  // enableChannelBinding option — map it. Needs TLS to mean anything.
  const enableChannelBinding = channelBinding === 'prefer' ? true : undefined
  if (enableChannelBinding && !ssl) {
    throw new Error('channel_binding=prefer needs TLS — ssl resolved off')
  }
  if (enableChannelBinding) {
    warnings.push('channel_binding=prefer is best-effort: SCRAM-SHA-256-PLUS is used only when the server offers it')
  }

  if (!dsn) return { connectionString: null, ssl, enableChannelBinding, warnings }

  // Strip ssl params so pg's DSN parse cannot clobber the resolved ssl object.
  for (const p of TLS_DSN_PARAMS) url.searchParams.delete(p)
  return { connectionString: url.toString(), ssl, enableChannelBinding, warnings }
}
