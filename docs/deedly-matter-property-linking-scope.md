# Authenticated Matter–Property Linking and Readback — Scope Proposal

**Status:** proposal for review, not implemented. P0 – Property Integration.
**Source commit:** `f016f3e73dbf698e2a668c13a47110c33668bccb` (`origin/main`).
**Model reference:** `docs/deedly-core-transfer-matter-data-model.md` (this
branch) — schema checkpoint `f5c6a33`, runtime checkpoint `f016f3e`.
**Auth note:** Production Authentication remains **Blocked**; the browser JWT
wiring this slice would sit behind is mock-tested only, pending the deployed
upstream contract and the external-ingress/key-rotation HOLD (`AGENTS.md`).
Nothing here changes that status.
**Boundary:** Jordan owns the Certified Core Transfer / Matter Model review.
This document proposes a *route/UI slice on the existing schema only* — it does
not redesign tables, and every schema-level or vocabulary question is flagged
for Jordan (§9–§10), not decided here.
**Out of scope (this slice):** `purchase_price`/`transfer_financials`,
milestones, documents, classification changes, external provider integration
(Loqate `/api/address/*` stays quarantined), property detachment/deletion,
`property_kind='output'`/development-matter semantics, and any restoration of
quarantined legacy routes. All existing role and institution restrictions
remain unchanged.

## 1. Terminology — four distinct things (do not conflate)

| Concept | Storage | Evidence |
|---|---|---|
| Matter-level address text | `transfers.property_address TEXT NOT NULL` | Free-text display field; required at v1 create, editable via the `f016f3e` PATCH. **Not** a property record and carries no link semantics. |
| Property record | `transfers.properties` (002, extended 003/006/011/019) | Tenant-owned working row (`PROP-YYYY-XXXX` business key). Its own lifecycle/status; shared across matters in principle. |
| Matter–property relationship | `transfers.matter_properties` (018/019) | Canonical v1 link: `matter_id` + `property_id` + `property_kind`. |
| External/canonical property reference | `matter_properties.external_property_id TEXT` | Neutral placeholder for the unresolved property-registry/Entities contract — see the boundary audit: "all person/company/property canonical data is reached over HTTP through the entities service" (`docs/deedly-data-boundary-audit.md`). No vocabulary exists yet. |
| Legacy pointers | `transfers.property_id` (002), `matters.property_id` (003) | Single-property columns superseded by `matter_properties`; both now carry composite tenant FKs (019). `matters.property_id` is **never written by any code path** (only read by the quarantined delete cleanup count, `server/routes/transfers.ts:1178`). |

## 2. Current state (inspected)

### 2.1 Constraints that govern any write

- `properties` required columns (002 + 019): `property_id` (system via
  `generate_property_id()`), `street_address` NOT NULL, `city` NOT NULL,
  `province` NOT NULL, `property_type` NOT NULL with the 9-value conveyancing
  CHECK (006), `accountable_institution_id` NOT NULL (019), `status` default
  `'active'`; `postal_code` has a 4-digit CHECK when present. **No dedup or
  uniqueness on address/erf/title-deed** — `property_id` is the only UNIQUE
  business key.
- `properties` fires `audit_properties_trigger` (002) → writes
  `public.audit_log` on every INSERT/UPDATE/DELETE. Any v1 property write
  produces legacy audit rows — a side effect to acknowledge (the boundary
  audit assigns audit writing to `legitify_auditor`, unlanded).
- `matter_properties` (018): `UNIQUE (matter_id, property_id, property_kind)`;
  CHECK `property_kind='output' OR property_id IS NOT NULL`;
  `accountable_institution_id` is **overwritten** by
  `trg_matter_properties_set_tenant` from the parent matter; composite FK
  `fk_matter_properties_property_tenant (property_id, ai) → properties(id, ai)`
  CASCADE (019) makes cross-tenant links unwritable.
- Sync trigger `trg_sync_matter_properties_from_transfer` (019 §7): one-way
  `transfers.property_id`/`matter_id` → `matter_properties`; inserts only
  `property_kind='input'` rows tagged `property_source='legacy_transfer_<uuid>'`
  with `ON CONFLICT DO NOTHING`, and deletes only rows bearing its own
  per-transfer source tag. Rows with any other `property_source` (including
  NULL) are invisible to its DELETE — v1-linked rows cannot be clobbered by it.

### 2.2 Writers and readers today

- **Only writers of `properties`/`matter_properties`/`transfers.property_id`
  are quarantined legacy handlers**: `server/routes/transfers.ts` POST create
  (~line 561: scaffold `properties` row with `created_for_transfer_id =
  <TRF-…>` + set `transfers.property_id`), PUT update (~lines 784–852: upsert
  property, create-on-missing then set `transfers.property_id`), DELETE
  (~lines 1169–1196: drop scaffolded property only when
  `created_for_transfer_id` matches and no other table references it);
  `python_server/routers/transfers.py` mirrors these. Both routers are
  hard-quarantined (503) on both servers.
- **No v1 code touches the property tables.** A grep of `python_server`
  (services/repositories/routers, excluding the quarantined legacy router and
  tests) finds no reference to `properties`, `matter_properties` or
  `property_id`; `server/routes/v1/` likewise. `matter_properties` is populated
  only by the 019 backfill and the sync trigger.
- **Reads:** v1 `GET /api/v1/transfers/{id}` returns `transfers.property_address`
  text plus (since `f016f3e`) the staff-only `matter` projection — no
  `matter_properties`/`properties` join anywhere in v1. BFF v1 GETs are served
  locally off the shared DB; writes are auth-proxied to FastAPI.
- **UI:** `StepProperty` captures address (Loqate-assisted — quarantined, so
  manual entry), city, province, postal code, property type, erf/lot number,
  year built, square footage, legal description — but `persistAggregate` in
  `src/pages/Transfers.tsx:129` sends only `property_address` +
  `purchase_price` to `createMatter`. **Every other captured property field is
  silently dropped**; no `properties`/`matter_properties` row is created. The
  `f016f3e` details panel states "property-record … details are managed in
  separate workflows" (`TransferMilestones.tsx:520`).
- Dead code worth noting: quarantined `server/routes/accounts.ts:405` selects
  `properties WHERE transfer_id = $1` — `properties` has no `transfer_id`
  column; the query can only ever fail inside its catch.

### 2.3 What this means for the slice

A link-only slice can serve only matters whose property rows already exist —
today that means legacy-era rows (the 019 backfill mapped them into
`matter_properties` with kind `input`). **Every v1-created matter has no
property to link** unless property creation is also permitted. Whether the
slice must include creation is therefore the blocking policy decision (D1):
the manual-party precedent (migration 023, firm-private unverified capture)
was approved for *persons* only — it does not by itself authorize manual
property records.

## 3. Proposed smallest slice

**Attach one existing, same-institution `properties` row to a transfer matter
as `property_kind='input'`, and read the link back.** Creation is proposed as
a gated follow-on pending D1.

### `POST /api/v1/transfers/{id}/properties` — FastAPI, BFF auth-proxy

Mirrors `POST …/parties`: BFF validates and forwards the verified JWT;
FastAPI owns the write. Proposed body (strict allow-list, `_require_body_keys`):

```json
{ "property_id": "<uuid of properties.id>" }
```

- `property_kind` is **not** caller-supplied in the slice: the only evidenced
  vocabulary for transfer matters is `'input'` (019 backfill/trigger). Writing
  `'output'`, `role_in_matter`, `registration_status`, `external_property_id`
  or `property_source` is deferred — the columns stay NULL rather than
  inventing semantics Jordan has not ratified.
- Response: the created link plus a minimal property projection
  (`{id, propertyId, streetAddress, city, province, propertyType, erfNumber,
  propertyKind, propertySource, createdAt}`), 201; replay of an identical
  existing link → 200 `created:false` (party-attach precedent).

Transaction (one `with_transaction`, mirroring `update_core_matter_fields` /
party attach):

1. `SELECT … FROM transfers WHERE id=$1 AND accountable_institution_id=$2 FOR
   UPDATE`; missing → 404.
2. Resolve the matter via `transfers.matter_id` (deterministic, consistent
   with the `f016f3e` PATCH — *not* `source_record_id` guessing); NULL or
   non-`transfer` matter → fail closed (see D7 for prototype-era rows).
3. `SELECT id FROM properties WHERE id=$3 AND accountable_institution_id=$4`
   — absence → 404 (no existence leak across tenants); the composite FK
   re-enforces this at insert.
4. `INSERT INTO matter_properties (matter_id, property_id, property_kind)
   VALUES (…, 'input') ON CONFLICT (matter_id, property_id, property_kind)
   DO NOTHING` then re-select → 201 or 200-replay.

### `GET /api/v1/transfers/{id}/properties` — BFF-local (GET precedent)

Joins `matter_properties → properties` scoped by the caller's
`accountable_institution_id` on both the transfer and the property.
**Staff-only**, matching the `f016f3e` matter-projection precedent: the
upstream client-read contract does not document property visibility, so
role-4 callers keep the existing restricted view (fail closed — §11 item 16
of the model guide).

### UI changes (minimal)

- `TransferMilestones` details panel: render linked properties under the
  existing "managed in separate workflows" note; add an attach control that
  accepts a `properties.id`/`PROP-…` reference for staff (search/browse of the
  firm's property register is **not** in this slice — no property list/search
  route exists).
- `Transfers` wizard: no change in the slice — StepProperty keeps capturing
  display fields; only `property_address` is persisted as today. Wiring the
  captured property-record fields depends on D1.

## 4. Authorization

- POST: `require_jwt` + `transfers:write`; role-4 denied (same gate as
  parties/PATCH); tenant from the verified claim only — a body
  `accountable_institution_id` is a 422 allow-list rejection.
- GET: `require_jwt` + tenant predicate; staff-only projection until the
  client contract is documented.
- Institution check applies to **both** sides: the matter (via the transfer's
  verified tenant + deterministic link) and the property (same-AI lookup +
  composite FK). No privileged-role exception — approved policy removed them
  everywhere.

## 5. Idempotency, concurrency, rollback

- **Duplicate-link replay:** `UNIQUE (matter_id, property_id, property_kind)`
  + `ON CONFLICT DO NOTHING` makes an identical retry a safe 200-replay —
  same pattern as party attach's lost-race handling. No
  `client_request_id`/`request_fingerprint` columns exist on
  `matter_properties`; adding them is a schema decision for Jordan (D6), and
  the natural key already covers retry-storm safety for identical requests.
- **Concurrency:** parent transfer is locked `FOR UPDATE` before insert;
  check-then-write is atomic under the lock. Two concurrent links of
  *different* properties both succeed (schema permits multiple `input` rows) —
  whether a transfer matter should cap `input` links is D4.
- **Rollback:** a single INSERT inside the transaction — failure leaves no
  partial state. The tenant trigger overwriting
  `accountable_institution_id` and the composite FK rejecting cross-tenant
  pairs can only be exercised on real PostgreSQL (§8).

## 6. `transfers.property_id` and the sync trigger

**Recommendation: the slice does not write `transfers.property_id` (or
`matters.property_id`).** Evidence:

- 018's transition contract: "`matter_properties` is authoritative; the legacy
  column must not be written independently for the same relationship." A v1
  canonical write with the legacy column left NULL is consistent; a future
  migration may remove the column (019 note).
- Writing `transfers.property_id` would fire
  `trg_sync_matter_properties_from_transfer`, which would attempt its own
  `input` insert tagged `legacy_transfer_<uuid>` — mislabeled provenance for a
  v1 link, and a second write path to keep consistent (ON CONFLICT would mask
  the duplicate but the source tag is already wrong).
- No live reader uses `transfers.property_id`: every consumer route is
  quarantined; v1 reads don't join it. Keeping the legacy pointer NULL is
  therefore honest — the column's retirement is Jordan's call (D3).
- Trigger safety in the other direction: the trigger's DELETE predicates on
  `property_source = 'legacy_transfer_' || <transfer uuid>` — v1-linked rows
  (NULL or a future v1 vocabulary) are never matched, so a later legacy-path
  change cannot strip a v1 link.

## 7. Existing matters and missing/inconsistent links

- **v1-created matters:** `transfers.matter_id` is populated at create —
  linkable immediately (given an eligible property row; D1).
- **Prototype-era transfers** (`matter_id` NULL, `source_record_id` set):
  fail closed under the deterministic rule — identical to the `f016f3e`
  PATCH behavior. A unique-`source_record_id` fallback is possible but is
  deferred (D7) — it touches the dual-link discrepancy (model guide §11.7)
  that Jordan owns.
- **Backfilled rows:** `matter_properties` rows written by 019/the trigger
  are returned by the GET as ordinary links (their `property_source` tag is
  exposed verbatim for provenance).
- **`property_id`-NULL `output` rows:** a readback may encounter them; the
  projection should surface `property: null` rather than dropping the row, so
  the link's existence is never hidden. (Transfer matters should not gain such
  rows through this slice.)
- **Inconsistent state:** `matter_properties` rows whose matter or property
  disagrees on tenant are unwritable by construction (trigger + composite FK);
  a GET filters on both tenant columns, so a corrupt row simply never appears.

## 8. Acceptance tests and certification requirements

- **FastAPI unit tests (mocked pool):** allow-list 422s; missing transfer →
  404; cross-tenant property → 404; `matter_id` NULL → error without partial
  write; role/ability gates (403, role-4 denied); replay → 200 `created:false`.
- **BFF route tests** (`npx tsx --test`): proxy contract for POST; local GET
  tenant scoping; client-role projection unchanged.
- **Guarded DB suite** — follows the established pattern
  (`TEST_DATABASE_URL` + explicit opt-in flag, uniquely named scratch schema,
  no ambient-DSN fallback): composite-FK rejection of cross-tenant pairs;
  tenant trigger overwriting a forged `accountable_institution_id`; UNIQUE
  conflict → DO NOTHING → re-select; `FOR UPDATE` serialization of two
  concurrent links; and **trigger non-interference** — prove a v1-linked row
  survives a `transfers.property_id` UPDATE that fires the sync trigger.
  Without these, tenant isolation and trigger behavior are asserted from SQL
  text only — an explicit certification gap, same convention as the
  matter-editing DB suite.
- **UI honesty:** attach failure leaves the panel unchanged with an error
  notice; no "saved" claim before server confirmation; GET readback renders
  the server projection, not local state.

## 9. Decisions needed before implementation

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Property creation policy.** Link-only (requires pre-existing `properties` rows) vs minimal firm-private create+link (the 002 NOT NULLs define the floor: `street_address`, `city`, `province`, `property_type` — legacy used `'Unknown'` defaults and `generate_property_id()`). The manual-*person* approval does not cover properties. | Flag for PO/Jordan. Link-only is implementable today but inert for v1-created matters. |
| D2 | **`property_source` vocabulary for v1 links.** Column is nullable; only `legacy_transfer_<uuid>` exists. | Leave NULL (or a Jordan-ratified token); do not mint a value in route code. |
| D3 | **Legacy pointer maintenance.** Should v1 also set `transfers.property_id`/`matters.property_id`? | No (§6) — confirm with Jordan since column retirement is his. |
| D4 | **Multiplicity.** May a transfer matter hold several `input` links? | Default allow-many (schema permits); cap at one only if Jordan confirms transfer matters are single-property. |
| D5 | **Eligible property status.** Attachable regardless of `properties.status`, or restricted (e.g. exclude `sold`/`inactive`)? | Existence + same tenant only; status is advisory until policy lands. |
| D6 | **Idempotency columns on `matter_properties`** (`client_request_id`/`request_fingerprint`, institution-scoped partial unique — the party-attach shape). | Schema change → Jordan. Natural key suffices for identical replays. |
| D7 | **Prototype-era matters** (`transfers.matter_id` NULL): keep fail-closed, or add a unique-`source_record_id` fallback? | Keep fail-closed (consistent with `f016f3e`); fallback is bound to §11.7 dual-link cleanup Jordan owns. |
| — | **`external_property_id`, `role_in_matter`, `registration_status` semantics** — deliberately unresolved registry/lifecycle vocabularies. | Slice writes none of them; readback returns them verbatim. Ratification is upstream/model work, not this slice. |

## 10. Boundary list for Dean → Jordan

Tables/constraints/decisions this slice touches that overlap the certified
core-model review:

1. `transfers.matter_properties` — `UNIQUE(matter_id, property_id,
   property_kind)`; CHECK `kind='output' OR property_id NOT NULL`; composite
   tenant FK `fk_matter_properties_property_tenant`; triggers
   `trg_matter_properties_set_tenant`, `update_matter_properties_updated_at`;
   whether D6 idempotency columns should be added.
2. `transfers.properties` — ownership/write policy for v1 (D1); absence of any
   dedup constraint; `audit_properties_trigger` → `public.audit_log` side
   effect on every v1 write; `status` eligibility semantics (D5).
3. `transfers.property_id` + `trg_sync_matter_properties_from_transfer` and
   `matters.property_id` — confirm canonical-only writes (D3) and the column
   retirement path noted in 018/019.
4. Dual `transfers.matter_id`/`matters.source_record_id` link (§11.7) — the
   link-resolution rule for property attach follows the PATCH precedent;
   D7 is the same question Jordan already owns for edits.
5. `matter_properties` placeholder columns (`external_property_id`,
   `role_in_matter`, `registration_status`, `property_source`) — vocabulary
   ratification is model work; the slice writes none of them.
6. No reference-table seeding is required (unlike
   `party_relationship_definitions`) — confirmed: `property_kind`'s CHECK is
   self-contained and `entity_type_definitions`/role rules don't apply to
   properties.

## 11. Explicitly out of scope

Purchase-price/financial fields, milestone/document scaffolding,
classification changes, status transitions, property detachment or deletion,
`output`-kind/development properties, external provider/registry integration
(including Loqate address lookup and any Entities property endpoint),
client-role property visibility, and any change to quarantined legacy routes.
