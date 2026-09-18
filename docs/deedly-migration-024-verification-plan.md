# Migration 024 — verification plan and review notes

Status: authored, **not executed**. File:
`src/lib/migrations/024_deedly_property_link_idempotency.sql` on branch
`deedly/mvp0/properties/manual-capture-and-linking` (commit `ff1ed5e`,
file sha256 `c280d874bac164f936de012e452e91c004cd68691e5191cdc78bd9a4c2512108`).

> Checksum corrected 2026-09-18: the earlier `fa3f3f59…` value was stale;
> `c280d874…` has been the file's invariant hash since `bae5185c`
> (confirmed by the 024 verification report).

This document is the handoff for running and verifying migration 024. It
also records findings from the scratch-fixture test run that the reviewing
engineer should be aware of.

## 1. What the migration does

- `ALTER TABLE transfers.properties` adds `client_request_id UUID` and
  `request_fingerprint VARCHAR(64)`, both nullable (`IF NOT EXISTS`).
- `ALTER TABLE transfers.matter_properties` adds the same two columns
  (`IF NOT EXISTS`).
- Creates institution-scoped partial unique indexes (`IF NOT EXISTS`):
  - `idx_properties_client_request_id` on
    `transfers.properties (accountable_institution_id, client_request_id)`
    where `client_request_id IS NOT NULL`
  - `idx_matter_properties_client_request_id` on
    `transfers.matter_properties (accountable_institution_id,
    client_request_id)` where `client_request_id IS NOT NULL`
- Runs inside one transaction with `SET LOCAL search_path TO transfers,
  public` and schema-qualified targets.

## 2. Prerequisites

1. **Numbering check against active branches.** 024 was chosen because 022
   is reserved by the unmerged SARS branch and 023 exists on main. Before
   executing, re-check `src/lib/migrations/` on main and on every branch
   that may merge first; if anything has claimed 024 in the meantime,
   renumber the file and update references.
2. **Target authorization.** For this workstream, execution requires an
   explicitly approved, disposable, non-production target. A maintenance
   window alone must not authorize execution against a live database. The
   Neon database used for scratch-fixture testing
   (`ep-billowing-sound-*.neon.tech/neondb`) held application data at
   inspection time (8 transfers, 20 audit rows); it is a candidate only if
   the project owner explicitly approves it as disposable. Until rows are
   identified as
   synthetic or expendable, treat every existing row as data of unknown
   provenance — not as fixture material.
3. **Recorded baseline.** Before running, record: the exact commit, the
   migration file's sha256 (above — must match the ledger value the runner
   will store), the database version (`SELECT version()`; the inspected
   target was PostgreSQL 17.11), and the prerequisite migration state —
   the `public.transfers_schema_migrations` ledger rows proving 018/019/023
   (or their successors) are applied, since the new indexes depend on
   `accountable_institution_id` being present and trigger-maintained.
4. **Runtime compatibility.** The new runtime requires migration 024;
   affected reads and writes may fail until it is applied. Ordering:
   migrate first, deploy second.

## 3. Executable verification and cleanup procedure

1. Apply the migration via `scripts/migrate.mjs` (the project's runner —
   see §3.7) on the approved disposable target.
2. Verify columns: `information_schema.columns` for both tables — names,
   types (`uuid`, `varchar(64)`), nullability.
3. Verify both partial unique indexes and their predicates:
   `pg_get_indexdef` on each index name; confirm the
   `(accountable_institution_id, client_request_id)` key order and the
   `WHERE client_request_id IS NOT NULL` predicate.
4. **Existing-row preservation.** Unchanged row counts and NULL new
   columns are necessary but not sufficient — they cannot prove existing
   records stayed unchanged. Before applying, snapshot each table's
   pre-existing rows (e.g. `SELECT * ... ORDER BY id` into a file, or a
   deterministic hash aggregate over the row set); after applying,
   re-run the same snapshot **excluding the two new columns** and diff.
   Any difference means the migration touched existing data — it should
   not.
5. **Index semantics with synthetic fixtures.** Insert clearly
   synthetic rows (tagged values, e.g. addresses like
   `__verify_024_<nonce>`) and isolate each expected outcome as a
   separate check:
   - same `(accountable_institution_id, client_request_id)` twice →
     second insert must fail with a unique violation on the
     corresponding index — expected failure, caught and asserted;
   - same `client_request_id` under a different
     `accountable_institution_id` → must succeed;
   - NULL `client_request_id` rows → never conflict;
   - repeat for both `properties` and `matter_properties` (the latter
     needs a synthetic matter + transfer for its tenant-derivation
     trigger).
6. **Audit effects.** Inserts into `properties`/`transfers` fire the
   audit triggers into `public.audit_log`. Bound the audit footprint:
   record `max(id)` (or current max `created_at`) of `public.audit_log`
   before the fixture inserts, so the verification-generated audit rows
   are identifiable by `id > baseline` and the synthetic `record_id`s.
7. **Cleanup / rollback.** Delete the synthetic `matter_properties` and
   `properties` rows (respecting FK order), then delete the audit rows
   generated by the fixture window (`id > baseline` AND `table_name` for
   the affected tables AND the synthetic `record_id`s — not a blanket
   `id > baseline` delete, which could remove unrelated audit entries
   written concurrently). Verify removal: zero rows matching the
   synthetic tag in both tables, audit count back to baseline. If the
   target must be returned to pre-migration shape, the rollback is
   `DROP INDEX` ×2 and `DROP COLUMN` ×4 plus a ledger-row delete — note
   that a rollback executed after certification should itself be
   reviewed, not improvised.
8. Post-run diff: rerun the §3.4 snapshot comparison and the baseline
   counts; report both.

## 3.7 Rerun behavior — resolve before execution

The actual runner is `scripts/migrate.mjs` with ledger table
`public.transfers_schema_migrations (filename PK, checksum, applied_at)`:
an applied file is skipped by filename, and a checksum mismatch makes the
runner refuse to proceed. The migration file already uses
`ADD COLUMN IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` on all
four statements — so a re-execution outside the runner is a no-op, not a
failure. (An earlier draft of this plan claimed the second `ALTER` fails;
that was checked against the actual file and is wrong.)

Consequence: rerun safety is already handled by the ledger skip for the
runner path and by `IF NOT EXISTS` for a manual rerun — but a skipped or
no-op rerun does **not** establish that the existing objects have the
correct definition, only that they exist. Do not treat a clean rerun as
verification; run §3.2–§3.3 checks explicitly. Do not add further
`IF NOT EXISTS` guards blindly — decide deliberately whether the runner's
ledger is the sole guard.

## 4. What scratch-fixture verification does and does not establish

The guarded suite (`python_server/tests/test_v1_matter_properties_db.py`)
verified the idempotency columns and indexes by **replicating** their DDL
inside a disposable `scratch_matter_prop_<hex>` schema. That proves the
service code behaves correctly against the intended schema shape; it is
not proof that migration 024 itself applies cleanly.

Applying §3 on an approved target establishes **migration behavior** —
the columns, index definitions, predicates and ledger entry. It does not
close the separate evidence items below; report each with its own result:

- `update_*_updated_at` triggers — not reproduced in scratch;
  `updated_at` behavior untested.
- `update_transfer_progress_trigger` — not reproduced.
- `property_details` view — not reproduced.
- `validate_sa_postal_code()` — replaced in scratch by an equivalent
  inline CHECK; real-function edge cases untested.
- `audit_log.user_id` FK to `users` — dropped in scratch; user-resolution
  FK behavior untested.
- Sync/audit triggers are **faithful replicas** of migrations 002/019
  bodies bound to scratch tables, not the deployed trigger objects.
- Application integration on the real schema (service connected to the
  migrated tables) — not yet exercised; scratch runs used the scratch
  schema only.

Remaining gaps are explicit above; none are closed by a clean §3 run.

## 5. Confinement report — qualified

The guarded run confined all writes to the scratch schema: `search_path`
was pinned to `"scratch", public` and every touched table existed in
scratch, so no name resolved to an application table. Application-table
counts were unchanged (properties 0→0, matter_properties 0→0, transfers
8→8, matters 0→0, audit_log 20→20) and the scratch schema was dropped.

**Qualification:** unchanged counts plus inspected search-path routing
support isolation, but counts alone cannot prove zero modification — a
write-then-undo to an application table would leave counts unchanged. The
stronger evidence is routing (every DML target name resolves to scratch)
and the absence of any application-schema objects in the fixture's write
path. No application-schema write was issued or observed; treat this as
supporting evidence, not a formal audit.

## 6. Finding — composite FK makes referenced properties undeletable

`fk_transfers_property_tenant` on `transfers (property_id,
accountable_institution_id) → properties (id, accountable_institution_id)`
is `ON DELETE SET NULL`. Deleting a property **still referenced** by
`transfers.property_id` makes PostgreSQL attempt to null **all**
referencing columns — including `transfers.accountable_institution_id`,
which is `NOT NULL`. The delete therefore fails with a
`NotNullViolationError`. Once the referencing transfer's `property_id`
is cleared, the property can be deleted normally — the failure depends on
a current reference, not on the link ever having existed.

Correction to an earlier draft: PostgreSQL **does** support
`ON DELETE SET NULL (column_list)` on a composite foreign key (since
PostgreSQL 15; the inspected target is 17.11) — `SET NULL (property_id)`
would null only that column and preserve
`accountable_institution_id`. The earlier claim that the composite FK
cannot express this was incorrect.

In production terms: a property row still referenced via the legacy
`transfers.property_id` pointer is effectively undeletable while the
reference stands. Whether that is intended, or the FK should become
`ON DELETE SET NULL (property_id)`, RESTRICT, or be restructured, is a
separate schema decision — **no FK change belongs in migration 024
without approval**, and none was made. Discovered via fixture cleanup
ordering; reproduced only in scratch.
