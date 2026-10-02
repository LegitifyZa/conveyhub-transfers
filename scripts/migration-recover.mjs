// Recovers the approved migration artifact — the migration files plus
// manifest.json — from a recorded git revision or a retained directory,
// and verifies every recovered byte against the manifest's sha256
// digests before any use.
//
// Byte source for --revision is `git show <rev>:<path>` — the committed
// blob bytes, independent of working-tree checkout EOL settings.
//
// Fail-closed: a missing file, altered bytes, an extra unlisted file, a
// malformed manifest, or a non-empty output directory all fail with a
// named reason and non-zero exit. This tool never writes the schema
// ledger, never modifies migration files, and never reconciles a
// mismatch by editing anything.
//
// Usage:
//   node scripts/migration-recover.mjs --revision=<sha> --output=<dir>
//   node scripts/migration-recover.mjs --verify=<dir>

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const MIGRATIONS_SUBDIR = 'src/lib/migrations'
const sha256 = b => createHash('sha256').update(b).digest('hex')

function fail(msg) {
  return { ok: false, reason: msg }
}

function loadManifest(dir) {
  const p = path.join(dir, 'manifest.json')
  if (!fs.existsSync(p)) return { error: `manifest.json missing from ${dir}` }
  try {
    const m = JSON.parse(fs.readFileSync(p))
    if (!Array.isArray(m.files) || !m.files.length) return { error: 'manifest.json has no files[] entries' }
    return { manifest: m, manifestSha256: sha256(fs.readFileSync(p)) }
  } catch (e) {
    return { error: `manifest.json unreadable: ${e.message}` }
  }
}

// Verify a directory of recovered files against its manifest.json.
export function verifyArtifactDir(dir) {
  const { manifest, manifestSha256, error } = loadManifest(dir)
  if (error) return fail(error)

  const recorded = manifest.files
  const orderOk = recorded.every((f, i) => i === 0 || recorded[i - 1].file < f.file)
  if (!orderOk) return fail('manifest files[] not in canonical sorted order')
  if (manifest.fileCount !== recorded.length)
    return fail(`manifest fileCount ${manifest.fileCount} != files[] length ${recorded.length}`)

  const problems = []
  for (const f of recorded) {
    const p = path.join(dir, f.file)
    if (!fs.existsSync(p)) { problems.push(`missing file ${f.file}`); continue }
    const actual = sha256(fs.readFileSync(p))
    if (actual !== f.sha256) problems.push(`checksum mismatch in ${f.file}`)
  }
  const listed = new Set(recorded.map(f => f.file))
  for (const extra of fs.readdirSync(dir).filter(n => n !== 'manifest.json' && !listed.has(n)))
    problems.push(`unlisted file present: ${extra}`)
  if (problems.length) return fail(problems.join('; '))
  return { ok: true, fileCount: recorded.length, manifestSha256 }
}

// Extract the artifact at a git revision into an empty output dir.
export function extractRevision(revision, outputDir, repoRoot) {
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length)
    return fail(`output dir not empty: ${outputDir} (refusing to overwrite)`)
  const opts = { cwd: repoRoot }
  let names
  try {
    names = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, MIGRATIONS_SUBDIR], opts)
      .toString().split('\n').filter(Boolean)
  } catch (e) {
    return fail(`cannot list ${MIGRATIONS_SUBDIR} at ${revision}: ${e.message.split('\n')[0]}`)
  }
  if (!names.includes(`${MIGRATIONS_SUBDIR}/manifest.json`))
    return fail(`no manifest.json at revision ${revision}`)

  fs.mkdirSync(outputDir, { recursive: true })
  for (const n of names) {
    const base = path.basename(n)
    const bytes = execFileSync('git', ['show', `${revision}:${n}`], { ...opts, encoding: 'buffer', maxBuffer: 64 << 20 })
    fs.writeFileSync(path.join(outputDir, base), bytes)
  }
  return { ok: true, filesWritten: names.length }
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--(revision|verify|output|repo)=(.+)$/)
    return m ? [m[1], m[2]] : [a, true]
  }),
)

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(args.repo || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
  if (args.revision && args.output) {
    const ex = extractRevision(args.revision, path.resolve(args.output), repo)
    if (!ex.ok) { console.error(`RECOVERY FAILED: ${ex.reason}`); process.exitCode = 1 }
    else {
      const v = verifyArtifactDir(args.output)
      if (!v.ok) { console.error(`RECOVERY FAILED: ${v.reason}`); process.exitCode = 1 }
      else console.log(`Recovered ${v.fileCount} migrations + manifest at ${args.revision} into ${args.output}; all sha256 verified. manifest sha256=${v.manifestSha256}`)
    }
  } else if (args.verify) {
    const v = verifyArtifactDir(path.resolve(args.verify))
    if (!v.ok) { console.error(`VERIFY FAILED: ${v.reason}`); process.exitCode = 1 }
    else console.log(`Verified ${v.fileCount} migrations + manifest in ${args.verify}; all sha256 match. manifest sha256=${v.manifestSha256}`)
  } else {
    console.error('Usage: --revision=<sha> --output=<dir> | --verify=<dir> [--repo=<path>]')
    process.exitCode = 2
  }
}
