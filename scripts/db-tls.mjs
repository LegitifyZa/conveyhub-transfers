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
// SCRAM-SHA-256). This resolver therefore maps channel_binding=require|
// prefer onto `enableChannelBinding`. Caveat: pg treats even 'require' as
// prefer-PLUS-if-offered; a server that does not advertise
// SCRAM-SHA-256-PLUS silently degrades to plain SCRAM — strict failure is
// not enforceable client-side with this driver.
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
  if (channelBinding === 'require' && (sslmodeParam === 'disable' || env.PGSSLMODE === 'disable')) {
    throw new Error('channel_binding=require contradicts sslmode=disable — refusing the insecure combination')
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

  // channel_binding=require/prefer only has an effect if pg gets its
  // explicit enableChannelBinding option — map it. 'require' additionally
  // fails closed when TLS is off.
  const enableChannelBinding =
    channelBinding === 'require' || channelBinding === 'prefer' ? true : undefined
  if (enableChannelBinding && !ssl) {
    throw new Error('channel_binding=require/prefer needs TLS — ssl resolved off')
  }

  if (!dsn) return { connectionString: null, ssl, enableChannelBinding, warnings }

  // Strip ssl params so pg's DSN parse cannot clobber the resolved ssl object.
  for (const p of TLS_DSN_PARAMS) url.searchParams.delete(p)
  return { connectionString: url.toString(), ssl, enableChannelBinding, warnings }
}
