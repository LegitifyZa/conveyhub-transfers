# DEEDLY Canonical Specialist Role and Representative-Capacity Contract

**Branch:** `deedly-v1-create`  
**Date:** 2026-08-31  
**Scope:** Design and contract documentation only — no migration, no schema change, no API change, no runtime behaviour.  

## 1. Objective

Step 16S.6a/6a.1 defines the canonical machine-readable specialist role/capacity taxonomy that Step 16S.5f left as `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN`.  It separates Golden Record identity, matter role, legal relationship, representative capacity, represented target, authority basis, evidence state, authority effectiveness, signing eligibility and ownership outcome, and provides the corrected contract for later implementation.

## 2. Findings summary

- The current `transfer_parties` table (migration 008, widened by migration 017) supports one row per `(transfer_id, golden_record_id, role)` and already seeds `transferor` and `transferee` through `party_role_definitions`.
- Migration 017 creates `entity_type_definitions` (`person`, `company`, `trust`) and `classification_party_role_rules`, but **no specialist role/capacity codes have been seeded** (verified by `test_migrations_017.py` and `test_migrations_019.py`).
- `is_primary_contact` is implemented as a communication-only flag and is enforced by a partial unique index on `(transfer_id, role)`.
- No runtime code currently stores `executor`, `executrix`, `masters_representative`, `trustee`, `heir`, `legatee`, `surviving_spouse` or `beneficiary` in production payloads.
- The existing `deedly-party-role-contract-audit.md` explicitly defers the machine codes for the concepts defined in this document.

## 3. Current-state inventory

| Layer | Field / table | Current state | Concepts it currently carries | Overload / gap |
|-------|---------------|---------------|------------------------------|----------------|
| `transfer_parties.golden_record_id` | UUID, NOT NULL | Golden Record identity | 1. Identity only | Correctly separate; no duplication allowed |
| `transfer_parties.entity_type` | `VARCHAR(40)` FK to `entity_type_definitions` | What the entity is (`person`, `company`, `trust`) | 2. Entity type only | No `estate` / `deceased_estate` entity type yet |
| `transfer_parties.role` | `VARCHAR(40)` free text | Matter-party role | 2/3 potential overlap; currently only `transferor`/`transferee` are validated by reference data | Cannot hold specialist concepts as roles |
| `transfer_parties.is_primary_contact` | `BOOLEAN` default `FALSE` | Primary communication contact | 10. Contact designation only | Correctly isolated |
| `entity_type_definitions` | Reference table | Entity type taxonomy | 2. Entity type | `estate`/`deceased_estate` not defined |
| `party_role_definitions` | Reference table | Matter role taxonomy | 3. Matter-party role | Only `transferor`, `transferee` seeded |
| `classification_party_role_rules` | Reference table | Per-classification role rules | 3. Matter-party role | No specialist classification rules seeded |
| `matter_properties` | Table | Property input/output relationship | Property relationship, not party | No party relationship or ownership outcome columns |

No existing field currently represents: matter-specific legal relationship, representative capacity, represented target, estate context, authority basis, evidence state, authority effectiveness, signing eligibility, or ownership outcome.

## 4. Definitions of the ten required concepts

| # | Concept | Meaning | DEEDLY ownership | Example canonical code / field |
|---|---------|---------|------------------|--------------------------------|
| 1 | **Golden Record identity** | Authoritative person/entity identity | Golden Records / Entities service | `golden_record_id` |
| 2 | **Canonical matter-party role** | What the entity is doing in the matter | DEEDLY | `transferor`, `transferee` |
| 3 | **Matter-specific legal relationship** | The legal relationship the party has to the matter context | DEEDLY | `heir`, `surviving_spouse`, `purchaser`, `beneficiary` |
| 4 | **Representative capacity** | The legal capacity in which a person acts for another party or legal context | DEEDLY | `executor`, `masters_representative`, `trustee` |
| 5 | **Represented target** | The party or non-GR matter context being represented | DEEDLY (link) | a trust `transfer_party`, or a `matter_estate_context` |
| 6 | **Authority basis** | The legal instrument or statutory power that supports the capacity | DEEDLY | `letters_of_executorship`, `trust_deed` |
| 7 | **Evidence / document status** | Whether the supporting document has been supplied and verified | DEEDLY | `uploaded`, `verified`, `rejected` |
| 8 | **Authority effectiveness** | Whether the verified authority is still effective for the matter | DEEDLY | `effective`, `lapsed`, `revoked` |
| 9 | **Signing eligibility** | Whether the person may legally sign, derived from 3-8 and classification rules | DEEDLY | `is_eligible_to_sign` (derived) |
| 10 | **Primary-contact status** | Communication/UI convenience | DEEDLY | `is_primary_contact` |

`is_primary_contact` must not confer or imply any of 1-9.

## 5. Proposed canonical taxonomy

### 5.1 Canonical matter-party roles

| Code | Domain | Plain-language meaning | Valid classifications | Permitted GR entity types | Type | Cardinality per matter | Multiple for same GR | Validation | Contributes to signing? | Required? |
|------|--------|------------------------|----------------------|---------------------------|------|------------------------|----------------------|------------|------------------------|-----------|
| `transferor` | All sale/donation/endorsement/inter-spousal | Golden Record-backed entity transferring ownership or interest | All sales, `transfer.donation`, `transfer.endorsement_section_45bis` | `person`, `company`, `trust`, future GR types | Role | 1+ | Yes | Must be GR-backed | Only if it has signing power or a representative | Mandatory where rule requires |
| `transferee` | All sale/donation/endorsement/inheritance | Golden Record-backed entity receiving ownership or interest | All sales, `transfer.donation`, `transfer.deceased_estate_inheritance`, `transfer.endorsement_section_45`, `transfer.endorsement_section_45bis` | `person`, `company`, `trust`, future GR types | Role | 1+ | Yes | Must be GR-backed | Only if it has signing power or a representative | Mandatory where rule requires |

A deceased estate is **not** a Golden Record-backed matter party and therefore does **not** appear as a `transferor` or `estate_party` row in `transfer_parties`. The estate is represented as a `matter_estate_context` that may have one or more associated representative assignments.

### 5.2 Matter-specific legal relationships

| Code | Domain | Plain-language meaning | Valid classifications | Permitted GR entity types | Type | Cardinality | Multiple per transfer party | Validation | Contributes to signing? | Required? |
|------|--------|------------------------|----------------------|---------------------------|------|-------------|-----------------------------|------------|------------------------|-----------|
| `heir` | Deceased estate inheritance | Person entitled under intestate succession | `transfer.deceased_estate_inheritance` | `person` | Relationship | 1+ | Yes | Role must be `transferee` | No | Mandatory for inheritance |
| `legatee` | Deceased estate inheritance | Person entitled under a will (specific bequest) | `transfer.deceased_estate_inheritance` | `person` | Relationship | 1+ | Yes | Role must be `transferee` | No | Optional |
| `surviving_spouse` | Section 45 | Spouse who survives the deceased and is the receiving party | `transfer.endorsement_section_45` | `person` | Relationship | 1 | No | Role must be `transferee` | No | Mandatory for Section 45 |
| `purchaser` | Deceased estate sale | Business label for the receiving buyer | `transfer.deceased_estate_sale` | `person`, `company`, `trust` | Relationship | 1+ | Yes | Role must be `transferee` | No | Optional (UI label only) |
| `beneficiary` | Trust | Person with an interest as a beneficiary of a trust | Trust matters | `person` | Relationship | 1+ | Yes | Usually `transferee` if receiving | No | Optional |

### 5.3 Representative capacities

| Code | Domain | Plain-language meaning | Valid represented targets | Permitted GR entity types | Type | Cardinality | Multiple for same GR | Validation | Contributes to signing? | Required? |
|------|--------|------------------------|--------------------------|---------------------------|------|-------------|----------------------|------------|------------------------|-----------|
| `executor` | Deceased estates | Duly appointed executor of a deceased estate | `matter_estate_context` | `person` | Capacity | 1+ per estate context | Yes across different estate contexts | Must have `letters_of_executorship` or equivalent evidence | Yes, if effective | Mandatory where an executor is the representative |
| `masters_representative` | Deceased estates | Master of the High Court's representative, e.g. curator, tutor, ad litem | `matter_estate_context` | `person` | Capacity | 1+ per estate context | Yes | Must have Master's appointment evidence | Yes, if effective | Optional / conditional |
| `trustee` | Trusts | Person appointed to represent and sign for a trust | `transfer_party` whose `entity_type` is `trust` | `person` | Capacity | 1+ per trust | Yes across different trusts | Trust deed / authority | Yes, if effective and the trust signing rule is satisfied | Mandatory where a trust acts through a person |

`executrix` must not be a separate machine code. UI/document labels may render `Executor` or `Executrix` from `executor` in presentation logic, not in the canonical persistence model.

### 5.4 Authority basis codes

| Code | Domain | Plain-language meaning | Valid classifications | Type | Cardinality | Validation | Required? |
|------|--------|------------------------|----------------------|------|-------------|------------|-----------|
| `letters_of_executorship` | Deceased estates | Letters of executorship issued by the Master | Estate inheritance, estate sale, Section 45 | Authority basis | 0+ per `executor` assignment | Evidence must be supplied and verified | Mandatory for `executor` capacity |
| `masters_appointment_certificate` | Master appointment | Master's certificate appointing a representative | Estate / Section 45 / other Master matters | Authority basis | 0+ per `masters_representative` assignment | Evidence must be supplied and verified | Mandatory for `masters_representative` |
| `section_42_2_endorsement` | Estate sale | Master’s section 42(2) no-objection / endorsement | `transfer.deceased_estate_sale` | Authority basis | 0 or 1 per matter | Supplied and verified before lodgement | Conditional on property/mortgage |
| `section_47_authority` | Estate sale | Authority governing manner and conditions of an executor sale | `transfer.deceased_estate_sale` | Authority basis | 0 or 1 per matter | Establish applicable basis | Conditional on post-death sale |
| `trust_deed` | Trusts | Trust deed or equivalent founding instrument | Any trust matter | Authority basis | 1 per trust | Supplied and verified | Mandatory for `trustee` capacity |
| `letters_of_authority_for_trust` | Trusts | Letters of authority / trustee resolution | Any trust matter | Authority basis | 0+ per trustee assignment | Supplied and verified | Conditional |
| `section_45bis_source_instrument` | Section 45bis | Legal basis for the 45bis endorsement | `transfer.endorsement_section_45bis` | Authority basis | 0+ per matter | Supplied and verified | Mandatory for 45bis |

These codes are reference-data candidates pending legal/conveyancing confirmation.

### 5.5 Evidence / document status

| Code | Meaning | Type |
|------|---------|------|
| `not_supplied` | No evidence recorded yet | Evidence status |
| `uploaded` | Document or evidence has been supplied | Evidence status |
| `pending_verification` | Evidence is awaiting review | Evidence status |
| `verified` | Evidence has been checked and accepted as valid and current | Evidence status |
| `rejected` | Evidence has been checked and rejected | Evidence status |

### 5.6 Authority effectiveness

| Code | Meaning | Type |
|------|---------|------|
| `not_effective` | Authority is not yet established for the matter | Authority effectiveness |
| `effective` | Authority is verified and currently applicable to the matter | Authority effectiveness |
| `lapsed` | Authority has expired | Authority effectiveness |
| `revoked` | Authority has been revoked or superseded | Authority effectiveness |

### 5.7 Signing-eligibility and signatory selection

| Concept | Meaning | Type | Source |
|---------|---------|------|--------|
| `is_eligible_to_sign` | Person may legally sign in this matter | Derived | `capacity` + effective authority + no conflict/disqualification |
| `is_required_signatory` | The classification/workflow requires this person's signature | Derived | Classification rule + capacity + represented target |
| `is_actual_signatory` | The person has actually been selected to sign this document | Selection | Workflow/user selection (not inferred) |

These values must not be persisted as simple booleans in the capacity table.

### 5.8 Ownership outcome

| Code | Domain | Plain-language meaning | Valid classifications | Type | Cardinality |
|------|--------|------------------------|----------------------|------|-------------|
| `sole_ownership` | Section 45bis | One spouse/former spouse becomes the sole owner | `transfer.endorsement_section_45bis` | Ownership outcome | 1 per matter |
| `undivided_shares` | Section 45bis | Both spouses/former spouses retain defined undivided shares | `transfer.endorsement_section_45bis` | Ownership outcome | 1 per matter |
| `heir_ownership` | Inheritance | Ownership devolves to heir(s) | `transfer.deceased_estate_inheritance` | Ownership outcome | 1 per matter |

## 6. Classification applicability matrix

| Classification | Required matter roles | Permitted relationships | Permitted capacities / represented targets | Required authority basis | Ownership outcome | Signing rule |
|----------------|----------------------|-------------------------|-------------------------------------------|--------------------------|-------------------|--------------|
| `transfer.deceased_estate_inheritance` | `transferee` (1+) | `heir`, `legatee` | `executor` / `masters_representative` targeting a `matter_estate_context` | `letters_of_executorship` or `masters_appointment_certificate` | `heir_ownership` | Representative of the estate context signs; heirs do not by default |
| `transfer.deceased_estate_sale` | `transferee` (purchaser, 1+) | `purchaser` | `executor` / `masters_representative` targeting a `matter_estate_context` | `letters_of_executorship` / `masters_appointment_certificate`; `section_47_authority`; `section_42_2_endorsement` (conditional) | Sale to purchaser | Representative of the estate context signs; purchasers sign as transferees |
| `transfer.endorsement_section_45` | `transferee` | `surviving_spouse` | `executor` / `masters_representative` targeting a `matter_estate_context` | `letters_of_executorship` / `masters_appointment_certificate` | Transfer to surviving spouse | Executor / Master’s representative signs for the estate context; surviving spouse signs as transferee |
| `transfer.endorsement_section_45bis` | `transferor`, `transferee` (or both, depending on outcome) | — | `executor` / `masters_representative` only if the represented target is a `matter_estate_context` | `section_45bis_source_instrument` | `sole_ownership` or `undivided_shares` | Signatories depend on the chosen ownership outcome and the represented target. Trust signing threshold remains unresolved |
| Trust participation (classification-agnostic) | `transferor` or `transferee` for the trust | `beneficiary` (optional) | `trustee` targeting the trust `transfer_party` | `trust_deed` / `letters_of_authority_for_trust` | As determined by classification | Trustee(s) with effective capacity sign for the trust; the trust itself never signs |

## 7. Conceptual entity and persistence model

### 7.1 Core entities

- `transfer_parties` — one row per `(transfer_id, golden_record_id, role)` for Golden Record-backed parties only.
- `matter_estate_contexts` — conceptual, matter-owned, non-GR record representing a deceased estate or estate-side interest. A matter may have more than one.
- `party_relationship_assignments` — zero or more relationship codes per `transfer_parties` row.
- `representative_assignments` — one row per person-capacity-target combination.
- `authority_bases` — reference data for legal instruments.
- `authority_documents` — evidence records attached to an assignment.
- `authority_effectiveness` — derived or cached legal-effectiveness state per assignment.

### 7.2 `matter_estate_contexts` (conceptual table)

```text
id                           UUID PRIMARY KEY
transfer_id                  UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE
deceased_golden_record_id    UUID              -- subject of the estate; not the estate's identity
masters_estate_reference     TEXT
estate_reference             TEXT
accountable_institution_id   INTEGER NOT NULL
created_by_actor_id          TEXT
updated_by_actor_id          TEXT
created_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

- A matter may have many `matter_estate_contexts`.
- `deceased_golden_record_id` references the deceased person; it is not the estate's identity.
- `accountable_institution_id` is derived from `transfers` via a trigger.
- No `transfer_parties` row is created for the estate.

### 7.3 `party_relationship_assignments`

```text
id                           UUID PRIMARY KEY
transfer_party_id            UUID NOT NULL REFERENCES transfer_parties(id) ON DELETE CASCADE
relationship_code            VARCHAR(40) NOT NULL  -- e.g. heir, surviving_spouse, purchaser, beneficiary
accountable_institution_id   INTEGER NOT NULL
created_by_actor_id          TEXT
updated_by_actor_id          TEXT
created_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
UNIQUE (transfer_party_id, relationship_code)
```

- Zero or more relationships per transfer party.
- Same Golden Record can therefore be both an `heir` and a `surviving_spouse` through separate `transfer_parties` rows or the same row with multiple relationship assignments, depending on the matter structure.
- Tenant anchoring is derived from `transfer_parties`.

### 7.4 `representative_assignments`

```text
id                              UUID PRIMARY KEY
transfer_id                     UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE
person_golden_record_id         UUID NOT NULL
capacity                        VARCHAR(40) NOT NULL  -- executor, masters_representative, trustee
represented_transfer_party_id   UUID REFERENCES transfer_parties(id) ON DELETE CASCADE
represented_estate_context_id   UUID REFERENCES matter_estate_contexts(id) ON DELETE CASCADE
authority_basis                 VARCHAR(40)
accountable_institution_id      INTEGER NOT NULL
created_by_actor_id             TEXT
updated_by_actor_id             TEXT
created_at                      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP

CHECK (num_nonnull(represented_transfer_party_id, represented_estate_context_id) = 1)
UNIQUE (transfer_id, person_golden_record_id, capacity, represented_transfer_party_id) WHERE represented_transfer_party_id IS NOT NULL
UNIQUE (transfer_id, person_golden_record_id, capacity, represented_estate_context_id) WHERE represented_estate_context_id IS NOT NULL
```

- The represented target is exactly one of: a `transfer_party` (e.g. a trust) or a `matter_estate_context`.
- The design preserves foreign-key integrity by using two explicit nullable columns with a `CHECK` constraint, not a generic `target_type`/`target_id` pair.
- `person_golden_record_id` is the representative person; `represented_*` is what they represent.
- A Golden Record may hold many representative assignments, even in the same matter, as long as the represented target differs.
- No `is_required_signatory` or `is_eligible_to_sign` column is persisted here.

### 7.5 `authority_documents`

```text
id                           UUID PRIMARY KEY
assignment_id                UUID NOT NULL REFERENCES representative_assignments(id) ON DELETE CASCADE
document_catalogue_id        UUID
document_type                VARCHAR(40)  -- e.g. letters_of_executorship, trust_deed
evidence_status              VARCHAR(40) NOT NULL DEFAULT 'not_supplied'  -- uploaded, pending_verification, verified, rejected
verified_at                  TIMESTAMPTZ
verified_by_actor_id         TEXT
accountable_institution_id   INTEGER NOT NULL
created_by_actor_id          TEXT
updated_by_actor_id          TEXT
created_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

- Separates the evidence record from the assignment itself.
- One assignment may have multiple documents (e.g. letters of executorship plus supplementary evidence).

### 7.6 `authority_effectiveness`

```text
id                           UUID PRIMARY KEY
assignment_id                UUID NOT NULL REFERENCES representative_assignments(id) ON DELETE CASCADE
effective_status             VARCHAR(40) NOT NULL DEFAULT 'not_effective'  -- effective, lapsed, revoked
reason                       TEXT
evaluated_at                 TIMESTAMPTZ
accountable_institution_id   INTEGER NOT NULL
created_by_actor_id          TEXT
updated_by_actor_id          TEXT
created_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
updated_at                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

- Tracks the legal-effectiveness state for the matter independently of the document verification state.
- Derived from verified evidence, conflicts, expiry and revocation.

## 8. Cardinality rules

- `transfer_parties`: one row per `(transfer_id, golden_record_id, role)`.
- `matter_estate_contexts`: one row per estate context; many per matter allowed.
- `party_relationship_assignments`: one row per `(transfer_party_id, relationship_code)`; many per transfer party allowed.
- `representative_assignments`: one row per `(transfer_id, person_golden_record_id, capacity, represented target)`; multiple per person allowed across different targets or matters.
- `authority_documents`: many per `representative_assignment`.
- `authority_effectiveness`: one current row per assignment; historical rows may be retained for audit.

## 9. Multi-capacity examples

### 9.1 Surviving spouse and executor

- One Golden Record for the surviving spouse.
- A `transfer_parties` row with role `transferee` and `party_relationship_assignments` containing `surviving_spouse`.
- A `matter_estate_context` row records the deceased estate context.
- A `representative_assignments` row for the same Golden Record with `capacity = 'executor'`, `represented_estate_context_id` pointing to the estate context.
- The person signs estate-side documents by virtue of the effective `executor` assignment and signs as transferee for the Section 45 receiving documents.
- No fake estate `transfer_parties` row is created and the person’s Golden Record is not duplicated.

### 9.2 Beneficiary and executor

- A person is a `transferee` with relationship `heir` (or `beneficiary`).
- The same Golden Record also has a `representative_assignments` row as `executor` for the `matter_estate_context`.
- The `heir` relationship and the `executor` capacity are separate records.

### 9.3 Trustee and personal purchaser

- A trust has a `transfer_parties` row as `transferee` (purchaser) with `entity_type = 'trust'`.
- A natural person has a `representative_assignments` row with `capacity = 'trustee'` and `represented_transfer_party_id` pointing to the trust row.
- If the same natural person also purchases in a personal capacity, that same Golden Record has a second `transfer_parties` row as `transferee` for the personal purchase.
- The two capacities are distinct and the Golden Record is not duplicated.

### 9.4 Multiple estate contexts

- A matter may involve two deceased co-owners.
- Two `matter_estate_contexts` rows are created.
- Each estate context may have its own `executor` or `masters_representative` assignment.
- The purchaser is the same `transferee`.

## 10. Authority and signing state model

### 10.1 State separation

| Dimension | State / values | Notes |
|-----------|----------------|-------|
| A. Representative assignment | `active`, `withdrawn`, `superseded` | Lifecycle of the capacity assignment |
| B. Authority basis / grant | `letters_of_executorship`, `masters_appointment_certificate`, `trust_deed`, `section_45bis_source_instrument`, etc. | Reference-data codes pending legal confirmation |
| C. Evidence / document status | `not_supplied`, `uploaded`, `pending_verification`, `verified`, `rejected` | Document-level verification |
| D. Authority effectiveness | `not_effective`, `effective`, `lapsed`, `revoked` | Matter-level legal effectiveness |
| E. Signing eligibility | `is_eligible_to_sign` | Derived: capacity + effective authority + no conflict |
| F. Actual signatory selection | `is_actual_signatory` | Workflow selection, not persisted in the capacity table |

### 10.2 Typical state flow

```
assignment active
  |
  v
evidence uploaded
  |
  v
evidence verified
  |
  v
authority effective
  |
  v
person is eligible to sign
  |
  v
workflow selects actual signatory
```

A transition to `lapsed` or `revoked` can occur from any later state.

### 10.3 Signing-eligibility rule

A person is `is_eligible_to_sign` when all of the following are true:

1. They hold a representative assignment that is applicable to the matter, or they are an ordinary `transferor`/`transferee` with legal signing power.
2. The corresponding evidence is `verified` and the authority is `effective`.
3. No related-party or conflict rule disqualifies them.
4. The represented target is still active in the matter.

`is_primary_contact` is never used in this derivation.

## 11. Backward-compatibility strategy

The later implementation must first audit the actual existing data for any of the following values stored in `transfer_parties.role`, in cache columns, or in legacy payload fields:

- `executor`
- `executrix`
- `masters_representative`
- `trustee`
- `surviving_spouse`
- `heir`
- `legatee`
- `beneficiary`

If any such rows exist, the migration must:

1. Leave `golden_record_id` untouched.
2. Map the canonical matter role from the classification and business context.
3. Convert `executor`, `executrix`, `masters_representative` and `trustee` into `representative_assignments` targeting the correct represented target.
4. Normalise `executrix` to the machine code `executor`; gendered rendering is presentation logic only.
5. Convert `surviving_spouse`, `heir`, `legatee`, `beneficiary` and `purchaser` into `party_relationship_assignments` linked to the correct `transfer_parties` row.
6. If `estate` values were stored, create or reference a `matter_estate_context` and re-target representative assignments accordingly.

No destructive translation should be performed until the audit results are known.

## 12. Tenant isolation and provenance

- Every matter-owned table (`matter_estate_contexts`, `party_relationship_assignments`, `representative_assignments`, `authority_documents`, `authority_effectiveness`) carries `accountable_institution_id`.
- `accountable_institution_id` is derived from the parent (`transfers` or `transfer_parties`) via a `BEFORE INSERT OR UPDATE` trigger, matching the existing `matter_properties` pattern.
- Cross-tenant parent/child associations must be rejected at the database level and tested in implementation.
- Actor provenance is stored as UUID/text references to the central identity service (`created_by_actor_id`, `updated_by_actor_id`, `verified_by_actor_id`), without foreign keys to deprecated DEEDLY-local user tables.
- `created_at`, `updated_at` and `update_updated_at_column` triggers are applied to every new table.

## 13. Schema / API / runtime implications for later implementation

### 13.1 Data model

- Create the conceptual tables listed in §7.
- Seed `representative_capacity_definitions` with `executor`, `masters_representative`, `trustee` only after confirmation.
- Seed `party_relationship_definitions` with `heir`, `legatee`, `surviving_spouse`, `purchaser`, `beneficiary` after confirmation.
- Add `estate` / `deceased_estate` to `entity_type_definitions` only if and when Golden Records supports it.
- Do not add `estate_party` to `party_role_definitions`.

### 13.2 API changes

- `GET /api/v1/transfers/{id}/parties` should expose `role`, `relationships`, `representative_assignments`, `authority_documents`, `authority_effectiveness`, and `ownership_outcome` as separate concepts.
- `POST` / `PUT` party endpoints must accept `relationship_code` and `representative_assignment` (capacity + target) separately from `role`.

### 13.3 Validation changes

- `executor`, `trustee`, `masters_representative` must not be accepted as `role` values.
- A `representative_assignment` must specify exactly one represented target.
- `is_primary_contact` must not imply signing eligibility.

## 14. Unresolved questions and confirmation required

| # | Unresolved question | Required confirmation |
|---|---------------------|----------------------|
| 1 | Does Golden Records support an `estate` or `deceased_estate` entity type? | Architecture |
| 2 | Exact Master’s certificate / appointment codes that fall under `masters_representative` | Legal/conveyancing |
| 3 | Executor authority subtypes and exact evidence requirements | Legal/conveyancing |
| 4 | Trust signing threshold and trustee resolution rules | Legal/conveyancing + Legitify business |
| 5 | Section 45bis source-instrument subtypes (divorce order, settlement agreement, court order, etc.) | Legal/conveyancing |
| 6 | Section 45bis estate involvement and when an executor is required | Legal/conveyancing |
| 7 | Heir versus legatee validation consequences and reporting differences | Legal/conveyancing + Legitify business |
| 8 | Ownership-outcome rules and share modelling for Section 45bis and inheritance | Legal/conveyancing + Legitify business |
| 9 | Presentation logic for `executrix` and other gendered labels | Legitify business (UX) |
| 10 | Whether `is_primary_contact` may be shown on capacity-related UI rows | Legitify business |

## 15. Smallest safe scope for Step 16S.6b

1. Create `party_relationship_assignments` and `representative_assignments` tables with the dual FK target pattern, tenant triggers and actor provenance columns.
2. Add the `authority_documents` table to separate evidence status from the capacity.
3. Seed only the three confirmed representative-capacity codes (`executor`, `masters_representative`, `trustee`) and the five relationship codes (`heir`, `legatee`, `surviving_spouse`, `purchaser`, `beneficiary`) as reference data.
4. Add the `matter_estate_contexts` table as a non-GR, matter-owned structure only after architecture confirms the synthetic-context approach.
5. Do **not** implement classification-specific validation, signing routing, or the `estate` entity type in `entity_type_definitions`.
6. Do **not** implement `authority_effectiveness` as a workflow engine; keep it as a derived state for now.

This scope builds the structural foundation while keeping unresolved legal and business rules open.
