// Readiness checks (M1). Read-only and bounded: the database probe is two
// SELECTs on a dedicated per-probe client (see db.ts makeProbeQuery — pg's
// query_timeout does not cancel backend statements, so probes use a
// client whose socket teardown kills in-flight work), each raced against
// an explicit timeout, plus an abort-bounded GET of the FastAPI readiness
// endpoint. No writes, no migrations, no database creation.
//
// The schema prerequisite is the approved migration manifest: every file in
// the manifest must be recorded in public.transfers_schema_migrations with
// the manifest's sha256. A ledger row not listed in the manifest is
// schema-drift — for the controlled pilot the deployed schema must equal
// the approved artifact exactly, so extras fail closed too. Deeper ledger
// integrity (ordering, EOL canonicalisation) remains migrate-preflight's
// job, not this probe's.
//
// Check labels are fixed strings — never connection details, hostnames,
// or error payloads that could carry credentials.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReadinessResult {
  ready: boolean
  checks: { config: string; database: string; schema: string; upstream: string }
}

export interface ManifestEntry { file: string; sha256: string }

const DB_PROBE_TIMEOUT_MS = 5000
const UPSTREAM_PROBE_TIMEOUT_MS = 3000

let manifestCache: ManifestEntry[] | null | undefined

function manifestCandidates(override?: string): string[] {
  if (override) return [override]
  if (process.env.MIGRATIONS_MANIFEST) return [process.env.MIGRATIONS_MANIFEST]
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [
    // Built runtime: dist/server/server/readiness.js → dist/server/src/...
    // (copied by build:server). Source tree: server/readiness.ts → ../src/...
    path.join(here, '../src/lib/migrations/manifest.json'),
    // Repo-root cwd (npm start / tsx dev / tests)
    path.resolve(process.cwd(), 'src/lib/migrations/manifest.json'),
  ]
}

export function loadManifest(manifestPath?: string): ManifestEntry[] | null {
  if (manifestPath === undefined && manifestCache !== undefined) return manifestCache
  let parsed: ManifestEntry[] | null = null
  for (const p of manifestCandidates(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(m.files) && m.files.every((f: any) => typeof f?.file === 'string' && typeof f?.sha256 === 'string')) {
        parsed = m.files.map((f: any) => ({ file: f.file, sha256: f.sha256.toLowerCase() }))
      }
    } catch { /* try next candidate */ }
    if (parsed) break
  }
  if (manifestPath === undefined) manifestCache = parsed
  return parsed
}

// Kept for the back-compat surface; the real gate is per-file validation.
export function expectedMigrationCount(manifestPath?: string): number | null {
  return loadManifest(manifestPath)?.length ?? null
}

export function resetReadinessCache(): void {
  manifestCache = undefined
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('probe timed out')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

interface Queryable { rows: Record<string, unknown>[] }

export async function checkReadiness(opts: {
  query: (text: string) => Promise<Queryable>
  configValid?: boolean
  manifestPath?: string
  // Absolute base URL of the DEEDLY FastAPI service. When set, its liveness
  // endpoint is probed — the pilot workflow proxies v1 routes to it, so a
  // configured-but-down upstream means not-ready. Unset (local BFF-only dev)
  // reports 'not-configured' and does not block readiness.
  upstreamBaseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<ReadinessResult> {
  const checks: ReadinessResult['checks'] = {
    config: opts.configValid === false ? 'invalid-configuration' : 'ok',
    database: 'unavailable',
    schema: 'unknown',
    upstream: 'not-configured',
  }
  const dbTimeout = opts.timeoutMs ?? DB_PROBE_TIMEOUT_MS

  try {
    await withTimeout(opts.query('SELECT 1'), dbTimeout)
    checks.database = 'ok'
  } catch {
    checks.database = 'unavailable'
    return { ready: false, checks }
  }

  const manifest = loadManifest(opts.manifestPath)
  if (manifest === null) {
    checks.schema = 'manifest-unavailable'
  } else {
    try {
      const res = await withTimeout(
        opts.query('SELECT filename, checksum FROM public.transfers_schema_migrations'),
        dbTimeout,
      )
      const ledger = new Map<string, string>()
      for (const row of res.rows) {
        if (typeof row.filename === 'string' && typeof row.checksum === 'string') {
          ledger.set(row.filename, row.checksum.toLowerCase())
        }
      }
      const expected = new Map(manifest.map(f => [f.file, f.sha256]))
      let mismatch = false
      for (const [file, sha] of expected) {
        const actual = ledger.get(file)
        if (actual === undefined) { checks.schema = 'schema-missing-migrations'; break }
        if (actual !== sha) { checks.schema = 'schema-checksum-mismatch'; mismatch = true; break }
      }
      if (!mismatch && checks.schema === 'unknown') {
        checks.schema = ledger.size > expected.size ? 'schema-drift' : 'ok'
      }
    } catch {
      checks.schema = 'ledger-missing'
    }
  }

  if (opts.upstreamBaseUrl) {
    // Probe FastAPI READINESS (not liveness): a live-but-not-ready upstream
    // cannot serve the v1 proxy routes, so 'not-ready' or a malformed body
    // is 'unavailable' here. AbortSignal cancels the socket — no abandoned
    // request remains after the deadline.
    const f = opts.fetchImpl ?? fetch
    try {
      const res = await f(`${opts.upstreamBaseUrl}/api/health/ready`, {
        signal: AbortSignal.timeout(UPSTREAM_PROBE_TIMEOUT_MS),
      })
      let body: any = null
      if (res.ok) {
        try { body = await res.json() } catch { body = null }
      }
      checks.upstream = res.ok && body?.status === 'ready' ? 'ok' : 'unavailable'
    } catch {
      checks.upstream = 'unavailable'
    }
  }

  const ready =
    checks.config === 'ok' &&
    checks.database === 'ok' &&
    checks.schema === 'ok' &&
    (checks.upstream === 'ok' || checks.upstream === 'not-configured')
  return { ready, checks }
}
