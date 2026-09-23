# DEEDLY document catalogue — fill-in template and import contract

Status: **template only — awaiting Dean/Louis catalogue content.** The
requirements mechanism shipped on
`deedly/mvp0/documents/upload-and-readback` with an **empty**
`document_requirement_rules` table; nothing here seeds production rules.
Schema target: `transfers.document_requirement_rules` (migration 025,
proposed, not executed). Import coordination: Dean → Jordan.

## 1. The fill-in table

One row per **requirement rule** — not one row per document. The same
document can need several rules (different classifications or conditions);
each rule gets its own stable `rule_key`, while `doc_code` identifies the
document itself. See §1.1 for the distinction and the gap it exposes.

Copy this table and fill it in. Cells Dean cannot decide yet should read
`PENDING` — unresolved entries stay explicitly pending rather than being
guessed.

| rule_key | doc_code | display_name | classification | required_when | condition | condition_source | scope | required_by_stage | satisfied_by | approval_status | rule_version |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (stable rule key) | (stable document code) | (UI name) | (code or `*`) | always / conditional | (engine key) | (authoritative data source) | per_matter / per_party / per_property | (stage) | (what satisfies it) | draft / approved | (e.g. 1) |

### 1.1 Document code vs requirement-rule key

Two distinct stable identities — do not conflate them:

- **`doc_code`** — catalogue-level identity of the *document* itself
  (e.g. `fica` for "FICA documents"). Human/business vocabulary; Dean
  assigns it.
- **`rule_key`** — the *requirement rule's* stable key, and the only one
  the schema actually persists: `UNIQUE` on
  `document_requirement_rules`, copied onto each
  `transfer_document_requirements` row as `requirement_key`, and the
  value `transfer_documents.requirement_key` links an uploaded file to.

**What the existing schema supports:** many rules, any
classification/condition combination, and `rule_key` uniqueness. It does
**not** support a shared `doc_code` — there is no such column anywhere.
Two rules that name the same `doc_code` are, to the engine, two unrelated
requirements with two requirement instances per matter.

**Gap — flagged, not expanded:** satisfaction linkage is per `rule_key`.
An uploaded file linked to rule A does **not** satisfy rule B even when
both rules share a `doc_code` — the reviewer would see the second
requirement as unsatisfied until a file is linked to it too. If the
catalogue needs "one upload satisfies the document wherever it is
required," that is a schema/engine decision for Jordan (a real
`doc_code` column or a satisfaction mapping) — recorded as an open item
in §5, not implemented here.

**Naming convention for filling the table:** give each rule an explicit
`rule_key` that encodes its scope (e.g. `fica_sale`,
`fica_donation_cash`), so two rules for one document can never collide.

### Column → engine mapping

| Catalogue column | Engine field | Supported? |
|---|---|---|
| `rule_key` | `rule_key` VARCHAR(150) UNIQUE | Yes — one row per rule; never reused for a different rule |
| `doc_code` | — | **Not persisted** — catalogue-level grouping only (see §1.1). If Dean needs it queryable or linked for satisfaction, that is a schema gap for Jordan |
| `display_name` | `display_name` VARCHAR(255) | Yes |
| `classification` | `classification_code` VARCHAR(100) | Yes — a matter classification code, or `*`/blank for all classifications. A classification-scoped rule on a matter with no recorded classification is **unevaluated**, never silently skipped |
| `required_when` | `condition_key` NULL vs set | Yes — `always` → NULL (baseline rule); `conditional` → the `condition` column's engine key |
| `condition` | `condition_key` VARCHAR(100) | **Limited vocabulary** — the engine supports exactly `has_bond` and `cash_purchase` (`_SUPPORTED_CONDITIONS`). Any other key is inert at runtime and surfaces as `unevaluatedRules` on every matter forever. **Import must reject unknown keys** — see §3 |
| `condition_source` | — | **Not a schema field.** `has_bond`/`cash_purchase` are implementation heuristics (a `bonds` row, or `transfer_financials.loan_amount > 0`) pending Dean's approved mappings. Record the intended authoritative source here; mapping it into the engine is a code decision, not a catalogue entry |
| `scope` (per_matter / per_party / per_property) | — | **Not supported.** The engine creates exactly one `transfer_document_requirements` row per `(transfer_id, requirement_key)` — per-party and per-property requirements are not expressible in this schema. Entries needing party/property scope stay `PENDING` and flag an engine extension, they are not silently coerced to per-matter |
| `required_by_stage` | — | **Not supported.** `sequence_number` orders display only; there is no stage/due-state concept. Stages stay `PENDING` — submission/milestone gating is an undecided product question (decisions doc §4) |
| `satisfied_by` | implicit | **Partially.** Satisfaction is fixed engine behavior: an `uploaded` document row with `scan_status='clean'` whose `requirement_key` matches. There is no dedicated description column — free-text guidance (e.g. "certified copy, dated within 3 months") has nowhere to live yet; flag if needed |
| `approval_status` | `status` CHECK('active','retired') | **Partially.** Only `active`/`retired` exist — there is no `draft`/`pending_approval` state. Until catalogue rows carry an approval gate, import only inserts rows Dean has signed off |
| `rule_version` | — | **Not supported.** No version column exists; rule edits update the row in place (`updated_at` only). Versioning is a schema change — record the intended version in the template; it does not persist yet |

Fields the engine cannot support are **flagged, not dropped** — the column
stays in the template so the catalogue records the real requirement even
where persistence awaits an engine extension.

## 2. What the engine does with a row

- Baseline rule (`condition_key` NULL): applies whenever the
  classification matches (`*`/NULL = every classification).
- Conditional rule: evaluated against `_load_matter_context`
  (`classification_code`, `has_bond` — tri-state; missing facts are
  `None`, never a negative answer).
- `POST …/requirements/recalculate` upserts one
  `transfer_document_requirements` row per applicable rule
  (`source='baseline'|'conditional'`), ordered by `sequence_number`.
- A rule that stops applying is **withdrawn in place** — never deleted.
- A rule that cannot be decided (unsupported condition, missing fact) is
  reported via `unevaluatedRules`/`unevaluatedFacts` and is **excluded
  from the withdrawal set** — it is never silently treated as
  "not required".

## 3. Import / validation contract

Two layers must not be conflated: what the engine **already does and is
tested for**, versus the **proposed** behaviour of a future catalogue
import that does not exist yet.

### 3.1 Implemented and tested today (no importer involved)

These are live engine semantics, covered by the service/route test
suites on `deedly/mvp0/documents/upload-and-readback`:

- Recalculation upserts `transfer_document_requirements` via
  `ON CONFLICT (transfer_id, requirement_key) DO UPDATE` — re-running
  recalculation is idempotent and refreshes `display_name` in place.
- A rule that stops applying marks its instance `withdrawn` in place —
  never deleted; `applied_at`/`withdrawn_at` history is preserved.
- Unevaluated rules (unsupported `condition_key`, missing facts) are
  surfaced via `unevaluatedRules`/`unevaluatedFacts` and excluded from
  the withdrawal set — never silently "not required".
- `rule_key` uniqueness on `document_requirement_rules` is enforced by
  the `UNIQUE` constraint itself.
- Evidence preservation: nothing in the requirement lane ever touches
  `transfer_documents`. An uploaded document linked via
  `requirement_key` keeps its row and storage object regardless of
  requirement changes.

### 3.2 Proposed import behaviour — not implemented, not tested

The catalogue is expected to arrive as a **reviewed migration through
Dean → Jordan**, not a runtime importer. The following is the proposed
contract for that seed — none of it exists yet:

- **Duplicate `rule_key`:** the proposed upsert is
  `ON CONFLICT (rule_key) DO UPDATE` of `display_name`,
  `classification_code`, `condition_key`, `sequence_number` —
  re-importing identical rows is a no-op and repeat imports are
  idempotent. A `rule_key` reused for a *different* requirement is a
  conflict for human review — never a silent rename. Because upsert keys
  on `rule_key` (not `doc_code`), two rules sharing one `doc_code` never
  collide with each other — see the §4 example.
- **Unsupported `condition`:** the proposal is that import **rejects**
  the row — seeding it would manufacture a permanently unevaluated rule
  on every matter. Supported keys today: `has_bond`, `cash_purchase`.
  New conditions require an engine extension
  (`_SUPPORTED_CONDITIONS` + fact source) before the catalogue may use
  them.
- **Missing facts:** not an import concern — runtime evaluation
  surfaces `unevaluatedFacts`; rules are never silently applied or
  withdrawn on missing data.
- **Rule updates:** proposed in-place edits; existing instances pick up
  the change on the next recalculation (implemented, §3.1) — the
  import-side mechanics are not built.
- **Retiring a rule — explicitly UNRESOLVED.** `status='retired'` drops
  a rule out of the active set: it stops being evaluated *and* falls
  outside the withdrawal set, so its existing requirement instances are
  left untouched. Whether that is the desired end-state is undecided —
  outstanding instances may need to be withdrawn, swept, or preserved
  for history, and that decision belongs to Dean/Louis before any
  retirement is exercised. Do not treat "retired leaves instances
  untouched" as approved behaviour.

## 4. Synthetic example — TEST ONLY

Illustrative rows for development/test fixtures. **Not approved
production rules; do not seed into any production catalogue.** The
`has_bond`/`cash_purchase` heuristics are implementation placeholders
pending Dean's approved mappings — see decisions doc §8.

The example deliberately puts **one document (`doc_code` = `fica`) under
two rules** with different classifications and different requirement
logic: `fica_sale` is baseline on `sale` matters, while
`fica_donation_cash` applies only on `donation` matters purchased for
cash. Each rule has its own `rule_key`, so the proposed
`ON CONFLICT (rule_key)` import upsert touches neither rule when the
other is (re-)imported — the shared `doc_code` causes no collision and
no overwrite.

```sql
-- TEST FIXTURE ONLY — illustrative, not approved production content.
INSERT INTO transfers.document_requirement_rules
    (rule_key, display_name, classification_code, condition_key, sequence_number)
VALUES
    -- Same document, sale matters: always required (baseline).
    ('fica_sale', 'FICA documents (TEST ONLY)', 'sale', NULL, 10),
    -- Same document, donation matters: only when a cash purchase
    -- (heuristic, unapproved).
    ('fica_donation_cash', 'FICA documents (TEST ONLY)', 'donation', 'cash_purchase', 20)
ON CONFLICT (rule_key) DO NOTHING;
```

Filled template row equivalents:

| rule_key | doc_code | display_name | classification | required_when | condition | condition_source | scope | required_by_stage | satisfied_by | approval_status | rule_version |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `fica_sale` | `fica` | FICA documents (TEST ONLY) | `sale` | always | — | — | per_matter | PENDING | uploaded clean file linked to `fica_sale` | test-fixture | n/a |
| `fica_donation_cash` | `fica` | FICA documents (TEST ONLY) | `donation` | conditional | `cash_purchase` | `bonds`/`loan_amount` (heuristic, unapproved) | per_matter | PENDING | uploaded clean file linked to `fica_donation_cash` | test-fixture | n/a |

Note the §1.1 gap applies here: the engine treats these as two unrelated
requirements — a file linked to `fica_sale` does not satisfy
`fica_donation_cash`.

## 5. Open items for Dean/Louis

1. The catalogue rows themselves (this template, filled in). Production
   `document_requirement_rules` stays **empty** until the approved
   catalogue is supplied.
2. Whether `has_bond`/`cash_purchase` heuristics match the approved
   business definitions — new conditions need engine work first.
3. **`doc_code` persistence/satisfaction gap (§1.1):** whether one
   upload may satisfy multiple rules sharing a document — schema/engine
   decision for Jordan; not implemented.
4. Per-party/per-property requirement scope — engine extension decision.
5. Stage/due-state semantics — product decision on gating.
6. **Rule-retirement semantics (§3.2):** unresolved — decide the effect
   on outstanding requirement instances before any retirement is
   exercised.
7. Approval-workflow states and rule versioning — schema decisions for
   Jordan.
8. Signature-date formatting (full month words) — recorded in scope doc
   §10.1; implemented with the generated-document/template slice, not
   this catalogue.
