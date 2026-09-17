# Migration 024 — verification plan and review notes for Jordan

Status: authored, **not executed**. File:
`src/lib/migrations/024_deedly_property_link_idempotency.sql` on branch
`deedly/mvp0/properties/manual-capture-and-linking`.

This document is the handoff for running and certifying migration 024. It
also records two findings from the scratch-fixture test run that Jordan
should be aware of.

## 1. What the migration does

- `ALTER TABLE transfers.properties` adds `client_request_id UUID` and
  `request_fingerprint VARCHAR(64)`, both nullable.
- `ALTER TABLE transfers.matter_properties` adds the same two columns.
- Creates institution-scoped partial unique indexes:
  - `idx_properties_client_request_id` on
    `properties (accountable_institution_id, client_request_id)` where
    `client_request_id IS NOT NULL`
  - `idx_matter_properties_client_request_id` on
    `matter_properties (accountable_institution_id, client_request_id)` where
    `client_request_id IS NOT NULL`
- Runs inside one transaction with `SET LOCAL search_path` and schema-
  qualified targets.

## 2. Prerequisites

1. **Numbering check against active branches.** 024 was chosen because 022 is
   reserved by the unmerged SARS branch and 023 exists on main. Before
   executing, re-check `src/lib/migrations/` on main and on every branch that
   may merge first; if anything has claimed 024 in the meantime, renumber the
   file and update references.
2. **Target selection.** Execute only on an explicitly isolated target —
   never against a database serving live traffic without a maintenance
   window. The Neon database used for scratch-fixture testing
   (`ep-billowing-sound-*.neon.tech/neondb`) is a candidate only if Dean
   confirms it is dedicated; it contained real application data (8 transfers,
   20 audit rows) at inspection time, so treat it as shared until confirmed.
3. **Baseline snapshot.** Record row counts of `transfers.properties`,
   `transfers.matter_properties`, `transfers.transfers`,
   `transfers.matters`, and `public.audit_log` before running.
4. **Runtime compatibility.** Deploy the service code that writes/reads the
   new columns only after the migration is applied — the code tolerates the
   columns being absent (it fails on insert), so ordering matters: migrate
   first, deploy second.

## 3. Verification steps

1. Apply the migration on the isolated target.
2. Verify columns exist with the right types/nullability:
   `information_schema.columns` for both tables.
3. Verify both partial unique indexes exist and their predicates:
   `pg_indexes`/`pg_get_indexdef`.
4. **Existing-row preservation:** confirm every pre-existing row is unchanged
   (`client_request_id` and `request_fingerprint` are NULL on all of them —
   no backfill exists or is needed).
5. **Index semantics:** insert two rows with the same
   `(accountable_institution_id, client_request_id)` → second insert must
   violate the unique index; the same `client_request_id` under a different
   `accountable_institution_id` must succeed; rows with NULL
   `client_request_id` never conflict.
6. Post-run counts: only the expected test rows differ from the baseline
   snapshot; `public.audit_log` grows only by trigger-generated entries for
   the verification inserts themselves.
7. Rerunnability: re-executing the script fails on the second `ALTER`
   (columns exist) — acceptable, but if rerunnability is required wrap the
   ALTERs in `IF NOT EXISTS` guards before certification. Decide whether the
   project's migration runner requires idempotent scripts.

## 4. Scratch-fixture verification vs. production certification

The guarded suite (`python_server/tests/test_v1_matter_properties_db.py`)
verified the idempotency columns and indexes by **replicating** their DDL
inside a disposable `scratch_matter_prop_<hex>` schema. That proves the
service code behaves correctly against the intended schema shape; it is not
proof that migration 024 itself applies cleanly — the script has never been
executed. Step 3 above is the real certification.

Fixture omissions (disclosed, not silently absent):

- `update_*_updated_at` triggers — not reproduced; `updated_at` behavior is
  untested.
- `update_transfer_progress_trigger` — not reproduced.
- `property_details` view — not reproduced.
- `validate_sa_postal_code()` — replaced by an equivalent inline CHECK;
  real-function edge cases untested.
- `audit_log.user_id` FK to `users` — dropped in scratch; user-resolution
  FK behavior untested.
- Sync/audit triggers are **faithful replicas** of migrations 002/019 bodies
  bound to scratch tables, not the deployed trigger objects.

Consequence for production readiness: scratch results certify service
semantics (idempotency, tenant scoping, atomicity, trigger non-interference)
but not the deployed DDL, the real trigger objects, or the migration's
execution. Certification requires running §3 on an approved target.

## 5. Confinement report — qualified

The guarded run confined all writes to the scratch schema: `search_path` was
pinned to `"scratch", public` and every touched table existed in scratch, so
no name resolved to an application table. Application-table counts were
unchanged (properties 0→0, matter_properties 0→0, transfers 8→8, matters
0→0, audit_log 20→20) and the scratch schema was dropped.

**Qualification:** unchanged counts plus inspected search-path routing
support isolation, but counts alone cannot prove zero modification — a
write-then-undo to an application table would leave counts unchanged. The
stronger evidence is routing (every DML target name resolves to scratch) and
the absence of any application-schema objects in the fixture's write path.
No application-schema write was issued or observed; treat this as supporting
evidence, not a formal audit.

## 6. Finding for Jordan — composite FK makes property deletion unsafe

`fk_transfers_property_tenant` on `transfers (property_id,
accountable_institution_id) → properties (id, accountable_institution_id)`
is `ON DELETE SET NULL`. Deleting a property still referenced by
`transfers.property_id` makes PostgreSQL attempt to null **both** referencing
columns — including `transfers.accountable_institution_id`, which is
`NOT NULL`. The delete therefore fails with a `NotNullViolationError`.

In production terms: a property row that has ever been linked via the legacy
`transfers.property_id` pointer is effectively undeletable. This is existing
migration-019 semantics — **no change was made** — but it should be a
conscious decision: either that is intended (properties are never deleted),
or the FK needs revisiting (e.g. SET NULL on `property_id` only, which the
composite FK cannot express — splitting the FK, or RESTRICT). Discovered via
fixture cleanup ordering; reproduced only in scratch.
