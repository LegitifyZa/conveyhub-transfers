# Migration 025 — DEEDLY matter documents: handoff for review

**Status:** PROPOSED — authored for review, **not executed** against any
database. Schema additions and numbering are coordinated through Dean to
Jordan. This document is the review artifact; the executable proposal is
`src/lib/migrations/025_deedly_matter_documents.sql` on
`deedly/mvp0/documents/upload-and-readback` (through `70fa7f7`), file
sha256 `adc37e5e674572835d8b3a40ed1760b885a86db617b9b2ddff538e1e8914ba96`.

**Application history:** no application of the earlier revision of this
file has been reported — the only migration execution on record is the
024 verification run (ledger `001`–`021`, `023`, `024`). The file was
revised at `70fa7f7` after a schema-targeting review (see below), so any
environment that somehow applied the pre-revision file should be flagged
before proceeding; none is known.

**Schema targeting (corrected at `70fa7f7`):** `scripts/migrate.mjs`
presets no `search_path`; the file now opens with
`SET LOCAL search_path TO transfers, public` and every table, index,
constraint and reference is `transfers.`-qualified — matching the
023/024 convention so the migration runs identically regardless of the
caller's search_path. The earlier revision was unqualified and would
have failed or misplaced objects under a `public`-first path.

## 0. Relationship to migration 024 — no dependency

**025 does not depend on 024.** The `025` number is authoring sequence
only — it was the next free number when the file was written, and
numbering alone must not be read as a dependency. The two migrations
touch disjoint objects:

- **024** (property branch, `deedly/mvp0/properties/…`) — property /
  matter-linkage tables.
- **025** — `transfer_documents` column additions and the four document
  tables below.

025's actual prerequisites are pre-existing objects only:
`transfer_documents` (created in **005**, moved to the transfers schema
in **010**), `transfers`, `matters`, `bonds`, `transfer_financials`, and
the `uuid_generate_v4()` convention used by earlier migrations. Nothing
created by 024 is referenced. The migrations may be applied in either
order; if a shared migration runner requires strict sequential ordering
that is a tooling constraint, not a schema dependency.

Numbering picture at authoring time: `022` SARS (unmerged), `023`
parties (main), `024` property idempotency (property branch), `025`
this migration (documents branch), **`026` now reserved** —
`026_deedly_generate_property_id_ambiguity_fix.sql` on the property
branch corrects the `generate_property_id()` ambiguity defect found in
Jordan's 024 verification run and must be applied before manual property
capture is enabled.

## 1. Proposed schema (exact)

### A. `transfer_documents` additions

| Column / object | Definition | Purpose |
|---|---|---|
| `accountable_institution_id` | `INTEGER`, backfilled from `transfers`, then `SET NOT NULL` | Direct tenant attribution for idempotency keys, storage and audit (previously only via parent transfer) |
| `idx_transfer_documents_ai` | index on `(accountable_institution_id)` | Tenant-scoped lookups |
| `client_request_id` | `UUID`, nullable | Idempotency key (mirrors the 023 pattern) |
| `request_fingerprint` | `TEXT`, nullable | Payload fingerprint bound to the idempotency key |
| `idx_transfer_documents_client_request` | `UNIQUE (accountable_institution_id, client_request_id) WHERE client_request_id IS NOT NULL` | Institution-scoped idempotent create |
| `requirement_key` | `VARCHAR(150)`, nullable | Links an upload to a requirement instance; NULL = free-form |
| `idx_transfer_documents_requirement` | index on `(transfer_id, requirement_key) WHERE requirement_key IS NOT NULL` | Requirement satisfaction join |
| `storage_key` | `TEXT`, nullable | Internal-only storage locator — never projected |
| `file_instance_id` | `UUID`, nullable | Files-service instance id (dual-write transition field) |
| `sha256` | `VARCHAR(64)`, nullable | Content digest — basis of content-addressed keys and same-bytes replay |
| `scan_status` | `VARCHAR(30) NOT NULL DEFAULT 'not_scanned'` + CHECK `('not_scanned','pending','clean','infected','error')` | Scan state — deliberately separate from lifecycle status and any future human-review state |
| `scan_result` | `VARCHAR(255)`, nullable | Scanner signature/detail |
| `scanned_at` | `TIMESTAMPTZ`, nullable | Scan timestamp |

### B. `document_requirement_rules` — catalogue configuration

`id UUID PK`, `rule_key VARCHAR(150) UNIQUE NOT NULL`,
`display_name VARCHAR(255) NOT NULL`,
`classification_code VARCHAR(100)` (NULL or `'*'` = all classifications),
`condition_key VARCHAR(100)` (NULL = baseline rule; set = conditional,
evaluated against a fixed supported vocabulary),
`sequence_number INTEGER NOT NULL DEFAULT 0`,
`status VARCHAR(30) NOT NULL DEFAULT 'active'` CHECK `('active','retired')`,
`created_at`, `updated_at`.

**Seeded empty by design** — Dean supplies the approved catalogue; the
commented example INSERT is illustrative only and must not be
uncommented as a production rule.

### C. `transfer_document_requirements` — per-matter instances

`id UUID PK`, `transfer_id UUID NOT NULL REFERENCES transfers(id)
ON DELETE CASCADE` (see §3), `accountable_institution_id INTEGER NOT NULL`,
`requirement_key VARCHAR(150) NOT NULL`,
`display_name VARCHAR(255) NOT NULL`,
`source VARCHAR(20) NOT NULL` CHECK `('baseline','conditional')`,
`condition_key VARCHAR(100)`,
`status VARCHAR(20) NOT NULL DEFAULT 'active'` CHECK `('active','withdrawn')`,
`applied_at`, `withdrawn_at`, `created_at`, `updated_at`,
`UNIQUE (transfer_id, requirement_key)`.
Indexes on `(transfer_id)` and `(accountable_institution_id)`.

Recalculation upserts in place; withdrawn is a status, never a delete.

### D. `document_operation_log` — durable reconciliation/audit trail

`id UUID PK`, `occurred_at`, `operation VARCHAR(40)` CHECK over
`document_created | file_uploaded | scan_completed | upload_rejected |
download_link_issued | download_retrieved | download_denied |
requirements_recalculated | audit_delivery_failed`,
`outcome VARCHAR(20)` CHECK `('success','failure','conflict')`,
`accountable_institution_id INTEGER NOT NULL`, `actor_user_id INTEGER`,
`transfer_id UUID` — **deliberately FK-free** so audit/reconciliation
rows survive parent deletion — `document_id UUID`, `detail JSONB`
(identifiers/outcomes only — never file contents, credentials, bearer
tokens, or client-visible paths), `created_at`. Indexes on
`(transfer_id)`, `(document_id)`, `(operation, occurred_at)`.

## 2. Prerequisites and tenant-backfill checks

- Existing `transfer_documents` rows get `accountable_institution_id`
  from their parent transfer (`UPDATE ... FROM transfers WHERE
  td.transfer_id = t.id`). The backfill **assumes every row has a parent
  transfer** — guaranteed by the existing
  `transfer_documents_transfer_id_fkey`. Before `SET NOT NULL` runs,
  verify on the target database:
  `SELECT count(*) FROM transfer_documents td LEFT JOIN transfers t
  ON td.transfer_id = t.id WHERE t.id IS NULL` → must be 0. Any non-zero
  result means orphaned rows the FK does not cover (e.g. deferred
  constraint state) — stop and reconcile before applying.
- Verify no pre-existing rows already carry conflicting column names
  (all `ADD COLUMN IF NOT EXISTS` — re-application is safe, but a
  same-named column with a different type would silently diverge).
- The partial unique index `(accountable_institution_id,
  client_request_id) WHERE client_request_id IS NOT NULL` is safe for
  existing rows (all NULL → nothing indexed). If any environment has
  pre-seeded non-NULL values, check for duplicates first.
- `document_requirement_rules` must remain empty at apply time — no
  seed step is included; seeding waits for Dean's approved catalogue and
  is idempotent by `rule_key` (`ON CONFLICT DO NOTHING` pattern).

## 3. Metadata-cascade protection — unresolved decision (Jordan owns)

`transfer_documents.transfer_id` is `ON DELETE CASCADE`
(`transfer_documents_transfer_id_fkey`, created in 005). A transfer
delete therefore destroys the rows that are the **only metadata record**
of retained storage objects — the "metadata cascade silently destroys
the only record" risk. The §E comment in the migration file is a
proposal, **not active protection** — nothing currently prevents it.

Deletion paths inventoried in the migration file (all currently
non-operational): quarantined `DELETE /api/transfers/:id` on both BFF
and FastAPI with live handlers behind the quarantine,
`TransferService.deleteTransfer`, `useTransfers.deleteTransfer`,
linked-matter deletion inside those handlers, latent
`DatabaseUtils.cleanupOldRecords`, and direct SQL.

**Proposal A (preferred):** `ON DELETE RESTRICT` — forbid deleting a
transfer that still has document metadata; archive instead. Requires
product confirmation that transfer deletion is never valid once
documents exist.

**Proposal B:** keep CASCADE; require the deleting path to tombstone
rows first and orphan storage objects under an explicit retention run.

The same decision applies to `transfer_document_requirements` (CASCADE
above, matching the parent convention). `document_operation_log` stays
FK-free regardless. **Jordan owns the choice** — neither variant is
applied without approval. Physical object deletion is disabled in this
slice (the storage interface has no delete operation).

## 4. Unresolved decisions for review

1. §3 cascade choice (Proposal A vs B) — Jordan + product confirmation.
2. `transfer_document_requirements` FK action — follows the §3 choice.
3. Whether `accountable_institution_id` on `transfer_document_requirements`
   should gain a formal FK to institutions (currently an attributed
   integer, matching `transfers` convention).
4. `document_operation_log` vs the platform audit contract
   (`legitify_auditor` / `AUDIT_DATABASE_URL`): this table is the local
   durable trail; dual-write or hand-off to the platform logger is an
   integration decision once the contract is confirmed.
5. `file_instance_id` semantics once the files-service contract lands —
   whether it is assigned by the service or by this layer.
