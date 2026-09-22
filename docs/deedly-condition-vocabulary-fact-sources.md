# Condition vocabulary + fact sources — proposal for Jordan

**Status: PROPOSAL for Dean/Jordan review — nothing here is approved,
implemented, or seeded.** Companion to
`docs/deedly-required-documents-register-mapping.md` (register mapping and
gaps), `docs/deedly-required-documents-pt-na-proposal.md` (§3 candidate
vocabulary for the private-treaty classification), and the unexecuted seed
`docs/proposals/027_deedly_document_requirement_rules_seed.sql`.

Purpose: the confirmed P0 set includes **825 Conditional cells across 65
documents**. Under the confirmed reading of "Your final level = Required"
(required *where applicable*; matrix applicability preserved), none of them
can be expressed today — the engine vocabulary is exactly `has_bond` /
`cash_purchase`, both unapproved heuristics. This document is the fact-source
proposal those cells need before any conditional rule can seed: **for each
trigger, the supporting fact, where it lives, who supplies it, and how
unknown/missing values are handled.**

## 1. Conventions

- **One `condition_key` per rule.** A document gated by "either of two
  facts" needs a composite key — two separate rules would double-list the
  document via the shared-`doc_code` satisfaction gap (template doc §1.1).
- **Purchaser finance and the seller's existing bond are separate facts.**
  `has_bond` / `cash_purchase` conflate them; neither existing key is
  reused.
- **Every fact is tri-state: `yes` / `no` / `unknown`.** `unknown` never
  means `no`: it leaves dependent rules in `unevaluatedRules` and the
  matter shows "Requirement evaluation is incomplete" — the engine's
  existing convention, proposed unchanged. There is no default-to-false;
  an unanswered staff-declared fact stays unknown. "Not applicable" is a
  positive `no`, never the absence of an answer.
- **Scope** = what the fact is about: the **matter**, a specific **party**,
  or the **property** being transferred. Party- and property-scoped facts
  need per-entity storage or an approved "any relevant entity" aggregation
  — the engine's single-value model cannot express that today (§4).
- **Fact source kinds:**
  - *Derived* — computed from existing columns/rows (bonds, financials,
    party entity type, property type, municipality).
  - *Declared* — staff-captured answer; needs a capture point (new field or
    the fact-checklist storage proposed in §4).
  - *Derived+declared* — a default can be computed but staff must be able
    to override (e.g. deeds-search result).

## 2. Vocabulary — 48 keys covering all 65 conditional documents

Keys marked † are new relative to the PT-NA proposal's 35-key inventory;
they cover documents conditional only on estate, endorsement, development,
auction or execution classifications.

### 2.1 Party capacity / entity facts

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `party_is_entity` | A party is a company or close corporation | Party (each) | `transfer_parties` entity type — exists | Derived (unknown if any party lacks a type) | DOC-011, 014*, 015* |
| `party_is_trust` | A party is a trust | Party (each) | `transfer_parties` entity type — exists | Derived | DOC-012, 013, 014*, 015* |
| `marriage_affects_capacity` | Matrimonial regime affects capacity/ownership | Party (each natural person) | New — marital-status capture per party | Declared | DOC-004, 005 |
| `divorce_affects_party` | Divorce order/settlement determines entitlement | Party | New — declared fact | Declared | DOC-006, 007 |
| `spousal_consent_required` | Matrimonial regime + act requires spouse consent | Party | New — marital regime + transaction type | Declared (partially derivable once regime stored) | DOC-034 |
| `representative_signs` | Someone signs on behalf of a party | Party | New — party/representative link | Declared | DOC-016 |
| `joint_estate_court_order` † | Joint-estate division / regime change relies on a court order rather than divorce | Party (spouses) | New — declared fact | Declared | DOC-086 |

\* DOC-014 and DOC-015 are gated by *either* `party_is_entity` *or*
`party_is_trust` — they need a composite key (e.g. `party_is_entity_or_trust`)
because two rules sharing a document would double-list it.

### 2.2 Estate facts — roles and routes stay separate

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `deceased_party` | A party is deceased; an estate representative must act | Party | New — deceased flag on the party record | Declared | DOC-008 |
| `estate_representative_appointed` | An executor/representative transfers or endorses estate property | Party (estate rep) | New — appointment fact; a distinct role, not implied by `deceased_party` | Declared | DOC-024 |
| `estate_testate` | Estate is testate — a will determines powers | Party (deceased estate) | New — estate route fact | Declared | DOC-023 |
| `estate_intestate` | Estate is intestate — the *opposite route*, not "no answer" | Party (deceased estate) | New — estate route fact | Declared | DOC-073, 074 |
| `estate_sale_route` | Executor sells estate property post-death (s42(2)/s47) | Matter | New — estate route fact | Declared | DOC-061, 062 |
| `estate_distribution_route` | Transfer/endorsement follows the L&D distribution (inheritance, s45) | Matter | New — estate route fact | Declared | DOC-025, 026, 027, 071 |

### 2.3 Contract / money facts

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `buyer_bond_finance` | **Purchaser** relies on bond finance | Party (transferee) | `bonds` row / `transfer_financials.loan_amount` — the unapproved heuristic; **Dean must approve the source** | Derived+declared | DOC-049 |
| `seller_bond_registered` | **Seller's** registered bond over the property must be cancelled/dealt with | Property | New — from deeds-search result; **never derived from buyer finance** | Declared (deeds search) | DOC-051, 052, 063 |
| `bond_debtor_substitution_route` † | Existing bond is retained under a permitted s45/s45bis debtor-substitution route — distinct from cancellation | Property | New — endorsement route fact | Declared | DOC-079 |
| `guarantee_required` | Contract requires a guarantee / price security | Matter | New — contract terms flag | Declared | DOC-050 |
| `deposit_due` | Cash deposit or price payment is due | Matter | `transfer_financials` deposit where present; else declared from contract | Derived+declared | DOC-022 |
| `payout_expected` | Money will be paid out to a party account | Party (per payee) | Financials / payout instructions | Derived+declared | DOC-009 |
| `suspensive_conditions_open` | Sale has unfulfilled suspensive conditions | Matter | New — contract condition tracking | Declared | DOC-081 |
| `terms_amended` | Parties varied terms / extended a deadline | Matter | New — declared fact | Declared | DOC-018 |
| `reconciliation_needed` | Matter has financial entries needing a final account | Matter | Trust ledger / financials presence | Derived | DOC-042 |
| `sale_agreement_exists` † | A private/estate sale agreement exists alongside an auction or execution record | Matter | New — declared fact (on auction/execution classifications DOC-017 is the alternative to DOC-028) | Declared | DOC-017 (auction/execution classes) |
| `wdo_certificate_clause` | Sale agreement or lender requires a WDO certificate | Matter | New — contract clause flag | Declared | DOC-058 (conditional cells) |

### 2.4 Property / installation facts

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `sectional_unit` | The property is a sectional title unit (s15B route) | Property | `properties.property_type` — exists | Derived | DOC-040 |
| `body_corporate_exists` | The scheme has a body corporate / levy administration — **not implied by `sectional_unit`** (first-transfer and no-BC branches exist) | Property | New — scheme/body-corporate fact | Declared | DOC-020, 046 |
| `hoa_consent_required` | Title condition or binding HOA provision requires consent | Property | New — title-condition review flag | Declared | DOC-047 |
| `property_leased` | Property is leased / SARS needs lease evidence | Property | New — lease data or declared | Declared | DOC-021 |
| `electrical_installation` | Electrical installation present on change of ownership | Property | New — property features | Declared (near-universal; may become baseline) | DOC-055 |
| `gas_installation` | Gas installation present | Property | New — property features | Declared | DOC-056 |
| `electric_fence` | Electric fence present | Property | New — property features | Declared | DOC-057 |
| `water_bylaw_applies` | Municipal water-certificate by-law applies to this property | Property | New — municipality on the property record | Derived (municipality lookup) + declared | DOC-059 |

### 2.5 Municipal / clearance facts

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `clearance_figures_needed` | Municipal/levy figures must be requested | Property | Clearance obligation — near-universal; may become baseline | Derived+declared | DOC-019, 044 |
| `rates_clearance_required` † | Rates clearance certificate is required on this route — endorsements/development have exceptions needing legal confirmation | Matter | New — route/legal-review flag | Declared | DOC-045 (conditional cells) |

### 2.6 Tax facts

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `tax_reference_required` | SARS requires a tax reference for the party (incl. R2m individual threshold) | Party | Party type + purchase price — derivable once financials store price; confirm derivation with Dean | Derived+declared | DOC-003 |
| `transfer_duty_process_applies` † | A dutiable/exempt acquisition exists — register-opening and endorsement routes may have none | Matter | New — tax-route determination | Declared | DOC-036, 048 (conditional cells) |
| `valuation_required` | SARS requests valuation (connected-party, partial share, donation evidence) | Matter | New — tax-route flag | Declared | DOC-060 (conditional cells) |
| `vat_treatment_claimed` | VAT treatment/exemption or going-concern is claimed | Matter | Seller VAT status + tax-route flag | Derived+declared | DOC-083 |

### 2.7 Compliance / firm-process facts

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `rmcp_enhanced_verification` | Firm RMCP/risk assessment calls for enhanced evidence | Matter | New — compliance-officer-set flag | Declared (compliance officer) | DOC-002, 010 |
| `declarations_required` | Route requires transferor/transferee declarations | Matter | New — firm/route flag | Declared | DOC-031, 032 |

### 2.8 Development / register-route facts †

| condition_key | Fact needed | Scope | Lives where | Supplied by | Gates |
|---|---|---|---|---|---|
| `sectional_register_dependency` | Transfer depends on a new/extended sectional register (approved plan needed) | Matter | New — linked-matter/development flag | Declared | DOC-064 |
| `township_or_subdivision_route` | Matter involves a township establishment or land subdivision | Matter | New — route fact | Declared | DOC-065 |
| `land_use_approval_required` | Development/subdivision requires land-use approval | Matter | New — planning-route fact | Declared | DOC-066 |
| `extension_right_route` | Scheme extension uses an existing reserved/transferred right (vs body-corporate route) | Matter | New — extension-route fact | Declared | DOC-069 |
| `scheme_rules_or_approvals_required` | Scheme rules or member/mortgagee approvals apply | Matter | New — scheme-route fact | Declared | DOC-070 |
| `s53_development_conditions` | Registration results from a land-development application within SPLUMA s53 | Matter | New — development-route fact | Declared | DOC-075 |
| `participation_quota_changes` | Scheme extension changes the participation-quota schedule | Matter | New — extension fact | Declared | DOC-078 |
| `extension_rights_or_plan_change` | Reserved extension rights or developer plan changes affect the purchaser | Matter | New — disclosure-route fact | Declared | DOC-080 |

## 3. Coverage check

Every Conditional matrix cell maps to exactly one key above; no document
needs two independent conditions except DOC-014/015 (composite
`party_is_entity_or_trust`). The 825 cells = 65 documents × their
conditional classifications; key approval unblocks all of them at once —
each conditional rule is still seeded per explicit classification, never
wildcard.

## 4. Schema questions this puts to Jordan

1. **Fact storage.** Declared facts need a home. Proposal: a fact table —
   `matter_facts` (`matter_id`, `fact_key`, `value` ∈ yes/no,
   `declared_by`, `declared_at`, `note`) for matter scope, and the same
   shape keyed by `transfer_party_id` / property for party/property scope —
   rather than one column per fact (48+ columns, sparse, and growing).
   Absent row = `unknown`.
2. **Per-entity scoping.** Party-scoped keys (`marriage_affects_capacity`,
   `payout_expected`, estate roles) need per-party values; without them the
   engine needs an approved "any relevant party" aggregation per key. The
   PT-NA proposal §3.2 marks this unimplemented.
3. **Composite keys.** DOC-014/015 need `party_is_entity_or_trust` — either
   a stored composite fact or engine support for OR-ed keys.
4. **Derived-fact definitions.** `buyer_bond_finance`, `sectional_unit`,
   `tax_reference_required`, `clearance_figures_needed`,
   `payout_expected`, `reconciliation_needed`, `water_bylaw_applies` have
   plausible derivations — each derivation needs Dean's sign-off on the
   source column(s) before it is wired into `_load_matter_context`.
5. **No Optional level.** Optional documents (28 cells) remain unseeded —
   each Optional → Required upgrade needs explicit approval. Persisting an
   Optional level would need a `requiredness` column.
6. **No stage, evidence text, or per-rule metadata columns** — the
   register's stage/evidence/basis fields have no home; adding them is a
   schema decision separate from this vocabulary.
7. **Migration numbering** — the baseline seed (027, pending Jordan's
   confirmation) covers Required cells only; conditional rules would land
   in a *later* migration after this vocabulary is approved, so its number
   is a separate allocation.

## 5. What is deliberately not here

- **No generation or e-sign scope.** "Include in P0 = Yes" and the
  signature flags do not approve the 22 `Generate in DEEDLY? = Candidate`
  documents or any e-sign integration — those stay separate decisions.
- **No execution.** No `condition_key` is added to the draft seed; the 825
  conditional rules do not exist as SQL until the vocabulary, fact sources
  and scoping model are approved.
- **No engine changes.** `_SUPPORTED_CONDITIONS` and
  `_load_matter_context` stay untouched until the keys above are approved.
