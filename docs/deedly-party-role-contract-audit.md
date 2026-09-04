# DEEDLY Party and Property Contract

**Branch:** `deedly-v1-create`  
**Commit base:** `730e59c5e6de396291625fee7ecb14f170340e21`  
**Date:** 2026-08-27  
**Scope:** Authoritative design/specification only — no code, migration, schema, or API changes.  

## 1. Objective

This document is the authoritative DEEDLY party and property contract for authenticated v1 create. It consolidates the business decisions now confirmed in Step 16S.4a and locks the minimum creation rules, role/capacity distinctions, Golden Record linking contract, trust handling, and property model for every current classification.

## 2. Foundational concepts

These architectural rules are locked and must not be redefined by future UI or document labels.

- **role** = what the entity is doing in the matter.
- **entity_type** = what the entity is (person, company, trust, or other future Golden Record-supported type).
- **Golden Records** = authoritative identity record for every entity.
- **DEEDLY** = transaction-specific role, capacity, workflow and legal-state rules.

For ordinary transfer-side ownership movement, the canonical backend role codes are:

- `transferor`
- `transferee`

The business meaning of many classifications is already locked, but the following specialist role/capacity machine codes are not yet approved and must be defined during the role/capacity model design:

- deceased-estate estate-side party;
- heir/legatee receiving relationship;
- executor / Master's Representative capacity;
- Section 45 deceased-estate/deceased-side relationship;
- Section 45 surviving-spouse relationship;
- any other specialist relationship where the business meaning is locked but the stable code has not yet been approved.

**Status of these specialist codes:** `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN`.

The implementation must not infer a code merely from the friendly label.

UI and document labels may vary by classification (for example, `Seller / Purchaser`, `Donor / Donee`, `Deceased Estate / Heir`), but those friendly labels must not redefine the underlying identity or role.

## 3. Multiple parties and primary contact

Locked rules:

- Multiple parties with the same legal role are allowed.
- Multiple transferors are allowed on one matter.
- Multiple transferees are allowed on one matter.
- All parties remain legally equal within their role unless a classification-specific rule says otherwise.
- Use `is_primary_contact` only as a communication/UI convenience.
- `is_primary_contact` must not confer ownership, legal authority, signing authority, entitlement, or representative status.
- Do not use display order as the legal concept.

## 4. Entity types

Locked rules:

- `transferor` and `transferee` may be individuals, companies, trusts, or any future Golden Records-supported legal entity type.
- Golden Records owns entity identity and entity type.
- DEEDLY must not create a parallel identity record.
- DEEDLY may apply transaction-specific rules based on the Golden Record entity type.
- `trust` must be a recognised DEEDLY entity type even if Golden Records trust workflows are not yet fully implemented.

**Current repo constraint:** `src/lib/migrations/008_create_transfer_parties.sql` currently constrains `entity_type` to `('person', 'company')`. This is a known transitional limitation. The future migration must not simply replace this with another restrictive `CHECK` list such as `('person','company','trust')`. Instead, the column should be extensible and validation should be reference-data-driven or performed server-side against the approved Golden Records/Entities entity-type contract.

## 5. Golden Record missing-entity rule

Locked workflow for any required entity that does not yet exist in Golden Records:

1. Search Golden Records.
2. If not found, launch/create through the Golden Records creation flow.
3. Wait for a valid `golden_record_id`.
4. Return to DEEDLY and link it.
5. Only then continue creation of the live DEEDLY matter where that entity is required.

Do not create a local DEEDLY substitute identity. Treat "not found" as a create-and-return workflow, not as a permanent failure.

A caller-supplied `golden_record_id` must not be trusted merely because it is a syntactically valid UUID. Future implementation must validate visibility and authorisation through the authorised Entities service before linking.

## 6. Trust rule

Locked rules:

- The trust itself is the matter party.
- A trust may be `transferor` or `transferee`.
- Trustees are linked as representatives/signatories of the trust.
- Trustees are not individually converted into `transferor` or `transferee` merely because they sign.
- Golden Records owns the trust identity and the individual trustee identities.
- DEEDLY owns trust-specific workflow rules, authority checks, signatory requirements, document requirements, and FICA/workflow state.
- `is_primary_contact` remains separate from legal authority.

Future trust workflow may track concepts such as:

- `representative_capacity = 'trustee'`
- `authority_verified`
- `is_required_signatory`

These are not implemented or required in this step.

## 7. Sale-type classifications

The following nine classifications share a common sale-type creation rule:

- `transfer.private_treaty.not_applicable`
- `transfer.private_treaty.sectional_title_register`
- `transfer.private_treaty.township_register`
- `transfer.private_treaty.extension_of_scheme`
- `transfer.private_treaty.subdivision`
- `transfer.private_treaty.bulk_transfer`
- `transfer.auction`
- `transfer.sale_in_execution`
- `transfer.property_in_possession`

**Minimum live-matter creation rule (locked):**

- At least one Golden Record-backed `transferor`.
- At least one Golden Record-backed `transferee`.
- At least one property or property interest.

Also locked:

- Multiple transferors are allowed.
- Multiple transferees are allowed.
- Multiple properties are allowed on one matter.
- `bulk_transfer` must explicitly support multiple properties.
- UI labels may differ by classification, but backend roles remain canonical `transferor` / `transferee`.

## 8. Donation

Classification: `transfer.donation`

Locked rules:

- At least one Golden Record-backed `transferor`.
- At least one Golden Record-backed `transferee`.
- At least one property or property interest.
- Multiple parties and multiple properties are allowed.
- UI/document labels may display `Donor / Donee` while backend roles remain `transferor / transferee`.

## 9. Deceased estate inheritance

Classification: `transfer.deceased_estate_inheritance`

Locked rules:

- The deceased estate is the estate-side party.
- The heir/legatee is the receiving party.
- The executor/executrix or applicable Master’s Representative acts as representative of the estate.
- The representative is not themselves converted into the `transferor` merely because they sign or administer the estate.
- At least one property or property interest is required.
- Multiple heirs and multiple properties are allowed.
- Golden Records remains authoritative for identities.
- DEEDLY owns representative capacity and estate-specific workflow.

**Approved taxonomy row:**

- Classification: `transfer.deceased_estate_sale`
- Taxonomy classification: `APPROVED` (seeded in migration 020)
- Detailed business workflow: `LOCKED`
- Specialist machine-readable party/capacity codes: `NOT YET APPROVED`
- Classification-specific party validation rules: `NOT YET SEEDED`
- A deceased-estate inheritance and a sale out of a deceased estate are different workflows.
- Do not implement or seed party/role rules for this classification until its specialist machine codes and business validation rules are explicitly locked.

### 9.1 Deceased estate sale

**Matter context**

- The deceased estate / Estate Late context must be captured.
- Capture the deceased person and Master’s estate reference where available.
- Do not invent a duplicate DEEDLY legal-entity identity merely to represent the estate context.

**Estate representative**

- The duly appointed executor/executrix, or other legally applicable Master’s Representative, acts in representative capacity.
- Representative identity and representative capacity must remain separate concepts.
- Do not assume the executor’s machine role code yet.

**Purchaser / receiving side**

- At least one Golden Record-backed purchaser/receiving party is required.
- Multiple purchasers are allowed.

**Property**

- At least one property or property interest is required.
- Multiple properties are supported.

**Minimum live-matter create structure**

Requires:

- approved classification;
- deceased-estate context;
- Golden Record-backed estate representative;
- Golden Record-backed purchaser/receiving party;
- at least one property/property interest;
- sufficient sale/source-instrument information to identify the transaction.

### 9.2 Deceased-estate-sale origin branch

- The business distinction between a sale concluded before death and a sale concluded by executor after death is locked.
- These are different workflow branches.
- The final machine codes for these values are not yet locked.
- For a post-death executor sale, the workflow must support the applicable section 47 authority/manner-and-conditions analysis.
- Do not model section 47 as a universal “all heirs must consent” checkbox; the legally applicable authority basis may differ by circumstances.

### 9.3 Deceased-estate-sale workflow gates

- **Executor authority:** the acting representative’s appointment/authority must be verified.
- **Section 47:** the appropriate authority governing the manner and conditions of an executor sale must be established where applicable.
- **Section 49:** DEEDLY must support a conflict/related-party check where the purchaser is the executor or falls within the controlled relationship categories contemplated by the Act.
- **Section 42(2):** the Master’s section 42(2) endorsement/certificate/no-objection requirement must be represented as a pre-lodgement workflow gate where applicable.
- **Mortgage bond:** if the property is mortgaged, the relevant bond/cancellation workflow must activate.

**Explicit distinction:** `transfer.deceased_estate_sale` is a sale workflow; `transfer.deceased_estate_inheritance` is an inheritance allocation workflow. They are not interchangeable.

## 10. Section 45 endorsement

Classification: `transfer.endorsement_section_45`

Locked rules:

- This is a special endorsement workflow, not a normal sale.
- The surviving spouse is the receiving party.
- The deceased estate/deceased-side interest is the estate-side party.
- The executor/executrix acts in representative capacity.
- At least one property or property interest is required.
- Mortgage-bond status must be captured because it changes the workflow.
- UI should use context-specific labels such as `Deceased Estate`, `Surviving Spouse`, and `Executor` rather than `Seller/Purchaser`.

**Approved taxonomy row:**

- Classification: `transfer.endorsement_section_45bis`
- Taxonomy classification: `APPROVED` (seeded in migration 020)
- Detailed business workflow: `LOCKED`
- Specialist machine-readable party/capacity codes: `NOT YET APPROVED`
- Classification-specific party validation rules: `NOT YET SEEDED`
- Do not implement or seed party/role rules for this classification until its specialist machine codes and business validation rules are explicitly locked.

### 10.1 Section 45bis endorsement

**Locked business rules**

- Both relevant spouses/former spouses must be Golden Record-backed identities.
- At least one property/property interest is required.
- Multiple properties are allowed where legitimately covered by the same legal outcome.
- A legally supported basis/source instrument for the endorsement must be identified.
- The intended post-endorsement ownership outcome must be explicitly captured.
- This is not an ordinary Seller/Purchaser transfer workflow.

### 10.2 Section 45bis outcome branches

**A. One spouse/former spouse acquires the other spouse’s share**

- One party becomes entitled to the whole property.

**B. Both spouses/former spouses retain the property in undivided shares**

- Both remain entitled to defined undivided shares.

- These business meanings are locked.
- The final machine codes for these outcome values are not yet locked.

### 10.3 Section 45bis lawful-acquisition gate

- Section 45bis is a registration mechanism; it does not itself create the underlying ownership entitlement.
- DEEDLY must therefore require a valid legal basis/source instrument establishing the relevant acquisition, award or division before the matter may reach endorsement readiness.
- Do not treat “parties are divorced” as sufficient proof that one party automatically acquires the other’s property share.
- Relevant source instruments may include a divorce order, settlement agreement, court order or other legally applicable basis.
- The final machine codes for the legal-basis types are not yet locked.

### 10.4 Section 45bis bond branch

- Mortgage-bond status must be captured for each affected property.
- The workflow must distinguish:
  - no registered mortgage bond;
  - one spouse becoming sole owner;
  - both former spouses retaining undivided shares.
- The applicable cancellation/release/substitution/consent requirements must activate from the actual legal outcome.
- Detailed bond workflow implementation is not yet locked.

## 11. Development classifications

These four classifications do not use the normal transferor/transferee creation rule.

### 11.1 New sectional title register

Classification: `development.new_sectional_title_register`

Minimum create:

- Golden Record-backed `developer`.
- Underlying registered land.
- Proposed scheme identity/name when known.

No `transferee` is required at creation. Resulting sections/units are outputs of the development workflow.

### 11.2 New township register establishment

Classification: `development.new_township_register_establishment`

Minimum create:

- Golden Record-backed `developer` / `township_owner`.
- Underlying registered land.
- Proposed township name/reference when known.
- `registered_owner` recorded separately where different from the developer.

No `transferee` is required at creation. Resulting erven/lots are outputs of the development workflow.

### 11.3 Scheme extension by addition of sections

Classification: `development.scheme_extension_sections`

Minimum create:

- Golden Record-backed `extension_right_holder`.
- Existing sectional title scheme/register.
- Registered extension right or sufficient identifying reference/details.

The holder may act in contextual capacity such as `developer`, `successor_in_title`, or `body_corporate`. No `transferee` is required at creation. Newly created sections are outputs of the development workflow.

This is not the same as extension of an individual existing section.

### 11.4 Subdivision

Classification: `development.subdivision`

Minimum create:

- Golden Record-backed `registered_owner`.
- Parent property.
- Sufficient proposed subdivision information.
- Optional separate `developer` capacity where developer differs from registered owner.

No `transferee` is required at creation. New portions are outputs of the development workflow.

Proposed property outputs should support a future lifecycle concept such as:

- `proposed`
- `surveyed`
- `sg_approved`
- `registered`

This lifecycle is not implemented in this step.

**Explicit distinction:** `development.subdivision` creates/registers the subdivided property structure. `transfer.private_treaty.subdivision` is the later conveyance of that property/portion.

## 12. Property model implications

Locked property requirements:

- A matter may contain multiple properties.
- Development matters must distinguish property inputs from property outputs.
- A proposed output is not automatically a registered property.
- A development matter may produce many sections, erven, or portions.
- Property registration state must not be inferred merely from a Surveyor-General-approved plan or diagram.
- Rights such as a sectional-title right of extension should eventually be modelled as first-class linked objects rather than free-text notes.

No schema changes are made in this step.

## 13. Role, capacity and authority distinction

The contract explicitly distinguishes these concepts. They must not be collapsed into a single `role` string.

| Concept | Meaning | Example values | Machine code status |
|---------|---------|----------------|---------------------|
| `identity` | The Golden Record entity | `golden_record_id` | `golden_record_id` is locked |
| `entity_type` | What the entity is | `person`, `company`, `trust`, or future Golden Records-supported types | Stable codes to be aligned with the Golden Records/Entities entity-type contract; do not hard-code another restrictive `CHECK` list |
| `matter_role` | What the entity is doing in the matter | `transferor`, `transferee` | `LOCKED` |
| | | `developer`, `registered_owner`, `extension_right_holder` | Explicitly agreed descriptions; final machine codes to be confirmed during role/capacity model design |
| | | estate-side party, heir, surviving spouse, etc. | `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN` |
| `representative_capacity` | Legal capacity in which a person acts for another entity | `trustee`, `executor`, `representative` | `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN` |
| `signatory_authority` | Whether the person may sign | `is_required_signatory`, `authority_verified` | Future fields, not final schema |
| `primary_contact` | Communication/UI convenience | `is_primary_contact` | Concept locked; code to be confirmed |

## 14. Classification matrix

| Classification code | Workflow family | Minimum parties/capacities | Minimum property | Transferee required at create? | Multiple properties? | Friendly UI labels | Special/conditional notes | Status |
|---------------------|-----------------|---------------------------|------------------|--------------------------------|----------------------|--------------------|---------------------------|--------|
| `transfer.private_treaty.not_applicable` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | — | LOCKED |
| `transfer.private_treaty.sectional_title_register` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Condominium/sectional title | LOCKED |
| `transfer.private_treaty.township_register` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Township register context | LOCKED |
| `transfer.private_treaty.extension_of_scheme` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Existing scheme extension | LOCKED |
| `transfer.private_treaty.subdivision` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Conveyance of a subdivided portion; see 11.4 for the development counterpart | LOCKED |
| `transfer.private_treaty.bulk_transfer` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes (explicitly) | Seller / Purchaser | Must support multiple properties in one matter | LOCKED |
| `transfer.auction` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Auction-specific workflow gates later | LOCKED |
| `transfer.sale_in_execution` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Execution/sheriff context later | LOCKED |
| `transfer.property_in_possession` | Sale | 1 transferor, 1 transferee | 1 | Yes | Yes | Seller / Purchaser | Possession-specific workflow gates later | LOCKED |
| `transfer.donation` | Donation | 1 transferor, 1 transferee | 1 | Yes | Yes | Donor / Donee | Backend roles remain transferor/transferee | LOCKED |
| `transfer.deceased_estate_inheritance` | Estate | 1 estate-side party (business label; machine code TBD), 1 heir/legatee receiving party (business label; machine code TBD), 1 executor/representative (business label; machine code TBD) | 1 | Yes (heir receives) | Yes | Deceased Estate / Heir / Executor | Business meaning locked; representative capacity is DEEDLY-owned; representative is not the transferor; `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN` | LOCKED |
| `transfer.endorsement_section_45` | Endorsement | 1 estate-side/deceased-side party (business label; machine code TBD), 1 surviving-spouse receiving party (business label; machine code TBD), 1 executor/representative (business label; machine code TBD) | 1 | Yes (surviving spouse receives) | Yes | Deceased Estate / Surviving Spouse / Executor | Business meaning locked; mortgage-bond status must be captured; not a normal sale; `MACHINE CODE TO BE DEFINED DURING ROLE/CAPACITY MODEL DESIGN` | LOCKED |
| `development.new_sectional_title_register` | Development | 1 developer | 1 underlying registered land | No | Yes (outputs) | Developer / Scheme | Resulting sections are outputs | LOCKED |
| `development.new_township_register_establishment` | Development | 1 developer/township owner, optional registered_owner | 1 underlying registered land | No | Yes (outputs) | Developer / Township | Resulting erven/lots are outputs | LOCKED |
| `development.scheme_extension_sections` | Development | 1 extension_right_holder | 1 existing scheme/register | No | Yes (outputs) | Extension Holder / Body Corporate / Successor | New sections are outputs; not individual section extension | LOCKED |
| `development.subdivision` | Development | 1 registered_owner, optional developer | 1 parent property | No | Yes (outputs) | Owner / Developer | New portions are outputs; proposed lifecycle to come later | LOCKED |
| `transfer.deceased_estate_sale` | Estate | Deceased-estate context; Golden Record-backed executor/representative; at least one Golden Record-backed purchaser; at least one property/property interest; sufficient sale/source-instrument | 1 | Yes (heir/beneficiary receives) | Yes | Deceased Estate / Heir / Executor | Taxonomy: APPROVED; business workflow: LOCKED; specialist machine codes: TO BE DEFINED; party validation rules: NOT YET SEEDED | APPROVED — taxonomy row seeded in migration 020 |
| `transfer.endorsement_section_45bis` | Endorsement | Both spouses/former spouses as Golden Record identities; at least one property; valid legal basis/source instrument; post-endorsement ownership outcome captured; mortgage-bond status | 1 | Yes (surviving spouse receives) | Yes | Deceased Estate / Surviving Spouse / Executor | Taxonomy: APPROVED; business workflow: LOCKED; specialist machine codes: TO BE DEFINED; party validation rules: NOT YET SEEDED | APPROVED — taxonomy row seeded in migration 020 |

## 15. Recently approved taxonomy rows

These two classifications are now approved and seeded in migration 020. Their taxonomy rows are active and selectable, but their detailed business workflow, specialist machine-readable party/capacity codes, and classification-specific party validation rules are not yet locked.

| Classification | Taxonomy classification | Detailed business workflow | Specialist machine codes | Party validation rules | Status |
|----------------|-------------------------|----------------------------|--------------------------|------------------------|--------|
| `transfer.deceased_estate_sale` | APPROVED | TO BE LOCKED | NOT YET APPROVED | NOT YET SEEDED | Taxonomy row active in migration 020 |
| `transfer.endorsement_section_45bis` | APPROVED | TO BE LOCKED | NOT YET APPROVED | NOT YET SEEDED | Taxonomy row active in migration 020 |

Do not invent specialist machine codes or seed classification-party role rules for these classifications yet.

## 16. Recommended future role/capacity data shape

A reference-data approach is preferred. The following shape is recommended but not implemented in this step.

```
entity_type_definitions  -- aligns with Golden Records/Entities contract; extensible
- entity_type_code   VARCHAR(40) PRIMARY KEY
- label              VARCHAR(100) NOT NULL
- golden_record_type TEXT         -- how the type maps to the Entities service
- is_active          BOOLEAN DEFAULT TRUE

party_role_definitions
- role_code          VARCHAR(40) PRIMARY KEY
- label              VARCHAR(100) NOT NULL
- description        TEXT
- allowed_entity_type_codes TEXT[]  -- references `entity_type_definitions`; do not hard-code `{'person','company','trust'}`
- is_active          BOOLEAN DEFAULT TRUE

transfer_classification_role_rules
- classification_code   VARCHAR(100) NOT NULL
- role_code             VARCHAR(40) NOT NULL
- min_count             INTEGER DEFAULT 0
- max_count             INTEGER DEFAULT NULL  -- NULL = unlimited
- is_required           BOOLEAN DEFAULT FALSE
- allows_primary_contact BOOLEAN DEFAULT FALSE
- allowed_entity_type_codes TEXT[]  -- override or subset from `entity_type_definitions`
- PRIMARY KEY (classification_code, role_code)

party_representative_capacities  -- future
- transfer_party_id     UUID
- person_golden_record_id UUID
- capacity              VARCHAR(50)  -- machine code to be defined during role/capacity model design
- authority_verified    BOOLEAN DEFAULT FALSE
- is_required_signatory BOOLEAN DEFAULT FALSE
```

Validation should be driven from these reference tables, not from hard-coded `if/else` logic in the create route.

## 17. Recommended property relationship shape

Recommended future model:

```
matter_properties
- matter_id             UUID
- property_id           UUID
- property_kind         VARCHAR(20)  -- 'input', 'output'
- registration_status   VARCHAR(20)  -- 'proposed','surveyed','sg_approved','registered' (future)
- role_in_matter        VARCHAR(50)  -- e.g., 'parent','resulting_section','resulting_erf','resulting_portion'
- external_property_id  TEXT         -- source reference when known
- property_source       VARCHAR(100) -- origin of the reference; contract TO BE CONFIRMED
```

A matter may therefore contain many properties, each marked as input or output. Outputs start as proposed and progress through registration lifecycle states.

**Property source contract:** Golden Records is authoritative for people/legal-entity identity. The authoritative property registry/provider contract has not yet been locked. The `external_property_id` and `property_source` columns are deliberately neutral placeholders pending that decision. Do not introduce a new external provider or architecture assumption.

## 18. Implementation sequencing recommendation

Proposed order, not to be implemented in this step:

1. **Stable party role/capacity reference data** — seed `party_role_definitions` and `transfer_classification_role_rules` before any create validation can be strict.
2. **Relax `transfer_parties.entity_type` constraint** — replace the restrictive `CHECK` with an extensible column and reference-data-driven or server-side validation; do not simply hard-code `('person','company','trust')` into another `CHECK`.
3. **Property input/output relationship model** — add the `matter_properties` or equivalent structure to support multiple properties and development outputs.
4. **Tenant-safe Golden Record validation/linking contract** — implement the Entities service call, visibility/authorisation check, and display-cache refresh before accepting `golden_record_id` values.
5. **Server-side classification-specific create validation** — implement the create route rules from the matrix above.
6. **Authenticated POST /api/v1/transfers** — create the authenticated v1 create endpoint.
7. **Frontend create flow** — update the UI to collect the canonical roles and friendly labels per classification.
8. **Later trust/estate/section-45/development-specific workflow gates** — add representative-capacity tracking, mortgage-bond capture, output-lifecycle states, and document/milestone rules.

**Ordering concerns from the current repo:**

- `src/lib/migrations/008_create_transfer_parties.sql` currently restricts `entity_type` to `('person', 'company')`. Trust support cannot be exercised until the constraint is replaced with an extensible, reference-data-driven validation approach rather than another hard-coded `CHECK`.
- `transfer_parties.role` is free text at the database level. Future reference data and validation must be enforced in application code until a `CHECK` or FK is added.
- The legacy `matter_parties` and `parties` tables are deprecated. New implementation should target `transfer_parties` only and avoid entangling with the old schema.

## 19. Current repo constraints

| Layer | Current state | Implication |
|-------|---------------|-------------|
| `transfer_parties.role` | `VARCHAR(40) NOT NULL` with no `CHECK` | Validation must start in application code; future migration can add a reference FK or `CHECK` |
| `transfer_parties.entity_type` | `CHECK (entity_type IN ('person', 'company'))` | Trust cannot be stored until the restrictive `CHECK` is replaced with extensible, reference-data-driven validation |
| `transfer_parties` unique key | `(transfer_id, golden_record_id, role)` | Supports multiple parties with the same role as long as `golden_record_id` differs |
| Legacy `matter_parties` | Fixed `CHECK` role list | Not authoritative; do not reuse for DEEDLY v1 |
| Prototype frontend | Hard-coded `buyer`/`seller` | Must be replaced with canonical `transferor`/`transferee` and classification-friendly labels |

## 21. Step 16S.5a — property authority, tenant safety, and primary contact

### 21.1 Transitional property authority contract

Migration 017 introduces `matter_properties` while `transfers.property_id` remains in the schema. The two are not independently writable sources of truth for the same relationship:

- **`transfers.property_id`** is the legacy single-property pointer used by existing Python/FastAPI routes in `python_server/routers/transfers.py` and TypeScript/Express routes in `server/routes/transfers.ts`. It was created in `002_add_properties_table.sql`.
- **`matter_properties`** is the DEEDLY-v1 canonical relationship. It supports multiple properties per matter and the `input`/`output` distinction required by development and multi-property transfers.
- **No backfill is performed in Step 16S.5a.** Existing `transfers.property_id` values continue to satisfy the legacy runtime.
- **Authoritative target:** future v1 create/read/update routes should treat `matter_properties` as authoritative. The legacy `transfers.property_id` is compatibility-only.
- **Legacy routes continue to work** because `transfers.property_id` is not removed or changed in this step.
- **Later migration:** once the v1 routes and any consumers are migrated off `transfers.property_id`, a future migration should backfill it into `matter_properties` and then remove or deprecate the column.
- **Contradiction prevented by contract:** the application must not write `transfers.property_id` and `matter_properties` for the same relationship independently. Until the legacy column is removed, new code should write `matter_properties` and, when a single primary input is required, mirror it to `transfers.property_id` at the application level if the legacy route still needs it.

### 21.2 Tenant safety of `matter_properties`

- `matter_properties` references `matters(id) ON DELETE CASCADE`.
- `matter_properties.accountable_institution_id` is not nullable.
- A `BEFORE INSERT OR UPDATE` trigger `trg_matter_properties_set_tenant` overrides `accountable_institution_id` with `matters.accountable_institution_id`, preventing cross-tenant property associations.
- The existing `matters.accountable_institution_id` tenant boundary therefore extends to `matter_properties`.

### 21.3 Primary contact semantics

- `is_primary_contact` is a boolean on `transfer_parties` with `DEFAULT FALSE`.
- Business rule: at most one party per `(transfer_id, role)` may be the primary communication contact; multiple primaries are allowed if they belong to different roles (e.g., one transferor primary, one transferee primary).
- Enforcement is at the DB level through a partial unique index `idx_transfer_parties_one_primary_per_role` on `(transfer_id, role) WHERE is_primary_contact = TRUE`.
- This carries no legal authority; it is a communication/UI convenience only.

### 21.4 Newly approved taxonomy

- `transfer.deceased_estate_sale` — taxonomy row seeded in migration 020; no specialist role/capacity rules added.
- `transfer.endorsement_section_45bis` — taxonomy row seeded in migration 020; no specialist role/capacity rules added.

## 21.5 Step 16S.5b — property-tenant isolation audit and migration 019 block

### 21.5.1 Cross-tenant property linking

- The `properties` table has no `accountable_institution_id` column.
- The `matter_properties` table enforces only that its own `accountable_institution_id` matches `matters.accountable_institution_id`.
- There is no constraint, trigger, or FK that prevents a property linked through `matter_properties` (or any other property relationship) from being associated with matters belonging to different accountable institutions.
- The integration test `test_cross_tenant_property_link_is_rejected` in `python_server/tests/test_migrations_018.py` demonstrates this by creating an AI-A matter and an AI-B matter, linking a property to AI-B, and then attempting to link the same property to AI-A. The insert succeeds, so the test fails.
- **Conclusion:** `matter_properties.accountable_institution_id` being derived from `matters` is insufficient for cross-tenant property isolation.

### 21.5.2 Migration 019 and 020 decision

- Migration `019_deedly_property_tenant_isolation.sql` closes the cross-tenant property linking gap by adding `properties.accountable_institution_id`, enforcing composite tenant FKs, backfilling legacy `transfers.property_id` into `matter_properties`, and adding a one-way legacy sync trigger.
- Migration `020_deedly_taxonomy_approved_classifications.sql` seeds the two approved taxonomy rows (`transfer.deceased_estate_sale` and `transfer.endorsement_section_45bis`) without specialist party/capacity codes or role rules.
- Do not invent specialist party/capacity codes or role rules for the two newly approved classifications.

### 21.5.3 Legacy-property compatibility bridge

- Existing rows where `transfers.property_id IS NOT NULL` but no corresponding `matter_properties` row exists are the legacy runtime records.
- Recommended strategy:
  1. Close the tenant-isolation gap first by scoping `properties` to an accountable institution (add `accountable_institution_id` and enforce it).
  2. Backfill existing `transfers.property_id` values into `matter_properties` as `property_kind = 'input'` for the corresponding `matter_id` (creating matters where missing).
  3. Update the Python/FastAPI and TypeScript/Express routes to read from `matter_properties`; keep `transfers.property_id` as a compatibility write target until all consumers are migrated.
  4. Once consumers are migrated, remove `transfers.property_id`.
- Preferred eventual model: `matter_properties` is the single authoritative property relationship.

### 21.5.4 Current callers of `transfers.property_id`

- **Python/FastAPI:** `python_server/routers/transfers.py` reads and writes `transfers.property_id` (e.g., `SELECT property_id FROM transfers WHERE id = $1`, `UPDATE transfers SET property_id = ...`).
- **TypeScript/Express:** `server/routes/transfers.ts` reads and writes `transfers.property_id` (e.g., `SELECT property_id FROM transfers WHERE id = $1`, `UPDATE transfers SET property_id = ...`).

## 20. Summary report

- **Step 16S.5 and 16S.5a foundation changes committed:** migration `018_deedly_party_property_contract_foundation.sql`, supporting tests, and this contract document.
- **Canonical backend roles for ordinary transfers:** `transferor` and `transferee`.
- **Friendly UI labels are allowed** (Seller/Purchaser, Donor/Donee, Deceased Estate/Heir, etc.) but must not replace canonical roles.
- **Multiple parties per role are allowed.** `is_primary_contact` is UI/communication only, carries no legal authority, and is enforced at the DB level by a partial unique index on `(transfer_id, role) WHERE is_primary_contact = TRUE`.
- **Trust is a first-class DEEDLY entity type**, with the trust as the party and trustees as representatives.
- **Golden Record is authoritative for identity;** missing entities must be created in Golden Records and then linked.
- **Sale-type rule:** one transferor, one transferee, one property; all nine sale-type classifications are locked under this rule.
- **Donation, deceased estate inheritance, and section 45 endorsement** each have locked, classification-specific rules.
- **Development classifications** do not require a transferee at creation; they focus on developer/owner/holder plus input property and output properties.
- **DEEDLY now has 18 approved classifications:** 16 original classifications are `LOCKED`; 2 additional classifications (`transfer.deceased_estate_sale` and `transfer.endorsement_section_45bis`) are `APPROVED` at the taxonomy level and their detailed business workflow is now `LOCKED`, while their specialist machine-readable party/capacity codes and classification-specific party validation rules remain to be defined.
- **The two taxonomy-only classifications are seeded in migration 020.** Do not invent or seed specialist party/capacity machine codes for them until their machine-code design is explicitly locked.
- **Do not invent or seed specialist party/capacity machine codes** for the two newly approved classifications until their business validation rules are explicitly locked.
- **Property-tenant isolation gap from Step 16S.5b resolved:** `properties` now has `accountable_institution_id` and `matter_properties` is protected by composite tenant FKs; legacy `transfers.property_id` is backfilled and kept in sync with `matter_properties` by a one-way compatibility trigger.
- **Recommended implementation sequence:** reference data → entity-type constraint → property input/output model → Golden Record linking contract → server-side create validation → authenticated v1 create route → frontend → specialized workflow gates.

## 22. Design-review note

The existing `transfer.deceased_estate_inheritance` representation should be revisited during specialist role/capacity machine-code design so that the following are modelled precisely and not collapsed into the simplistic statement that the estate itself is necessarily the machine-code `transferor`:

- estate context;
- executor/representative identity;
- representative capacity;
- heir/legatee receiving relationship.

This is a design-review note only; the locked inheritance workflow is not changed in this step and no replacement machine codes are invented.
