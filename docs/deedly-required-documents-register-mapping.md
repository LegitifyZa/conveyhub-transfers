# Required Documents Register → DEEDLY document/rules structure

Mapping and gap report for `DEEDLY_Required_Documents_Register.xlsx`
(21 September 2026; sheets: Requirements, Document catalogue, Rule guidance,
Classification guide, Sources). 86 document types × 18 classifications =
1,548 cells: **222 Required / 825 Conditional / 473 Not applicable / 28
Optional**.

Companion to `docs/deedly-document-catalogue-template.md` (the fill-in/import
contract this register answers) and `docs/deedly-matter-documents-decisions.md`
§0 ("Required documents — Included in P0 … Dean will supply the approved
catalogue"). Proposed seed:
`docs/proposals/027_deedly_document_requirement_rules_seed.sql` — kept
outside `src/lib/migrations/` so `scripts/migrate.mjs` (which executes every
`*.sql` there) cannot pick it up; numbering to be confirmed with Jordan
before it is ever moved back. Focused per-classification proposal:
`docs/deedly-required-documents-pt-na-proposal.md`.

**Register caveat preserved — no approval is assumed.** The workbook describes
its matrix as "editable proposals, not approved production rules" and marks
every "Signature / execution needed?" and "Include in P0?" cell **To review**.
The Required level is therefore treated as a *candidate* baseline, not a P0
approval: **migration 027 is review content pending the team's validated P0
selections** and must not be executed or merged until they arrive. Nothing
marked To review or deferred is implemented.

---

## 1. Classification mapping — complete, no gap

All 18 register classifications map 1:1 onto `matter_classification_options`
(migrations 015 + 020; the only unmapped register column is the user-override
columns U/V, which are empty).

| Register column | canonical_code |
|---|---|
| Private Treaty — Not Applicable | `transfer.private_treaty.not_applicable` |
| Private Treaty — Sectional Title Register | `transfer.private_treaty.sectional_title_register` |
| Private Treaty — Township Register | `transfer.private_treaty.township_register` |
| Private Treaty — Extension of Scheme | `transfer.private_treaty.extension_of_scheme` |
| Private Treaty — Subdivision | `transfer.private_treaty.subdivision` |
| Private Treaty — Bulk Transfer | `transfer.private_treaty.bulk_transfer` |
| Auction | `transfer.auction` |
| Sale in Execution | `transfer.sale_in_execution` |
| Property in Possession | `transfer.property_in_possession` |
| Deceased Estate — Inheritance | `transfer.deceased_estate_inheritance` |
| Deceased Estate — Sale | `transfer.deceased_estate_sale` |
| Endorsement — Section 45 | `transfer.endorsement_section_45` |
| Endorsement — Section 45bis | `transfer.endorsement_section_45bis` |
| Donation | `transfer.donation` |
| New Sectional Title Register | `development.new_sectional_title_register` |
| New Township Register / Establishment | `development.new_township_register_establishment` |
| Scheme Extension (Sections) | `development.scheme_extension_sections` |
| Subdivision | `development.subdivision` |

## 2. Requirement-level mapping — what the engine can express

The rules engine (`transfers.document_requirement_rules` →
`transfer_document_requirements`, evaluated by
`python_server/services/matter_document_service.py`) supports exactly two
rule shapes: **baseline** (`condition_key NULL` — applies when the
classification matches) and **conditional** on the fixed vocabulary
`has_bond` / `cash_purchase`. There is no Optional level, no stage, no
per-party scope, and no free-text trigger.

| Register level | Engine mapping | Proposed for seed? |
|---|---|---|
| Required | Baseline rule, `condition_key NULL`, one row per classification | **Proposed — 222 cells → 222 rules** |
| Conditional | Would need `condition_key` + a stored fact. Register triggers are prose; none map to `has_bond`/`cash_purchase` cleanly | **No — see §4.1** |
| Optional | No "suggested but ungated" state exists | No — docs stay addable free-form by name |
| Not applicable | Absence of a rule | No rows (correct by construction) |

### 2.1 Proposed set (`docs/proposals/027_…` — review artifact, pending P0 selections)

- One rule per Required cell: **222 rows**, each scoped to an explicit
  canonical `classification_code`. **No `'*'` wildcards** — a wildcard would
  extend requirements to `transfer.generic` and any future classification the
  register never reviewed. The six documents Required on all 18
  classifications (DOC-001, DOC-033, DOC-041, DOC-053, DOC-054, DOC-082) are
  seeded as 18 explicit rows each.
- `rule_key` = `doc-NNN.{classification_code}` — encodes both the register
  document identity and the rule scope; stable and never reused.
- `sequence_number` = register DOC number (display order only — not a stage).
- Idempotent upsert on `rule_key` per the proposed import contract (template
  doc §3.2): `display_name`, `classification_code`, `condition_key`,
  `sequence_number` refreshed; a `rule_key` reused for a different
  requirement is a review conflict, not a rename.

Per-classification baseline counts in the proposal: Private Treaty — NA 12,
Sectional Title Register 13, Township Register 12, Extension of Scheme 13,
Subdivision (PT) 12, Bulk Transfer 13, Auction 12, Sale in Execution 14,
Property in Possession 12, Deceased Estate — Inheritance 15, Deceased
Estate — Sale 15, Endorsement s45 13, Endorsement s45bis 9, Donation 14, New
Sectional Title Register 12, New Township Register 10, Scheme Extension 11,
Subdivision (dev) 10.

## 3. Document-catalogue attribute mapping

Register sheet 2 attributes vs `document_requirement_rules` columns:

| Register column | Engine field | Status |
|---|---|---|
| Document ID (DOC-001…086) | `rule_key` prefix | Persisted (embedded) |
| Document name | `display_name` | Persisted |
| Suggested stage | — | **Not persisted** — no stage/gate concept (§4.4) |
| Suggested condition/trigger | `condition_key` | **Not persisted** — prose, no vocabulary (§4.1) |
| Category (FICA/Tax/…) | — | **Not persisted** — no column |
| Origin / collection route | — | **Not persisted** — no column |
| Applies to party | — | **Not persisted** — per-matter engine only (§4.3) |
| Basis / source (S01…S16, P01) | — | **Not persisted** — no column; kept in this doc/register |
| Generate in DEEDLY? = "Candidate" | — | **Not implemented** — unverified capability (§7.3) |
| Signature / execution needed? = "To review" | — | **Not approved** — all 86 rows To review |
| Include in P0? = "To review" | — | **Not persisted** — see §7.1 interpretation flag |
| `legal_authority`-equivalent | — | Basis text has no rules-table column (§6.2) |

## 4. Gaps — engine vs register

### 4.1 Conditional requirements cannot be seeded (825 cells, 53%)

Every Conditional cell needs a `condition_key` evaluated against stored
matter facts. The engine vocabulary is exactly `has_bond`/`cash_purchase`,
sourced from `bonds` rows / `transfer_financials.loan_amount` — and those
heuristics are themselves recorded as *unapproved implementation choices*
(decisions doc §8). Even bond-adjacent register triggers don't fit:
DOC-049/050 concern *buyer* finance (roughly `has_bond`), but DOC-051/052
concern the *seller's existing registered bond* — a different fact entirely.

The register's Conditional triggers cluster into fact domains the product
does not yet store:

- **Party entity/marital facts:** party is company/CC/trust (DOC-011…015),
  marriage/ANC/divorce affects capacity (DOC-004…007, DOC-034, DOC-086),
  representative signs (DOC-016), spousal consent regime (DOC-034).
- **Estate facts:** death affects matter (DOC-008, DOC-073, DOC-074), testate
  vs intestate (DOC-023), redistribution/election (DOC-025…027).
- **Property/installation facts:** electrical/gas/electric-fence/plumbing
  installations exist (DOC-055…057, DOC-059), body corporate / HOA exists
  (DOC-020, DOC-046, DOC-047), property leased (DOC-021).
- **Contract facts:** suspensive conditions (DOC-081), deposit due (DOC-022),
  guarantee required (DOC-050), finance clause (DOC-049), addendum (DOC-018),
  WDO certificate clause (DOC-058).
- **Finance/payment facts:** source-of-funds risk (DOC-010), bank account for
  payout (DOC-009), bond approval (DOC-049), bond to cancel (DOC-051/052),
  mortgagee consent (DOC-063, DOC-079).
- **Tax facts:** tax reference needed (DOC-003), VAT/going-concern claimed
  (DOC-083), valuation needed (DOC-060).
- **Route/authority facts:** POA used (DOC-016), declarations needed
  (DOC-031/032), estate-sale authority (DOC-062), extension-right route
  (DOC-069/070), scheme-rules route (DOC-070, DOC-080).

Implementing these requires **(a)** an approved `condition_key` vocabulary,
**(b)** stored fact sources (mostly new fields on matters/parties/properties
or new staff-captured facts — most do not exist today), and **(c)** the
tri-state "unknown → unevaluated, never negative" treatment the engine
already defines. Until then, seeded unknown keys would produce permanently
`unevaluatedRules` noise on every matching matter — the import contract
(template §3.2) explicitly rejects that.

### 4.2 No Optional level

28 cells (e.g. DOC-043 Registration notification everywhere, DOC-058 beetle
certificate on endorsement/development routes, DOC-060 valuations on
auction/execution). The engine has only "rule applies / rule doesn't" —
nothing expresses "available, not required". These documents remain
collectable free-form via `POST …/documents` by name; they get no checklist
visibility. A `level`/`requiredness` column is a schema decision.

### 4.3 No per-party scope

Register "Applies to party" (Transferor / Transferee / Estate representative /
Developer / spouses / sheriff / matter) cannot be expressed — one
`transfer_document_requirements` row per `(transfer_id, requirement_key)`.
Where a document is Required only for one side, the seeded rule applies to
the matter as a whole. Per-party instances need the flagged engine extension
(template doc §5.4).

### 4.4 No stage/due-state

Register "Suggested stage" (onboarding → clearance → signing → lodgement →
registration → closure) has no engine field. `sequence_number` is display
order only; nothing gates a stage. Requirement satisfaction is evaluated
against "now". Stage gating is the deferred product decision in decisions
doc §4 — **not implemented**.

### 4.5 No trigger/evidence/basis text

Accepted-evidence guidance (e.g. "ID OR passport, not both", "reconciled bank
receipt, not a screenshot") and basis/source IDs (S01…S16, P01) have no
columns. Reviewers currently see `display_name` only. Persisting guidance is
a schema extension — flagged, not improvised into `display_name` strings.

### 4.6 'transfer.generic' coverage — sharper with explicit scopes

With explicit classification scopes (no `'*'`), a matter on the
`transfer.generic` fallback matches **zero** rules — its requirement list is
empty, and because it *has* a recorded classification nothing surfaces
`unevaluatedFacts` to warn that the list is incomplete. The register has no
generic column, so there is no validated baseline for generic matters.
Options for Dean: disallow/resolve `transfer.generic` at capture, add a
reviewed generic ruleset, or accept an empty baseline with a UI caveat.
Flagged; no code change made.

### 4.7 Zero applicable rules must not read as readiness

Related to §4.6 and strictly broader: the engine cannot distinguish "rules
configured, none applicable" from "no rules configured at all". A matter
with an unsupported or unconfigured classification (`transfer.generic`, a
future code, or any classification whose rule set was never approved) must
present **"Requirements not configured"** — an explicit unknown state —
rather than an empty requirement list that reads as a successful
completeness result. Zero applicable rules is an absence of configuration,
not evidence that nothing is required.

**Status: pending — unimplemented.** This is a required engine/API/behaviour
change, not a documented property of the current system. Today the engine
returns an empty requirement list in this situation, and the proposal tests
do not exercise or verify readiness handling — nothing in the verified
results establishes that readiness behaves correctly. It remains open work
inside the same vocabulary/schema review; do not claim it covered.

## 5. Conflicts — where the register and existing structure disagree

1. **Legacy per-transfer auto-seed vs classification-aware rules.** The
   quarantined `seed_transfer_documents` attaches *every* `Active` +
   `module='Transfers'` `document_catalogue` row to a new transfer. If the 86
   register documents were seeded `Active` into `public.document_catalogue`,
   unquarantining that path would attach all 86 to every transfer regardless
   of classification — the anti-pattern the matrix exists to replace.
   `document_catalogue` is therefore **not seeded** (§6.1).

2. **Two "requirement" tables with different semantics.**
   `document_catalogue_requirements` (public) lists *supporting documents a
   catalogue doc needs*; `transfer_document_requirements` (transfers) lists
   *documents a matter owes*. The register's "required" is the second sense.
   The legacy table is not used for this register — flag to avoid conflation.

3. **"Required" ≠ statutory requirement.** The register itself warns its
   Required level is a *baseline incl. firm controls*, not a statutory
   mandate per named upload. Seeding them as engine rules makes them
   checklist obligations — the display name carries no statutory claim, and
   the basis text (statutory vs firm-policy) currently has no column (§4.5).

4. **`has_bond`/`cash_purchase` heuristic mismatch.** Even where register
   triggers look bond-shaped, the register distinguishes buyer-finance
   (DOC-049/050) from seller-bond cancellation (DOC-051/052) and
   endorsement debtor-substitution (DOC-079). The engine's single `has_bond`
   fact cannot separate these — mapped to no rule rather than mis-mapped.

5. **Sheet 3 conflicts with the matrix on DOC-079 numbering.** Rule guidance
   refers to "s45bis may instead arise from a different joint-estate court
   order (see DOC-079)" but DOC-079 is the bond debtor-substitution row and
   DOC-086 is the court-order row — likely a stale cross-reference; noted,
   no impact on seeding.

6. **Register self-describes as "editable proposals".** No P0 approval is
   inferred from the Required level (§7.1). The proposed rows would enter as
   `active` *if* approved — until then they are unexecuted review content.
   Any future level change needs a `retired` transition — and retirement
   semantics for outstanding instances are **unresolved** (template §3.2:
   retired rules leave instances untouched — do not exercise retirement
   before that is decided).

## 6. What was intentionally not extended

1. **`public.document_catalogue` not seeded** — dead on the live lane (the
   quarantined catalogue routes and generic-fallback map are its only
   consumers), and `Active` rows would re-arm the legacy auto-seed (§5.1).
   Its columns also cannot hold category/origin/party/stage. If Dean wants the
   86 documents queryable in the legacy catalogue too, that is a separate,
   status-careful seed — not assumed here.

2. **`classification_document_map` not populated** — dead structure (written
   only by migration 015's generic fallback; no live reader). The live lane
   reads `document_requirement_rules` exclusively.

3. **No `document_templates` rows** — "Generate in DEEDLY? = Candidate" is a
   template *candidate* flag, explicitly "not verified DEEDLY capability";
   signature/execution flags are all "To review".

4. **No condition vocabulary invented** — §4.1's fact domains are listed for
   Dean's approval; nothing was coerced into `has_bond`/`cash_purchase`.

5. **No schema changes to `document_requirement_rules`** — persisting level,
   stage, trigger, evidence, scope, version or doc_code all need Dean →
   Jordan schema work (open items in template §5).

## 7. Open items for review

1. **P0 selection pending.** Every register row marks "Include in P0? = To
   review" — Required is a *candidate* baseline, not an approved P0 set. The
   seed file is review content only: it must not execute or merge until the
   team's validated P0 selections arrive. Once confirmed, the approved subset
   is pruned from the same VALUES list (explicit scopes only).

2. **Explicit scopes, no wildcard.** Universal documents are seeded as 18
   explicit classification rows; `'*'` is deliberately unused so no
   requirement can extend to unreviewed classifications (incl.
   `transfer.generic` — see §4.6).

3. **Migration number 027** assumed free (024/026 reserved on the property
   branch, 025 on this branch) — **confirm with Jordan before moving the
   proposal back under `src/lib/migrations/`**.

4. **PostgreSQL-backed tests — run against a real Neon database.**
   `python_server/tests/test_document_requirement_rules_seed_proposal.py`
   (17 tests, incl. 3 DB cases: insert count, idempotent re-run, canonical
   classification coverage) passes 17/17 against the scratch database
   `deedly_proposal_test` on the isolated `deedly-documents-test` Neon
   branch (endpoint `ep-lucky-sun-awl88y3n`). **No production or shared
   application database was migrated.** The proposal SQL applied inside
   rolled-back transactions — `document_requirement_rules` is empty
   afterwards and the ledger has no 027 row. A static guard test asserts no
   `document_requirement_rules_seed` file exists under
   `src/lib/migrations/`, so `scripts/migrate.mjs` cannot execute the
   proposal. Note: the branch's own `neondb` database holds the legacy
   all-`public` layout (no `transfers` schema) and an empty ledger — it
   predates the schema split and cannot host these tests.

5. **Database exposure flag — commit `a24cdc3`.** That commit placed an
   earlier version of this seed (120 rules including six `'*'` wildcard
   scopes) at `src/lib/migrations/027_deedly_document_requirement_rules_seed.sql`.
   Any database that executed it carries a
   `public.transfers_schema_migrations` ledger row for that filename plus
   **unapproved** rules — including wildcard rules that attach documents to
   `transfer.generic` and future classifications. Such a database is
   flagged: reset or reconcile it under the approved P0 seed before
   reliance; its `document_requirement_rules` content is not a baseline.
   The `deedly-documents-test` Neon branch (endpoint `ep-lucky-sun-awl88y3n`)
   was checked before use — no ledger, no rules table — and is therefore
   unexposed; its scratch database `deedly_proposal_test` holds only the
   approved 001–025 chain plus rolled-back proposal test runs.

6. **Requirement instances on existing matters** appear only on
   `POST …/requirements/recalculate` — seeding rules does not retro-create
   instances; that is engine behaviour, not a seed gap.

7. **Retirement semantics unresolved** (template §3.2): `status='retired'`
   leaves existing instances untouched. No retirement may be exercised before
   Dean/Louis decide the intended end-state for outstanding requirements.

## 8. Source register digest (per-document metadata not persisted in DB)

The register's per-document attributes (category, origin route, applies-to
party, trigger, stage, basis) are preserved below — they have no DB home yet
(§4.3–4.5) but are the vocabulary candidates for §4.1's condition work.

| Doc | Name | Category | Origin | Party | Trigger (Conditional basis) | Stage | Gen? | Basis |
|---|---|---|---|---|---|---|---|---|
| DOC-001 | Identity document / passport | FICA | Client supplied | Both | Identify each relevant person and representative under the firm RMCP. | Onboarding / before regulated work | No | CDD + firm implementation • S09; S15 • See Rule guidance / Sources |
| DOC-002 | Residential address evidence | FICA | Client supplied | Both | Firm RMCP calls for address verification or enhanced evidence. | Onboarding | No | Firm RMCP recommendation • S09; P01 • See Rule guidance / Sources |
| DOC-003 | Income tax registration evidence | Tax | Client supplied | Both | Tax reference required for seller and purchaser; for individuals, transactions above R2 million. Separate proof only where needed. | Before TDC01 submission | No | SARS + product recommendation • S01 • See Rule guidance / Sources |
| DOC-004 | Marriage certificate | Capacity | Client supplied | Both | Marriage affects capacity, ownership or endorsement route. | Before capacity approval / signing | No | Capacity review recommendation • P01 • See Rule guidance / Sources |
| DOC-005 | Antenuptial contract | Capacity | Client supplied | Both | An ANC establishes the applicable property regime. | Before capacity approval / signing | No | Capacity review recommendation • P01 • See Rule guidance / Sources |
| DOC-006 | Divorce order | Capacity | Client supplied | Both | Divorce is the basis of entitlement or affects capacity. | Before entitlement approval / tax | No | Statutory / SARS conditional • S02; S04 • See Rule guidance / Sources |
| DOC-007 | Divorce settlement agreement | Capacity | Client supplied | Both | Settlement determines property allocation. | Before entitlement approval / tax | No | SARS / entitlement evidence • S02 • See Rule guidance / Sources |
| DOC-008 | Death certificate | Estate | Client supplied | Estate representative | Death affects the matter or the surviving spouse’s entitlement. | Onboarding / estate authority | No | Estate authority recommendation • S03; P01 • See Rule guidance / Sources |
| DOC-009 | Bank account confirmation | Financial | Client supplied | Both | Money will be paid to that account. | Before payout / refund | No | Firm payment control • P01 • See Rule guidance / Sources |
| DOC-010 | Source of funds evidence | FICA | Client supplied | Transferee | RMCP risk assessment requires source-of-funds corroboration. | CDD / before accepting relevant funds | No | Firm RMCP recommendation • S09; S15 • See Rule guidance / Sources |
| DOC-011 | Company / close corporation registration documents | FICA | Client supplied | Both | Company or CC is a relevant party. | Onboarding / before authority approval | No | Entity / CDD recommendation • S09; P01 • See Rule guidance / Sources |
| DOC-012 | Trust deed and amendments | FICA | Client supplied | Both | A trust is a relevant party. | Onboarding / before signing | No | Capacity / CDD recommendation • S09; P01 • See Rule guidance / Sources |
| DOC-013 | Trustee letters of authority | Capacity | Client supplied | Both | Trustees act for a trust. | Before trust acts / signing | No | Capacity recommendation • P01 • See Rule guidance / Sources |
| DOC-014 | Beneficial ownership / control evidence | FICA | Client supplied | Both | Entity / trust requires ownership and control verification. | Before CDD approval | No | CDD + firm implementation • S09; S15 • See Rule guidance / Sources |
| DOC-015 | Entity resolution / authority to transact | Capacity | Client supplied | Both | Entity / trust acts through authorised signatories. | Before representative signs | No | Capacity recommendation • P01 • See Rule guidance / Sources |
| DOC-016 | Existing representative power of attorney | Capacity | Client supplied | Both | Someone signs on behalf of a party. | Before agent signs | No | Capacity recommendation • S04; P01 • See Rule guidance / Sources |
| DOC-017 | Signed offer to purchase / sale agreement | General | Client supplied | Both | Private sale, PIP resale or estate sale. | Instruction / before substantive sale processing | No | Contract / SARS • S02 • See Rule guidance / Sources |
| DOC-018 | Signed addendum / extension agreement | General | Client supplied | Both | Parties vary terms or extend a deadline. | Before relying on changed terms | No | Contractual • P01 • See Rule guidance / Sources |
| DOC-019 | Municipal account | Municipal | Client supplied | Transferor | Account details are needed to request figures. | Before requesting clearances | No | Operational evidence • P01 • See Rule guidance / Sources |
| DOC-020 | Levy account / managing agent details | Sectional title | Client supplied | Transferor | Property has body corporate / estate levy administration. | Before levy clearance request | No | Operational evidence • P01 • See Rule guidance / Sources |
| DOC-021 | Lease agreement | General | Client supplied | Transferor | Property is leased or SARS needs lease evidence. | Title/occupation review; before tax filing | No | Contract / SARS • S01 • See Rule guidance / Sources |
| DOC-022 | Deposit / purchase price payment proof | Financial | Client supplied | Transferee | Cash deposit or price is due. | Contractual due date; before lodgement approval | No | Contract + firm payment control • P01 • See Rule guidance / Sources |
| DOC-023 | Last will and testament | Estate | Client supplied | Estate representative | Testate estate or will determines executor sale powers. | Before inheritance / estate-authority approval | No | Estate / SARS conditional • S02; S03 • See Rule guidance / Sources |
| DOC-024 | Letters of executorship / applicable appointment | Estate | Client supplied | Estate representative | Estate representative transfers or endorses estate property. | Before executor acts / signs | No | Estate authority • S03; S02 • See Rule guidance / Sources |
| DOC-025 | Liquidation and distribution account | Estate | Client supplied | Estate representative | Inheritance or s45 entitlement depends on distribution. | Before distribution transfer / tax clearance | No | Estate / SARS • S03; S02 • See Rule guidance / Sources |
| DOC-026 | Redistribution agreement | Estate | Client supplied | Estate representative | Beneficiaries redistribute estate assets. | Before entitlement and tax approval | No | Estate / SARS conditional • S02 • See Rule guidance / Sources |
| DOC-027 | Renunciation / repudiation / adiation evidence | Estate | Client supplied | Estate representative | Beneficiary election changes entitlement. | Before entitlement and tax approval | No | Estate / SARS conditional • S02 • See Rule guidance / Sources |
| DOC-028 | Auction conditions and signed sale record | General | Third-party issued | Both | Auction or execution-sale route. | Instruction / before sale processing | No | Contract / execution evidence • S02; P01 • See Rule guidance / Sources |
| DOC-029 | Court order / writ supporting execution sale | Authority | Third-party issued | Transferor | Sale in execution, not an ordinary resale of PIP. | Before recognising sheriff authority | No | Court process; provisional implementation • S14; P01 • See Rule guidance / Sources |
| DOC-030 | Power of attorney to pass transfer | Transfer | Attorney generated | Transferor | Conventional transfer rather than endorsement / register opening. | Signing / before lodgement | Candidate | Registration instrument • S04 • See Rule guidance / Sources |
| DOC-031 | Transferor declaration / affidavit | Transfer | Attorney generated | Transferor | Information / declarations are needed for this transfer route. | Signing / before tax approval | Candidate | Firm template / tax evidence • P01 • See Rule guidance / Sources |
| DOC-032 | Transferee declaration / affidavit | Transfer | Attorney generated | Transferee | Transferee information / declarations are needed. | Signing / before tax approval | Candidate | Firm template / tax evidence • P01 • See Rule guidance / Sources |
| DOC-033 | FICA / client information questionnaire | FICA | Attorney generated | Both | Firm collects client due-diligence information. | Onboarding / CDD approval | Candidate | Firm workflow recommendation • S09; P01 • See Rule guidance / Sources |
| DOC-034 | Spousal consent | Capacity | Attorney generated | Relevant spouse | Relevant matrimonial regime and act require spouse consent. | Before binding act requiring consent | Candidate | Capacity; legal review needed • P01 • See Rule guidance / Sources |
| DOC-035 | Deed of transfer | Lodgement | Attorney generated | Matter | Conventional transfer of land / unit. | Drafting / lodgement / registration | Candidate | Registration instrument • S04; S05 • See Rule guidance / Sources |
| DOC-036 | Transfer duty declaration (TDC01) | Tax | Attorney generated | Both | Acquisition requires duty/exemption process. | Tax processing; monitor six-month acquisition deadline | Candidate | SARS process • S01 • See Rule guidance / Sources |
| DOC-037 | Deed of donation | Transfer | Attorney generated | Both | Donation of property. | Before donation / tax processing | Candidate | SARS / transaction instrument • S02 • See Rule guidance / Sources |
| DOC-038 | Section 45 endorsement application | Lodgement | Attorney generated | Surviving spouse / executor | Survivor acquires deceased spouse’s joint-estate share under this route. | Before s45 lodgement | Candidate | Statutory endorsement • S04 • See Rule guidance / Sources |
| DOC-039 | Section 45bis endorsement application | Lodgement | Attorney generated | Relevant spouses | Eligible division of joint estate / divorce / regime-change court order. | Before s45bis lodgement | Candidate | Statutory endorsement • S04 • See Rule guidance / Sources |
| DOC-040 | Conveyancer’s sectional title certificate (s15B) | Sectional title | Attorney generated | Matter | Transfer of sectional unit under applicable s15B route. | Before sectional transfer lodgement | Candidate | Statutory certification • S05; S06 • See Rule guidance / Sources |
| DOC-041 | Transfer cost quotation / pro forma | Financial | Attorney generated | Transferee | Firm agrees or communicates fees and disbursements. | Before fee commitment / requesting costs | Candidate | Recommended firm control • P01 • See Rule guidance / Sources |
| DOC-042 | Final account / statement of distribution | Financial | Attorney generated | Both | Matter has financial entries requiring reconciliation. | Before final payout / matter closure | Candidate | Recommended firm control • P01 • See Rule guidance / Sources |
| DOC-043 | Registration notification | General | Attorney generated | Both | Matter registered successfully. | After registration verified | Candidate | Recommended service workflow • P01 • See Rule guidance / Sources |
| DOC-044 | Rates clearance figures | Municipal | Third-party issued | Transferor | Municipal clearance must be obtained. | Clearance preparation | No | Operational prerequisite • S08; P01 • See Rule guidance / Sources |
| DOC-045 | Rates clearance certificate | Municipal | Third-party issued | Matter | Ordinary transfer of rateable property; exceptions require legal confirmation. | Before lodgement; valid at registration | No | Statutory clearance • S08 • See Rule guidance / Sources |
| DOC-046 | Body corporate levy clearance confirmation | Sectional title | Third-party issued | Transferor | Body corporate exists and levy clearance applies. | Before DOC-040 certification | No | Statutory supporting evidence • S05 • See Rule guidance / Sources |
| DOC-047 | HOA consent / clearance | Compliance | Third-party issued | Transferor | Title condition or binding HOA provision requires consent / clearance. | Before signing/lodgement as condition requires | No | Title / contractual condition • P01 • See Rule guidance / Sources |
| DOC-048 | SARS transfer duty receipt / exemption receipt | Tax | Third-party issued | Matter | Applicable transfer duty / exemption process. | Before lodgement approval | No | SARS / registration evidence • S01 • See Rule guidance / Sources |
| DOC-049 | Bond approval letter | Bond | Third-party issued | Transferee | Buyer relies on bond finance. | By finance-condition deadline | No | Contract / lender requirement • P01 • See Rule guidance / Sources |
| DOC-050 | Bank / financial guarantee | Financial | Third-party issued | Transferee | Contract requires guarantee or lender-funded price security. | By guarantee deadline / before lodgement | No | Contract / lender requirement • P01 • See Rule guidance / Sources |
| DOC-051 | Bond cancellation figures | Bond | Third-party issued | Transferor | Registered bond must be cancelled. | Before arranging bond cancellation | No | Lender process • S04; P01 • See Rule guidance / Sources |
| DOC-052 | Consent to cancellation of bond | Bond | Third-party issued | Transferor | Bond is being cancelled. | Before linked cancellation lodgement | No | Registration / lender • S04 • See Rule guidance / Sources |
| DOC-053 | Existing title deed / registered copy | Property | Third-party issued | Matter | Every registrable-property workflow. | Early title review; original before lodgement if needed | No | Registration + recommended title control • S04; S05 • See Rule guidance / Sources |
| DOC-054 | Deeds search report | Property | Third-party issued | Matter | Verify ownership, bonds, restrictions and linked transactions. | Before title approval; refresh before lodgement | No | Recommended firm control • P01 • See Rule guidance / Sources |
| DOC-055 | Electrical certificate of compliance | Compliance | Third-party issued | Transferor | Electrical installation and applicable change-of-ownership rule. | Before ownership change / contractual deadline | No | Regulatory; professional guidance • S10 • See Rule guidance / Sources |
| DOC-056 | Gas certificate of conformity | Compliance | Third-party issued | Transferor | Gas installation exists and relevant trigger applies. | Before owner/user change or installation handover | No | Regulation 17(3) • S11 • See Rule guidance / Sources |
| DOC-057 | Electric fence compliance certificate | Compliance | Third-party issued | Transferor | Electric fence exists and applicable rule is triggered. | Before ownership change / contractual deadline | No | Regulatory; provisional source • S12 • See Rule guidance / Sources |
| DOC-058 | Beetle / wood-destroying organism certificate | Compliance | Third-party issued | Transferor | Sale agreement or lender condition requires specified WDO certificate. | Contractual certificate deadline | No | Contractual; proposed default • P01 • See Rule guidance / Sources |
| DOC-059 | Water / plumbing compliance certificate | Compliance | Third-party issued | Transferor | Property falls within applicable municipal water-certificate rule. | Before transfer where local by-law applies | No | Local by-law • S13 • See Rule guidance / Sources |
| DOC-060 | Property valuation report(s) | Tax | Third-party issued | Matter | Donation; connected-party / partial-share sale; other SARS request. | Before relevant tax submission | No | SARS relevant material • S02 • See Rule guidance / Sources |
| DOC-061 | Master’s section 42(2) certificate | Estate | Third-party issued | Estate representative | Transfer pursuant to sale through deceased estate route. | Before estate-sale lodgement | No | Statutory estate sale • S03 • See Rule guidance / Sources |
| DOC-062 | Estate sale authority evidence | Estate | Client supplied | Estate representative | Executor sells after death. | Before post-death executor sale is approved | No | Statutory estate authority • S03 • See Rule guidance / Sources |
| DOC-063 | Mortgagee consent / release | Development | Third-party issued | Owner / developer | Affected bonded land/right needs mortgagee consent or release. | Before endorsement/development/release lodgement | No | Registration / lender • S04; S05 • See Rule guidance / Sources |
| DOC-064 | Approved sectional plan | Development | Third-party issued | Developer | Sectional development or linked first transfer needs approved plan. | Before opening / extending sectional register | No | Statutory development • S05; S06 • See Rule guidance / Sources |
| DOC-065 | Approved general plan / subdivision diagram | Development | Third-party issued | Owner / developer | Township or land subdivision. | Before township/subdivision registration | No | Statutory development • S04; S07 • See Rule guidance / Sources |
| DOC-066 | Planning approval and conditions | Development | Third-party issued | Owner / developer | Development / subdivision requires land-use approval. | Planning approval before registration preparation | No | Planning law • S07 • See Rule guidance / Sources |
| DOC-067 | Development register / subdivision application | Development | Attorney generated | Owner / developer | Development-only register / subdivision route. | Before development lodgement | Candidate | Registration instrument • S04; S05 • See Rule guidance / Sources |
| DOC-068 | Certificates of registered title / sectional title | Development | Attorney generated | Owner / developer | Development route requires new titles / certificates. | Prepared before lodgement; issued after registration | Candidate | Registration instrument • S04; S05 • See Rule guidance / Sources |
| DOC-069 | Registered extension-right title / evidence | Development | Third-party issued | Extension right holder | Scheme extension uses an existing reserved or transferred right. | Before extension authority approval | No | Sectional development • S05; S06 • See Rule guidance / Sources |
| DOC-070 | Scheme rules / applicable body corporate resolution | Development | Client supplied | Developer / body corporate | Scheme rules or member / mortgagee approvals apply. | Before development authority / lodgement | No | Scheme / statutory conditional • S05; S06 • See Rule guidance / Sources |
| DOC-071 | Conveyancer’s section 42(1) certificate | Estate | Attorney generated | Estate representative | Distribution transfer or endorsement governed by s42(1). | Before inheritance / s45 lodgement | Candidate | Statutory estate distribution • S03 • See Rule guidance / Sources |
| DOC-072 | Donation tax declaration (IT144) | Tax | Attorney generated | Donor / tax adviser | Donation transaction requires SARS supporting material. | Before donation tax submission | Candidate | SARS relevant material • S02 • See Rule guidance / Sources |
| DOC-073 | Next-of-kin affidavit | Estate | Client supplied | Estate representative | Estate is intestate. | Before intestate entitlement / tax submission | No | SARS relevant material • S02 • See Rule guidance / Sources |
| DOC-074 | Death notice | Estate | Client supplied | Estate representative | No L&D account available in applicable intestate SARS branch. | Before estate tax submission where applicable | No | SARS conditional alternative • S02 • See Rule guidance / Sources |
| DOC-075 | Municipal development-condition compliance certificate (s53) | Development | Third-party issued | Owner / developer | Registration results from land development application within s53. | Before development-result registration | No | Statutory planning gate • S07 • See Rule guidance / Sources |
| DOC-076 | Conveyancer title-conditions schedule | Development | Attorney generated | Developer | Opening new sectional register requires title-condition treatment. | Before sectional register opening | Candidate | Statutory development • S05 • See Rule guidance / Sources |
| DOC-077 | Conveyancer scheme-rules certificate | Development | Attorney generated | Developer | Opening sectional register requires applicable rules certification. | Before sectional register opening | Candidate | Statutory development • S05 • See Rule guidance / Sources |
| DOC-078 | Revised participation-quota schedule | Development | Third-party issued | Extension right holder | Scheme extension changes participation quota schedule. | Before extension registration | No | Statutory development • S05; S06 • See Rule guidance / Sources |
| DOC-079 | Bond debtor-substitution agreement / consent | Bond | Third-party issued | Spouse(s) / mortgagee | Existing bond retained under permitted s45 / s45bis debtor-substitution route. | Before endorsement lodgement | No | Statutory endorsement conditional • S04 • See Rule guidance / Sources |
| DOC-080 | Sectional title extension / developer-change disclosure | Sectional title | Attorney generated | Developer / purchaser | Reserved extension rights or relevant developer plan changes affect purchaser. | Before sale signing / before sectional transfer certification | Candidate | Sectional statutory / contractual • S05; S06 • See Rule guidance / Sources |
| DOC-081 | Suspensive-condition fulfilment / waiver evidence | General | Client supplied | Both | Sale has suspensive or other unfulfilled conditions. | By each condition deadline; before lodgement | No | Contract + recommended workflow • P01 • See Rule guidance / Sources |
| DOC-082 | Confirmed registration record | General | Third-party issued | Matter | Registry event is claimed complete. | After registration; before payout / closure | No | Recommended firm control • P01 • See Rule guidance / Sources |
| DOC-083 | VAT / tax-treatment supporting evidence | Tax | Client supplied | Transferor / tax adviser | VAT treatment/exemption or going-concern route is claimed. | Before final tax determination | No | Tax + recommended evidence bundle • S01 • See Rule guidance / Sources |
| DOC-084 | Sheriff’s execution-transfer supporting pack | Authority | Third-party issued | Sheriff | Sheriff sale is the operative acquisition. | Before execution-transfer lodgement | No | Court process; proposed bundle • S14; P01 • See Rule guidance / Sources |
| DOC-085 | Bulk property / allocation / linked-matter schedule | General | Attorney generated | Matter | Multiple properties / shares transfer in one coordinated transaction. | Before bulk drafting / tax / lodgement | Candidate | Recommended firm control • P01 • See Rule guidance / Sources |
| DOC-086 | Court order for joint-estate division / regime change | Capacity | Third-party issued | Relevant spouses | Division of joint estate or change of regime relies on court order rather than divorce. | Before s45bis eligibility / signing | No | Statutory endorsement conditional • S04 • See Rule guidance / Sources |

*Sources S01–S16 and P01 are listed verbatim in the register's Sources sheet;
statutory copies are acknowledged as older consolidations — see the register
for verification limitations.*
