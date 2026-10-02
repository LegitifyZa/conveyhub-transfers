// Offline recovery rehearsal for the immutable migration artifact.
// Uses temp copies only — the repository migrations are never touched,
// and no ledger/database is involved.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { extractRevision, verifyArtifactDir } from './migration-recover.mjs'

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const realDir = path.join(repo, 'src/lib/migrations')

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'm1br-recover-'))
}

// Copy the real artifact into a temp dir (the "retained copy" scenario)
function copyArtifact() {
  const d = tmp()
  for (const f of fs.readdirSync(realDir).filter(n => n.endsWith('.sql') || n === 'manifest.json'))
    fs.copyFileSync(path.join(realDir, f), path.join(d, f))
  return d
}

test('recovers an intact retained copy — all digests verify', () => {
  const d = copyArtifact()
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, true, v.reason)
  assert.equal(v.fileCount, 27)
  assert.match(v.manifestSha256, /^[0-9a-f]{64}$/)
})

test('detects a tampered migration file by name', () => {
  const d = copyArtifact()
  const victim = path.join(d, '001_initial_schema.sql')
  fs.writeFileSync(victim, fs.readFileSync(victim) + '-- tampered\n')
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /checksum mismatch in 001_initial_schema\.sql/)
})

test('detects a missing migration file', () => {
  const d = copyArtifact()
  fs.unlinkSync(path.join(d, '003_complete_conveyhub_schema.sql'))
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /missing file 003_complete_conveyhub_schema\.sql/)
})

test('detects an unlisted extra file', () => {
  const d = copyArtifact()
  fs.writeFileSync(path.join(d, '999_sneaky.sql'), 'SELECT 1')
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /unlisted file present: 999_sneaky\.sql/)
})

test('tampered file + rewritten manifest still fails against the approved digest', () => {
  const d = copyArtifact()
  // Attacker edits a migration AND recomputes the copied manifest to match.
  const victim = '001_initial_schema.sql'
  fs.writeFileSync(path.join(d, victim), fs.readFileSync(path.join(d, victim)) + '-- tampered\n')
  const mPath = path.join(d, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(mPath))
  const entry = m.files.find(f => f.file === victim)
  entry.sha256 = createHash('sha256').update(fs.readFileSync(path.join(d, victim))).digest('hex')
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2))

  // Self-referential verify passes — the copy is internally consistent…
  assert.equal(verifyArtifactDir(d).ok, true)
  // …but it is NOT the approved artifact: the pinned manifest digest fails.
  const approved = createHash('sha256').update(
    execFileSync('git', ['show', 'HEAD:src/lib/migrations/manifest.json'], { cwd: repo })).digest('hex')
  const v = verifyArtifactDir(d, { expectedManifestSha256: approved })
  assert.equal(v.ok, false)
  assert.match(v.reason, /manifest digest mismatch/)
})

test('rejects manifest path entries that escape the artifact dir', () => {
  const cases = [
    ['..\\..\\evil.sql', /unsafe manifest path/],
    ['../evil.sql', /unsafe manifest path/],
    ['C:/abs/evil.sql', /unsafe manifest path/],
    ['/abs/evil.sql', /unsafe manifest path/],
    ['sub/dir.sql', /unsafe manifest path/],
  ]
  for (const [name, re] of cases) {
    const d = copyArtifact()
    const mPath = path.join(d, 'manifest.json')
    const m = JSON.parse(fs.readFileSync(mPath))
    m.files.push({ file: name, sha256: '0'.repeat(64) })
    fs.writeFileSync(mPath, JSON.stringify(m, null, 2))
    const v = verifyArtifactDir(d)
    assert.equal(v.ok, false, `${name} should fail`)
    assert.match(v.reason, re)
  }
})

test('rejects duplicate manifest entries', () => {
  const d = copyArtifact()
  const mPath = path.join(d, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(mPath))
  m.files.push({ ...m.files[0] })
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2))
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /duplicate entries/)
})

test('rejects a symlink in place of a migration file', () => {
  const d = copyArtifact()
  const victim = path.join(d, '001_initial_schema.sql')
  const outside = path.join(d, '..', `outside-${Date.now()}`)
  fs.mkdirSync(outside)
  fs.unlinkSync(victim)
  // 'junction' is the unprivileged Windows symlink type; lstat reports it
  // as a symlink and it resolves outside the artifact dir — the verifier
  // must reject it rather than follow it.
  fs.symlinkSync(outside, victim, 'junction')
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /not a regular file: 001_initial_schema\.sql/)
  fs.rmSync(outside, { recursive: true })
})

test('fails on a missing manifest', () => {
  const d = tmp()
  fs.copyFileSync(path.join(realDir, '001_initial_schema.sql'), path.join(d, '001_initial_schema.sql'))
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /manifest\.json missing/)
})

test('fails on a malformed manifest', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'manifest.json'), '{not json')
  const v = verifyArtifactDir(d)
  assert.equal(v.ok, false)
  assert.match(v.reason, /unreadable/)
})

test('recovers exact bytes from a recorded git revision (HEAD)', () => {
  const out = tmp()
  fs.rmdirSync(out) // ensure empty target
  const rev = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()
  const ex = extractRevision(rev, out, repo)
  assert.equal(ex.ok, true, ex.reason)
  const v = verifyArtifactDir(out)
  assert.equal(v.ok, true, v.reason)
  // Byte-for-byte equality with the committed blobs, independent of checkout EOL
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json')))
  for (const f of manifest.files) {
    const blob = execFileSync('git', ['show', `${rev}:src/lib/migrations/${f.file}`],
      { cwd: repo, encoding: 'buffer', maxBuffer: 64 << 20 })
    assert.ok(blob.equals(fs.readFileSync(path.join(out, f.file))), `${f.file} bytes differ`)
  }
  assert.equal(manifest.files.length, 27)
})

test('refuses a non-empty output dir and a bad revision', () => {
  const full = tmp()
  fs.writeFileSync(path.join(full, 'junk.txt'), 'x')
  const ex1 = extractRevision('HEAD', full, repo)
  assert.equal(ex1.ok, false)
  assert.match(ex1.reason, /not empty/)
  const ex2 = extractRevision('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', tmp(), repo)
  assert.equal(ex2.ok, false)
})
