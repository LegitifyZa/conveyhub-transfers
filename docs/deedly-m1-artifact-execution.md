# M1 exact-artifact execution — recovered-artifact input and clean-install plan

Companion to `deedly-m1-artifact-recovery.md`. Covers **executing** a
recovered migration artifact — the remaining "exact-artifact clean
install and repeat-run tests" leg of the M1 exit — rather than
re-applying the working tree.

## Artifact input (implemented)

`migrate.mjs` and `migrate-preflight.mjs` accept:

```powershell
--migrations-dir=<dir> --expect-manifest-sha256=<approved-digest>
```

- Both flags are **required together**; either alone refuses.
- Both entry points verify the **same** complete artifact
  (`verifyArtifactDir`): missing, altered, extra, unsafe-path, duplicate,
  symlink and incomplete-recovery cases all fail, and the manifest's
  sha256 must equal the independently recorded expected digest.
  **Internal consistency alone is never accepted for execution.**
- Verification runs **before any pool or connection is created** —
  including before `createDatabaseIfNeeded` — so an invalid artifact
  means zero database connections through either entry point.
- The executed SQL and the ledger checksum both derive from the same
  verified in-memory bytes: `loadVerifiedArtifact` returns the exact
  buffers it hashed, the runner sends those bytes and inserts their
  manifest digest into the ledger. There is no fallback to working-tree
  SQL when `--migrations-dir` is set (`artifactFiles ?? loadMigrations()`
  — the artifact path never re-reads `src/lib/migrations`).
- Repeat runs only `INSERT` new ledger rows and skip checksum-matching
  rows — the entire ledger, including `applied_at`, is preserved.
  (`--baseline-through`, which rewrites ledger rows, is not part of this
  procedure.)
- All existing safeguards are unchanged: TLS resolution, DSN/pooler
  rejection, target expectations, the session advisory lock,
  checksum-mismatch refusal, no ledger rewrites.

## Provenance — three separately recorded values

| Value | Concrete value for this rehearsal |
|---|---|
| **Approved source revision** | `2e8192874c3088b838f99697feaee10b2a93df02` (merged `main` carrying the approved 27-file manifest) |
| **Expected manifest digest** | `596bca2a95647f0283572d6c788047ffe3c75e94805b2fa85d6b32a8bb42d854` — sha256 of the `manifest.json` **git blob** at the approved revision |
| **Runner revision** | recorded at execution: `git rev-parse HEAD` on the branch containing this procedure |

**Warning:** do NOT hash the working-tree `manifest.json` — a CRLF
checkout yields a different digest (`f81789f5…` on this machine). The
expected digest is over the committed blob bytes; recovery via
`git show` produces exactly those bytes.

## Bounded clean-install/repeat-run procedure (PowerShell — not executed)

Target: **`deedly_m1_artifact_verify`** (new disposable DB) on the
approved direct Neon host `ep-red-term-awh8wnfa.c-12.us-east-1.aws.neon.tech`,
`sslmode=verify-full` with the probed PEM CA bundle, pgpass/secure-string
credentials, `finally` cleanup — identical credential discipline to the
§5 rehearsal. **Requires `CREATE DATABASE` approval.**

```powershell
# --- provenance (three values, recorded in the run log) ---
$ApprovedSha = '2e8192874c3088b838f99697feaee10b2a93df02'
$ExpectedDigest = '596bca2a95647f0283572d6c788047ffe3c75e94805b2fa85d6b32a8bb42d854'
$RunnerSha = git rev-parse HEAD   # runner revision at execution time
$Art = "$env:TEMP\m1ex-artifact"

# --- 1. recover the artifact (byte-verified against the pinned digest) ---
node scripts/migration-recover.mjs --revision=$ApprovedSha `
  --output=$Art --expect-manifest-sha256=$ExpectedDigest

# --- 2. fresh disposable target ---
Invoke-Psql -d neondb "SELECT datname FROM pg_database
  WHERE datname='deedly_m1_artifact_verify'"   # must be absent — else STOP
Invoke-Psql -d neondb "CREATE DATABASE deedly_m1_artifact_verify"

# --- 3. preflight against the ARTIFACT (all flags required) ---
$env:DB_NAME = 'deedly_m1_artifact_verify'    # + DB_HOST/DB_USER/DB_PASSWORD, PGSSLMODE=verify-full
node scripts/migrate-preflight.mjs `
  --expect-host=ep-red-term-awh8wnfa.c-12.us-east-1.aws.neon.tech `
  --expect-database=deedly_m1_artifact_verify --expect-environment=disposable `
  --migrations-dir=$Art --expect-manifest-sha256=$ExpectedDigest
#   → PASS, fresh, 27 pending

# --- 4. exact-artifact clean install ---
node scripts/migrate.mjs --migrations-dir=$Art `
  --expect-manifest-sha256=$ExpectedDigest     # → 27/27 applied

# --- 5. seed synthetic fixtures (marker M1EX-) ---
Invoke-Psql -d deedly_m1_artifact_verify -f seed.sql   # marked rows only

# --- 6. snapshot ledger + state (before repeat run) ---
Invoke-Psql -d deedly_m1_artifact_verify `
  "COPY (SELECT filename, checksum, applied_at
         FROM transfers_schema_migrations ORDER BY filename)
   TO STDOUT CSV" > $RunLog\ledger-before.csv

# --- 7. repeat run on the same target ---
node scripts/migrate.mjs --migrations-dir=$Art `
  --expect-manifest-sha256=$ExpectedDigest     # → 27 skipped, 0 applied

# --- 8. verification — eight checks ---
#   a. schema-only pg_dump of the new DB matches the canonical artifact's
#      schema (same normalization/allowlist rules as the §5 rehearsal)
#   b. constraint catalog parity (pg_get_constraintdef)
#   c. index catalog parity (pg_get_indexdef)
#   d. extension name+version parity (plpgsql, uuid-ossp)
#   e. seeded M1EX- fixture row counts + content hashes unchanged by
#      the repeat run
#   f. FULL ledger comparison before vs after the repeat run —
#      filename + checksum + applied_at deep-equal (not just row count)
#   g. post-apply preflight PASS (27 applied / 0 pending) using the same
#      --migrations-dir/--expect-manifest-sha256 flags
#   h. advisory-lock path exercised: both migrate runs acquired and
#      released the 'deedly-migration-runner' lock

# --- 9. fixture cleanup ---
Invoke-Psql -d deedly_m1_artifact_verify -f cleanup.sql   # marker-scoped deletes
Invoke-Psql -d deedly_m1_artifact_verify `
  "SELECT count(*) FROM transfers.transfers t JOIN ... WHERE marker LIKE 'M1EX-%'"
#   → 0 residual
```

**Pass criteria:** all eight checks pass; ledger checksums equal the
manifest digests for all 27 rows; `applied_at` set preserved verbatim
across the repeat run.

**Stop conditions:** any verification failure, unexpected target state,
or missing `CREATE DATABASE` approval — stop; no drop/recreate, no
retries that recreate databases.

## Execution evidence — run on 2026-10-02 (runner `abddf15`, report committed as `153eb1f`)

Artifact recovered from approved revision `2e81928` into
`%TEMP%\m1ex-artifact` — 27 files, all sha256 verified, manifest digest
`596bca2a…c854` matched the pinned value.

| Step | Result |
|---|---|
| Create `deedly_m1_artifact_verify` | OK (absent beforehand; 4 evidence DBs untouched) |
| Preflight vs artifact (fresh) | PASS — 27 pending, read-only session |
| Clean install (`--migrations-dir`) | 27/27 applied, verified-bytes banner printed |
| Repeat run | **0 applied, 27 skipped** |
| a. schema vs `deedly_m1_verify_lf` | **identical** (reference = previously validated canonical-LF DB) |
| b. constraints / c. indexes / d. extensions | identical / identical / identical (`plpgsql 1.0`, `uuid-ossp 1.1`) |
| e. M1EX- fixtures across repeat run | counts + hash unchanged |
| f. ledger deep-equal incl. `applied_at` | identical before/after; all 27 digests = manifest |
| g. post-apply preflight | PASS — 27 applied / 0 pending |
| h. advisory lock | `pg_try_advisory_lock` → `t` after both runs — the probe **acquired** the free lock in its own `psql` session, which closed on exit (releasing it). A second session's explicit `pg_advisory_unlock` warned "you don't own a lock" — benign, since it owned none |
| `test_transfer_list_db.py` | **8 tests, OK** (82.9s; M1V- fixtures self-clean) |
| Fixture cleanup | 3 transfers + 1 doc row deleted, 0 residual |

**Credential handling:** password entered via `Read-Host -AsSecureString`
into ACL-protected `%TEMP%\m1ex_pgpass.conf` (protected, owner-only —
independently re-verified via `Get-Acl` before each use), deleted by the
shell's exit trap on every run. `PGPASSFILE`/`DB_PASSWORD`/DSN env vars
scoped per-run.

**Deviations recorded:**

1. An early probe shell's exit trap deleted the pgpass before the main
   run — credential entry was repeated (no DB impact).
2. A `grep "Running "` false positive stopped the first script after the
   repeat run — corrected to match per-file applies; the repeat run had
   applied 0. Verification continued in a second credentialed shell.
3. Operator supplied a `-pooler`/`sslmode=require` DSN in chat — not
   used. The run used the approved direct host with `verify-full` + PEM
   CA. **The pasted password should be rotated.**
4. The ledger↔manifest node check needed a `C:/` path (MSYS `/c/` form
   fails in Node); rerun in the continuation shell, passed 27/0-mismatch.

Run log, dumps, ledger TSVs, preflight JSONs and pytest output preserved
at `C:\Users\Dean\m1ex-run\`.

## What remains outside this slice

- Executing the plan (needs `CREATE DATABASE` approval).
- External document/blob recovery (M0-operational/M7), provider
  integrations, deploy-lock coordination, secrets delivery.
- `deedly_m1_verify`, `deedly_m1_verify_lf`, `deedly_m1_backup_src`,
  `deedly_m1_restore_verify` remain preserved evidence — untouched.
