// Readiness checks (M1). Read-only and bounded: two SELECTs against the
// pool, no writes, no migrations, no database creation. A process whose
// dependencies or schema prerequisites are unavailable reports NOT ready.
//
// The schema prerequisite is the migration ledger: the applied-row count
// must equal the approved manifest's fileCount — pending or partial
// schema means not ready. Deeper ledger integrity is migrate-preflight's
// job, not this probe's.
//
// Check labels are fixed strings — never connection details, hostnames,
// or error payloads that could carry credentials.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReadinessResult {
  ready: boolean
  checks: { config: string; database: string; schema: string }
}

let manifestCount: number | null | undefined

export function expectedMigrationCount(manifestPath?: string): number | null {
  if (manifestCount !== undefined) return manifestCount ?? null
  const p = manifestPath
    || process.env.MIGRATIONS_MANIFEST
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/migrations/manifest.json')
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'))
    manifestCount = typeof m.fileCount === 'number' ? m.fileCount : null
  } catch {
    manifestCount = null
  }
  return manifestCount ?? null
}

export function resetReadinessCache(): void {
  manifestCount = undefined
}

export async function checkReadiness(opts: {
  query: (text: string) => Promise<{ rows: { n?: number }[] }>
  configValid?: boolean
  manifestPath?: string
}): Promise<ReadinessResult> {
  const checks: ReadinessResult['checks'] = { config: 'ok', database: 'unavailable', schema: 'unknown' }
  if (opts.configValid === false) checks.config = 'invalid-configuration'

  try {
    await opts.query('SELECT 1')
    checks.database = 'ok'
  } catch {
    checks.database = 'unavailable'
    checks.schema = 'unknown'
    return { ready: false, checks }
  }

  const expected = expectedMigrationCount(opts.manifestPath)
  if (expected === null) {
    checks.schema = 'manifest-unavailable'
    return { ready: false, checks }
  }
  try {
    const res = await opts.query('SELECT count(*)::int AS n FROM public.transfers_schema_migrations')
    const applied = res.rows[0]?.n
    checks.schema = applied === expected ? 'ok' : 'schema-incomplete'
  } catch {
    checks.schema = 'ledger-missing'
  }
  return { ready: checks.config === 'ok' && checks.schema === 'ok', checks }
}
