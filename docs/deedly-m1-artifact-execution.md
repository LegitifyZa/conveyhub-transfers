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
- The directory is fully verified (`verifyArtifactDir` — missing,
  altered, extra, unsafe-path, duplicate, symlink and incomplete-recovery
  cases all fail) and its manifest's sha256 is compared to the
  independently recorded expected digest. **Internal consistency alone is
  never accepted for execution.**
- Verification runs **before any pool or connection is created**,
  including before `createDatabaseIfNeeded` — an invalid artifact means
  zero database connections.
- The executed SQL is the same in-memory bytes that were hashed: a file
  changed on disk between verification and execution cannot substitute
  different SQL.
- All existing safeguards are unchanged: TLS resolution, DSN/pooler
  rejection, target expectations (preflight), the session advisory lock,
  checksum-mismatch refusal and no ledger rewrites.

## Provenance — three separately recorded values

A run must record, independently of the artifact copy:

1. **Approved source revision** — the reviewed git SHA the artifact was
   recovered from.
2. **Expected manifest digest** — sha256 of
   `src/lib/migrations/manifest.json` at that revision
   (`git show <sha>:src/lib/migrations/manifest.json` → hash the raw
   blob bytes).
3. **Runner revision** — the git SHA of the code executing the run.

## Bounded clean-install/repeat-run plan (not yet executed)

New disposable target: `deedly_m1_artifact_verify` on the approved Neon
project. Same TLS/credential discipline as the §5 rehearsal —
`sslmode=verify-full`, pgpass/secure-string credentials, `finally`
cleanup. **Requires approval for the `CREATE DATABASE` before running.**

```powershell
# 0 — provenance
$ApprovedSha = '<approved source revision>'
$RunnerSha   = git rev-parse HEAD          # runner revision, recorded
git show "${ApprovedSha}:src/lib/migrations/manifest.json" |
  Set-Content -AsByteStream $env:TEMP\m1ex-mf.json -NoNewline
$ExpectedDigest = (Get-FileHash -Algorithm SHA256 $env:TEMP\m1ex-mf.json).Hash.ToLower()
# Record $ApprovedSha, $RunnerSha, $ExpectedDigest in the run log.

# 1 — recover the artifact (byte-verified against the pinned digest)
node scripts/migration-recover.mjs --revision=$ApprovedSha `
  --output=$env:TEMP\m1ex-artifact --expect-manifest-sha256=$ExpectedDigest

# 2 — preflight the fresh target AGAINST THE ARTIFACT (read-only)
psql -d neondb -c "SELECT datname FROM pg_database
  WHERE datname='deedly_m1_artifact_verify'"   # must be absent
psql -d neondb -c "CREATE DATABASE deedly_m1_artifact_verify"
node scripts/migrate-preflight.mjs `
  --expect-host=ep-red-term-awh8wnfa.c-12.us-east-1.aws.neon.tech `
  --expect-database=deedly_m1_artifact_verify --expect-environment=disposable `
  --migrations-dir=$env:TEMP\m1ex-artifact --expect-manifest-sha256=$ExpectedDigest
#   → PASS, fresh, 27 pending

# 3 — exact-artifact clean install
node scripts/migrate.mjs --migrations-dir=$env:TEMP\m1ex-artifact `
  --expect-manifest-sha256=$ExpectedDigest     # → 27/27 applied

# 4 — repeat-run on the same target
node scripts/migrate.mjs --migrations-dir=$env:TEMP\m1ex-artifact `
  --expect-manifest-sha256=$ExpectedDigest     # → 27 skipped, 0 applied

# 5 — confirm the ledger carries the manifest digests
#   (all 27 rows = manifest sha256 values; compared in the run log)
```

**Pass criteria:** preflight PASS on fresh target; clean install applies
27; repeat run applies 0; ledger checksums equal the manifest digests;
advisory lock acquired/released each run; no schema writes beyond the
migrations themselves.

**Stop conditions:** any verification failure, unexpected target state,
connection drift — stop; no drop/recreate, no retry loops.

## What remains outside this slice

- Executing the plan (needs `CREATE DATABASE` approval).
- External document/blob recovery (M0-operational/M7), provider
  integrations, deploy-lock coordination, secrets delivery.
- `deedly_m1_verify`, `deedly_m1_verify_lf`, `deedly_m1_backup_src`,
  `deedly_m1_restore_verify` remain preserved evidence — untouched.
