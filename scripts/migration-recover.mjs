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
//   node scripts/migration-recover.mjs --revision=<sha> --output=<dir> [--expect-manifest-sha256=<hex>]
//   node scripts/migration-recover.mjs --verify=<dir> [--expect-manifest-sha256=<hex>]
//
// --expect-manifest-sha256 pins the recovered manifest to an independent
// trust reference (the approved revision's manifest digest) — otherwise a
// retained copy carrying a rewritten manifest would verify against itself.

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

// A manifest file entry must be a plain basename inside the artifact
// directory — reject traversal, absolute or nested paths and anything
// that is not a regular file (symlinks can escape the directory).
function entryNameProblem(name) {
  if (typeof name !== 'string' || !name) return 'empty file name'
  if (path.basename(name) !== name || name.includes('/') || name.includes('\\') ||
      path.isAbsolute(name) || path.win32.isAbsolute(name) || name === '..' || name.includes('..'))
    return `unsafe manifest path: ${JSON.stringify(name)}`
  if (name === 'manifest.json') return 'manifest.json must not appear in files[]'
  return null
}

// Verify a directory of recovered files against its manifest.json.
// opts.expectedManifestSha256 pins the manifest itself to an independent
// trust reference (e.g. the approved revision's manifest digest) —
// without it a directory that ships its own rewritten manifest would
// verify against itself.
export function verifyArtifactDir(dir, opts = {}) {
  const { manifest, manifestSha256, error } = loadManifest(dir)
  if (error) return fail(error)
  if (opts.expectedManifestSha256 &&
      manifestSha256 !== String(opts.expectedManifestSha256).toLowerCase())
    return fail(`manifest digest mismatch: expected ${String(opts.expectedManifestSha256).toLowerCase()} got ${manifestSha256}`)

  const recorded = manifest.files
  const problems = []
  for (const f of recorded) {
    const p = entryNameProblem(f && f.file)
    if (p) problems.push(p)
  }
  const names = recorded.map(f => f.file)
  if (new Set(names).size !== names.length) problems.push('manifest files[] contains duplicate entries')
  const orderOk = recorded.every((f, i) => i === 0 || recorded[i - 1].file < f.file)
  if (!orderOk) problems.push('manifest files[] not in canonical sorted order')
  if (manifest.fileCount !== recorded.length)
    problems.push(`manifest fileCount ${manifest.fileCount} != files[] length ${recorded.length}`)

  const verified = []
  for (const f of recorded) {
    if (entryNameProblem(f.file)) continue
    const p = path.join(dir, f.file)
    if (!fs.existsSync(p)) { problems.push(`missing file ${f.file}`); continue }
    const st = fs.lstatSync(p)
    if (!st.isFile() || st.isSymbolicLink()) { problems.push(`not a regular file: ${f.file}`); continue }
    const bytes = fs.readFileSync(p)
    if (sha256(bytes) !== f.sha256) problems.push(`checksum mismatch in ${f.file}`)
    else verified.push({ file: f.file, bytes, checksum: f.sha256 })
  }
  const listed = new Set(names)
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'manifest.json' || listed.has(e.name)) continue
    if (!e.isFile() || e.isSymbolicLink())
      problems.push(`unexpected non-file entry: ${e.name}`)
    else
      problems.push(`unlisted file present: ${e.name}`)
  }
  if (problems.length) return fail(problems.join('; '))
  return { ok: true, fileCount: recorded.length, manifestSha256, files: verified }
}

// Verify an artifact directory and return the exact bytes that were
// hashed — callers that execute or compare migrations MUST use these
// buffers so a file changed after verification cannot substitute
// different SQL (verification-to-execution substitution).
export function loadVerifiedArtifact(dir, expectedManifestSha256) {
  const v = verifyArtifactDir(dir, { expectedManifestSha256 })
  if (!v.ok)
    throw new Error(`Migration artifact verification failed for ${dir}: ${v.reason}`)
  return { manifestSha256: v.manifestSha256, files: v.files }
}

// Extract the artifact at a git revision into an empty output dir.
// All blob bytes are fetched before anything touches disk, and a
// `.recovery-incomplete` marker exists for the whole write window — a
// partial/interrupted recovery can never verify as a complete artifact
// (the marker is itself an unlisted file).
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
  const nested = names.filter(n => n.slice(MIGRATIONS_SUBDIR.length + 1).includes('/'))
  if (nested.length)
    return fail(`unexpected nested paths in ${MIGRATIONS_SUBDIR} at ${revision}: ${nested.join(', ')}`)

  const blobs = new Map()
  for (const n of names) {
    try {
      blobs.set(path.basename(n), execFileSync('git', ['show', `${revision}:${n}`],
        { ...opts, encoding: 'buffer', maxBuffer: 64 << 20 }))
    } catch (e) {
      return fail(`cannot read ${n} at ${revision}: ${e.message.split('\n')[0]}`)
    }
  }

  const marker = path.join(outputDir, '.recovery-incomplete')
  try {
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(marker, 'incomplete recovery — do not use\n')
    for (const [base, bytes] of blobs) fs.writeFileSync(path.join(outputDir, base), bytes)
    fs.unlinkSync(marker)
  } catch (e) {
    return fail(`write failed (directory left marked .recovery-incomplete): ${e.message}`)
  }
  return { ok: true, filesWritten: names.length }
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--(revision|verify|output|repo|expect-manifest-sha256)=(.+)$/)
    return m ? [m[1], m[2]] : [a, true]
  }),
)

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(args.repo || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
  const expect = args['expect-manifest-sha256']
  if (args.revision && args.output) {
    const ex = extractRevision(args.revision, path.resolve(args.output), repo)
    if (!ex.ok) { console.error(`RECOVERY FAILED: ${ex.reason}`); process.exitCode = 1 }
    else {
      const v = verifyArtifactDir(args.output, { expectedManifestSha256: expect })
      if (!v.ok) { console.error(`RECOVERY FAILED: ${v.reason}`); process.exitCode = 1 }
      else if (expect)
        console.log(`Recovered ${v.fileCount} migrations + manifest at ${args.revision} into ${args.output}; all sha256 verified and manifest matches the expected digest. manifest sha256=${v.manifestSha256}`)
      else
        console.log(`Recovered ${v.fileCount} migrations + manifest at ${args.revision} into ${args.output}. INTERNAL CONSISTENCY ONLY — no --expect-manifest-sha256 given; run again with the approved digest before release use. manifest sha256=${v.manifestSha256}`)
    }
  } else if (args.verify) {
    const v = verifyArtifactDir(path.resolve(args.verify), { expectedManifestSha256: expect })
    if (!v.ok) { console.error(`VERIFY FAILED: ${v.reason}`); process.exitCode = 1 }
    else if (expect)
      console.log(`Verified ${v.fileCount} migrations + manifest in ${args.verify}; all sha256 match and manifest matches the expected digest. manifest sha256=${v.manifestSha256}`)
    else
      console.log(`Verified ${v.fileCount} migrations + manifest in ${args.verify}. INTERNAL CONSISTENCY ONLY — the copy verifies against its own manifest; this does NOT prove it is the approved artifact. Re-run with --expect-manifest-sha256=<approved digest>. manifest sha256=${v.manifestSha256}`)
  } else {
    console.error('Usage: --revision=<sha> --output=<dir> | --verify=<dir> [--repo=<path>] [--expect-manifest-sha256=<hex>]')
    process.exitCode = 2
  }
}
