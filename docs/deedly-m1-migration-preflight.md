# M1 — Migration preflight slice

Status: **implemented offline, not executed against any database.**
Branch: `m1/migration-preflight` (from `origin/main` @ `5793574`).
Scope: the engineering-owned preflight work in the M1 megaplan section —
target resolution, ledger/schema inspection, checksum verification,
ordered pending list, fail-closed results, the procedure/failure/
backup documentation, and the isolated-PostgreSQL verification plan.
Executing migrations, provisioning targets and TLS/CA verification are
**not** part of this slice and remain gated.

## 1. Deliverables

| Artifact | Purpose |
|---|---|
| `scripts/migrate-preflight.mjs` | Read-only preflight: resolves the target, requires explicit `--expect-host`/`--expect-database`/`--expect-environment`, proves the session is read-only, inspects the ledger, compares all applied checksums, lists pending files in canonical order, reports violations. |
| `src/lib/migrations/manifest.json` | Immutable artifact manifest — ordered file list with the sha256 of each file's raw bytes (the digest the runner stores in the ledger). |
| `scripts/migration-manifest.mjs` | `--write`/`--check` generator/verifier for the manifest. |
| `scripts/migrate-preflight.test.mjs`, `scripts/migration-manifest.test.mjs` | Offline regression tests (fake client; no database, no sockets). |

## 2. Required migrations, order and prerequisites

Canonical order is the sorted filename order (zero-padded). All 27 files
are required for the fresh pilot database. Numbering gaps 022 and 027 are
**reserved, not missing** — the runner must not expect files for them, and
`docs/proposals/027_deedly_document_requirement_rules_seed.sql` is a
proposal, never an applied migration.

| # | File | Purpose | Notable prerequisites |
|---|---|---|---|
| 001 | initial_schema | Core schema (transfers, documents, audit_log, users) | none — creates base |
| 002 | add_properties_table | `properties`, `generate_property_id()` | 001 |
| 003 | complete_conveyhub_schema | Remaining legacy conveyancing tables | 001–002 |
| 004 | seed_reference_data | Reference/lookup seed data | 001–003 |
| 005 | transfer_documents | Transfer document tables | 003 |
| 006 | update_property_types | Property type options | 002 |
| 007 | add_identification_document | Required Identification doc | 005 |
| 008 | create_transfer_parties | `transfer_parties` link table | 001, transfers schema usage begins |
| 009 | accountable_institution_id on matters/transfers | Tenant ownership columns | 001/003 |
| 010 | move_transfer_owned_tables_to_transfers_schema | Relocate DEEDLY-owned tables to lowercase `transfers` schema | 008–009 |
| 011 | property_created_for_transfer_id | Provenance marker | 002/010 |
| 012 | backfill_qa_tenant_and_enforce_ownership | Backfill QA tenant, enforce ownership NOT NULL | 009; **writes existing data — fresh DB is a no-op data-wise but still required for constraints** |
| 013 | platform_user_actor_columns | Platform JWT `user_id` INTEGER columns | 009 |
| 014 | rename submitted_by → created_by | Column rename per 013 | 013 |
| 015 | deedly_classification_taxonomy | Classification taxonomy + matter columns | 010 |
| 016 | deedly_status_lifecycle | Canonical status lifecycle | 015 |
| 017 | accounts_billing_config | Tenant-scoped billing/tariff tables | 009/010 |
| 018 | party_property_contract_foundation | Party/property contract schema foundation | 010, 015 |
| 019 | property_tenant_isolation | AI ownership on properties + tenant constraints | 018; triggers depend on ownership columns |
| 020 | taxonomy_approved_classifications | Approved classification rows | 015 |
| 021 | specialist_role_capacity_persistence | Specialist context/relationship tables | 008, 018 |
| 023 | manual_party_sources | Manual-party source model + idempotency keys | 008, 021 |
| 024 | property_link_idempotency | Institution-scoped request idempotency indexes | 019 (`accountable_institution_id` must exist/trigger-maintained) |
| 025 | matter_documents | Upload/scan-gated storage, requirements, audit | 010, 019 |
| 026 | generate_property_id ambiguity fix | Repair function from 002 | 002, 010 |
| 028 | document_scan_attempt_ownership | Scan-attempt ownership | 025 |
| 029 | generate_transfer_id ambiguity fix | Repair transfer-id generation | 016 |

Prerequisite chain notes: 008→023/021 chain for parties; 009→019→024 for
property tenancy/idempotency; 015→016→029 for classification/status and
transfer-id generation; 025→028 for document scan ownership. The runner
applies in sorted filename order, which respects these chains.

## 3. Preflight pass/fail contract

`node scripts/migrate-preflight.mjs --expect-host=… --expect-database=… --expect-environment=disposable|staging|pilot`

Exit codes: **0** PASS — target matches expectations, history is valid
(fresh ledger or all applied rows match checked-in files); pending list
emitted in canonical order. **1** FAIL — violation found or the connected
target disagrees with expectations. **2** refusal — missing flags or a
production-shaped environment label.

Report contains only safe metadata: host/database/port/server version,
read-only proof, filenames, checksums, `applied_at`, counts, pending list,
violations. Never a DSN, user or password.

Fail states detected before any write is contemplated:

| State | Result |
|---|---|
| Missing `--expect-*` flags | Refuse (exit 2) |
| `expect-environment` not in the allowed set (incl. `production`) | Refuse (exit 2) |
| `current_database()` ≠ `--expect-database` | FAIL, ledger untouched |
| Configured host ≠ `--expect-host` | FAIL, ledger untouched |
| Session not provably read-only | FAIL, ledger untouched |
| Ledger row names a file absent from the checkout (`unknown-applied`) | FAIL |
| Applied file checksum ≠ checkout checksum (`checksum-mismatch`) | FAIL |
| Pending file sorts before an applied file (`applied-out-of-order`) | FAIL |
| Ledger table absent | PASS, `fresh: true`, all files pending |

The tool forces `default_transaction_read_only = on`, runs inside a
started transaction, verifies `transaction_read_only = on` on the server,
issues only `SELECT`s, and rolls back. No `CREATE TABLE`, no ledger write —
a missing ledger is reported as `fresh`, never created by preflight.

## 4. Migration procedure

1. **Preflight** (this tool) on the approved target. FAIL → stop; do not
   run `migrate.mjs` until violations are reconciled.
2. **Backup** per §5 before any apply.
3. **Apply**: `node scripts/migrate.mjs` with the same target. The runner
   skips ledgered files and fails hard on checksum mismatch. One migrator
   at a time — see serialization below.
4. **Verify**: re-run preflight — expect PASS, zero pending, zero
   violations; then the target-specific verification plan (§6 for the
   pilot DB).

### Failure handling

- **File fails mid-run:** the runner stops; applied files remain ledgered.
  Fix the cause, rerun — the ledger skips completed files. Files manage
  their own `BEGIN`/`COMMIT` blocks (the majority of 001–029 do), so a
  failure can leave a partially applied file: reconcile per the next item
  before any retry.
- **SQL applied but ledger row missing** (crash between apply and ledger
  insert): rerun will re-execute the file's SQL. Most files use
  `IF NOT EXISTS`/idempotent guards, but existence does not prove correct
  definition (per the 024 verification report). Recovery: inspect actual
  objects (`pg_get_indexdef`, `information_schema`) against the file;
  if they match, insert the ledger row manually with the file's exact
  sha256 (from `manifest.json`) and `applied_at = now()`; if they differ,
  repair the objects first, then ledger. Record the reconciliation in the
  run log — do not treat a clean rerun as proof.
- **Checksum mismatch at any step:** stop. A mismatch means either the
  file changed post-application or the target's history belongs to a
  different artifact line. Never reconcile by editing the ledger to match
  new bytes, never use `--baseline-through` to silence it (megaplan §3.8).
- **Serialization:** `migrate.mjs` takes a non-blocking session-level
  advisory lock — `pg_try_advisory_lock(hashtext('deedly-migration-runner'))`
  — on one dedicated connection before any ledger mutation or migration
  SQL, and holds it for the whole run (session scope survives the
  per-migration `BEGIN`/`COMMIT` blocks). A competing runner fails
  immediately with no schema or ledger change. The lock is released on
  success and handled failure; a crashed session frees it via connection
  teardown, and a release failure never masks the run's own error.
  **Scope:** this serializes cooperating migration runners only — it is
  not a complete deployment lock and does not stop unrelated clients.
  **Pooler guard:** session advisory locks do not serialize through a
  transaction-mode pooler (each client can land on a different backend
  session — verified live on Neon: two pooler clients both acquired).
  Known pooler hostnames (`-pooler`, `.pooler.`) are **rejected before
  any write** — the runner requires an explicitly configured direct
  endpoint and never derives or silently switches it. Limitation:
  hostname matching cannot prove session affinity for arbitrary proxies;
  unknown forwarders are outside this guard. The operational rule remains
  a single operator window with the deploy pipeline holding a deploy lock.
  **Connection hygiene:** a failed unlock destroys the connection rather
  than returning it to the pool, so no surviving session can keep the
  lock; every exit path releases the client and ends the pool.
- **No automated rollback.** The runner has none; per-migration reversal
  is reviewed SQL authored for that migration (see the 024 doc's example),
  not a flag. Roll forward or restore from backup are the supported paths.

### EOL/byte-identity hazard

The ledger hash is over raw file bytes; `core.autocrlf=true` checkouts
produce CRLF bytes — a different artifact that will (correctly) fail
checksum comparison against an LF-applied ledger. The canonical artifact
is LF (`manifest.json` `canonicalEol: lf`), now enforced by
`.gitattributes` (`src/lib/migrations/*.sql text eol=lf`) so every
platform materializes LF. If `migration-manifest.mjs --check` fails on a
checkout predating `.gitattributes`, normalize the checkout, do not
edit the manifest to match local bytes.

**Applied evidence:** the first version of this manifest was generated
from a CRLF (`autocrlf=true`) working tree and failed in CI, where the
checkout is LF. The disposable database `deedly_m1_verify` was migrated
from that same CRLF worktree, so its ledger rows hold CRLF digests — a
re-run of the preflight there now reports `checksum-mismatch` on all 27
entries until the ledger rows are reconciled to canonical digests or the
database is recreated. Neither remediation is in scope for this PR.

**Correction to earlier reports:** the post-apply preflight "PASS,
checksums verified" was against the CRLF-derived manifest, not
canonical bytes. The applied SQL was content-identical (see audit
below), but the ledger digests are not the canonical LF digests.

**Audit (27/27 files):** for every migration, the old manifest digest
equals `sha256(CRLF bytes)` and the new equals `sha256(LF bytes)`, and
the live ledger rows in `deedly_m1_verify` all match the CRLF digests.
Every old-to-new difference is solely CRLF↔LF — no SQL-content changes.
The CRLF ledger is preserved as evidence; a canonical-digest ledger
requires a fresh apply (see `deedly_m1_verify_lf` proposal).

## 5. Backup/restore prerequisites

Before any apply on a target containing data:

- `pg_dump --format=custom` of the target database, stored outside the
  instance; for the fresh pilot database this is trivially a no-data
  snapshot but still taken.
- `SELECT version()` recorded (inspected target was PostgreSQL 17.11).
- Ledger export: `SELECT * FROM public.transfers_schema_migrations` saved.
- Pre/post row snapshots for any table a migration touches (see the 024
  plan's snapshot-diff method — unchanged counts are necessary, not
  sufficient).
- Restore rehearsal is an M1 operational-exit requirement (megaplan §5):
  database + immutable files + metadata/file relationship must be
  rehearsed before real pilot data. This slice does not perform it.
- Known schema caveat: `fk_transfers_property_tenant` composite FK makes a
  referenced property effectively undeletable (024 report §6) — relevant
  to fixture cleanup ordering on any non-empty target.

### Backup/restore rehearsal plan (prepared — do not run yet)

Bounded rehearsal of the §5 `pg_dump`/`pg_restore` path on two dedicated
disposable databases. `deedly_m1_verify` (CRLF-ledger evidence) and
`deedly_m1_verify_lf` (canonical-ledger evidence) are preserved unchanged —
neither is a source, target, or subject of any statement below.

**Prerequisites (confirm before step 0):**

- **PostgreSQL 17 client tools** matching the server (17.11): install the
  PG 17 `pg_dump`/`pg_restore`/`psql` binaries (EDB installer or
  equivalent). Local machine currently has only PG 18 tools at
  `C:\Program Files\PostgreSQL\18\bin` — record the resolved `pg_dump
  --version` (17.x) in the run log; do not run with 18.x.
- **Credentials without command-line passwords:** create a temporary
  pgpass file `%TEMP%\m1br_pgpass.conf` containing
  `ep-red-term-awh8wnfa.c-12.us-east-1.aws.neon.tech:5432:*:neondb_owner:<password>`,
  ACL-restricted to the current user (`icacls ... /inheritance:r /grant:r
  "$env:USERNAME:R"`), and point `PGPASSFILE` at it. Delete it after the
  run. Passwords never appear on a command line, in a DSN argument, or in
  committed files. For the Node scripts, use discrete `DB_*` env vars
  (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, PGSSLMODE=verify-full) or
  a DSN in `DATABASE_URL` — env vars only, never `psql`/`pg_dump`
  arguments.
- **TLS:** all connections use the **direct endpoint**
  (`ep-red-term-awh8wnfa.c-12.us-east-1.aws.neon.tech`, no `-pooler`)
  with `sslmode=verify-full` (`PGSSLMODE=verify-full` for libpq tools;
  `resolveDbTls` maps it to full verification for the Node scripts).
- Working tree clean on the rehearsal branch with
  `migration-manifest.mjs --check` PASS (canonical LF bytes).

**Sequence:**

```text
0. Probe (read-only, psql -d neondb): SELECT version() recorded;
   deedly_m1_backup_src AND deedly_m1_restore_verify both absent.
   If either exists → stop, report; do not reuse or drop silently.
1. CREATE DATABASE deedly_m1_backup_src;            -- empty container
   CREATE DATABASE deedly_m1_restore_verify;        -- empty container
2. Build source from the canonical artifact:
   a. preflight --expect-database=deedly_m1_backup_src
      --expect-environment=disposable → PASS, fresh, 27 pending
   b. node scripts/migrate.mjs → 27/27 applied
   c. re-run preflight → PASS, 0 pending; ledger digests == manifest
      canonical LF digests (cross-check all 27 rows)
3. Seed source (marker M1BR-): 3 transfers.transfers rows across two
   random 800M-range accountable_institution_ids with mixed statuses;
   1 transfers.transfer_documents row FK'd via the transfer's uuid id
   with file_path/file_size/file_type set, pointing at a local synthetic
   artifact file whose sha256 is recorded (metadata↔file relationship
   only — see separation note below).
4. Snapshot source state (saved to run log):
   - per-table row counts (all tables)
   - ordered content hash per seeded table (sha256 over COPY ... ORDER BY pk)
   - ledger export: SELECT * FROM transfers_schema_migrations ORDER BY filename
   - extension inventory: SELECT extname, extversion FROM pg_extension
   - constraint defs: pg_get_constraintdef for all constraints;
     index defs: pg_get_indexdef for all non-pg_internal indexes
5. pg_dump --format=custom --no-owner --no-acl -d deedly_m1_backup_src
   -f %TEMP%\m1br.dump   → exit 0, nonzero size; record duration + size.
6. Prepare target: pre-create exactly the source's extension set
   (expected: uuid-ossp only — migrations 001/003 create it
   IF NOT EXISTS; enumerate pg_extension at step 4 and match exactly).
7. pg_restore --no-owner --no-acl --exit_on_error -d
   deedly_m1_restore_verify %TEMP%\m1br.dump
   → --exit_on_error aborts on any error; stderr captured; record
   duration. Any error = stop and report, no retry-by-omission.
8. Verify target against source snapshots:
   a. Schema: pg_dump --schema-only on both, normalize before diff —
      strip comment banners (-- Dumped from database version / pg_dump
      version / timestamps), \connect, SET, and SELECT set_config lines.
      Only those lines may differ legitimately; ANY remaining diff is
      substantive and fails the check.
   b. Catalog parity (immune to dump formatting): information_schema
      tables/columns, all pg_get_constraintdef and pg_get_indexdef output
      equal.
   c. Per-table row counts equal to step-4 snapshot.
   d. Ordered content hashes on seeded tables equal.
   e. Ledger deep-equal: all 27 rows identical including applied_at.
   f. migrate-preflight on target → PASS, 27 applied, 0 pending —
      certifies the restored DB as a migrated target.
   g. node scripts/migrate.mjs on target → 0 applied, all skipped —
      proves the advisory-lock runner path works post-restore.
   h. FK spot-check: seeded transfer_documents row resolves to its
      transfer; artifact file sha256 unchanged (metadata↔file link).
9. Cleanup: DELETE seeded M1BR- rows from the source (children before
   parents); 0-residual check. Delete PGPASSFILE. Preserve the dump file,
   run log, and BOTH new databases as evidence unless drop is separately
   approved — they contain only synthetic and migration-seed data.
10. Stop on any mismatch or unexpected failure; no automatic
    drop/recreate.
```

**Separation of concerns:** the artifact file seeded in step 3 and
checked in 8h is a *synthetic* local file with a recorded checksum — it
verifies the DB-side metadata↔file linkage only. Real immutable-blob storage recovery is NOT
rehearsed here and stays outstanding in §7.

## 6. Isolated PostgreSQL verification plan (prepared — do not run yet)

**Exact setup (when separately approved):**

```text
1. Docker: postgres:17 container, empty volume, loopback-only publish
   (docker run --rm -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=synthetic
   -e POSTGRES_DB=deedly_verify postgres:17)
2. DATABASE_URL=postgres://postgres:synthetic@127.0.0.1:55432/deedly_verify
   (and the same value into TEST_DATABASE_URL; all other DSN env vars
   unset — see db_test_utils._DB_URL_ENV_KEYS)
3. Preflight: node scripts/migrate-preflight.mjs --expect-host=127.0.0.1 \
     --expect-database=deedly_verify --expect-environment=disposable
   → expect PASS, fresh:true, all 27 pending
4. Apply: node scripts/migrate.mjs
5. Re-run preflight → expect PASS, zero pending, zero violations
6. Seed synthetic fixtures only: two institutions (e.g. AI 5, AI 7),
   matters/transfers with mixed statuses on each, clearly tagged values
   (__verify_m1_<nonce>), roles 1–4 principals.
```

**Verification coverage (M2 list contract, on the PR head's server code):**

- `status=complete` returns only complete rows; `status=in_progress` only
  in-progress; invalid/repeated values → 422 before any query.
- `pagination.total` matches the selected status per institution.
- `statusTotals` = institution-wide `{total,inProgress,completed}`
  regardless of page and filter.
- Other institution's rows absent from rows, pagination and totals.
- Client role (4): empty list, no totals disclosure.
- Constraint checks: institution-scoped partial unique indexes from 024;
  composite tenant FKs; `transfers.status` lifecycle values from 016.

**Existing coverage and gaps:**

- `python_server/tests/test_v1_transfers.py` — DB-gated (`TEST_DATABASE_URL`)
  tenant-scoping tests exist for list/detail/parties/milestones/documents/
  financials (own-AI vs foreign-AI, role denial, client isolation).
- `test_ai_tenant_security.py` — exercises the status filter and
  `statusTotals` **against a mocked query layer**: it asserts the SQL
  predicates issued, not real PostgreSQL results. Gap: no real-schema run
  proves the predicates return correct rows/counts/totals (e.g. the
  `COUNT(*) FILTER` totals, pagination count vs filter consistency).
- Gap: no DB test asserts consistency between the list page, the count
  query and totals on a real engine; the three are separate reads — no
  snapshot consistency is claimed or testable without explicit snapshot
  isolation.
- Gap: Python DB tests are skipped when `TEST_DATABASE_URL` is unset —
  the 249-skip count in CI evidence is skipped coverage, not a pass.

**STOP before step 3** until an isolated-database execution is explicitly
approved. Nothing in this slice connects to a database.

## 7. Remaining M1 work outside this slice

- ~~DB TLS/CA verification in migration tooling and FastAPI's pool~~ —
  addressed on `m1/tls-hardening` (and ported to this tool via
  `scripts/db-tls.mjs`): verification is the default, trusted CA via
  `sslrootcert`/`PGSSLROOTCERT`/`DB_SSL_CA_FILE`, `no-verify` is an
  explicit warned opt-out. BFF-side DB TLS config remains open if/when the
  BFF takes a direct pool.
- Immutable-artifact build + validation run on a disposable DB (needs the
  §6 approval).
- Migrator serialization mechanism (deploy-lock integration) and the
  reconciled-runbook sign-off.
- Secrets delivery, environment health/readiness fail-closed startup.
