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

function sandbox(sql, env = {}) {
  const queries = []
  const context = vm.createContext({
    createHash, path, fileURLToPath, URL,
    config: () => {},
    fs: { readdirSync: () => [filename], readFileSync: () => sql },
    process: { env, argv: [] },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    resolveDbTls: () => ({ connectionString: null, ssl: false, warnings: [], enableChannelBinding: false }),
    Pool: class {
      constructor() { throw new Error('Checksum tests must not open database connections') }
    },
  })
  vm.runInContext(definitions, context)
  return {
    ...vm.runInContext('({ sha256, loadMigrations, runMigrations, withMigrationLock, runMigration })', context),
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

// --- Advisory-lock serialization (offline; fake client only) ---

function lockClient({ acquired = true, failUnlock = false } = {}) {
  const queries = []
  return {
    queries,
    query: async (sql) => {
      queries.push(sql)
      if (failUnlock && /pg_advisory_unlock/.test(sql)) throw new Error('unlock boom')
      return { rows: [{ acquired }] }
    },
  }
}

const runner = sandbox(lf)

test('a competing runner fails clearly without issuing any other query', async () => {
  const client = lockClient({ acquired: false })
  let ran = false
  await assert.rejects(runner.withMigrationLock(client, async () => { ran = true }), /advisory lock|Another migration runner/)
  assert.equal(ran, false)
  assert.equal(client.queries.length, 1)
  assert.match(client.queries[0], /pg_try_advisory_lock/)
})

test('the lock is acquired before work and released after it', async () => {
  const client = lockClient()
  let sawLock = false
  await runner.withMigrationLock(client, async () => {
    sawLock = /pg_try_advisory_lock/.test(client.queries[0])
    client.query('select 1') // simulate migration work
  })
  assert.ok(sawLock)
  assert.match(client.queries.at(-1), /pg_advisory_unlock/)
})

test('the lock is released when the wrapped work throws', async () => {
  const client = lockClient()
  await assert.rejects(runner.withMigrationLock(client, async () => { throw new Error('mid-run failure') }), /mid-run failure/)
  assert.match(client.queries.at(-1), /pg_advisory_unlock/)
})

test('an unlock failure never masks the run error', async () => {
  const client = lockClient({ failUnlock: true })
  await assert.rejects(
    runner.withMigrationLock(client, async () => { throw new Error('primary failure') }),
    /primary failure/ // not 'unlock boom'
  )
})

test('an unlock failure does not break an otherwise successful run', async () => {
  const client = lockClient({ failUnlock: true })
  const result = await runner.withMigrationLock(client, async () => 'ok')
  assert.equal(result, 'ok')
})

test('a failed unlock flags the client for destruction; helper never releases', async () => {
  const releases = []
  const client = {
    ...lockClient({ failUnlock: true }),
    release: (err) => releases.push(err ?? null),
  }
  await runner.withMigrationLock(client, async () => 'ok')
  // The helper does NOT own the client: it flags it, releases nothing.
  assert.equal(client.__migrationLockDestroy?.message, 'unlock boom')
  assert.equal(releases.length, 0)
})

// --- Connection guard: malformed / pooler / direct ---

// The guard runs at module eval (before Pool can be constructed), so a
// rejected config throws from sandbox() itself — zero connection attempts.
for (const [name, env, pattern] of [
  ['pooler DSN', { POSTGRES_URL: 'postgresql://u:p@ep-x-pooler.c-12.us-east-1.aws.neon.tech/db?sslmode=require' }, /transaction-pooler/],
  ['pooler DB_HOST', { DB_HOST: 'db.project.pooler.supabase.com' }, /transaction-pooler/],
  ['malformed DSN', { POSTGRES_URL: 'not-a-url' }, /not a valid URL/],
  ['unsupported scheme', { POSTGRES_URL: 'https://db.example.com/x' }, /Unsupported migration connection scheme 'https:'/],
]) {
  test(`${name} is rejected before any connection or write`, () => {
    assert.throws(() => sandbox(lf, env), pattern)
  })
}

test('rejection errors never carry credentials', () => {
  const secret = 's3cr3t-p@ssw0rd'
  for (const dsn of [
    `postgresql://user:${secret}@ep-x-pooler.c-12.us-east-1.aws.neon.tech/db`,
    `postgres://user:${secret}@[bad`,
  ]) {
    try {
      sandbox(lf, { POSTGRES_URL: dsn })
      assert.fail('should have thrown')
    } catch (e) {
      assert.ok(!e.message.includes(secret), `error leaked credentials: ${e.message}`)
    }
  }
})

test('a direct endpoint passes the guard', async () => {
  const r = sandbox(lf, { POSTGRES_URL: 'postgresql://u:p@ep-x.c-12.us-east-1.aws.neon.tech/db' })
  // Reaches the Pool stub — i.e. past the guard — proving direct hosts pass.
  await assert.rejects(r.runMigration(), /must not open database connections/)
})

// --- Full runMigration exit-path tests (working fake pool) ---

function runSandbox(env, { failWork = false, failUnlock = false } = {}) {
  const queries = [], releases = [], pools = []
  const client = {
    query: async (sql) => {
      queries.push(sql)
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ acquired: true }] }
      if (/pg_advisory_unlock/.test(sql)) {
        if (failUnlock) throw new Error('unlock boom')
        return { rows: [] }
      }
      if (failWork && /RANDOM\(\)/.test(sql)) throw new Error('mid-run failure')
      return { rows: [] }
    },
    release: (err) => releases.push(err ?? null),
  }
  const pool = { connect: async () => client, ends: 0, end: async function () { this.ends++ } }
  const context = vm.createContext({
    createHash, path, fileURLToPath, URL,
    config: () => {},
    fs: { readdirSync: () => [filename], readFileSync: () => lf },
    process: { env, argv: [] },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    resolveDbTls: () => ({ connectionString: null, ssl: false, warnings: [], enableChannelBinding: false }),
    Pool: class { constructor() { pools.push(this); return pool } },
  })
  vm.runInContext(definitions, context)
  return { runMigration: vm.runInContext('runMigration', context), queries, releases, pools, pool, client }
}

const DIRECT_ENV = { POSTGRES_URL: 'postgresql://u:p@ep-x.c-12.us-east-1.aws.neon.tech/db' }

test('successful run: lock first, unlock last, release once, pool ended once', async () => {
  const r = runSandbox(DIRECT_ENV)
  await r.runMigration()
  assert.match(r.queries[0], /pg_try_advisory_lock/)
  assert.match(r.queries.at(-1), /pg_advisory_unlock/)
  assert.equal(r.releases.length, 1)
  assert.equal(r.releases[0], null) // returned to pool, not destroyed
  assert.equal(r.pool.ends, 1)
})

test('mid-run failure: unlock still attempted, exactly one release, pool ended', async () => {
  const r = runSandbox(DIRECT_ENV, { failWork: true })
  await assert.rejects(r.runMigration(), /mid-run failure/)
  assert.ok(r.queries.some(q => /pg_advisory_unlock/.test(q)))
  assert.equal(r.releases.length, 1)
  assert.equal(r.pool.ends, 1)
})

test('work + unlock failure: original error preserved, release(err) exactly once', async () => {
  const r = runSandbox(DIRECT_ENV, { failWork: true, failUnlock: true })
  await assert.rejects(r.runMigration(), /mid-run failure/) // not 'unlock boom'
  assert.equal(r.releases.length, 1)
  assert.equal(r.releases[0].message, 'unlock boom') // destroyed, not pooled
  assert.equal(r.pool.ends, 1)
})
