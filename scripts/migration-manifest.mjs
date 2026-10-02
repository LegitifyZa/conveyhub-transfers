// Generates/verifies the immutable migration manifest
// (src/lib/migrations/manifest.json): the ordered list of migration files
// with the sha256 of each file's raw bytes — the same digest the runner
// stores in the ledger. The manifest is the reviewable record of the exact
// artifact bytes; it is written from this checkout and `--check` fails
// loudly if the working tree differs (including a CRLF checkout, which is
// a different byte artifact and must not be silently reconciled).
//
// Usage:
//   node scripts/migration-manifest.mjs --write   # regenerate manifest.json
//   node scripts/migration-manifest.mjs --check   # exit non-zero on drift

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/migrations')
const manifestPath = path.join(dir, 'manifest.json')

export function buildManifest() {
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => {
      const bytes = fs.readFileSync(path.join(dir, file), 'utf8')
      return {
        file,
        sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'),
        eol: bytes.includes('\r\n') ? 'crlf' : 'lf',
        bytes: Buffer.byteLength(bytes, 'utf8'),
      }
    })
  return {
    artifact: 'transfers-migrations',
    algorithm: 'sha256-over-raw-file-bytes',
    canonicalEol: 'lf',
    note: 'sha256 is over the file bytes exactly as the runner applies them. A CRLF checkout produces different digests — that is a byte-different artifact, not a cosmetic difference.',
    fileCount: files.length,
    files,
  }
}

export function checkManifest(manifest) {
  const actual = buildManifest().files
  const recorded = manifest?.files || []
  const problems = []
  const byName = new Map(recorded.map(f => [f.file, f]))
  for (const f of actual) {
    const r = byName.get(f.file)
    if (!r) problems.push(`manifest missing ${f.file}`)
    else if (r.sha256 !== f.sha256) problems.push(`checksum drift in ${f.file}`)
  }
  for (const r of recorded) {
    if (!actual.find(f => f.file === r.file)) problems.push(`manifest names absent file ${r.file}`)
  }
  const orderOk = recorded.every((f, i) => i === 0 || recorded[i - 1].file < f.file)
  if (!orderOk) problems.push('manifest files are not in canonical sorted order')
  return problems
}

const mode = process.argv[2]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (mode === '--write') {
    fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(), null, 2) + '\n')
    console.log(`Wrote ${manifestPath}`)
  } else if (mode === '--check') {
    const problems = checkManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    if (problems.length) {
      console.error('Manifest drift:\n' + problems.map(p => `  - ${p}`).join('\n'))
      process.exitCode = 1
    } else {
      console.log('Manifest matches the migration directory.')
    }
  } else {
    console.error('Usage: migration-manifest.mjs --write|--check')
    process.exitCode = 2
  }
}
