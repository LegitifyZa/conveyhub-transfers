# DEEDLY Canonical Specialist Role and Representative-Capacity Contract

**Branch:** `deedly-v1-create`  
**Date:** 2026-08-31  
**Scope:** Design and contract documentation only — no migration, no schema change, no API change, no runtime behaviour.  

## 1. Objective

Step 16S.6a defines the canonical machine-readable specialist role/capacity taxonomy that Step 16S.5f left as `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN`.  It separates Golden Record identity, matter role, legal relationship, representative capacity, authority basis, authority status, signing eligibility and ownership outcome, and provides the contract for later implementation.

## 2. Findings summary

- The current `transfer_parties` table (migration 008, widened by migration 017) only supports `role` as a single free-text column and already seeds `transferor` and `transferee` through `party_role_definitions`.
- Migration 017 creates `entity_type_definitions` (`person`, `company`, `trust`) and `classification_party_role_rules`, but **no specialist role/capacity codes have been seeded** (verified by `test_migrations_017.py` and `test_migrations_019.py`).
- `is_primary_contact` is implemented as a communication-only flag and is enforced by a partial unique index on `(transfer_id, role)`.
- No runtime code currently stores `executor`, `executrix`, `masters_representative` or `trustee` in production payloads.
- The existing `deedly-party-role-contract-audit.md` explicitly defers the machine codes for the concepts defined in this document.

## 3. Current-state inventory

| Layer | Field / table | Current state | Concepts it currently carries | Overload / gap |
|-------|---------------|---------------|------------------------------|----------------|
| `transfer_parties.golden_record_id` | UUID, NOT NULL | Golden Record identity | 1. Identity only | Correctly separate; no duplication allowed |
| `transfer_parties.entity_type` | `VARCHAR(40)` FK to `entity_type_definitions` | What the entity is (`person`, `company`, `trust`) | 2. Entity type only | No `estate` / `deceased_estate` entity type yet |
| `transfer_parties.role` | `VARCHAR(40)` free text | Matter-party role | 2/3/4 overloaded potential; currently only `transferor`/`transferee` are validated by reference data | Cannot hold `executor` as capacity without conflating it with the matter role |
| `transfer_parties.is_primary_contact` | `BOOLEAN` default `FALSE` | Primary communication contact | 10. Contact designation only | Correctly isolated |
| `entity_type_definitions` | Reference table | Entity type taxonomy | 2. Entity type | `estate`/`deceased_estate` not defined |
| `party_role_definitions` | Reference table | Matter role taxonomy | 3. Matter-party role | Only `transferor`, `transferee` seeded |
| `classification_party_role_rules` | Reference table | Per-classification role rules | 3. Matter-party role | No specialist classification rules seeded |
| `matter_properties` | Table | Property input/output relationship | Property relationship, not party | No party relationship or ownership outcome columns |

No existing field currently represents: representative capacity, represented legal context, authority basis, authority status, signing eligibility, or ownership outcome.

## 4. Definitions of the ten required concepts

| # | Concept | Meaning | DEEDLY ownership | Example canonical code |
|---|---------|---------|------------------|------------------------|
| 1 | **Golden Record identity** | Authoritative person/entity identity | Golden Records / Entities service | `golden_record_id` |
| 2 | **Canonical matter-party role** | What the entity is doing in the matter | DEEDLY | `transferor`, `transferee`, `estate_party` |
| 3 | **Matter-specific legal relationship** | The legal relationship the party has to the matter context | DEEDLY | `heir`, `surviving_spouse`, `deceased_side` |
| 4 | **Representative capacity** | The legal capacity in which a person acts for another party or legal context | DEEDLY | `executor`, `masters_representative`, `trustee` |
| 5 | **Represented party or legal context** | The entity/estate/trust being represented | DEEDLY (link) | `estate_party` row or `trust` `transfer_party` row |
| 6 | **Authority basis** | The legal instrument or statutory power that supports the capacity | DEEDLY | `letters_of_executorship`, `trust_deed`, `section_45bis_source_instrument` |
| 7 | **Authority-document status** | Where the supplied authority evidence sits in a verification lifecycle | DEEDLY | `claimed`, `supplied`, `verified`, `effective`, `lapsed` |
| 8 | **Signing eligibility** | Whether the person may legally sign in the matter, derived from 3, 4, 5, 6 and 7 | DEEDLY | `is_eligible_to_sign` (derived) |
| 9 | **Ownership outcome** | The resulting ownership configuration where the classification requires one | DEEDLY | `sole_ownership`, `undivided_shares` |
| 10 | **Primary-contact status** | Communication/UI convenience | DEEDLY | `is_primary_contact` |

`is_primary_contact` must not confer or imply any of 1-9.

## 5. Proposed canonical taxonomy

### 5.1 Canonical matter-party roles

| Code | Domain | Plain-language meaning | Valid classifications | Permitted entity types | Type | Cardinality per matter | Multiple for same GR | Validation | Contributes to signing? | Required? |
|------|--------|------------------------|----------------------|------------------------|------|------------------------|----------------------|------------|------------------------|-----------|
| `transferor` | All sale/donation/endorsement | Entity transferring ownership or interest | All sales, `transfer.donation`, `transfer.endorsement_section_45`, `transfer.endorsement_section_45bis` | `person`, `company`, `trust`, future GR types | Role | 1+ | Yes | Must be GR-backed | Indirectly (role + capacity) | Mandatory where rule requires |
| `transferee` | All sale/donation/endorsement/inheritance | Entity receiving ownership or interest | All sales, `transfer.donation`, `transfer.deceased_estate_inheritance`, `transfer.endorsement_section_45`, `transfer.endorsement_section_45bis` | `person`, `company`, `trust`, future GR types | Role | 1+ | Yes | Must be GR-backed | Indirectly | Mandatory where rule requires |
| `estate_party` | Estate / Section 45 | The deceased estate or estate-side interest in the matter | `transfer.deceased_estate_inheritance`, `transfer.deceased_estate_sale`, `transfer.endorsement_section_45` (conditional) | `deceased_estate` / `estate` if GR supports it; otherwise a synthetic context | Role | 1 per estate context | No | Requires estate reference; no duplicate local GR | No — the representative signs | Mandatory for estate-side matters |

### 5.2 Matter-specific legal relationships

| Code | Domain | Plain-language meaning | Valid classifications | Permitted GR entity types | Type | Cardinality | Multiple for same GR | Validation | Contributes to signing? | Required? |
|------|--------|------------------------|----------------------|---------------------------|------|-------------|----------------------|------------|------------------------|-----------|
| `heir` | Deceased estate inheritance | Person entitled under intestate succession | `transfer.deceased_estate_inheritance` | `person` | Relationship | 1+ | Yes | Role must be `transferee` | No | Mandatory for inheritance |
| `legatee` | Deceased estate inheritance | Person entitled under a will (specific bequest) | `transfer.deceased_estate_inheritance` | `person` | Relationship | 1+ | Yes | Role must be `transferee` | No | Optional |
| `surviving_spouse` | Section 45 | Spouse who survives the deceased and is the receiving party | `transfer.endorsement_section_45` | `person` | Relationship | 1 | No per deceased | Role must be `transferee` | No | Mandatory for Section 45 |
| `deceased_side` | Section 45 / estate | The deceased-side interest / estate context in the matter | `transfer.endorsement_section_45`, `transfer.deceased_estate_inheritance` | `person` (deceased) or `estate` context | Relationship | 1 | No | Role must be `transferor` or `estate_party` | No | Mandatory where applicable |
| `purchaser` | Deceased estate sale | Business label for the receiving buyer | `transfer.deceased_estate_sale` | `person`, `company`, `trust` | Relationship | 1+ | Yes | Role must be `transferee` | No | Optional (UI label only) |
| `beneficiary` | Trust | Person who has an interest as a beneficiary of a trust | Trust matters | `person` | Relationship | 1+ | Yes | Usually `transferee` if receiving | No | Optional |

### 5.3 Representative capacities

| Code | Domain | Plain-language meaning | Valid classifications | Permitted GR entity types | Type | Cardinality | Multiple for same GR | Validation | Contributes to signing? | Required? |
|------|--------|------------------------|----------------------|---------------------------|------|-------------|----------------------|------------|------------------------|-----------|
| `executor` | Deceased estates | Duly appointed executor of a deceased estate | `transfer.deceased_estate_inheritance`, `transfer.deceased_estate_sale`, `transfer.endorsement_section_45` (conditional) | `person` | Capacity | 1+ per estate | Yes across different estates | Must have `letters_of_executorship` or equivalent | Yes, if verified | Mandatory where an executor is the representative |
| `masters_representative` | Deceased estates | Master of the High Court's representative, e.g. curator, tutor, ad litem | Same as `executor` plus other Master-appointment matters | `person` | Capacity | 1+ | Yes | Must have Master's appointment certificate | Yes, if verified | Optional / conditional |
| `trustee` | Trusts | Person appointed to represent and sign for a trust | Any trust `transferor`/`transferee` matter | `person` | Capacity | 1+ per trust | Yes across different trusts | Trust deed / letters of authority | Yes, if verified | Mandatory where a trust signs |

`executrix` must not be a separate machine code. UI/document labels may render `Executor` or `Executrix` from `executor` with a label override.

### 5.4 Authority basis

| Code | Domain | Plain-language meaning | Valid classifications | Type | Cardinality | Validation | Required? |
|------|--------|------------------------|----------------------|------|-------------|------------|-----------|
| `letters_of_executorship` | Deceased estates | Letters of executorship issued by the Master | Estate inheritance, estate sale, Section 45 | Authority basis | 1 per `executor` capacity | Must be supplied and verified | Mandatory for `executor` capacity |
| `masters_appointment_certificate` | Master appointment | Master's certificate appointing a representative | Estate / Section 45 / other Master matters | Authority basis | 1 per `masters_representative` capacity | Must be supplied and verified | Mandatory for `masters_representative` |
| `section_42_2_endorsement` | Estate sale | Master's section 42(2) no-objection / endorsement | `transfer.deceased_estate_sale` | Authority basis | 0 or 1 per matter | Supplied and verified before lodgement | Conditional on property/mortgage |
| `section_47_authority` | Estate sale | Authority governing manner and conditions of an executor sale | `transfer.deceased_estate_sale` | Authority basis | 0 or 1 per matter | Establish applicable basis | Conditional on post-death sale |
| `trust_deed` | Trusts | Trust deed or equivalent founding instrument | Any trust matter | Authority basis | 1 per trust | Supplied and verified | Mandatory for `trustee` capacity |
| `letters_of_authority_for_trust` | Trusts | Letters of authority / trustee resolution | Any trust matter | Authority basis | 1 per trustee per matter | Supplied and verified | Conditional |
| `section_45bis_source_instrument` | Section 45bis | Legal basis for the 45bis endorsement (divorce order, settlement agreement, court order) | `transfer.endorsement_section_45bis` | Authority basis | 1 per matter | Supplied and verified | Mandatory for 45bis |

### 5.5 Authority-document status

| Code | Meaning | Type |
|------|---------|------|
| `claimed` | Capacity has been asserted by the party but no evidence yet | Authority status |
| `evidence_supplied` | Document/evidence has been uploaded or recorded but not verified | Authority status |
| `verified` | Evidence has been checked and accepted as valid and current | Authority status |
| `effective_for_matter` | Authority is verified and applicable to this specific matter | Authority status |
| `lapsed` / `revoked` | Authority has expired, been revoked or superseded | Authority status |

### 5.6 Signing-eligibility and signatory selection

| Concept | Meaning | Type | Source |
|---------|---------|------|--------|
| `is_eligible_to_sign` | Person may legally sign in this matter | Derived | `capacity` + `authority_verified` + `effective_for_matter` + no conflict/disqualification |
| `is_required_signatory` | The classification/workflow requires this person's signature | Derived | Classification rule + capacity + represented context |
| `is_actual_signatory` | The person has actually been selected to sign this document | Selection | Workflow/user selection (not inferred) |

### 5.7 Ownership outcome

| Code | Domain | Plain-language meaning | Valid classifications | Type | Cardinality |
|------|--------|------------------------|----------------------|------|-------------|
| `sole_ownership` | Section 45bis | One spouse/former spouse becomes the sole owner | `transfer.endorsement_section_45bis` | Ownership outcome | 1 per matter |
| `undivided_shares` | Section 45bis | Both spouses/former spouses retain defined undivided shares | `transfer.endorsement_section_45bis` | Ownership outcome | 1 per matter |
| `heir_ownership` | Inheritance | Ownership devolves to heir(s) | `transfer.deceased_estate_inheritance` | Ownership outcome | 1 per matter |

## 6. Classification applicability matrix

| Classification | Required matter roles | Permitted relationships | Permitted capacities | Required authority basis | Ownership outcome | Signing rule |
|----------------|----------------------|-------------------------|----------------------|--------------------------|-------------------|--------------|
| `transfer.deceased_estate_inheritance` | `estate_party`, `transferee` (1+) | `heir`, `legatee` | `executor`, `masters_representative` (for `estate_party`) | `letters_of_executorship` or `masters_appointment_certificate` | `heir_ownership` | Representative of `estate_party` signs; heirs do not by default |
| `transfer.deceased_estate_sale` | `estate_party` (transferor/seller), `transferee` (purchaser, 1+) | `purchaser` (UI label) | `executor`, `masters_representative` | `letters_of_executorship` / `masters_appointment_certificate`; `section_47_authority`; `section_42_2_endorsement` (conditional) | Sale to purchaser | Representative of `estate_party` signs; purchasers sign as transferees |
| `transfer.endorsement_section_45` | `estate_party` (deceased side), `transferee` | `deceased_side`, `surviving_spouse` | `executor`, `masters_representative` | `letters_of_executorship` / `masters_appointment_certificate` | Transfer to surviving spouse | Executor / Master's representative signs for the estate; surviving spouse signs as transferee |
| `transfer.endorsement_section_45bis` | `transferor`, `transferee` (or both, depending on outcome) | — | `executor` / `masters_representative` only if one side is an estate | `section_45bis_source_instrument` | `sole_ownership` or `undivided_shares` | Signatories depend on the chosen ownership outcome; both GRs sign if transferring shares |
| Trust participation (classification-agnostic) | `transferor` or `transferee` for the trust | `beneficiary` (optional) | `trustee` | `trust_deed` / `letters_of_authority_for_trust` | As determined by classification | Trustee(s) with verified capacity sign for the trust; the trust itself never signs |

## 7. Representation semantics

A representative-capacity assignment is a first-class record that must never alter the person's Golden Record identity and must never replace or silently add a canonical matter role.

Required elements of a representative-capacity assignment:

- `person_golden_record_id` — the Golden Record that holds the capacity.
- `represented_party_id` — the `transfer_party` or synthetic legal-context row being represented (e.g. the trust, the `estate_party`).
- `matter_id` / `transfer_id` — the matter in which the capacity applies.
- `capacity` — one of `executor`, `masters_representative`, `trustee`.
- `authority_basis` — the legal instrument that supports the capacity.
- `authority_status` — one of `claimed`, `evidence_supplied`, `verified`, `effective_for_matter`, `lapsed`/`revoked`.

One Golden Record must appear in the matter only once per canonical matter role. Capacities are attached to the relevant represented party, not duplicated as new local identities.

## 8. Authority and signing state model

### 8.1 State transitions

```
claimed
  |
  v
evidence_supplied
  |
  v
verified
  |
  v (if still current and applicable)
effective_for_matter
  |
  |---> lapsed / revoked (on expiry, death of authority, conflict finding)
```

- **Claimed** → **evidence_supplied**: a document or reference is uploaded.
- **evidence_supplied** → **verified**: the firm/workflow confirms the evidence is valid and current.
- **verified** → **effective_for_matter**: the authority applies to this specific matter and no conflict/disqualification exists.
- **effective_for_matter** → **lapsed** / **revoked**: the authority expires, is superseded, or a related-party conflict is found.

### 8.2 Signing-eligibility rule

A person is `is_eligible_to_sign` when all of the following are true:

1. They hold a representative capacity that is applicable to the matter (or they are an ordinary `transferor`/`transferee` with signing power).
2. The `authority_status` for that capacity is `effective_for_matter`.
3. No related-party or conflict rule (e.g. Section 49) disqualifies them for this matter.
4. The represented party or legal context is still the active party in the matter.

`is_primary_contact` is never used in this derivation.

## 9. Multi-capacity behaviour

### 9.1 Surviving spouse and executor

- The surviving spouse is one Golden Record.
- They appear as a `transferee` with relationship `surviving_spouse`.
- If they are also the executor, the same GR also has a `party_representative_capacities` row with `capacity = 'executor'` linked to the `estate_party`.
- They sign the estate-side documents in their `executor` capacity, and the Section 45 receiving documents in their `transferee` capacity.

### 9.2 Beneficiary and executor

- A person is an heir/beneficiary (`transferee` with relationship `heir` or `beneficiary`).
- The same GR may also hold an `executor` capacity for the `estate_party`.
- These are separate records; the GR is not duplicated.

### 9.3 Trustee and purchaser / transferee

- A trust is the `transferee` (purchaser). Its GR appears in `transfer_parties`.
- The trustee(s) are natural persons whose GRs are linked to the trust `transfer_party` through `party_representative_capacities` with `capacity = 'trustee'`.
- If one of those trustees is also purchasing personally, that same GR has a separate `transfer_parties` row as `transferee` in their own right — distinct from the `trustee` capacity row.

### 9.4 Primary contact and legal representative

- `is_primary_contact` can be set on any `transfer_parties` row for communication purposes.
- A `trustee` or `executor` may also be marked `is_primary_contact`, but this does not make them eligible to sign; signing eligibility is derived from capacity and authority.

### 9.5 More than one valid representative capacity

- One Golden Record may hold `executor` for one estate and `trustee` for a trust in the same matter if the legal facts support it.
- Each capacity is recorded against the relevant `represented_party_id`.
- The same GR is never inserted as a new local identity for each capacity.

## 10. Backward-compatibility assessment

- No production data currently uses `executor`, `executrix`, `masters_representative`, `trustee` or `surviving_spouse` in the `transfer_parties.role` column.
- If any legacy or prototype payload stores these values as `role`, the migration strategy is:
  1. Leave `golden_record_id` untouched.
  2. Determine the actual canonical matter role (`transferor`, `transferee`, `estate_party`) from the classification and business context.
  3. Convert `role = 'executor'`, `'executrix'`, `'masters_representative'` or `'trustee'` into a `party_representative_capacities` row linked to the represented party.
  4. Normalise `executrix` → `executor`; store the gendered label as a display override, not as a machine code.
  5. Map `surviving_spouse` to the `surviving_spouse` relationship code on the relevant `transferee` row.
- Existing `transferor`/`transferee` data remains valid and does not need migration.
- The `is_primary_contact` flag remains valid and continues to mean communication only.

## 11. Schema / API / runtime implications for later implementation

### 11.1 Likely data-model additions

- `party_representative_capacities` (or equivalent) table with at least:
  - `transfer_party_id` / `represented_party_id` UUID
  - `person_golden_record_id` UUID
  - `capacity` (`executor`, `masters_representative`, `trustee`)
  - `authority_basis`
  - `authority_status`
  - `is_required_signatory` (derived flag)
- Reference-data seeding of new role codes (e.g. `estate_party`), relationship codes, capacity codes, authority basis codes and ownership-outcome codes.
- Possible new entity type `deceased_estate` / `estate` in `entity_type_definitions`, subject to Golden Records contract.
- A matter-level estate-context record or `represented_context` table may be required to avoid duplicating the deceased's identity.

### 11.2 API changes

- `GET /api/v1/transfers/{id}/parties` should expose `role`, `relationship`, `capacities`, `authority`, and `is_eligible_to_sign` as separate fields.
- `POST` / `PUT` party endpoints must accept `capacity`, `authority_basis`, `authority_status` and `represented_party_id` separately from `role`.

### 11.3 Validation changes

- Classification-specific party validation must use `classification_party_role_rules` plus capacity rules.
- `executor` must not be accepted as a `role` value; it is a `capacity`.
- `is_primary_contact` must not imply `is_eligible_to_sign`.

### 11.4 Migration implications

- A future migration will be needed to create the capacity table, add reference data, and possibly add the `estate` entity type / synthetic context.
- No migration is created in Step 16S.6a.

## 12. Unresolved questions requiring business confirmation

1. Is `estate_party` a canonical matter role, or should the estate be modelled as a non-GR `represented_context` with a representative capacity?  
2. Does Golden Records support a `deceased_estate` or `estate` entity type, or must the estate context be synthetic?  
3. Should `heir` and `legatee` remain separate relationship codes, or be merged into a single `heir_legatee` / `beneficiary` code with a sub-type?  
4. For `transfer.endorsement_section_45bis`, is an `estate_party`/`executor` required only when one of the parties is deceased, or for all 45bis endorsements?  
5. Should `surviving_spouse` be a relationship on a `transferee` role, or a separate matter role for Section 45?  
6. What are the exact Master's certificate / appointment codes that fall under `masters_representative`?  
7. What is the signing threshold for trusts — any single trustee, all trustees, or majority?  
8. Should `is_primary_contact` be allowed on a capacity row, or only on the main `transfer_parties` row?  
9. What is the precise legal-basis taxonomy for `section_45bis_source_instrument` (divorce order, settlement agreement, court order, etc.)?  
10. How should the UI label `executrix` be stored and rendered while keeping the machine code `executor`?
