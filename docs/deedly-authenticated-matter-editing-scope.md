# Authenticated Core Matter Editing and Readback — Scope Proposal

**Status:** **implemented** — merged on `main` at
`f016f3e73dbf698e2a668c13a47110c33668bccb` ("Merge authenticated core matter
editing and readback", reviewed at `249469f`). Deltas from this proposal:
`purchase_price` was dropped from the merged slice (dependency D2 below remains
unresolved, so `transfers.purchase_price` vs `transfer_financials` divergence is
still an open decision), and the concurrency contract uses **two** required
tokens — `expected_updated_at` + `expected_matter_updated_at`, both verified
under row locks — instead of the single token drafted in §3. The linked matter
is resolved deterministically via `transfers.matter_id`; a missing or
inconsistent link fails closed. Q1 resolved as proposed: no cross-institution
writes. P0 – Matter Creation & Party Management.
**Source commit:** `f5c6a338543ca43c5a7b227a82df30214d3e183e` (`origin/main`).
**Model reference:** `docs/deedly-core-transfer-matter-data-model.md` (this
branch, @ `60dc6e3`). Jordan owns the Certified Core Transfer / Matter Model —
this document proposes a *route/UI slice* on the existing schema only; it does
not redesign tables and does not duplicate certification work.
**Out of scope (first slice):** property links (`matter_properties`,
`transfers.property_id`), `transfer_financials`, document/milestone
scaffolding, and any party editing (`transfer_parties`).

## 1. Current state (inspected)

### UI edit surface

`src/pages/TransferMilestones.tsx` (`/transfers/:transferId/milestones`) has an
expandable "Transfer details" panel. The form edits:

- Property: `address`, `city`, `province`, `postalCode`, `propertyType`,
  `erfNumber`, `legalDescription`
- Buyer/seller parties: `fullName`, `idNumber`, `email`, `phone`, `address`
- `purchasePrice`

"Save Details" → `detailsToAggregate()` → `useTransfers.updateTransfer` →
`TransferApi.updateTransfer` → **`PUT /api/transfers/:id` (quarantined →
503)**. On failure the hook sets `error`, the page renders an
`UnavailableNotice` (line ~444), and the panel stays expanded — failed-save
honesty is already correct; no optimistic state is committed.

### v1 routes (FastAPI, `python_server/routers/v1/transfers.py`)

- `POST /` — create: allow-list `{property_address, purchase_price,
  firm_reference?, classification_code?, client_request_id?,
  accountable_institution_id?}`; creates `transfers` + `matters` in one
  transaction; idempotent replay via `client_request_id` + fingerprint.
- `GET /{id}` — readback: `_map_transfer` returns `transfers` columns only,
  plus a hardcoded empty `parties: []`. **Matter fields (`firm_reference`,
  `title`, `classification_code`, `reference_number`) are not currently read
  back.**
- `GET` subresources exist for parties, milestones, documents, financials,
  estate-contexts, representative-assignments, relationships.
- **No update route exists on v1** — no PUT/PATCH at all.
- Auth shape: `require_jwt` + `transfers:write` for writes (`_require_transfers_write`,
  clients denied explicitly); `_authorize_transfer` scopes reads to
  `accountable_institution_id` (clients additionally filtered by GR party
  membership).
- BFF (`server/routes/v1/transfers.ts`) auth-forwards `POST /` and
  `POST /{id}/parties` to FastAPI; GETs are served locally.

### Quarantined legacy update (`server/routes/transfers.ts:709`, `PUT /:id`)

`quarantineLegacyRoute` 503s the whole router; it must stay closed.
For the record, the handler it would run:

- Updates `transfers`: `property_address`, `purchase_price`, `status`,
  `current_step`, `total_steps`, `progress`.
- Upserts `properties` and `transfer_financials`.
- Replaces rows in the **deprecated legacy `parties` table** — not
  `transfer_parties`. Reopening or porting this behavior would bypass the
  party-source rules.
- **No tenant scoping**: the row is resolved by `transfer_id OR id` with no
  `accountable_institution_id` predicate (line 713) — a cross-tenant write
  hole, and a further reason not to resurrect the route.
- No optimistic concurrency: last writer wins silently.

## 2. Field-by-field proposal

### 2.1 Editable — proposed first slice

| Field | Table (col) | Validation | Related-record effects |
|---|---|---|---|
| Property address | `transfers.property_address` (`TEXT NOT NULL`) | non-empty trimmed string; reuse create validation | Denormalised display field only; canonical link is `matter_properties` (out of scope). No related writes. |
| Purchase price | `transfers.purchase_price` (`DECIMAL(12,2) NOT NULL`) | finite number ≥ 0; mirror `create_transfer_matter` validation | Does **not** update `transfer_financials.purchase_price` in this slice — see dependency D2. |
| Firm reference | `matters.firm_reference` (`VARCHAR(100)`) | optional string ≤ 100, trimmed; empty → `NULL` | None. |
| Matter title | `matters.title` (`VARCHAR(255)`) | optional non-empty string ≤ 255, trimmed | None; display label only. Default `Transfer {transfer_id}` retained when unset. |

### 2.2 Flagged separately — workflow implications, NOT in slice

| Field | Table | Why flagged |
|---|---|---|
| Status | `transfers.status` **and** `matters.status` (both `{in_progress, complete}` per migration 016) | Stored in two places — any edit must move both in one transaction. Transition rules (one-way `complete`? reopen?) and milestone interplay are undefined. Needs a PO/Jordan decision; recommend a dedicated transition endpoint later, not a field in this PATCH. |
| Classification | `matters.classification_code` | Seeded `classification_milestone_map` / `classification_document_map` imply re-scaffolding on change; `classification_party_role_rules` is unenforced. Until the scaffold policy is decided, treat as immutable. |
| Progress counters | `transfers.current_step`, `total_steps`, `progress` | Intended to be driven by milestone scaffolding (not yet implemented); free editing would corrupt workflow state. Immutable in slice. |

### 2.3 Immutable — never writable via this contract

`id`, `transfer_id`, `matters.id`, `matters.reference_number` (user-facing
business key, generated = `transfer_id`; `firm_reference` is the editable
firm-facing reference), `matters.source_record_id`, `matter_type`,
`accountable_institution_id` (tenant boundary), `created_by_user_id` /
`submitted_by_user_id` / `assigned_to_user_id` (actor columns),
`client_request_id` / `request_fingerprint` (idempotency identity),
`firm_id` (deprecated), `transfers.property_id` (legacy property link —
property slice), `created_at`, `updated_at` (system-managed).

## 3. Proposed contract

### `PATCH /api/v1/transfers/{id}` — FastAPI, BFF auth-forwarding proxy

Body is a strict allow-list via `_require_body_keys` (same as create):
`{property_address?, purchase_price?, firm_reference?, title?,
expected_updated_at}` — `expected_updated_at` **required**.

Transaction boundary — one `with_transaction` block:

1. Resolve transfer by `id` + caller `accountable_institution_id`
   (`_authorize_transfer`-equivalent for writes; no cross-tenant override —
   see open question Q1).
2. `UPDATE transfers SET <slice fields>, updated_at = CURRENT_TIMESTAMP
   WHERE id = $1 AND accountable_institution_id = $2 AND updated_at = $3`
   — zero rows ⇒ **409** ("modified by another user; reload and retry").
3. `UPDATE matters` on the linked `matter_id` for `firm_reference`/`title`
   with the same tenant predicate, in the same transaction.
4. Return the updated projection (same shape as readback).

No `client_request_id` on updates — create-time idempotency is preserved
unchanged; update safety is provided by the precondition, and the browser's
401 refresh-replay reissues the identical body, so a retried PATCH either
matches (same values + same precondition now stale → 409, honest) or
succeeds once.

### Readback — extend `GET /api/v1/transfers/{id}`

Add a `matter` object to the response: `{referenceNumber, firmReference,
title, classificationCode, status}` and keep `updatedAt` as the concurrency
token the client echoes back in `expected_updated_at`. No new endpoint needed.
PATCH responses use the identical projection, so save-then-read agrees.

### Auth and security (unchanged rules)

`require_jwt` + `transfers:write`; clients (role 4) denied; tenant always from
the verified claim — `accountable_institution_id` in the body is a 422
allow-list rejection, never honoured.

## 4. Focused acceptance tests

1. **Institution isolation** — inst-B staff PATCH/GET on an inst-A transfer →
   404 (not 403; no existence leak). Update under wrong-tenant precondition
   writes zero rows.
2. **Role/ability** — user without `transfers:write` → 403; role-4 client →
   403 even where their GR id is a party on the matter.
3. **Validation** — unknown key → 422; wrong types → 422;
   `accountable_institution_id` in body → 422; `purchase_price < 0` or
   non-finite → 422; `firm_reference` > 100 chars → 422; missing
   `expected_updated_at` → 422.
4. **Persistence** — PATCH then row state: slice columns changed,
   `updated_at` advanced, tenant/actors/idempotency keys unchanged.
5. **Lost-update protection** — two reads share `updatedAt`; first PATCH
   succeeds; second PATCH with the stale token → 409 and **no partial write**
   (matters row also unchanged).
6. **Failed-save honesty** — forced 422/503 leaves the details panel open,
   shows the error notice, adds no audit entry, commits no UI state.
7. **Readback** — GET after PATCH returns the new `matter` fields and the
   bumped `updatedAt`; values match the PATCH response.

## 5. Dependencies flagged for Jordan

- **D1 — none required for the slice.** `updated_at` exists on both tables;
  the concurrency token needs no migration.
- **D2 — dual `purchase_price` storage.** `transfers.purchase_price` vs
  `transfer_financials.purchase_price` diverge once the former is editable
  (financials stay out of scope). Decide whether the slice should co-update
  the financials row or accept the divergence documented.
- **D3 — dual `status` storage.** `transfers.status` and `matters.status`
  must move together if status ever becomes editable; kept immutable here.
- **D4 — classification scaffold policy undefined.** Seeded maps imply
  milestone/document re-scaffolding on `classification_code` change; nothing
  enforces it. Decision needed before classification becomes editable.
- **D5 — `reference_number` immutability.** Confirm the generated
  `reference_number = transfer_id` stays immutable and `firm_reference` is the
  firm-facing editable reference.

## 6. Open questions

- **Q1** — Should the documented cross-tenant write roles
  (`resolve_write_tenant_id`) be able to update another institution's
  matters? Proposal: no for this slice; target tenant must equal the caller's
  verified institution.
- **Q2** — Which of the flagged fields (status, classification, progress
  counters) graduate to later slices, and under what transition rules?
- **Q3** — Is `matters.title` actually user-meaningful in the UI, or should
  the slice be the three-field minimum (address, price, firm_reference)?
