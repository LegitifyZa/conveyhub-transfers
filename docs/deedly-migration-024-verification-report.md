# Migration 024 — Verification and Certification Report

**Project**: P0 – Transfers Backend & Core Data Model  
**Target Migration**: `src/lib/migrations/024_deedly_property_link_idempotency.sql`  
**Execution Date**: 2026-09-18  
**Author / Verifier**: Jordan Wright  
**Status**: Verified on disposable application schema — **CONDITIONAL PASS** (Feature deployment gated on pre-existing `generate_property_id()` defect fix)

---

## Executive Summary & Recommendation for Dean

Migration 024 adds institution-scoped request idempotency columns (`client_request_id UUID`, `request_fingerprint VARCHAR(64)`) and partial unique indexes (`WHERE client_request_id IS NOT NULL`) to `transfers.properties` and `transfers.matter_properties`.

### Recommendation: CONDITIONAL PASS

1. **Migration 024 DDL & Database Behavior**: **PASS (UNCONDITIONAL)**
   - Applied cleanly through the project runner (`scripts/migrate.mjs`) on PostgreSQL 16.14.
   - All four columns created with exact types, lengths, nullability (`YES`), and defaults (`NULL`).
   - Both indexes created, unique, institution-scoped, with exact predicates, and marked valid.
   - Pre-existing rows remain 100% byte-for-byte identical; new columns remain strictly `NULL`.
   - Index semantics verified with synthetic fixtures: intra-institution collisions rejected (23505), cross-institution reuse accepted, multiple `NULL` keys accepted without collision.
   - Rerun behavior verified: runner skips applied migration; raw SQL `IF NOT EXISTS` is a safe no-op.
   - Rollback procedure verified: clean removal of indexes, columns, and ledger entry with zero data corruption.

2. **Application Compatibility & Feature Readiness**: **BLOCKED ON PREREQUISITE DEFECT**
   - **Discovered Defect (Blocking for Property Capture)**: `public.generate_property_id()` (authored in Migration 002) fails with `AmbiguousColumnError: column reference "property_id" is ambiguous` when executed against PostgreSQL 16+. The PL/pgSQL variable `property_id` collides with column `properties.property_id` in `WHERE property_id = property_id`.
   - **Why Missed in Previous Testing**: The scratch DB test suite (`test_v1_matter_properties_db.py`) replaced `generate_property_id()` with a synthetic mock, masking the bug.
   - **Compatibility with Disambiguated Function**: When `generate_property_id()` was temporarily patched with a disambiguated variable (`v_property_id`), the entire FastAPI service and HTTP surface (`POST /api/v1/transfers/{id}/properties`, `GET /api/v1/transfers/{id}/properties`) passed all checks: 201 creation, 200 idempotent replay, 409 conflict on altered payload, cross-institution isolation, and atomic rollback on failure.
   - **Required Action Before Feature Launch**: Author and execute a migration (e.g. Migration 025 or prerequisite fix) to replace `public.generate_property_id()` with disambiguated variable references. Migration 024 itself should not be polluted with this unrelated fix.

---

## 1. Target & Source Verification

| Parameter | Specification / Inspected Value |
| :--- | :--- |
| **Git Branch** | `deedly/mvp0/properties/manual-capture-and-linking` |
| **Commit SHA** | `b482542a9e9e63828c45392113c5dead300f630a` |
| **Migration File** | `src/lib/migrations/024_deedly_property_link_idempotency.sql` |
| **Migration SHA-256** | `c280d874bac164f936de012e452e91c004cd68691e5191cdc78bd9a4c2512108` |
| **Database Target** | `conveyhub_isolated` (Local disposable Docker container `legitify-be-postgres-1`) |
| **PostgreSQL Version** | `PostgreSQL 16.14 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit` |
| **Prerequisite Migrations** | 22 applied files in `public.transfers_schema_migrations` (`001`–`021`, `023`), all matching exact disk checksums |
| **Numbering Collision Check** | Verified unique. `022` is reserved on unmerged SARS branch (`022_deedly_sars_tdc01_foundation.sql`); `023` is manual parties on `main`. Zero other `024` migrations exist across the repository history. |
| **Pending Migration List** | Exactly 1 file: `024_deedly_property_link_idempotency.sql` |

*Note on Checksum Reference*: `docs/deedly-migration-024-verification-plan.md` previously cited a checksum `fa3f3f59...` for commit `ff1ed5e`. Verification across all git tree objects confirmed `c280d874bac164f936de012e452e91c004cd68691e5191cdc78bd9a4c2512108` has been the invariant checksum of `src/lib/migrations/024_deedly_property_link_idempotency.sql` since its initial commit (`bae5185c`).

---

## 2. Migration Execution & DDL Schema Assertions

### 2.1 Runner Execution
The migration was applied via `scripts/migrate.mjs` against `conveyhub_isolated`:
```bash
DB_HOST=localhost DB_PORT=5432 DB_NAME=conveyhub_isolated DB_USER=legitify DB_PASSWORD=legitify_dev DB_SSL=false node scripts/migrate.mjs
```
**Output**:
```text
⏭️ Skipping 001_initial_schema.sql (already applied)
... [skipping 002-021, 023]
🔧 Running 024_deedly_property_link_idempotency.sql...
✅ Applied 024_deedly_property_link_idempotency.sql
✅ Migrations completed successfully
```
**Ledger Entry**:
- `filename`: `024_deedly_property_link_idempotency.sql`
- `checksum`: `c280d874bac164f936de012e452e91c004cd68691e5191cdc78bd9a4c2512108`
- `applied_at`: Verified recorded timestamp.

### 2.2 Column Schema Definitions
Verified via `information_schema.columns`:

| Table | Column Name | Data Type | Length | Nullable | Default | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `transfers.properties` | `client_request_id` | `uuid` | — | YES | `NULL` | **PASS** |
| `transfers.properties` | `request_fingerprint` | `character varying` | 64 | YES | `NULL` | **PASS** |
| `transfers.matter_properties` | `client_request_id` | `uuid` | — | YES | `NULL` | **PASS** |
| `transfers.matter_properties` | `request_fingerprint` | `character varying` | 64 | YES | `NULL` | **PASS** |

### 2.3 Index Definitions & Validity
Verified via `pg_indexes` and `pg_index`:

1. **`transfers.idx_properties_client_request_id`**:
   - `Definition`: `CREATE UNIQUE INDEX idx_properties_client_request_id ON transfers.properties USING btree (accountable_institution_id, client_request_id) WHERE (client_request_id IS NOT NULL)`
   - `Uniqueness`: `indisunique = true`
   - `Validity`: `indisvalid = true`
   - `Result`: **PASS**

2. **`transfers.idx_matter_properties_client_request_id`**:
   - `Definition`: `CREATE UNIQUE INDEX idx_matter_properties_client_request_id ON transfers.matter_properties USING btree (accountable_institution_id, client_request_id) WHERE (client_request_id IS NOT NULL)`
   - `Uniqueness`: `indisunique = true`
   - `Validity`: `indisvalid = true`
   - `Result`: **PASS**

---

## 3. Pre-Existing Row Preservation

Prior to applying Migration 024, synthetic baseline property records were established and snapshotted across all columns (`id`, `property_id`, `erf_number`, `street_address`, `suburb`, `city`, `postal_code`, `province`, `property_type`, `accountable_institution_id`, `status`).

**Post-Migration Comparison**:
- Baseline rows re-queried and diffed against pre-migration snapshots.
- Every original column remained 100% byte-for-byte identical.
- `client_request_id` and `request_fingerprint` were confirmed strictly `NULL` on all pre-existing rows.
- **Result**: **PASS**

---

## 4. Index Semantics & Synthetic Fixture Testing

Index isolation and semantics were exercised with synthetic fixtures on the real schema:

| Test Case | Scenario | Expected Behavior | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Properties Unique Key** | Duplicate `(ai=1, client_request_id)` | Reject with `UniqueViolationError` (23505) on `idx_properties_client_request_id` | Caught 23505 duplicate key error | **PASS** |
| **Properties Tenant Scope** | Same `client_request_id` under `ai=2` | Accepted without error | Row inserted successfully | **PASS** |
| **Properties Partial Predicate** | Multiple rows with `client_request_id = NULL` under same `ai=1` | Accepted without collision | Rows inserted successfully | **PASS** |
| **Matter Properties Unique Key** | Duplicate `(ai=1, client_request_id)` | Reject with `UniqueViolationError` (23505) on `idx_matter_properties_client_request_id` | Caught 23505 duplicate key error | **PASS** |
| **Matter Properties Tenant Scope** | Same `client_request_id` under `ai=2` | Accepted without error | Row inserted successfully | **PASS** |
| **Matter Properties Partial Predicate**| Multiple rows with `client_request_id = NULL` under same `ai=1` | Accepted without collision | Rows inserted successfully | **PASS** |
| **Tenant Derivation Trigger** | Insert `matter_properties` row | Trigger `trg_matter_properties_set_tenant` derives `ai` from parent matter into indexed column | Derived `accountable_institution_id = 1` | **PASS** |

---

## 5. Rerun & `IF NOT EXISTS` Behavior

1. **Migration Runner Rerun**: Re-running `node scripts/migrate.mjs` against the applied database cleanly detected the ledger entry and logged:
   `⏭️ Skipping 024_deedly_property_link_idempotency.sql (already applied ...)`
2. **Raw SQL Idempotency**: Re-executing the raw SQL file directly against the database completed with 0 errors; all `ADD COLUMN IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` clauses executed as safe no-ops without altering existing definitions.
3. **Result**: **PASS**

---

## 6. Bounded Application Compatibility & Discovered Defects

### 6.1 Discovered Defect: `public.generate_property_id()` (BLOCKING)
- **Error**: `AmbiguousColumnError: column reference "property_id" is ambiguous (SQLSTATE 42702)`
- **Origin**: Migration 002 (`002_add_properties_table.sql`, lines 130–149).
- **Trigger**: Called by `matter_property_service.py` (`_insert_property()`) via `VALUES (generate_property_id(), ...)`.
- **Root Cause**:
  ```sql
  CREATE OR REPLACE FUNCTION generate_property_id() RETURNS TEXT AS $$
  DECLARE
      ...
      property_id TEXT;  -- Local variable name
  BEGIN
      ...
      -- Collides with table column properties.property_id:
      WHILE EXISTS (SELECT 1 FROM properties WHERE property_id = property_id) LOOP
  ```
  PostgreSQL PL/pgSQL cannot disambiguate `property_id = property_id` between the column and the variable.
- **Why It Evaded Scratch Tests**: `python_server/tests/test_v1_matter_properties_db.py` replaced `generate_property_id()` with a synthetic dummy SQL function in the scratch schema, masking the production defect.
- **Fix Verified**: Disambiguating the variable (`v_property_id TEXT` and `WHERE properties.property_id = v_property_id`) completely resolves the issue.

### 6.2 Application Compatibility Results (with Disambiguated Function)
With `generate_property_id()` temporarily patched in `conveyhub_isolated`, the full FastAPI application surface was tested via `httpx`:

1. **Manual Property Capture & Link (`POST /api/v1/transfers/{id}/properties`)**:
   - HTTP 201 Created. Link and property created atomically with `client_request_id` and `request_fingerprint`.
2. **Idempotent Replay**:
   - HTTP 200 OK. Re-sending identical payload with the same `client_request_id` returned the original property and link without creating duplicate rows.
3. **Conflicting Replay (Altered Payload)**:
   - HTTP 409 Conflict. Re-sending the same `client_request_id` with a modified address was rejected.
4. **Cross-Institution Isolation**:
   - Institution 2 attempting to link or read Institution 1's transfer returned HTTP 404/403.
   - Institution 2 reusing Institution 1's `client_request_id` under its own matter succeeded without collision (HTTP 201 Created).
5. **Atomic Rollback on Link Failure**:
   - Passing an unlinked/invalid matter ID aborted the operation; verified 0 orphan properties were left in `transfers.properties`.
6. **Readback Projection (`GET /api/v1/transfers/{id}/properties`)**:
   - HTTP 200 OK. Returned allow-listed property projection including `client_request_id`.

### 6.3 Trigger & View Dependencies
- **Audit Trigger (`audit_properties_trigger`)**: Real trigger fired and recorded `INSERT` in `public.audit_log` with JSON payload containing `client_request_id`.
- **Timestamp Trigger (`update_properties_updated_at`)**: Real trigger correctly updated `updated_at` on property mutation.
- **Postal Code Function (`validate_sa_postal_code()`)**: Evaluated real function: `'8001'` -> `True`, invalid format -> `False`.
- **`property_details` View**: Confirmed intentionally dropped in Migration 010; no active application dependency exists.

---

## 7. Rollback & Environment Cleanup

1. **Rollback DDL Executed**:
   ```sql
   DROP INDEX IF EXISTS transfers.idx_properties_client_request_id;
   DROP INDEX IF EXISTS transfers.idx_matter_properties_client_request_id;
   ALTER TABLE transfers.properties DROP COLUMN IF EXISTS client_request_id, DROP COLUMN IF EXISTS request_fingerprint;
   ALTER TABLE transfers.matter_properties DROP COLUMN IF EXISTS client_request_id, DROP COLUMN IF EXISTS request_fingerprint;
   DELETE FROM public.transfers_schema_migrations WHERE filename = '024_deedly_property_link_idempotency.sql';
   ```
2. **Post-Rollback Verification**:
   - Confirmed columns and indexes completely removed from `information_schema` and `pg_indexes`.
   - Confirmed ledger row deleted.
   - Baseline pre-existing rows remained intact and identical to pre-migration snapshot.
   - `public.generate_property_id()` restored to original unpatched Migration 002 definition.
3. **Final Retention**:
   - Per agreement, Migration 024 was re-applied cleanly via `scripts/migrate.mjs` so `conveyhub_isolated` is retained in the certified migrated state for downstream testing.
   - Final ledger count: exactly 23 migrations (`001`–`021`, `023`, `024`).

---

## 8. Remaining Certification Gaps (Explicit Disclosure)

The following areas remain outside the bounded database verification scope:
1. **Upstream External Authentication**: Tests used local signed JWTs matching BFF verification rules; live upstream Legitify S2S authentication and key rotation remain under integration HOLD.
2. **Production Postal Code Validation**: Verified `validate_sa_postal_code()` on standard 4-digit codes; postal codes outside South Africa or non-standard formats were not certified.
3. **Legacy Composite FK Deletion**: Deleting a property still referenced via `transfers.property_id` fails due to `ON DELETE SET NULL` on non-nullable `accountable_institution_id` (documented in `docs/legacy-property-fk-delete-review.md`). This remains an independent schema issue.
4. **`public.generate_property_id()` Defect Fix**: Requires an approved migration before the manual property capture feature can be released to staging or production.

---

## 9. Verification Sign-Off

- **Migration DDL & Ledger**: **CERTIFIED**
- **Idempotency & Tenant Isolation**: **CERTIFIED**
- **Existing Data Safety**: **CERTIFIED**
- **Deployment Recommendation**: **CONDITIONAL PASS** (Approve Migration 024 DDL; schedule prerequisite fix for `generate_property_id()` before feature launch).
