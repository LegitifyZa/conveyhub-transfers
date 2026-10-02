# M1 verification evidence — disposable PostgreSQL run

Recorded after the `deedly_m1_verify_lf` run. Companion to
`deedly-m1-migration-preflight.md`. This document records executed
verification only; it certifies nothing beyond the disposable target.

## Revision under test

- Integration merge `417c7f522bbb0f00c7d6e8a7706e3b44e9a34b6c`
  (`main@20c8fbe` + `m1/tls-hardening@ec00411` + `m1/migration-preflight@a904463`),
  exercised in a detached worktree `D:\WORK\Legitify\Projects\_m1-integration`.
- Tree identity: `417c7f5^{tree} == 3755c6d4ea72f5a0411d7cb75725418722cc2a60
  == origin/main@07f5045^{tree}` — the tested tree is byte-identical to
  merged main after PRs #9 and #10 landed. The evidence applies to merged
  main exactly; no equivalence is assumed.

## PR status correction

Earlier reports stated both PRs remained draft. Corrected: **PR #9
(migration preflight) and PR #10 (TLS hardening) are merged** into main —
merge commits `0f27416` and `07f5045`. No further M1 branches are pending.

## Target

- Neon project `ep-red-term-awh8wnfa-pooler.c-12.us-east-1.aws.neon.tech`,
  PostgreSQL 17.11.
- New disposable database `deedly_m1_verify_lf` — created empty for this
  run (the only object created).
- `deedly_m1_verify` preserved untouched: its ledger holds CRLF digests
  from the pre-`.gitattributes` apply — retained as EOL-hazard evidence.

## Commands and results

| Step | Command / check | Result |
|---|---|---|
| Target probe | `SELECT datname FROM pg_database` (via `neondb` admin conn, `sslmode=require`) | `deedly_m1_verify_lf` absent; host and version confirmed |
| Tree/manifest | `git status` clean at `417c7f5`; `node scripts/migration-manifest.mjs --check` | PASS — manifest matches migration bytes |
| Create | `CREATE DATABASE deedly_m1_verify_lf` | Empty container only |
| Empty-target preflight | `node scripts/migrate-preflight.mjs --expect-host=… --expect-database=deedly_m1_verify_lf --expect-environment=disposable` | PASS — `fresh: true`, 27 pending, read-only session enforced |
| Apply | `node scripts/migrate.mjs` | 27/27 applied, in order, zero failures |
| Post-apply preflight | same preflight command | PASS — 27 applied, 0 pending, 0 violations |
| Canonical digests | ledger rows vs `manifest.json` | 27/27 match canonical LF digests |
| Contract tests | `python -m unittest tests.test_transfer_list_db` with `TEST_DATABASE_URL=…deedly_m1_verify_lf?sslmode=require` | 8/8 pass |
| Cleanup | `SELECT count(*) … transfer_id LIKE 'M1V-%'` | 0 residual rows |

## Effective TLS configuration

- `sslmode=require` only — `pg` 8.20 maps it to full verification
  (`rejectUnauthorized: true`, system trust roots, hostname check).
- Observed: `authorized: true`, TLS 1.3, `TLS_AES_256_GCM_SHA384`,
  peer SAN `*.c-12.us-east-1.aws.neon.tech`.
- **No channel binding** configured or claimed: `channel_binding=require`
  is rejected by the resolver (pg cannot strictly enforce PLUS) and
  asyncpg 0.31 cannot negotiate it. `prefer` was not used.

## Merged-tree test totals at the tested revision

- Node: 47/47 (`migrate.test` 6, `migrate-preflight.test` 14,
  `migration-manifest.test` 3, `db-tls.test` 15, `db-tls-fixture.test` 9),
  0 skipped.
- Python: 18/18 (`test_db_ssl_context`, `test_db_tls_fixture`).
- CI on both merged PR heads: green — runs 36972849172 (TLS hardening:
  checksum 6/6, DB TLS 24/24, Python 18/18) and 36972841071 (preflight
  script suite 39/39).

## Outstanding M1 items

- Backup/restore rehearsal (doc §5 prerequisites written; not exercised).
- Immutable-artifact recovery procedure.
- **Deployment-lock serialization** — proposed next slice.
- asyncpg channel-binding decision (driver change or documented risk
  acceptance) if binding is required on the Python path.
