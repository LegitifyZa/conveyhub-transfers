// Opt-in real-PostgreSQL tests for migration-runner serialization.
// Requires TEST_DATABASE_URL pointing at a disposable database via a
// DIRECT endpoint — session-level advisory locks do not serialize
// through transaction-mode poolers (Neon '-pooler' hosts), which is
// exactly what these tests assert against.
// The suite never writes: contention and release are proven with lock
// probes and pg_backend_pid/pg_terminate_backend on the lock-holding
// session only. Skipped entirely when TEST_DATABASE_URL is unset.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { resolveDbTls } from './db-tls.mjs'

const DSN = process.env.TEST_DATABASE_URL
const require_ = createRequire(import.meta.url)
const havePg = (() => { try { require_('pg'); return true } catch { return false } })()

// Eval migrate.mjs definitions in a vm sandbox (same technique as
// migrate.test.mjs) so the script's entrypoint never runs and no pool is
// opened by the module itself.
const runnerUrl = new URL('./migrate.mjs', import.meta.url)
const source = fs.readFileSync(runnerUrl, 'utf8')
const definitions = source
  .slice(0, source.lastIndexOf('\nrunMigration().then('))
  .replace(/^import .*\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(runnerUrl.href))

async function makeRunner() {
  const { Client } = require_('pg')
  const tls = resolveDbTls(DSN, {})
  const client = new Client({ connectionString: tls.connectionString, ssl: tls.ssl })
  await client.connect()
  const context = vm.createContext({
    require: require_, fs, console,
    process: { env: {}, argv: [] },
    path: { join: (...a) => a.join('/'), dirname: (p) => p },
    createHash: require_('node:crypto').createHash,
    fileURLToPath: require_('node:url').fileURLToPath,
    Pool: class { constructor() { throw new Error('no pools in lock tests') } },
    config: () => {},
    resolveDbTls: () => ({ connectionString: null, ssl: false, warnings: [], enableChannelBinding: false }),
  })
  vm.runInContext(definitions, context)
  const { withMigrationLock } = vm.runInContext('({ withMigrationLock })', context)
  return { client, withMigrationLock }
}

// pg_try_advisory_lock ACQUIRES on success — release immediately so the
// probe itself leaves no lock behind.
const lockFree = async (client) => {
  const { rows: [{ a }] } = await client.query(
    "SELECT pg_try_advisory_lock(hashtext('deedly-migration-runner')) AS a")
  if (a) await client.query("SELECT pg_advisory_unlock(hashtext('deedly-migration-runner'))")
  return a
}

test('migration advisory lock: contention, release, crash-release', { skip: !DSN && 'TEST_DATABASE_URL unset' }, async (t) => {
  assert.ok(havePg, 'pg must be installed')

  await t.test('a competing runner fails without touching schema or ledger', async () => {
    const holder = await makeRunner()
    const challenger = await makeRunner()
    try {
      const ledgerBefore = (await challenger.client.query(
        'SELECT count(*)::int c FROM public.transfers_schema_migrations')).rows[0].c
      let ran = false, heldDuring = null
      // Probe while the holder is still inside withMigrationLock.
      await holder.withMigrationLock(holder.client, async () => {
        await assert.rejects(
          challenger.withMigrationLock(challenger.client, async () => { ran = true }),
          /Another migration runner holds/)
        heldDuring = await lockFree(challenger.client)
      })
      assert.equal(ran, false)
      assert.equal(heldDuring, false) // still held by holder during the callback
      assert.equal(await lockFree(challenger.client), true) // free after release
      const ledgerAfter = (await challenger.client.query(
        'SELECT count(*)::int c FROM public.transfers_schema_migrations')).rows[0].c
      assert.equal(ledgerAfter, ledgerBefore) // no ledger change
    } finally {
      await holder.client.end(); await challenger.client.end()
    }
  })

  await t.test('success and handled failure both release the lock', async () => {
    const a = await makeRunner(); const probe = await makeRunner()
    try {
      await a.withMigrationLock(a.client, async () => 'done')
      assert.equal(await lockFree(probe.client), true)
      await assert.rejects(a.withMigrationLock(a.client, async () => { throw new Error('handled') }), /handled/)
      assert.equal(await lockFree(probe.client), true)
    } finally {
      await a.client.end(); await probe.client.end()
    }
  })

  await t.test('a terminated holder session releases the lock (crash path)', async () => {
    const victim = await makeRunner(); const killer = await makeRunner(); const probe = await makeRunner()
    victim.client.on('error', () => {}) // expected: we terminate this session below
    try {
      const { rows: [{ pg_backend_pid: pid }] } = await victim.client.query('SELECT pg_backend_pid()')
      let released = false
      await victim.withMigrationLock(victim.client, async () => {
        // Terminate ONLY this lock-holding session while it holds the lock.
        const { rows: [r] } = await killer.client.query('SELECT pg_terminate_backend($1) AS ok', [pid])
        assert.equal(r.ok, true)
        for (let i = 0; i < 50 && !released; i++) {
          await new Promise(r2 => setTimeout(r2, 200))
          released = await lockFree(probe.client)
        }
      }).catch(() => {}) // the victim's own connection dies mid-callback
      assert.equal(released, true, 'lock must be free after the holder session dies')
    } finally {
      await victim.client.end().catch(() => {}); await killer.client.end(); await probe.client.end()
    }
  })
})
