# Focused proposal — `transfer.private_treaty.not_applicable` document requirements

**Status: PROPOSAL for review — nothing here is approved, seeded as a gate, or
executed.** Companion to `docs/deedly-required-documents-register-mapping.md`
and the proposed seed in
`docs/proposals/027_deedly_document_requirement_rules_seed.sql` (deliberately
outside `src/lib/migrations/` — the migration runner cannot reach it).
Source:
DEEDLY_Required_Documents_Register.xlsx (21 Sep 2026), columns C (level),
"Rule guidance" (stage / trigger / evidence / review issue).

Scope: ordinary private sale with no linked development subtype — the most
common DEEDLY workflow. Register coverage for this classification:
**12 Required / 51 Conditional / 1 Optional / 22 Not applicable.**

## 1. What the current engine can and cannot represent

| Capability | Engine today | This proposal needs |
|---|---|---|
| Baseline requirement per classification | `condition_key NULL` + explicit `classification_code` | The 12 Required rows (proposed in 027) |
| Conditional requirement | Only `has_bond` / `cash_purchase` — unapproved heuristics | **§3 vocabulary + fact sources — not expressible today** |
| Due stage / progression gate | None — `sequence_number` is display order only; no stage model exists | **Not representable** — stage column below is intent only |
| "Blocks progression" | None — requirements are a checklist, nothing gates milestones/submission | **Not representable** — decisions doc §4 leaves gating undecided |
| Satisfying evidence text | None — only `display_name` reaches the reviewer | **Not representable** — evidence column below is guidance, not persisted |
| Optional level | None | **Not representable** |
| Per-party scope | None — per-matter instances only | Not representable — "Applies to party" is informational |
| Validity windows (e.g. rates certificate "valid at registration", deeds search "refresh before lodgement") | None | Not representable — flagged per-row |

Every row below therefore needs an engine extension (schema + facts) before it
can behave as written; only the level `Required` rows exist in the proposed
027 seed, and even they carry no stage, trigger, or evidence.

## 2. Proposed requirements for this classification

"Blocks progression" records the register's intent — Required blocks its due
stage; Conditional blocks only when its trigger applies; Optional never
gates. **None of this is enforceable today** (§1).

| Doc | Requirement | Level | Due stage / gate | Blocks progression? | Satisfying evidence |
|---|---|---|---|---|---|
| DOC-001 | Identity document / passport | Required | Onboarding / before regulated work | Yes — proposed gate at due stage | ID OR passport / approved verification evidence; no need for both. |
| DOC-002 | Residential address evidence | Conditional | Onboarding | Only if trigger applies — proposed gate at due stage | Accept approved alternatives; no automatic universal three-month utility-bill rule. |
| DOC-003 | Income tax registration evidence | Conditional | Before TDC01 submission | Only if trigger applies — proposed gate at due stage | Capture tax reference or permitted purchaser non-registration reason. A data requirement does not automatically require a registration letter. |
| DOC-004 | Marriage certificate | Conditional | Before capacity approval / signing | Only if trigger applies — proposed gate at due stage | Certificate plus regime review; escalate customary, foreign or multiple marriages. |
| DOC-005 | Antenuptial contract | Conditional | Before capacity approval / signing | Only if trigger applies — proposed gate at due stage | Registered ANC / acceptable registry evidence; no ANC request for every married party. |
| DOC-006 | Divorce order | Conditional | Before entitlement approval / tax | Only if trigger applies — proposed gate at due stage | Final court order; s45bis may instead arise from a different joint-estate court order (see DOC-079). |
| DOC-007 | Divorce settlement agreement | Conditional | Before entitlement approval / tax | Only if trigger applies — proposed gate at due stage | Signed settlement incorporated in / read with court order; do not require a nonexistent separate settlement. |
| DOC-008 | Death certificate | Conditional | Onboarding / estate authority | Only if trigger applies — proposed gate at due stage | Death certificate; death notice is a separate record (DOC-074). |
| DOC-009 | Bank account confirmation | Conditional | Before payout / refund | Only if trigger applies — proposed gate at due stage | Independent bank verification; uploaded letter alone does not approve a changed account. |
| DOC-010 | Source of funds evidence | Conditional | CDD / before accepting relevant funds | Only if trigger applies — proposed gate at due stage | Evidence proportionate to source and risk; capture source information even where no separate upload is required. |
| DOC-011 | Company / close corporation registration documents | Conditional | Onboarding / before authority approval | Only if trigger applies — proposed gate at due stage | Current registration and representative evidence, including amendments where relevant. |
| DOC-012 | Trust deed and amendments | Conditional | Onboarding / before signing | Only if trigger applies — proposed gate at due stage | Trust deed plus operative amendments; check powers and decision-making requirements. |
| DOC-013 | Trustee letters of authority | Conditional | Before trust acts / signing | Only if trigger applies — proposed gate at due stage | Master-issued letters and current trustee details; a deed alone is insufficient authority evidence. |
| DOC-014 | Beneficial ownership / control evidence | Conditional | Before CDD approval | Only if trigger applies — proposed gate at due stage | Trace controllers / beneficial owners with appropriate evidence; do not assume one company certificate is sufficient. |
| DOC-015 | Entity resolution / authority to transact | Conditional | Before representative signs | Only if trigger applies — proposed gate at due stage | Valid resolution or other legally sufficient authority; attorney may draft, client adopts. |
| DOC-016 | Existing representative power of attorney | Conditional | Before agent signs | Only if trigger applies — proposed gate at due stage | Valid transaction-specific authority where needed; verify foreign execution separately. |
| DOC-017 | Signed offer to purchase / sale agreement | Required | Instruction / before substantive sale processing | Yes — proposed gate at due stage | Executed agreement; auction / sheriff sale uses DOC-028 as alternative record. |
| DOC-018 | Signed addendum / extension agreement | Conditional | Before relying on changed terms | Only if trigger applies — proposed gate at due stage | Valid signed amendment; attorney checks timing and whether the original agreement remained in force. |
| DOC-019 | Municipal account | Conditional | Before requesting clearances | Only if trigger applies — proposed gate at due stage | Municipal account OR confirmed municipal account reference; no redundant upload if already verified. |
| DOC-020 | Levy account / managing agent details | Conditional | Before levy clearance request | Only if trigger applies — proposed gate at due stage | Account OR confirmed managing-agent / account details. |
| DOC-021 | Lease agreement | Conditional | Title/occupation review; before tax filing | Only if trigger applies — proposed gate at due stage | Full single lease; multiple-lease summary for SARS, underlying leases retained. |
| DOC-022 | Deposit / purchase price payment proof | Conditional | Contractual due date; before lodgement approval | Only if trigger applies — proposed gate at due stage | Reconciled bank receipt / trust ledger; client payment screenshot alone does not establish cleared funds. |
| DOC-023 | Last will and testament | Conditional | Before inheritance / estate-authority approval | Only if trigger applies — proposed gate at due stage | Applicable will and codicils; intestacy uses DOC-073. |
| DOC-024 | Letters of executorship / applicable appointment | Conditional | Before executor acts / signs | Only if trigger applies — proposed gate at due stage | Master-issued appointment; verify powers. Alternative appointment routes need specific approval. |
| DOC-025 | Liquidation and distribution account | Conditional | Before distribution transfer / tax clearance | Only if trigger applies — proposed gate at due stage | Operative L&D account and distribution readiness; estate sale does not always wait for final distribution. |
| DOC-026 | Redistribution agreement | Conditional | Before entitlement and tax approval | Only if trigger applies — proposed gate at due stage | Valid agreement consistent with approved entitlement and tax treatment. |
| DOC-027 | Renunciation / repudiation / adiation evidence | Conditional | Before entitlement and tax approval | Only if trigger applies — proposed gate at due stage | Signed applicable election only; do not demand renunciation, repudiation and adiation together. |
| DOC-030 | Power of attorney to pass transfer | Required | Signing / before lodgement | Yes — proposed gate at due stage | Correctly executed transfer POA from authorised seller, executor or sheriff as applicable. |
| DOC-031 | Transferor declaration / affidavit | Conditional | Signing / before tax approval | Only if trigger applies — proposed gate at due stage | Signed applicable declaration OR equivalent accepted record; no universal standalone affidavit identified. |
| DOC-032 | Transferee declaration / affidavit | Conditional | Signing / before tax approval | Only if trigger applies — proposed gate at due stage | Signed applicable declaration OR equivalent accepted record. |
| DOC-033 | FICA / client information questionnaire | Required | Onboarding / CDD approval | Yes — proposed gate at due stage | Completed questionnaire OR verified structured digital record; attachments assessed separately. |
| DOC-034 | Spousal consent | Conditional | Before binding act requiring consent | Only if trigger applies — proposed gate at due stage | Proper consent or legally accepted alternative authority; not required merely because a party is married. |
| DOC-035 | Deed of transfer | Required | Drafting / lodgement / registration | Yes — proposed gate at due stage | Applicable deed type, reviewed and executed through deeds process. |
| DOC-036 | Transfer duty declaration (TDC01) | Required | Tax processing; monitor six-month acquisition deadline | Yes — proposed gate at due stage | Validated submission and audit record; draft TDC01 is not the SARS receipt. |
| DOC-040 | Conveyancer’s sectional title certificate (s15B) | Conditional | Before sectional transfer lodgement | Only if trigger applies — proposed gate at due stage | Conveyancer certificate with applicable levy and extension-right statements; see DOC-046 and DOC-080. |
| DOC-041 | Transfer cost quotation / pro forma | Required | Before fee commitment / requesting costs | Yes — proposed gate at due stage | Written fee/cost record; DEEDLY pro forma is one implementation. |
| DOC-042 | Final account / statement of distribution | Conditional | Before final payout / matter closure | Only if trigger applies — proposed gate at due stage | Reconciled final account and distribution approval. |
| DOC-043 | Registration notification | Optional | After registration verified | No — informational | Notification or logged communication; not a pre-registration document. |
| DOC-044 | Rates clearance figures | Conditional | Clearance preparation | Only if trigger applies — proposed gate at due stage | Current figures for correct property/account; figures do not replace certificate. |
| DOC-045 | Rates clearance certificate | Required | Before lodgement; valid at registration | Yes — proposed gate at due stage | Issued certificate for correct property; monitor stated validity and refresh if needed. |
| DOC-046 | Body corporate levy clearance confirmation | Conditional | Before DOC-040 certification | Only if trigger applies — proposed gate at due stage | Body corporate confirmation that dues are paid or satisfactory provision made; no separate client upload if attorney obtains it. |
| DOC-047 | HOA consent / clearance | Conditional | Before signing/lodgement as condition requires | Only if trigger applies — proposed gate at due stage | Correct association consent, clearance or legally approved alternative. |
| DOC-048 | SARS transfer duty receipt / exemption receipt | Required | Before lodgement approval | Yes — proposed gate at due stage | SARS-issued receipt; no duty payable does not mean no receipt. |
| DOC-049 | Bond approval letter | Conditional | By finance-condition deadline | Only if trigger applies — proposed gate at due stage | Approval matching contract requirements; record outstanding lender conditions. |
| DOC-050 | Bank / financial guarantee | Conditional | By guarantee deadline / before lodgement | Only if trigger applies — proposed gate at due stage | Acceptable guarantee OR cleared cash / approved alternative security. |
| DOC-051 | Bond cancellation figures | Conditional | Before arranging bond cancellation | Only if trigger applies — proposed gate at due stage | Current lender figures; partial release / substitution may follow a different route. |
| DOC-052 | Consent to cancellation of bond | Conditional | Before linked cancellation lodgement | Only if trigger applies — proposed gate at due stage | Cancellation attorney / mortgagee consent in proper form. |
| DOC-053 | Existing title deed / registered copy | Required | Early title review; original before lodgement if needed | Yes — proposed gate at due stage | Correct title evidence; original or permitted registry/lost-title alternative for lodgement. |
| DOC-054 | Deeds search report | Required | Before title approval; refresh before lodgement | Yes — proposed gate at due stage | Current authoritative search / equivalent registry verification; retain result. |
| DOC-055 | Electrical certificate of compliance | Conditional | Before ownership change / contractual deadline | Only if trigger applies — proposed gate at due stage | Valid CoC with test report; check two-year ownership-change rule and alterations. |
| DOC-056 | Gas certificate of conformity | Conditional | Before owner/user change or installation handover | Only if trigger applies — proposed gate at due stage | Certificate by authorised person covering installation; no invented universal expiry date. |
| DOC-057 | Electric fence compliance certificate | Conditional | Before ownership change / contractual deadline | Only if trigger applies — proposed gate at due stage | Appropriate registered-person certificate; distinguish individual from common-property installation. |
| DOC-058 | Beetle / wood-destroying organism certificate | Conditional | Contractual certificate deadline | Only if trigger applies — proposed gate at due stage | Certificate meeting actual scope, issuer and age terms; otherwise Optional. |
| DOC-059 | Water / plumbing compliance certificate | Conditional | Before transfer where local by-law applies | Only if trigger applies — proposed gate at due stage | Registered plumber certificate under current local form. |
| DOC-060 | Property valuation report(s) | Conditional | Before relevant tax submission | Only if trigger applies — proposed gate at due stage | Donation: two detailed agent valuations. Normal relevant sale: two agent valuations OR one sworn valuation. |
| DOC-061 | Master’s section 42(2) certificate | Conditional | Before estate-sale lodgement | Only if trigger applies — proposed gate at due stage | Master’s s42(2) no-objection certificate; separate from sale authority. |
| DOC-062 | Estate sale authority evidence | Conditional | Before post-death executor sale is approved | Only if trigger applies — proposed gate at due stage | Check will first. Under s47, relevant heirs approve manner/conditions in writing; minor/absentee/curatorship or disagreement invokes Master route. |
| DOC-063 | Mortgagee consent / release | Conditional | Before endorsement/development/release lodgement | Only if trigger applies — proposed gate at due stage | Consent/release matching transaction; link DOC-079 for endorsement substitution. |
| DOC-071 | Conveyancer’s section 42(1) certificate | Conditional | Before inheritance / s45 lodgement | Only if trigger applies — proposed gate at due stage | Conveyancer certifies consistency with operative L&D account. |
| DOC-073 | Next-of-kin affidavit | Conditional | Before intestate entitlement / tax submission | Only if trigger applies — proposed gate at due stage | Next-of-kin affidavit / required accepted evidence. |
| DOC-074 | Death notice | Conditional | Before estate tax submission where applicable | Only if trigger applies — proposed gate at due stage | Death notice; distinct from death certificate. |
| DOC-081 | Suspensive-condition fulfilment / waiver evidence | Conditional | By each condition deadline; before lodgement | Only if trigger applies — proposed gate at due stage | Evidence of fulfilment or valid waiver/extension where permitted; record deadline and approving attorney. |
| DOC-082 | Confirmed registration record | Required | After registration; before payout / closure | Yes — proposed gate at due stage | Authoritative registration confirmation with date/reference; draft deed alone does not satisfy. |
| DOC-083 | VAT / tax-treatment supporting evidence | Conditional | Before final tax determination | Only if trigger applies — proposed gate at due stage | Evidence of taxable supply and relevant tax basis; vendor status alone is insufficient. |

## 3. Candidate condition vocabulary

One `condition_key` per rule; a document gated by "either of two facts" needs
a composite key (the shared-doc_code satisfaction gap in the template doc
§1.1 makes two separate rules wrong — a matter would show the document twice).

**Purchaser finance and the seller's existing bond are deliberately separate
facts.** The current `has_bond` / `cash_purchase` heuristics conflate them (a
`bonds` row or `loan_amount > 0` says nothing about a bond registered over
the *seller's* title). Neither existing key is reused here.

### 3.1 Candidate inventory — 35 keys covering all 51 Conditional cells

| condition_key | Meaning / fact needed | Proposed fact source | Gates |
|---|---|---|---|
| `party_is_entity` | A party is a company or close corporation | Party entity type on matter parties — **not currently stored per requirement; needs capture or derivation** | DOC-011, DOC-014, DOC-015 |
| `party_is_trust` | A party is a trust | Same party-type fact | DOC-012, DOC-013, DOC-014, DOC-015 |
| `marriage_affects_capacity` | A party's matrimonial regime affects capacity/ownership | Marital-status facts per party — not stored | DOC-004, DOC-005 |
| `divorce_affects_party` | Divorce order/settlement determines entitlement | Staff-declared fact | DOC-006, DOC-007 |
| `deceased_party` | A party to the matter is deceased; an estate representative must act | Staff-declared; needs a deceased/estate flag on the party record | DOC-008 |
| `estate_representative_appointed` | An executor/representative transfers or endorses estate property | Estate appointment fact — distinct role, not implied by `deceased_party` | DOC-024 |
| `estate_testate` | The estate is testate — a will determines executor powers | Estate route fact (testate vs intestate) | DOC-023 |
| `estate_intestate` | The estate is intestate | Estate route fact — the *opposite* route, not "no answer" | DOC-073, DOC-074 |
| `estate_sale_route` | The executor sells estate property post-death (s42(2)/s47) | Estate route fact — sale route, distinct from distribution | DOC-061, DOC-062 |
| `estate_distribution_route` | Transfer/endorsement follows the L&D distribution (inheritance, s45) | Estate route fact — distribution route, distinct from sale | DOC-025, DOC-026, DOC-027, DOC-071 |
| `representative_signs` | Someone signs on behalf of a party | Party/representative link — not stored | DOC-016 |
| `spousal_consent_required` | Matrimonial regime + act requires spouse consent | Marital-regime fact + transaction type | DOC-034 |
| `rmcp_enhanced_verification` | Firm RMCP/risk assessment calls for enhanced evidence | Compliance-officer-set flag on the matter | DOC-002, DOC-010 |
| `tax_reference_required` | SARS requires a tax reference for the party (incl. the R2m individual threshold) | Party type + purchase price (derivable once financials store price) — confirm derivation with Dean | DOC-003 |
| `suspensive_conditions_open` | Sale has unfulfilled suspensive conditions | Contract terms — staff-declared or parsed | DOC-081 |
| `terms_amended` | Parties varied terms / extended a deadline | Staff-declared | DOC-018 |
| `declarations_required` | Route requires transferor/transferee declarations | Firm/route flag | DOC-031, DOC-032 |
| `wdo_certificate_clause` | Sale agreement or lender requires WDO certificate | Contract clause flag | DOC-058 |
| `sectional_unit` | The property is a sectional title unit (s15B certificate route) | `properties.property_type` — unit status only; body-corporate existence is a separate fact | DOC-040 |
| `body_corporate_exists` | The scheme has a body corporate / levy administration | Scheme/body-corporate fact — NOT implied by `sectional_unit` (first-transfer and no-BC branches exist) | DOC-020, DOC-046 |
| `hoa_consent_required` | Title condition or binding HOA provision requires consent | Title-condition review flag | DOC-047 |
| `property_leased` | Property is leased / SARS needs lease evidence | Staff-declared or lease data | DOC-021 |
| `electrical_installation` | Electrical installation present on change of ownership | Property features — near-universal; consider baseline instead | DOC-055 |
| `gas_installation` | Gas installation present | Property features | DOC-056 |
| `electric_fence` | Electric fence present | Property features | DOC-057 |
| `water_bylaw_applies` | Municipal water-certificate by-law applies to this property | Municipality on the property record | DOC-059 |
| `clearance_figures_needed` | Municipal/levy figures must be requested | Follows from clearance obligation — near-universal; consider baseline instead | DOC-019, DOC-044 |
| `buyer_bond_finance` | **Purchaser** relies on bond finance | Buyer financing fact (bonds row / loan_amount is the unapproved heuristic — Dean must approve the source) | DOC-049 |
| `guarantee_required` | Contract requires a guarantee / price security | Contract terms flag | DOC-050 |
| `deposit_due` | Cash deposit or price payment is due | Contract terms / financials | DOC-022 |
| `payout_expected` | Money will be paid out to a party account | Financials / payout instructions | DOC-009 |
| `seller_bond_registered` | **Seller** has a registered bond over the property that must be cancelled or dealt with | Deeds search / title facts — never infer from buyer finance | DOC-051, DOC-052, DOC-063 |
| `reconciliation_needed` | Matter has financial entries needing a final account | Trust ledger/financials presence | DOC-042 |
| `valuation_required` | SARS requests valuation (connected-party, partial share) | Tax-route flag | DOC-060 |
| `vat_treatment_claimed` | VAT treatment/exemption or going-concern is claimed | Seller VAT status + tax-route flag | DOC-083 |

The estate cluster deliberately separates **roles** (`deceased_party`,
`estate_representative_appointed`) from **routes** (`estate_testate` /
`estate_intestate`, `estate_sale_route` / `estate_distribution_route`): an
estate sale needs s42(2)/s47 authority evidence while a distribution
transfer needs the L&D account trail — one flag cannot express both, and
testate vs intestate are different legal routes, not a boolean on one.
Likewise `sectional_unit` (a property-type fact) and `body_corporate_exists`
(a scheme fact) stay separate: a sectional unit in a scheme with no
operative body corporate takes a different document path.

**Derivable vs declared.** Keys like `buyer_bond_finance`,
`tax_reference_required`, `sectional_unit` and `clearance_figures_needed`
have plausible derivations from existing data (bonds/financials rows, party
types, property_type). The rest are staff-declared facts that need capture
points — either new matter/party fields or explicit "fact checklist"
answers. None of this exists today; each key needs an approved fact source
before its rules can seed.

### 3.2 P0 demo subset — 12 keys (proposed)

A standard P0 demo is an ordinary private-treaty sale: natural-person
parties, purchaser bond finance, a seller bond to cancel, contract-driven
money facts, and the common compliance toggles. **This subset is proposed,
not agreed** — Dean confirms which facts the demo exercises. The estate
cluster and the route-specific keys stay in the §3.1 inventory for later
expansion.

**Scope** identifies what the fact is about — the relevant **party**
(person/entity on the matter), the relevant **property**, or the **matter**
as a whole. Scoped facts need a per-entity value: e.g. `seller_bond_registered`
attaches to the property being transferred (a bond is registered over a
title, not over a matter), and `marriage_affects_capacity` attaches to the
specific married person. On a multi-party or multi-property matter the
engine's single-value fact model cannot express that — it needs either
per-entity fact storage or an approved "any relevant entity" aggregation
rule per key. That scoping decision is part of the vocabulary review and is
unimplemented.

| condition_key | Scope | Input source | Allowed values | Unknown behaviour |
|---|---|---|---|---|
| `buyer_bond_finance` | Party (transferee) | Derived: purchaser `bonds` row / `transfer_financials.loan_amount` (source needs Dean's sign-off) | `yes` / `no` / `unknown` | DOC-049 rule unevaluated; surfaced as pending fact |
| `seller_bond_registered` | Property | Declared from deeds-search result for the property being transferred (never derived from buyer finance) | `yes` / `no` / `unknown` | DOC-051/052/063 rules unevaluated; surfaced |
| `guarantee_required` | Matter | Declared from sale agreement | `yes` / `no` / `unknown` | DOC-050 rule unevaluated |
| `deposit_due` | Matter | Declared from contract / `transfer_financials` deposit | `yes` / `no` / `unknown` | DOC-022 rule unevaluated |
| `suspensive_conditions_open` | Matter | Declared from contract condition tracking | `yes` / `no` / `unknown` | DOC-081 rule unevaluated |
| `party_is_entity` | Party (each) | Derived from matter-party entity type | `yes` / `no` / `unknown` (unknown if any party lacks a type) | DOC-011/014/015 rules unevaluated |
| `party_is_trust` | Party (each) | Derived from matter-party entity type | `yes` / `no` / `unknown` | DOC-012/013/014/015 rules unevaluated |
| `marriage_affects_capacity` | Party (each natural person) | Declared per party (marital-status capture — not stored today) | `yes` / `no` / `unknown` | DOC-004/005 rules unevaluated |
| `property_leased` | Property | Declared / lease data on the property | `yes` / `no` / `unknown` | DOC-021 rule unevaluated |
| `electrical_installation` | Property | Declared on property features (near-universal — demo may assert `yes`) | `yes` / `no` / `unknown` | DOC-055 rule unevaluated |
| `clearance_figures_needed` | Property | Derived from the property's clearance obligation (near-universal — may become baseline) | `yes` / `no` / `unknown` | DOC-019/044 rules unevaluated |
| `payout_expected` | Party (per payee) | Derived from financials / payout instructions to a party account | `yes` / `no` / `unknown` | DOC-009 rule unevaluated |

Every demo fact is tri-state. `unknown` never means `no`: an unanswered fact
leaves its rules in `unevaluatedRules` and the matter shows "Requirement
evaluation is incomplete" — it cannot produce a clean checklist by silence.
The remaining 23 inventory keys behave identically when their rules are
approved later; their scopes follow the same convention (estate role/route
facts are party-scoped, installation/by-law facts are property-scoped,
contract and firm-route facts are matter-scoped).

### 3.3 Zero applicable rules is not readiness — pending, unimplemented

A matter whose classification has **no** configured rules — an unsupported
classification, `transfer.generic`, or any code with no approved rule set —
must present **"Requirements not configured"**, never an empty checklist
that reads as complete. Zero applicable rules is an *absence of
configuration*, not evidence that nothing is required.

This is a required engine/API change that **does not exist today**: the
current service returns an empty requirement list in exactly this situation,
and no test establishes correct readiness behaviour — the proposal tests
cover only the seed content (row shape, scope, idempotency, canonical
codes), not readiness semantics. Until the configured-vs-unconfigured
distinction is built and verified, completeness displays on matters without
an approved rule set are untrustworthy by construction.

## 4. Unknown-answer semantics (already the engine's model — proposed to keep)

The engine is tri-state by design and this proposal extends that convention
unchanged:

- A fact that is **unknown** (not stored, not answered) makes every rule
  depending on it **unevaluable** — it surfaces in `unevaluatedFacts` /
  `unevaluatedRules` and the UI shows "Requirement evaluation is incomplete".
- An unevaluable rule is **never** treated as satisfied, applicable, or
  "not required": its requirement is not created, and an existing
  requirement bound to it is **never withdrawn** on missing data.
- A staff-declared fact left unanswered stays unknown — there is no
  default-to-false. A matter with an unanswered `deceased_party` shows the
  estate documents as pending-review, not absent.
- "Not applicable" is a *positive* answer (fact = no), never the absence of
  an answer. Register guidance: "Never treat unknown applicability as 'not
  required'."

## 5. What needs deciding before any of this can seed

1. The P0 selection itself (register "Include in P0?" is all To review).
2. The §3 vocabulary: key names, composite rules, and each fact's
   authoritative source (Dean) — then engine work to extend
   `_SUPPORTED_CONDITIONS` + `_load_matter_context`.
3. Where staff-declared facts are captured (matter/party fields or a fact
   checklist) — product decision.
4. Stage gating / blocking — decisions doc §4 leaves this open; the
   "blocks progression" column is intent only.
5. Whether `electrical_installation` and `clearance_figures_needed` should
   instead be baseline rules (near-universal in this classification) — the
   register keeps them Conditional.
