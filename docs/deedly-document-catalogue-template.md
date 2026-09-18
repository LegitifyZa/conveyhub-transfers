# DEEDLY document catalogue — fill-in template and import contract

Status: **template only — awaiting Dean/Louis catalogue content.** The
requirements mechanism shipped on
`deedly/mvp0/documents/upload-and-readback` with an **empty**
`document_requirement_rules` table; nothing here seeds production rules.
Schema target: `transfers.document_requirement_rules` (migration 025,
proposed, not executed). Import coordination: Dean → Jordan.

## 1. The fill-in table

One row per requirement. Copy this table and fill it in. Cells Dean cannot
decide yet should read `PENDING` — unresolved entries stay explicitly
pending rather than being guessed.

| doc_code | display_name | classification | required_when | condition | condition_source | scope | required_by_stage | satisfied_by | approval_status | rule_version |
|---|---|---|---|---|---|---|---|---|---|---|
| (stable code) | (UI name) | (code or `*`) | always / conditional | (engine key) | (authoritative data source) | per_matter / per_party / per_property | (stage) | (what satisfies it) | draft / approved | (e.g. 1) |

### Column → engine mapping

| Catalogue column | Engine field | Supported? |
|---|---|---|
| `doc_code` | `rule_key` VARCHAR(150) UNIQUE | Yes — stable snake_case code; never reused for a different requirement |
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

Proposed behavior for the eventual catalogue seed (expected to be a
reviewed migration through Dean → Jordan, not a runtime import):

- **Duplicate `doc_code`:** `UNIQUE(rule_key)` enforces one row per code.
  Import is an upsert: `ON CONFLICT (rule_key) DO UPDATE` of
  `display_name`, `classification_code`, `condition_key`,
  `sequence_number`. Re-importing identical rows is a no-op. A code
  reused for a *different* requirement is a conflict for human review —
  never a silent rename.
- **Unsupported `condition`:** import **rejects** the row — the engine
  cannot evaluate it, so seeding it would manufacture a permanently
  unevaluated rule on every matter. Supported keys today: `has_bond`,
  `cash_purchase`. New conditions require an engine extension
  (`_SUPPORTED_CONDITIONS` + fact source) before the catalogue may use
  them.
- **Missing facts:** not an import concern — runtime evaluation
  surfaces `unevaluatedFacts`; rules are never silently applied or
  withdrawn on missing data.
- **Repeat imports:** idempotent via the `rule_key` upsert — safe to
  re-run the same seed.
- **Rule updates:** edit in place. The next recalculation refreshes
  `display_name` on existing requirement instances; requirement history
  (`applied_at`/`withdrawn_at`) is preserved.
- **Retiring a rule:** set `status='retired'` — it drops out of the
  active set entirely. Its existing requirement instances are **left
  untouched** (a retired rule is outside both the applicable and
  withdrawal sets). Whether retired-rule instances should be swept is an
  open decision — today they remain visible with their history.
- **Evidence preservation:** requirement withdrawal, retirement and
  updates never touch `transfer_documents`. An uploaded document linked
  via `requirement_key` keeps its row and storage object regardless of
  catalogue changes.

## 4. Synthetic example — TEST ONLY

Illustrative rows for development/test fixtures. **Not approved
production rules; do not seed into any production catalogue.** The
`has_bond` heuristic is an implementation placeholder pending Dean's
approved mapping — see decisions doc §8.

```sql
-- TEST FIXTURE ONLY — illustrative, not approved production content.
INSERT INTO transfers.document_requirement_rules
    (rule_key, display_name, classification_code, condition_key, sequence_number)
VALUES
    -- Baseline: required on every matter regardless of classification.
    ('test_fica_documents', 'FICA documents (TEST ONLY)', '*', NULL, 10),
    -- Conditional: only when the matter has a bond (heuristic, unapproved).
    ('test_bond_approval_letter', 'Bond approval letter (TEST ONLY)', NULL, 'has_bond', 20)
ON CONFLICT (rule_key) DO NOTHING;
```

Filled template row equivalents:

| doc_code | display_name | classification | required_when | condition | condition_source | scope | required_by_stage | satisfied_by | approval_status | rule_version |
|---|---|---|---|---|---|---|---|---|---|---|
| `test_fica_documents` | FICA documents (TEST ONLY) | `*` | always | — | — | per_matter | PENDING | uploaded clean file linked to `test_fica_documents` | test-fixture | n/a |
| `test_bond_approval_letter` | Bond approval letter (TEST ONLY) | `*` | conditional | `has_bond` | `bonds` row / `loan_amount` (heuristic, unapproved) | per_matter | PENDING | uploaded clean file linked to `test_bond_approval_letter` | test-fixture | n/a |

## 5. Open items for Dean/Louis

1. The catalogue rows themselves (this template, filled in).
2. Whether `has_bond`/`cash_purchase` heuristics match the approved
   business definitions — new conditions need engine work first.
3. Per-party/per-property requirement scope — engine extension decision.
4. Stage/due-state semantics — product decision on gating.
5. Approval-workflow states and rule versioning — schema decisions for
   Jordan.
6. Signature-date formatting (full month words) — recorded in scope doc
   §10.1; implemented with the generated-document/template slice, not
   this catalogue.
