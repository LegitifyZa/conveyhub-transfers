# DEEDLY Party-Role Contract Audit

**Branch:** `deedly-v1-create`  
**Commit base:** `4b769df014cb3ad04ae3a171872e80310667157c`  
**Date:** 2026-08-27  
**Scope:** Design/audit only — no code, migration, or schema changes.  

## 1. Objective

Establish the authoritative DEEDLY party-role contract before any authenticated v1 create-route implementation. The audit deliberately does not invent per-classification roles; it records only what the repository and documented handover currently support, and clearly marks everything else as unresolved.

## 2. Current repo findings

### 2.1 Where party roles live today

| Layer | File / Table | What it assumes about roles |
|-------|-------------|----------------------------|
| Legacy schema | `src/lib/migrations/003_complete_conveyhub_schema.sql` — `matter_parties.role` | `CHECK (role IN ('client', 'purchaser', 'buyer', 'seller', 'transferor', 'transferee', 'borrower', 'lender', 'agent', 'other'))` |
| Target schema | `src/lib/migrations/008_create_transfer_parties.sql` — `transfer_parties.role` | `VARCHAR(40) NOT NULL` with **no** `CHECK` constraint — free text at the database level |
| Target schema | `transfer_parties` unique key | `UNIQUE (transfer_id, golden_record_id, role)` — the same `golden_record_id` may appear in **different** roles on one transfer, but not twice in the same role |
| Target schema | `transfer_parties.entity_type` | `CHECK (entity_type IN ('person', 'company'))` — **no `trust`** support |
| Legacy schema | `parties` table | `entity_type` defaults to `'individual'`; has `first_name`, `last_name`, `company_name`; no trust column |
| Python repository | `python_server/repositories/transfer_parties.py` | Notes: *"Valid role combinations are a later business rule decision; this repository does not constrain them."* Does not call the Entities service |
| Python service | `python_server/services/transfer_party_service.py` (exercised by tests) | `attach_party_to_transfer` accepts any `role` string and resolves only the parent `accountable_institution_id` |
| Python v1 router | `python_server/routers/v1/transfers.py` | Lists/reads `transfer_parties`; does not create parties; authorisation is by `transfer_parties.golden_record_id` + `accountable_institution_id` |
| Legacy Python router | `python_server/routers/transfers.py` | When returning legacy `parties`, it filters `party.type` to `['buyer', 'seller']` only |
| Legacy Node router | `server/routes/transfers.ts` | Same `['buyer', 'seller']` type filter on lines 644 and 920 |
| Frontend (prototype) | `src/components/transfers/StepParties.tsx` | Hard-codes `type: 'buyer' | 'seller'`; requires at least one buyer, one seller, and a primary buyer; this is **prototype UI convenience, not business authority** |
| Frontend (prototype) | `src/pages/NewTransfer.tsx` | Allows selecting DEEDLY classification, but has **no party-role logic tied to the selected classification** |
| Frontend (prototype) | `src/pages/TransferMilestones.tsx` | Hard-codes `buyer` and `seller` detail fields |
| Reference data | `src/lib/migrations/004_seed_reference_data.sql` | `template_data_fields` seeds `Seller.*` and `Purchaser.*` fields; `milestone_definitions` seeds `transferor-fica` and `transferee-fica`; `document_catalogue` lists `Transferee`/`Transferor` account documents |
| Tests | `python_server/tests/test_transfer_parties.py` | Uses `buyer`/`seller`; explicitly tests that the same `golden_record_id` can have two different roles |
| Tests | `python_server/tests/test_v1_transfers.py` | Fixture inserts `buyer` and `seller` rows into `transfer_parties` |
| README / docs | `README.md` | Mentions "Buyer/seller information" as `parties` |
| ERD docs | `docs/ERD_Mermaid.md` | Defines `buyer` as "Property purchaser" |

### 2.2 Role terminology found in the repo

| Term | Found in | Notes |
|------|---------|-------|
| `buyer` | Frontend, legacy routes, tests, README, ERD, `matter_parties` constraint | Prototype UI + legacy schema only; not confirmed as DEEDLY canonical |
| `seller` | Frontend, legacy routes, tests, README, `matter_parties` constraint | Same as above |
| `purchaser` | `template_data_fields`, `document_catalogue`, `TransferMilestones` template data | Template/document terminology; not a `transfer_parties` role code today |
| `transferor` | `milestone_definitions`, `document_catalogue`, `TransferMilestones` | Used only for FICA/account milestones and documents |
| `transferee` | `milestone_definitions`, `document_catalogue`, `TransferMilestones` | Same as above |
| `donor` / `donee` | **Not found** | No repo evidence |
| `executor` / `heir` | Only `deceased_estate_inheritance` classification label | No role terminology found |
| `owner` / `developer` | Only in unrelated migration/seed comments or `owner` in `properties` context | No DEEDLY party-role evidence |

### 2.3 Classification taxonomy (confirmed)

From `src/lib/migrations/015_deedly_classification_taxonomy.sql`, the selectable codes are:

```
transfer.private_treaty.not_applicable
transfer.private_treaty.sectional_title_register
transfer.private_treaty.township_register
transfer.private_treaty.extension_of_scheme
transfer.private_treaty.subdivision
transfer.private_treaty.bulk_transfer
transfer.auction
transfer.sale_in_execution
transfer.property_in_possession
transfer.deceased_estate_inheritance
transfer.endorsement_section_45
transfer.donation
development.new_sectional_title_register
development.new_township_register_establishment
development.scheme_extension_sections
development.subdivision
```

The migration stores `category`, `subtype`, `transfer_from`, display labels, and whether `transfer_from` is required. It does **not** define any party-role requirements per classification.

## 3. Classification-by-classification role evidence

| Classification code | Roles explicitly supported by current code | Documentation / template evidence | Authoritative minimum composition? | Safe for v1 create? | Status |
|---------------------|--------------------------------------------|-----------------------------------|-----------------------------------|---------------------|--------|
| `transfer.private_treaty.not_applicable` | None in schema; prototype UI uses `buyer`/`seller` | `matter_parties` allows `buyer`/`seller` | No | Only with generic minimum rule | UNRESOLVED — BUSINESS DECISION REQUIRED |
| `transfer.private_treaty.sectional_title_register` | None | Same | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.private_treaty.township_register` | None | Same | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.private_treaty.extension_of_scheme` | None | Same | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.private_treaty.subdivision` | None | Same | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.private_treaty.bulk_transfer` | None | Same | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.auction` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.sale_in_execution` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.property_in_possession` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.deceased_estate_inheritance` | None | Classification label only | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.endorsement_section_45` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `transfer.donation` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `development.new_sectional_title_register` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `development.new_township_register_establishment` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `development.scheme_extension_sections` | None | None | No | Only with generic minimum rule | UNRESOLVED |
| `development.subdivision` | None | None | No | Only with generic minimum rule | UNRESOLVED |

**Conflicts worth noting:**

- `matter_parties` (legacy) declares a fixed role list, but `docs/deedly-data-boundary-audit.md` marks `matter_parties` for deprecation and says role mapping should fold into `transfer_parties`. That legacy list is therefore **not** the authoritative DEEDLY contract.
- Prototype UI enforces `buyer` + `seller` + primary buyer, but this is not backed by schema, migration 015, or the data-boundary audit.
- Template/document data dictionary uses `Purchaser`/`Seller`, while milestones use `Transferor`/`Transferee`. These are document-fill labels, not validated `transfer_parties.role` codes.

## 4. Confirmed rules

The following are explicitly confirmed by the user and are safe to rely on for v1 create design:

1. A Transfer may be created once there is a **valid active/selectable classification** and at least **one Golden Record-backed party**.
2. **Zero-party creation is not allowed**.
3. Do **not** globally require one buyer plus one seller.
4. Party roles must ultimately work with `transfers.transfer_parties`.
5. `transfer_parties.role` is currently free text at the DB level.
6. Golden Record entity identity is authoritative.
7. Company/trust submission support is not yet available; do not assume create support that does not exist.
8. `transfer_parties.entity_type` currently allows only `person` and `company`.

## 5. Unresolved business decisions

Before `transfer_parties.role` can be validated at create time, the following must be decided:

1. **Canonical role code list** for DEEDLY transfers (e.g., `buyer`, `seller`, `transferor`, `transferee`, `donor`, `donee`, `executor`, `heir`, `owner`, `developer`, `purchaser`, `client`, `agent`, `other`).
2. **Allowed roles per classification** — which subset of the canonical list is valid for each of the 16 selectable classifications.
3. **Cardinality rules** per role per classification:
   - Is the role required, optional, or repeatable?
   - Minimum and maximum occurrences.
   - Is a "primary" flag required for any role?
4. **Entity-type compatibility** per role — which roles may be `person`, `company`, or (future) `trust`.
5. **Whether `trust` should be supported** as an `entity_type` in `transfer_parties` once trust submission exists.
6. **Document/milestone dependencies** — which roles feed templates (`Purchaser`, `Seller`, `Transferor`, `Transferee`, etc.) and how role codes map to template entities.
7. **Whether the legacy `matter_parties` role check constraint should inform or be ignored** when defining the new contract.

## 6. Proposed role-contract structure (not implemented)

A configuration/reference-data approach is preferred over scattered `if/else` logic. The following shape lets the system validate roles server-side, per classification, without hard-coding rules in create-route code.

### 6.1 Tables / reference data

```
party_role_definitions
- role_code          VARCHAR(40) PRIMARY KEY   -- stable machine-readable code
- label              VARCHAR(100) NOT NULL     -- human-readable label
- description        TEXT
- allowed_entity_types TEXT[]                  -- {'person'}, {'person','company'}, etc.
- is_active          BOOLEAN DEFAULT TRUE

transfer_classification_role_rules
- classification_code   VARCHAR(100) NOT NULL
- role_code             VARCHAR(40) NOT NULL
- min_count             INTEGER DEFAULT 0
- max_count             INTEGER DEFAULT NULL   -- NULL = unlimited
- is_required           BOOLEAN DEFAULT FALSE
- requires_primary      BOOLEAN DEFAULT FALSE
- allows_primary        BOOLEAN DEFAULT FALSE
- entity_types          TEXT[]                 -- override or subset
- PRIMARY KEY (classification_code, role_code)
```

### 6.2 Validation contract

The authenticated v1 create route would:

1. Validate that `classification_code` exists, `is_active = TRUE`, and `is_selectable = TRUE` in `matter_classification_options`.
2. Validate that at least one `transfer_parties` entry is supplied and each has a `golden_record_id`, `entity_type`, and `role`.
3. Validate each `role` against `party_role_definitions.role_code` (generic allow-list).
4. Optionally, when `transfer_classification_role_rules` is populated, validate per-classification `min_count`/`max_count`/`is_required` and `entity_types`.
5. Validate `entity_type` against the allowed set for that role.
6. Reject any role/entity-type combination not in the reference data.

This structure supports:

- Stable machine-readable role codes and human-readable labels.
- Allowed roles per classification.
- Required/optional/repeatable rules.
- Minimum party count (sum of `min_count` per required role).
- Multiple parties with the same role (different `golden_record_id` values).
- Individual/company/trust compatibility as reference data, not code.
- Future document/milestone dependencies via `role_code` → template-data-field mappings.
- Server-side validation independent of UI.
- Future expansion by inserting reference rows, not by changing code.

## 7. Minimum-create rule for authenticated v1 create

**Confirmed minimum rule:**

> Valid active/selectable classification + at least one valid Golden Record-backed party.

**Do not** add stricter role composition (e.g., one buyer + one seller) unless authoritative business rules are supplied for that classification.

## 8. Recommended v1 create scope

### 8.1 Option A: Temporarily exclude unresolved classifications

Only allow `transfer.private_treaty.*` in v1 create because the prototype UI and legacy code already assume `buyer`/`seller` for those.

**Trade-off:**
- **Pros:** The create route can enforce a small, known-looking role set immediately.
- **Cons:** It artificially blocks the other 10 selectable classifications for which the only missing piece is the role contract; it also risks treating the legacy/prototype `buyer`/`seller` assumption as business truth.

### 8.2 Option B: Accept all selectable classifications with a generic validated role contract (recommended)

Allow all 16 selectable classifications. Enforce only the confirmed minimum rule. Store `role` as a validated code from `party_role_definitions`, but do **not** enforce per-classification composition until `transfer_classification_role_rules` is populated.

**Trade-off:**
- **Pros:** v1 create can support the full classification taxonomy immediately; the create route is forward-compatible — as reference data is populated, validation becomes stricter without code changes; it does not invent per-classification rules.
- **Cons:** A user could create a `transfer.donation` with only a `buyer`-coded party, which is semantically odd until donation-specific rules exist; this must be accepted as a temporary design gap and addressed by populating reference data, not by code.

**Recommendation:** Use Option B. The business can then progressively fill `transfer_classification_role_rules` to tighten validation per classification.

## 9. Golden Record implications

1. **Role is transfer-side metadata.** `transfer_parties.role` belongs to the Transfers service; it is not part of the Golden Record canonical identity.
2. **Golden Record remains the authoritative entity identity.** `golden_record_id` is a UUID reference to the Entities service; `transfer_parties` caches only display fields (`cached_name`, `cached_id_number`, `cached_email`, `synced_at`).
3. **`golden_record_id` must not encode party role.** The unique key `(transfer_id, golden_record_id, role)` allows the same entity to play different roles, but the entity ID itself is role-agnostic.
4. **Visibility/authorisation must still be validated server-side.** Current v1 routes (`python_server/routers/v1/transfers.py`) already scope by `accountable_institution_id` and, for clients, by `golden_record_id` membership in `transfer_parties`. Future create/update routes must keep this pattern.
5. **No direct Golden Record database access should be introduced.** The repository layer (`python_server/repositories/transfer_parties.py`) already does not call the Entities service. The create route will need to call the Entities service over HTTP to resolve/validate the `golden_record_id` and cache canonical fields, rather than querying `legitify_golden_record` directly.

## 10. Blockers before implementation

1. **Canonical role code list must be approved.** Without it, `party_role_definitions` cannot be seeded.
2. **Per-classification role rules must be approved.** Without them, the generic minimum rule is the only enforceable check.
3. **Entity-type compatibility per role must be confirmed**, including whether `trust` should be supported.
4. **Primary-party semantics** must be decided (which roles need a primary, if any).
5. **Document/milestone role mapping** must be reconciled — e.g., whether `Purchaser` template fields map to a `buyer` role code or a separate `purchaser` role code.

## 11. Summary report

- **No runtime/schema changes were made.**
- **Working tree:** only this design document added to `docs/`.
- **Current authoritative role evidence:** only the `matter_parties` legacy `CHECK` constraint and the `transfer_parties` free-text `role` column exist. No per-classification role rules are present in migrations, schema, or tests.
- **Classifications with authoritative role evidence:** **None**.
- **Classifications marked unresolved:** **All 16 selectable DEEDLY classifications**.
- **Recommended minimum v1-create party validation:** valid active/selectable classification + at least one Golden Record-backed party; no global buyer/seller requirement.
- **Golden Record implications:** role is transfer metadata; GR is authoritative identity; no direct GR DB access; server-side visibility/tenant scoping required.
- **Business decisions required before Step 16S.5:** canonical role code list, per-classification role rules, entity-type compatibility per role, primary-party semantics, and document/milestone role mapping.
