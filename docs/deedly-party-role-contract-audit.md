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

**Current repo constraint:** `src/lib/migrations/008_create_transfer_parties.sql` currently constrains `entity_type` to `('person', 'company')`. This is a known transitional limitation and must be relaxed in a future migration when trust support is implemented.

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

**Pending taxonomy confirmation:**

- Proposed classification: `transfer.deceased_estate_sale`
- Status: `PENDING LEGITIFY CONFIRMATION`
- Do not implement or seed this classification yet.
- A deceased-estate inheritance and a sale out of a deceased estate are different workflows.

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

**Pending taxonomy confirmation:**

- Proposed classification: `transfer.endorsement_section_45bis`
- Status: `PENDING LEGITIFY CONFIRMATION`
- Do not implement or seed this classification yet.

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

| Concept | Meaning | Example values |
|---------|---------|----------------|
| `identity` | The Golden Record entity | `golden_record_id` |
| `entity_type` | What the entity is | `person`, `company`, `trust` |
| `matter_role` | What the entity is doing in the matter | `transferor`, `transferee`, `developer`, `registered_owner`, `heir` |
| `representative_capacity` | Legal capacity in which a person acts for another entity | `trustee`, `executor`, `representative` |
| `signatory_authority` | Whether the person may sign | `is_required_signatory`, `authority_verified` |
| `primary_contact` | Communication/UI convenience | `is_primary_contact` |

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
| `transfer.deceased_estate_inheritance` | Estate | 1 estate-side party, 1 heir/legatee, 1 executor/representative | 1 | Yes (heir receives) | Yes | Deceased Estate / Heir / Executor | Representative capacity is DEEDLY-owned; representative is not the transferor | LOCKED |
| `transfer.endorsement_section_45` | Endorsement | 1 estate-side party, 1 surviving spouse, 1 executor/representative | 1 | Yes (surviving spouse receives) | Yes | Deceased Estate / Surviving Spouse / Executor | Mortgage-bond status must be captured; not a normal sale | LOCKED |
| `development.new_sectional_title_register` | Development | 1 developer | 1 underlying registered land | No | Yes (outputs) | Developer / Scheme | Resulting sections are outputs | LOCKED |
| `development.new_township_register_establishment` | Development | 1 developer/township owner, optional registered_owner | 1 underlying registered land | No | Yes (outputs) | Developer / Township | Resulting erven/lots are outputs | LOCKED |
| `development.scheme_extension_sections` | Development | 1 extension_right_holder | 1 existing scheme/register | No | Yes (outputs) | Extension Holder / Body Corporate / Successor | New sections are outputs; not individual section extension | LOCKED |
| `development.subdivision` | Development | 1 registered_owner, optional developer | 1 parent property | No | Yes (outputs) | Owner / Developer | New portions are outputs; proposed lifecycle to come later | LOCKED |

## 15. Pending taxonomy confirmation

| Proposed classification | Reason | Status |
|-------------------------|--------|--------|
| `transfer.deceased_estate_sale` | Distinct from inheritance; sale out of a deceased estate | PENDING LEGITIFY CONFIRMATION |
| `transfer.endorsement_section_45bis` | Distinct endorsement variant | PENDING LEGITIFY CONFIRMATION |

Do not implement or seed these classifications yet.

## 16. Recommended future role/capacity data shape

A reference-data approach is preferred. The following shape is recommended but not implemented in this step.

```
party_role_definitions
- role_code          VARCHAR(40) PRIMARY KEY
- label              VARCHAR(100) NOT NULL
- description        TEXT
- allowed_entity_types TEXT[]      -- e.g., {'person','company','trust'}
- is_active          BOOLEAN DEFAULT TRUE

transfer_classification_role_rules
- classification_code   VARCHAR(100) NOT NULL
- role_code             VARCHAR(40) NOT NULL
- min_count             INTEGER DEFAULT 0
- max_count             INTEGER DEFAULT NULL  -- NULL = unlimited
- is_required           BOOLEAN DEFAULT FALSE
- allows_primary_contact BOOLEAN DEFAULT FALSE
- entity_types          TEXT[]      -- override or subset
- PRIMARY KEY (classification_code, role_code)

party_representative_capacities  -- future
- transfer_party_id     UUID
- person_golden_record_id UUID
- capacity              VARCHAR(50)  -- 'trustee', 'executor', 'representative'
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
- golden_record_link    TEXT         -- Loom/provider property key when known
```

A matter may therefore contain many properties, each marked as input or output. Outputs start as proposed and progress through registration lifecycle states.

## 18. Implementation sequencing recommendation

Proposed order, not to be implemented in this step:

1. **Stable party role/capacity reference data** — seed `party_role_definitions` and `transfer_classification_role_rules` before any create validation can be strict.
2. **Relax `transfer_parties.entity_type` constraint** — add `trust` and future entity types in a migration once the reference data is ready.
3. **Property input/output relationship model** — add the `matter_properties` or equivalent structure to support multiple properties and development outputs.
4. **Tenant-safe Golden Record validation/linking contract** — implement the Entities service call, visibility/authorisation check, and display-cache refresh before accepting `golden_record_id` values.
5. **Server-side classification-specific create validation** — implement the create route rules from the matrix above.
6. **Authenticated POST /api/v1/transfers** — create the authenticated v1 create endpoint.
7. **Frontend create flow** — update the UI to collect the canonical roles and friendly labels per classification.
8. **Later trust/estate/section-45/development-specific workflow gates** — add representative-capacity tracking, mortgage-bond capture, output-lifecycle states, and document/milestone rules.

**Ordering concerns from the current repo:**

- `src/lib/migrations/008_create_transfer_parties.sql` currently restricts `entity_type` to `('person', 'company')`. Trust support cannot be exercised until this constraint is relaxed.
- `transfer_parties.role` is free text at the database level. Future reference data and validation must be enforced in application code until a `CHECK` or FK is added.
- The legacy `matter_parties` and `parties` tables are deprecated. New implementation should target `transfer_parties` only and avoid entangling with the old schema.

## 19. Current repo constraints

| Layer | Current state | Implication |
|-------|---------------|-------------|
| `transfer_parties.role` | `VARCHAR(40) NOT NULL` with no `CHECK` | Validation must start in application code; future migration can add a reference FK or `CHECK` |
| `transfer_parties.entity_type` | `CHECK (entity_type IN ('person', 'company'))` | Trust cannot be stored until the constraint is relaxed |
| `transfer_parties` unique key | `(transfer_id, golden_record_id, role)` | Supports multiple parties with the same role as long as `golden_record_id` differs |
| Legacy `matter_parties` | Fixed `CHECK` role list | Not authoritative; do not reuse for DEEDLY v1 |
| Prototype frontend | Hard-coded `buyer`/`seller` | Must be replaced with canonical `transferor`/`transferee` and classification-friendly labels |

## 20. Summary report

- **No runtime/schema/migration changes were made.**
- **Working tree:** only the design document `docs/deedly-party-role-contract-audit.md` is changed.
- **Canonical backend roles for ordinary transfers:** `transferor` and `transferee`.
- **Friendly UI labels are allowed** (Seller/Purchaser, Donor/Donee, Deceased Estate/Heir, etc.) but must not replace canonical roles.
- **Multiple parties per role are allowed.** `is_primary_contact` is UI/communication only and carries no legal authority.
- **Trust is a first-class DEEDLY entity type**, with the trust as the party and trustees as representatives.
- **Golden Record is authoritative for identity;** missing entities must be created in Golden Records and then linked.
- **Sale-type rule:** one transferor, one transferee, one property; all nine sale-type classifications are locked under this rule.
- **Donation, deceased estate inheritance, and section 45 endorsement** each have locked, classification-specific rules.
- **Development classifications** do not require a transferee at creation; they focus on developer/owner/holder plus input property and output properties.
- **All 16 current classifications are now `LOCKED`.**
- **Pending Legitify confirmations:** `transfer.deceased_estate_sale` and `transfer.endorsement_section_45bis`.
- **Recommended implementation sequence:** reference data → entity-type constraint → property input/output model → Golden Record linking contract → server-side create validation → authenticated v1 create route → frontend → specialized workflow gates.
