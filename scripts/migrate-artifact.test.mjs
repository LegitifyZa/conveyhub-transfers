// Offline regressions for exact-artifact execution (--migrations-dir +
// --expect-manifest-sha256) on migrate.mjs and migrate-preflight.mjs.
// All verification must happen before any database connection; every
// invalid-artifact case asserts the Pool stub was never constructed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { loadVerifiedArtifact, verifyArtifactDir } from './migration-recover.mjs'
import { parseExpectations, resolveMigrationSource } from './migrate-preflight.mjs'

const runnerUrl = new URL('./migrate.mjs', import.meta.url)
const source = fs.readFileSync(runnerUrl, 'utf8')
const entry = source.lastIndexOf('\nrunMigration().then(')
assert.ok(entry > 0, 'Migration runner entrypoint must be isolated from the test sandbox')
const definitions = source.slice(0, entry)
  .replace(/^import .*\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(runnerUrl.href))

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const realDir = path.join(repo, 'src/lib/migrations')
const manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'manifest.json'), 'utf8'))
const approvedDigest = createHash('sha256')
  .update(fs.readFileSync(path.join(realDir, 'manifest.json'))).digest('hex')

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'm1ex-artifact-')) }

function copyArtifact() {
  const d = tmp()
  for (const f of fs.readdirSync(realDir).filter(n => n.endsWith('.sql') || n === 'manifest.json'))
    fs.copyFileSync(path.join(realDir, f), path.join(d, f))
  return d
}

// migrate.mjs sandbox with REAL fs/recovery imports and a Pool stub that
// counts constructions — the zero-connection proof.
function runnerSandbox(argv = []) {
  const pools = []
  const queries = []
  const client = {
    query: async (sql, params) => {
      queries.push([sql, params])
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ acquired: true }] }
      return { rows: [] }
    },
    release: () => {},
  }
  const pool = { connect: async () => client, end: async () => {} }
  const context = vm.createContext({
    createHash, path, fileURLToPath, URL, fs,
    config: () => {},
    verifyArtifactDir, loadVerifiedArtifact,
    process: { env: { POSTGRES_URL: 'postgresql://u:p@ep-x.c-12.us-east-1.aws.neon.tech/db' }, argv: ['node', 'migrate.mjs', ...argv] },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    resolveDbTls: () => ({ connectionString: null, ssl: false, warnings: [], enableChannelBinding: false }),
    Pool: class { constructor() { pools.push(this); return pool } },
  })
  vm.runInContext(definitions, context)
  return {
    ...vm.runInContext('({ runMigration, runMigrations, resolveArtifactInput, parseArgs })', context),
    pools, queries,
  }
}

const DIR_FLAGS = d => [`--migrations-dir=${d}`, `--expect-manifest-sha256=${approvedDigest}`]

test('valid artifact: verifies, connects once, executes the verified bytes', async () => {
  const d = copyArtifact()
  const r = runnerSandbox(DIR_FLAGS(d))
  await r.runMigration()
  assert.equal(r.pools.length, 1) // pool created only after verification passed
  assert.match(r.queries[0][0], /pg_try_advisory_lock/)
  // Every executed migration body equals the on-disk verified bytes
  for (const f of manifest.files) {
    const bytes = fs.readFileSync(path.join(d, f.file), 'utf8')
    assert.ok(r.queries.some(q => q[0] === bytes), `${f.file} was not executed as its verified bytes`)
  }
  // Ledger inserts carry the manifest digests
  const inserts = r.queries.filter(q => /INSERT INTO public\.transfers_schema_migrations/.test(q[0]))
  assert.equal(inserts.length, manifest.files.length)
  for (const [, params] of inserts) {
    const expected = manifest.files.find(f => f.file === params[0]).sha256
    assert.equal(params[1], expected)
  }
})

test('tampered file: rejects before any connection', async () => {
  const d = copyArtifact()
  const victim = path.join(d, '001_initial_schema.sql')
  fs.writeFileSync(victim, fs.readFileSync(victim) + '-- tampered\n')
  const r = runnerSandbox(DIR_FLAGS(d))
  await assert.rejects(r.runMigration(), /checksum mismatch in 001_initial_schema\.sql/)
  assert.equal(r.pools.length, 0) // zero connections
})

test('missing file: rejects before any connection', async () => {
  const d = copyArtifact()
  fs.unlinkSync(path.join(d, '003_complete_conveyhub_schema.sql'))
  const r = runnerSandbox(DIR_FLAGS(d))
  await assert.rejects(r.runMigration(), /missing file 003_complete_conveyhub_schema\.sql/)
  assert.equal(r.pools.length, 0)
})

test('extra unlisted file: rejects before any connection', async () => {
  const d = copyArtifact()
  fs.writeFileSync(path.join(d, '999_extra.sql'), 'SELECT 1')
  const r = runnerSandbox(DIR_FLAGS(d))
  await assert.rejects(r.runMigration(), /unlisted file/)
  assert.equal(r.pools.length, 0)
})

test('rewritten manifest over a tampered file: pinned digest rejects it', async () => {
  const d = copyArtifact()
  const victim = '001_initial_schema.sql'
  fs.writeFileSync(path.join(d, victim), fs.readFileSync(path.join(d, victim)) + '-- tampered\n')
  const mPath = path.join(d, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(mPath))
  m.files.find(f => f.file === victim).sha256 =
    createHash('sha256').update(fs.readFileSync(path.join(d, victim))).digest('hex')
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2))
  // Internally consistent — self-verify alone would pass:
  assert.equal(verifyArtifactDir(d).ok, true)
  // …but the pinned approved digest does not match:
  const r = runnerSandbox(DIR_FLAGS(d))
  await assert.rejects(r.runMigration(), /manifest digest mismatch/)
  assert.equal(r.pools.length, 0)
})

test('incomplete recovery dir (.recovery-incomplete marker): rejects', async () => {
  const d = copyArtifact()
  fs.writeFileSync(path.join(d, '.recovery-incomplete'), 'incomplete recovery — do not use\n')
  const r = runnerSandbox(DIR_FLAGS(d))
  await assert.rejects(r.runMigration(), /unlisted file present: \.recovery-incomplete/)
  assert.equal(r.pools.length, 0)
})

test('unsafe manifest path entry: rejects before any connection', async () => {
  const d = copyArtifact()
  const mPath = path.join(d, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(mPath))
  m.files.push({ file: '../../evil.sql', sha256: '0'.repeat(64) })
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2))
  // Pin to the edited manifest's own digest so path validation is reached.
  const editedDigest = createHash('sha256').update(fs.readFileSync(mPath)).digest('hex')
  const r = runnerSandbox([`--migrations-dir=${d}`, `--expect-manifest-sha256=${editedDigest}`])
  await assert.rejects(r.runMigration(), /unsafe manifest path/)
  assert.equal(r.pools.length, 0)
})

test('--migrations-dir without --expect-manifest-sha256: refused, zero connections', async () => {
  const d = copyArtifact()
  const r = runnerSandbox([`--migrations-dir=${d}`])
  await assert.rejects(r.runMigration(), /requires --expect-manifest-sha256/)
  assert.equal(r.pools.length, 0)
})

test('--expect-manifest-sha256 without --migrations-dir: refused, zero connections', async () => {
  const r = runnerSandbox([`--expect-manifest-sha256=${approvedDigest}`])
  await assert.rejects(r.runMigration(), /requires --migrations-dir/)
  assert.equal(r.pools.length, 0)
})

test('wrong expected digest: refused, zero connections', async () => {
  const d = copyArtifact()
  const r = runnerSandbox([`--migrations-dir=${d}`, `--expect-manifest-sha256=${'1'.repeat(64)}`])
  await assert.rejects(r.runMigration(), /manifest digest mismatch/)
  assert.equal(r.pools.length, 0)
})

test('verification-to-execution: a post-verify file change cannot substitute SQL', async () => {
  const d = copyArtifact()
  const victim = manifest.files[0].file
  const originalBytes = fs.readFileSync(path.join(d, victim))
  // Resolve (verify + load bytes) first, then tamper the file on disk.
  const files = loadVerifiedArtifact(d, approvedDigest).files
    .map(f => ({ file: f.file, sql: f.bytes.toString('utf8'), checksum: f.checksum }))
  fs.writeFileSync(path.join(d, victim), 'SELECT evil()')
  const queries = []
  const client = { query: async (sql, params) => { queries.push([sql, params]); return { rows: [] } } }
  const r = runnerSandbox(DIR_FLAGS(d))
  await r.runMigrations(client, files, new Map())
  const applied = queries.find(q => q[0] === originalBytes.toString('utf8'))
  assert.ok(applied, 'executed SQL must be the verified bytes, not the tampered disk content')
  assert.ok(!queries.some(q => q[0] === 'SELECT evil()'))
  const insert = queries.find(q => /INSERT INTO public\.transfers_schema_migrations/.test(q[0]))
  assert.equal(insert[1][1], manifest.files[0].sha256)
})

// --- Preflight side ---

test('preflight flags: migrations-dir and digest must be paired', () => {
  const base = ['--expect-host=h', '--expect-database=d', '--expect-environment=disposable']
  assert.throws(() => parseExpectations([...base, '--migrations-dir=/x']), /requires --expect-manifest-sha256/)
  assert.throws(() => parseExpectations([...base, `--expect-manifest-sha256=${approvedDigest}`]), /requires --migrations-dir/)
  const ok = parseExpectations([...base, ...DIR_FLAGS('/x')])
  assert.equal(ok.migrationsDir, '/x')
  assert.equal(ok.expectedManifestSha256, approvedDigest)
})

test('preflight source: verified artifact supplies manifest digests', () => {
  const d = copyArtifact()
  const { files, artifact } = resolveMigrationSource({
    migrationsDir: d, expectedManifestSha256: approvedDigest,
  })
  assert.equal(files.length, manifest.files.length)
  assert.equal(artifact.manifestSha256, approvedDigest)
  for (const f of files)
    assert.equal(f.checksum, manifest.files.find(m => m.file === f.file).sha256)
})

test('preflight source: invalid artifact throws before any client exists', () => {
  const d = copyArtifact()
  fs.writeFileSync(path.join(d, '001_initial_schema.sql'), 'SELECT evil()')
  assert.throws(
    () => resolveMigrationSource({ migrationsDir: d, expectedManifestSha256: approvedDigest }),
    /checksum mismatch/,
  )
  // resolveMigrationSource is pure fs — no client/pool is ever constructed.
})

test('preflight source: no dir falls back to the working-tree artifact', () => {
  const { files, artifact } = resolveMigrationSource({})
  assert.equal(artifact, null)
  assert.equal(files.length, 27)
})
