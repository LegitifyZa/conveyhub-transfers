import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const runnerUrl = new URL('./migrate.mjs', import.meta.url)
const source = fs.readFileSync(runnerUrl, 'utf8')
const entry = source.lastIndexOf('\nrunMigration().then(')
assert.ok(entry > 0, 'Migration runner entrypoint must be isolated from the test sandbox')
const definitions = source.slice(0, entry)
  .replace(/^import .*\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(runnerUrl.href))
const filename = '029_deedly_generate_transfer_id_ambiguity_fix.sql'
const lf = fs.readFileSync(new URL('../src/lib/migrations/' + filename, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const crlf = lf.replaceAll('\n', '\r\n')

function sandbox(sql) {
  const queries = []
  const context = vm.createContext({
    createHash, path, fileURLToPath,
    config: () => {},
    fs: { readdirSync: () => [filename], readFileSync: () => sql },
    process: { env: {}, argv: [] },
    console: { log: () => {}, error: () => {} },
    Pool: class {
      constructor() { throw new Error('Checksum tests must not open database connections') }
    },
  })
  vm.runInContext(definitions, context)
  return {
    ...vm.runInContext('({ sha256, loadMigrations, runMigrations })', context),
    client: { query: async (...args) => { queries.push(args); return { rows: [] } } },
    queries,
  }
}

const applied = checksum => new Map([[filename, { checksum, applied_at: new Date('2026-09-23T00:00:00Z') }]])

test('migration loading hashes original bytes; LF and CRLF differ', async () => {
  const unix = sandbox(lf)
  const windows = sandbox(crlf)
  const [a] = await unix.loadMigrations()
  const [b] = await windows.loadMigrations()
  assert.equal(a.sql, lf)
  assert.equal(b.sql, crlf)
  assert.equal(a.checksum, createHash('sha256').update(lf, 'utf8').digest('hex'))
  assert.equal(b.checksum, createHash('sha256').update(crlf, 'utf8').digest('hex'))
  assert.notEqual(a.checksum, b.checksum)
})

test('identical applied artifacts are skipped without any ledger rewrite', async () => {
  for (const sql of [lf, crlf]) {
    const runner = sandbox(sql)
    const ledger = applied(runner.sha256(sql))
    const original = ledger.get(filename)
    await runner.runMigrations(runner.client, await runner.loadMigrations(), ledger)
    assert.equal(runner.queries.length, 0)
    assert.equal(ledger.get(filename), original)
  }
})

for (const [name, recorded, checkout] of [['LF to CRLF', lf, crlf], ['CRLF to LF', crlf, lf]]) {
  test(name + ' is rejected without running SQL or rewriting history', async () => {
    const runner = sandbox(checkout)
    const ledger = applied(runner.sha256(recorded))
    await assert.rejects(runner.runMigrations(runner.client, await runner.loadMigrations(), ledger), /Checksum mismatch/)
    assert.equal(runner.queries.length, 0)
    assert.equal(ledger.get(filename).checksum, runner.sha256(recorded))
  })
}

test('a substantive SQL change remains a hard checksum failure', async () => {
  const runner = sandbox(lf.replace('RANDOM() * 1000', 'RANDOM() * 100'))
  await assert.rejects(runner.runMigrations(runner.client, await runner.loadMigrations(), applied(runner.sha256(lf))), /Checksum mismatch/)
  assert.equal(runner.queries.length, 0)
})

test('a new migration records its raw checksum only after SQL execution', async () => {
  const runner = sandbox(lf)
  await runner.runMigrations(runner.client, await runner.loadMigrations(), new Map())
  assert.equal(runner.queries.length, 2)
  assert.equal(runner.queries[0][0], lf)
  assert.match(runner.queries[1][0], /INSERT INTO public\.transfers_schema_migrations/)
  assert.equal(runner.queries[1][1][0], filename)
  assert.equal(runner.queries[1][1][1], runner.sha256(lf))
  assert.doesNotMatch(runner.queries[1][0], /UPDATE|ON CONFLICT/)
})
