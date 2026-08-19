# ConveyHub Transfers — Data Boundary Audit

**Branch:** `deedly-fastapi-integration`  
**Date:** 2026-08-19  
**Architecture source:** `Documentation/Transfers Integration Handover.pdf` (supersedes older integration docs where stated)  
**Scope:** SQL migrations in `src/lib/migrations/` and Python API query patterns in `python_server/routers/`. No code changes were made.

## 1. Summary of the handover rules

The handover defines the following data-ownership boundaries for the new Transfers service:

- Transfers working data lives in the `legitify` database under the `transfers` schema.
- Transfers must **never** read or write the `legitify_golden_record` database; all person/company/property canonical data is reached over HTTP through the `entities` service (port 8003).
- Golden Record owns canonical person/company identity, addresses, FICA/AML status and verified bank-account data.
- Transfers owns the matter-specific workflow, roles, property working data, financials, SARS state, milestones and fees.
- Parties must reference `golden_record_id` (a UUID) and may cache only display fields (`cached_name`, `cached_id_number`, etc.) plus a `synced_at` timestamp.
- No Transfers-local `users` table is allowed; authentication comes from the platform `users.users` table via JWT and the shared `CurrentUser` dependency.
- Every business record must be owned by an `accountable_institution_id` (tenant). Setup/config data may use `tenant_id` where appropriate.
- The platform `AuditLogger` and `legitify_auditor` database are the intended immutable audit mechanism, not a local Transfers `audit_log` table.
- The `files` service (port 8005, MinIO/S3) owns binary document storage; transfers only keeps pointers/status.
- Events flow through the shared `EventBus` backed by Redis.

## 2. Table classification

| Table | Classification | Notes |
|-------|---------------|-------|
| `users` | **DEPRECATE** | Local `users` table must not exist in the final architecture. |
| `firms` | **DEPRECATE** | Replaced by platform `accountable_institution` concept. |
| `user_preferences` | **DEPRECATE** | Belongs to the `users` service. |
| `matters` | **CHANGE** | Valid concept; must move to `accountable_institution_id` and drop local `users` FKs. |
| `transfers` | **CHANGE** | Valid concept; add `accountable_institution_id`, remove `submitted_by` local user FK. |
| `parties` | **CHANGE** | Must become `golden_record_id`-referenced cache, not a source of identity. |
| `matter_parties` | **DEPRECATE** | Role mapping can be folded into `transfer_parties` / `parties`. |
| `party_bank_accounts` | **DEPRECATE** | Golden Record owns canonical bank-account identity. |
| `golden_record_links` | **DEPRECATE** | `golden_record_id` should sit directly on `parties`/`properties`. |
| `properties` | **CHANGE** | Local working data is allowed, but must be enriched from the Loom/Golden Record pipeline and scoped by tenant. |
| `transfer_financials` | **KEEP** | Financials are Transfers-owned, but need tenant scoping. |
| `milestone_definitions` | **KEEP** | Transfers-specific config table. |
| `matter_milestones` | **CHANGE** | Workflow state is Transfers-owned, but `assigned_to` must become a platform `user_id` int. |
| `milestone_history` | **CHANGE** | Same as `matter_milestones`; `changed_by` must be platform `user_id` int. |
| `documents` | **DEPRECATE** | Binary document storage belongs to the `files` service; metadata tracking belongs in `transfer_documents` or `files`. |
| `transfer_documents` | **CHANGE** | Track required/uploaded status; remove `file_path` and `uploaded_by` local user, reference `files` service. |
| `audit_log` | **DEPRECATE** | Use the platform `AuditLogger` to `legitify_auditor`. |
| `activity_log` | **DEPRECATE** | Same as `audit_log`. |
| `fica_verifications` | **DEPRECATE** | FICA/AML status is owned by the Golden Record; use workflow milestones for tracking. |
| `bonds` | **DECISION REQUIRED** | The handover does not establish final module ownership for bond registration. |
| `cancellations` | **DECISION REQUIRED** | The handover does not establish final module ownership for cancellations/refunds. |
| `refunds` | **KEEP** | Matter-specific, but needs `accountable_institution_id` and no local `users` FKs. |
| `municipal_accounts` | **KEEP** | Matter/property working data, needs tenant scoping. |
| `clearance_records` | **KEEP** | Matter working data, needs tenant scoping. |
| `transfer_guarantees` | **KEEP** | Matter working data, needs tenant scoping. |
| `transfer_conditions` | **KEEP** | Matter working data, needs tenant scoping. |
| `compliance_certificates` | **KEEP** | Matter working data, needs tenant scoping. |
| `matter_accounts` | **KEEP** | Matter financial working data, needs tenant scoping. |
| `matter_account_entries` | **KEEP** | Matter financial working data, needs tenant scoping. |
| `communications` | **DECISION REQUIRED** | Could stay as a local log or move to the `notifications` service; needs `accountable_institution_id` and platform `user_id`. |
| `template_data_fields` | **DECISION REQUIRED** | Document-template scaffolding; likely belongs in the `documents` service (port 8011). |
| `document_catalogue` | **DECISION REQUIRED** | Document catalogue likely belongs in the `documents` service. |
| `document_catalogue_*` | **DECISION REQUIRED** | Document catalogue relationships likely belong in the `documents` service. |
| `document_templates` | **DECISION REQUIRED** | Template design/fill belongs in the `documents` service. |
| `document_template_versions` | **DECISION REQUIRED** | Belongs in the `documents` service. |
| `template_version_*` | **DECISION REQUIRED** | Belongs in the `documents` service. |
| `clauses` / `clause_versions` | **DECISION REQUIRED** | Clause library likely belongs in the `documents` service. |
| `generated_documents` | **DECISION REQUIRED** | Generated document records may stay as Transfers working data or move to `documents` service. |
| `generated_document_clauses` | **DECISION REQUIRED** | Depends on generated-documents ownership. |
| `document_parties` | **DECISION REQUIRED** | Depends on documents ownership. |
| `views` (transfer_summary, party_details, etc.) | **DEPRECATE** | Built on the wrong ownership model; will be rebuilt. |

## 3. Detailed table conflicts

### `users`

- **Current:** `users` table is created in `001_initial_schema.sql` with `id UUID PRIMARY KEY`, `email`, `name`, `role`. Many tables FK to `users(id)`. `python_server/routers/users.py` provides local user management.  
- **Target:** No Transfers-local `users` table; the platform `users.users` table is the source. JWT `CurrentUser` provides `user_id` (int), `accountable_institution_id` (int), `tenant_id` (UUID), `golden_record_id` (UUID) and abilities.  
- **Migration risk:** **High**. Dropping `users` breaks almost every FK in the current migrations and the Express backend that depends on them. The `user_id` type changes from UUID to int.  
- **Recommended transition:** Introduce `CurrentUser` dependencies first; add parallel `created_by_user_id`/`updated_by_user_id` int columns alongside the existing UUID columns; dual-write during the transition; eventually drop UUID `users` FKs and the `users` table.

### `firms`

- **Current:** `firms` table stores law-firm profile and trust-account details. `matters`, `activity_log`, `users` all FK to `firms`.  
- **Target:** Tenant ownership is `accountable_institution_id` (int), supplied by the JWT and managed in the `users` service.  
- **Migration risk:** **High**. Firm UUIDs are used as tenant boundaries; they must be mapped to `users.accountable_institutions.id`. Trust-account details may need to move or stay as a per-AI cache.  
- **Recommended transition:** Add `accountable_institution_id` int to all business tables; back-fill by mapping `firms.id` → platform AI id; then remove `firm_id` UUID.

### `matters`

- **Current:** `matters` has `firm_id`, `assigned_to`, `created_by` FKs to local `users`; no `accountable_institution_id`; no `tenant_id`.  
- **Target:** `accountable_institution_id` int owns the row; assignment/creation use platform `user_id` ints.  
- **Migration risk:** **Medium**. Business logic already treats `matters` as the parent workflow container, so the shape is close. FK changes are disruptive.  
- **Recommended transition:** Add `accountable_institution_id` nullable; dual-write from `firm_id` mapping; change `assigned_to`/`created_by` to int references.

### `transfers`

- **Current:** `transfers` has `matter_id`, `property_id`, `submitted_by` to local `users`; `property_address`, `purchase_price` and status. No tenant column.  
- **Target:** `transfers` working data is owned by `accountable_institution_id`; `submitted_by` is a platform `user_id` int; `purchase_price` may live in `transfer_financials`.  
- **Migration risk:** **Medium**. Column reshuffle and tenant scoping.  
- **Recommended transition:** Add `accountable_institution_id`; move `submitted_by` to int; consider whether `purchase_price` should be redundant with `transfer_financials`.

### `parties` / `matter_parties`

- **Current:** `parties` stores `name`, `id_number`, `registration_number`, `email`, `phone`, `address`, `company_name`, `first_name`, `last_name`, `tax_number`. `matter_parties` is a role join table. `parties` has `matter_id` and `transfer_id`.  
- **Target:** `transfer_parties` is the target relationship table. Its core columns are `transfer_id`, `golden_record_id` (UUID, not a DB FK), `entity_type`, `role`, `accountable_institution_id`, and display-cache fields (`cached_name`, `cached_id_number`, `cached_email`, `synced_at`). Do not add `matter_id` unless a concrete workflow requirement is identified; `transfer_id` already binds the party to the matter workflow via `transfers.matter_id`. No identity-of-record columns.  
- **Migration risk:** **High**. The prototype treats `parties` as the source of truth for names/IDs. Migrating means either pre-seeding the Golden Record with existing parties or losing historical data, and rewiring every query.  
- **Recommended transition:** Add a `golden_record_id` column to the existing `parties` table (or create `transfer_parties` in parallel). Back-fill by first searching/reconciling existing `id_number` / `registration_number` values against the Golden Record (`POST /api/v1/entities/search`, `GET /api/v1/entities/{id}`). Only unresolved identities should be submitted to the appropriate `POST /api/v1/entities/submit` (person) or company/trust path, because provider orchestration triggers billable external lookups. Cache the returned canonical fields; later drop `matter_parties` and the raw identity columns.

### `party_bank_accounts`

- **Current:** Stores encrypted `account_number`, `branch_code`, `verification_status`, `verified_by` local `users` FK.  
- **Target:** Bank account identity is canonical in the Golden Record (`person_bank_accounts`, `company_bank_accounts`).  
- **Migration risk:** **High** if account numbers are needed for refunds; **Low** if they can be re-fetched from entities.  
- **Recommended transition:** Replace with a `golden_record_bank_account_id` pointer or fetch the verified account at refund/payment time from the entities service.

### `properties`

- **Current:** `properties` has full cadastral/physical attribute columns. No `accountable_institution_id` and no explicit link to a Golden Record person/company owner or a Loom/provider property reference. Created as a standalone table in `002_add_properties_table.sql`.  
- **Target:** Transfers keeps local property working data (`erf_number`, `title_deed_number`, rates data, etc.) but it must be seeded and refreshed from the existing Loom property pipeline in the Golden Record (`GET /api/v1/entities/{entity_id}/properties`, `POST .../property/{property_key}/full-report`). The property record should link to the owning person/company via `source_owner_golden_record_id` and to the external property record via a Loom/provider property key (naming TBC, e.g. `loom_property_key` / `provider_property_id`). `golden_record_id` is not an identifier for the property itself.  
- **Migration risk:** **Medium**. Existing sample/seed data can be left in place; enrichment can be back-filled.  
- **Recommended transition:** Add `accountable_institution_id`; add `source_owner_golden_record_id` (person/company) and a Loom/provider property reference column (naming TBC); add Loom sync endpoint calls; keep local-only overrides but treat Golden Record as canonical.

### `transfer_financials`

- **Current:** 1:1 with `transfers` by `transfer_id`; stores all fee/financial columns. No tenant.  
- **Target:** Transfers-owned financial working data. Should be `accountable_institution_id`-scoped and not expose unverified values.  
- **Migration risk:** **Low**. Add `accountable_institution_id` and ensure the API never recomputes without the parent matter scope.  
- **Recommended transition:** Add tenant id and a `calculation_version`/`calculated_by_user_id` int.

### `milestone_definitions` / `matter_milestones` / `milestone_history`

- **Current:** `milestone_definitions` seeded with transfer-specific codes. `matter_milestones` tracks per-matter status with `assigned_to` local `users`. `milestone_history` tracks changes with `changed_by` local `users`.  
- **Target:** `milestone_definitions` is a Transfers config table. `matter_milestones` and `milestone_history` are Transfers workflow data, `accountable_institution_id`-scoped and using platform `user_id` ints.  
- **Migration risk:** **Low** for definitions; **Medium** for history because of local `users` FKs.  
- **Recommended transition:** Keep `milestone_definitions`; add `accountable_institution_id` to `matter_milestones` (or inherit from `matters`); replace `assigned_to` and `changed_by` with platform `user_id` ints.

### `documents` / `transfer_documents`

- **Current:** `documents` stores `file_path` on local disk. `transfer_documents` tracks which catalogue items are required for a transfer and also stores `file_path`, `uploaded_by` local `users` FK.  
- **Target:** Binary data lives in the `files` service (MinIO/S3). Transfers keeps only status, `storage_key`, `file_instance_id` and `uploaded_by_user_id` int.  
- **Migration risk:** **High**. Files are on disk; moving them to MinIO is a bulk migration. `uploaded_by` type changes.  
- **Recommended transition:** Add `storage_key` and `file_instance_id` nullable to `transfer_documents`; continue writing `file_path` until the `files` service is integrated; then batch-upload existing files and drop `file_path`.

### `audit_log` / `activity_log`

- **Current:** `audit_log` is fed by triggers on `users`, `transfers`, `parties`, `documents`, `properties`. `activity_log` is an application-level log with `firm_id` and `user_id` local FKs.  
- **Target:** Use the platform `AuditLogger` to `legitify_auditor`; never keep a local immutable audit.  
- **Migration risk:** **Medium** to high if the existing audit data must be preserved for compliance.  
- **Recommended transition:** Add `AuditLogger` to the FastAPI lifespan; write new audit events to `legitify_auditor`; keep existing `audit_log`/`activity_log` read-only until a data-retention decision is made.

### `fica_verifications`

- **Current:** Tracks per-party FICA status with `verified_by` local `users`.  
- **Target:** FICA/AML is owned by the Golden Record. The only Transfers-side tracking should be workflow milestones (`transferor-fica`, `transferee-fica`).  
- **Migration risk:** **Medium** if the `fica_verifications` rows represent the only record of FICA completion.  
- **Recommended transition:** Query the Golden Record FICA status for display; use existing milestones for the workflow gate. Optionally preserve `fica_verifications` as a read-only historical table until the Golden Record is back-filled.

### `bonds` / `cancellations`

- **Current:** Matter/transfer working data tables. No `accountable_institution_id`.
- **Target:** The handover does not establish final module ownership for bonds or cancellations. They may stay in Transfers, move to another module, or be folded into `matters`/`transfers` workflow.
- **Migration risk:** **Low** if kept, but product decision required before scoping.
- **Recommended transition:** Add `accountable_institution_id` only after ownership is confirmed; otherwise leave read-only or move to the owning module.

### `refunds` / `communications` / `municipal_accounts` / `clearance_records` / `transfer_guarantees` / `transfer_conditions` / `compliance_certificates` / `matter_accounts` / `matter_account_entries`

- **Current:** Matter/transfer working data. All lack `accountable_institution_id`; several FK to local `users` or `parties`.  
- **Target:** `accountable_institution_id`-scoped Transfers working data. User references become platform `user_id` ints. `party_id` becomes `golden_record_id` (UUID, not a DB FK).  
- **Migration risk:** **Low to Medium** once `parties` and `users` are addressed.  
- **Recommended transition:** Add `accountable_institution_id`; replace local-user FKs; replace `party_id` party-local FKs with the party's `golden_record_id` or with the new `transfer_parties` row id.

### `golden_record_links`

- **Current:** External-record mapping with `source_system`, `external_record_id`, `snapshot`.  
- **Target:** Not required. `golden_record_id` should live directly on `parties` and `properties`.  
- **Migration risk:** **Low**. Data can be migrated to the `golden_record_id` column on `parties`/`properties` or simply dropped if the existing prototype has few links.  
- **Recommended transition:** Migrate `party_id` rows to `parties.golden_record_id`; drop `golden_record_links`.

### Document-template scaffolding (`template_data_fields`, `document_catalogue`, `document_templates`, `clauses`, etc.)

- **Current:** Full clause/template library in the Transfers schema, referenced by `generated_documents`.  
- **Target:** The `documents` service (port 8011) is the PDF template designer/filler. Whether Transfers keeps a local `document_catalogue_id` cache or uses the documents API at runtime is a product decision.  
- **Migration risk:** **High** if the document-generation feature is in active use.  
- **Recommended transition:** Decide whether to keep these as Transfers setup/config or move them to the `documents` service; in either case, ensure `tenant_id` is added and `created_by` is a platform `user_id` int.

### Schema name `Transfers`

- **Current:** `database.ts` and `config.py` default the schema name to `Transfers` (capital).  
- **Target:** The handover uses `CREATE SCHEMA IF NOT EXISTS transfers` (lowercase).  
- **Migration risk:** **Low** on a fresh database; **Medium** if the existing deployed database or migrations already refer to the capitalized schema.  
- **Recommended transition:** Inspect existing deployments and the `search_path` in `db.py` before deciding to rename or create a lowercase parallel schema.

## 4. Python API query-pattern conflicts

- **`python_server/routers/transfers.py`** reads and writes `transfers`, `parties`, `properties`, `matters`, `transfer_financials`, `transfer_documents`, `milestone_definitions`, `matter_milestones` directly. It does not call the `entities` service for party identity, property data, or FICA/AML.
- **No tenant filter** is applied in `list_transfers`, `get_transfer`, or any other route. The handover requires `accountable_institution_id` scoping on every business query.
- **No JWT/S2S dependency injection** is used. All routes are public.
- **No audit logging** to a platform `legitify_auditor` or `AuditLogger`; no `transfer.*` events are published.
- **Files are saved to local disk** (`python_server/uploads`) via `save_transfer_document_upload`; the handover expects the `files` service and `storage_key`.

## 5. Ordered migration plan (preserves the working prototype)

1. **Stabilise the current FastAPI bootstrap** (`lifespan`, `app.state.settings`, `redirect_slashes=False`) and keep the existing Express backend untouched. Do not remove or change the existing schema yet.
2. **Add `BaseServiceSettings`/`Settings` fields** (`SECRET_KEY`, `entities_service_url`, `redis_url`, `audit_database_url`, `transfers_service_url`) so the service can reach the platform services without changing current env precedence.
3. **Introduce `CurrentUser` and `require_ability` / `require_jwt_or_service_key` as opt-in route dependencies** on a shadow `/api/v1/transfers` router. The legacy `/api/transfers` paths and the new authenticated `/api/v1/transfers` paths may coexist only in a controlled development/transition environment. The legacy unauthenticated paths must be removed or fully protected before the service is deployed, so that publicly accessible unauthenticated routes do not remain.
4. **Add `accountable_institution_id` nullable columns** to `matters`, `transfers`, `parties`/`matter_parties`, `properties`, `transfer_financials` and all other business tables. Back-fill from the existing `firms` mapping.
5. **Add `golden_record_id` to `parties` (or create `transfer_parties`) and add `source_owner_golden_record_id` plus a Loom/provider property reference to `properties`**. Back-fill by first searching/reconciling existing `id_number` / `registration_number` / title-deed identifiers against the `entities` service. Only unresolved identities should be submitted to the appropriate `POST /api/v1/entities/submit` path, because provider orchestration can trigger billable external lookups. Keep the old identity columns for read-only fallback.
6. **Replace the local `users` references** with platform `user_id` int columns (`created_by_user_id`, `updated_by_user_id`, `assigned_to_user_id`). Dual-write until the `users` table can be removed.
7. **Integrate the `files` service** by adding `storage_key` / `file_instance_id` to `transfer_documents`; continue to write `file_path` until a batch upload can migrate existing files.
8. **Add `AuditLogger` and `EventBus` to the FastAPI lifespan**. Route new audit events to `legitify_auditor` and publish `transfer.*` events; keep the local `audit_log`/`activity_log` read-only.
9. **Add Loom property sync** to `properties`: periodically re-seed/enrich from the Golden Record and store `source_owner_golden_record_id` plus the Loom/provider property reference (naming TBC).
10. **Resolve the schema-name question** (`Transfers` vs `transfers`) after inspecting the existing database and migrations. If a rename is safe, create a final migration and switch `DB_SCHEMA` in `config.py` and `database.ts`.
11. **Once the new paths, auth and data ownership are validated, cut over** by dropping the deprecated tables (`users`, `firms`, `golden_record_links`, `fica_verifications`, `audit_log`, `activity_log`) and removing the legacy identity columns from `parties`/`properties`.

This plan keeps the existing prototype operational at every step and only removes the old structures once the new platform boundaries are in place.
