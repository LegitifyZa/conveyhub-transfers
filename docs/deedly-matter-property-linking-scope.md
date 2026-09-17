# Authenticated Matter–Property Linking and Readback — Implementation Contract

**Status:** implemented for review on
`deedly/mvp0/properties/manual-capture-and-linking` at `bae5185` — migration
024 is authored, not executed. P0 – Property Integration.
**Source commit:** `f016f3e73dbf698e2a668c13a47110c33668bccb` (`origin/main`).
**Model reference:** `docs/deedly-core-transfer-matter-data-model.md` (this
branch) — schema checkpoint `f5c6a33`, runtime checkpoint `f016f3e`.
**Approved product scope (2026-09-17):** DEEDLY may create institution-private
manual property records and link them to the institution's matters. Manual
capture requires no prior search, external response or Golden Record, makes no
upstream writes, and carries no implied registry verification. External
verification/linking remains separate work.
**Approved rule updates (this slice):** multiple `input` properties per matter
(no cap); new links require an `active` same-institution property while
existing links stay readable regardless of current status; "Erf number" writes
only `erf_number`; legal description writes only `legal_description`; UI
labels are "Province" and "Postal code"; malformed supplied postcodes are
rejected explicitly; property type is required; editable area capture is
deferred — visibly unavailable, existing values preserved, no
`square_footage`/`extent_sqm` cross-mapping; `transfers.property_address` and
the legacy property pointers are never synchronized or modified.
**Auth note:** Production Authentication remains **Blocked**; this slice sits
behind the same mock-tested browser JWT wiring pending the deployed upstream
contract and the external-ingress/key-rotation HOLD (`AGENTS.md`).
**Boundary:** Jordan owns the Certified Core Transfer / Matter Model review.
This document proposes a route/UI slice on the existing schema plus **one
schema addition** (idempotency columns — §6) that requires his coordination
through Dean; it is not a blanket blocker — see §10 for the exact overlap list.
**Out of scope (this slice):** `purchase_price`/`transfer_financials`,
milestones, documents, classification changes, status transitions, external
provider/registry integration (Loqate `/api/address/*` stays quarantined; no
Entities property endpoint), property detachment/deletion, `output`-kind
links/development-matter semantics, client-role property visibility, and any
restoration of quarantined legacy routes.

## 1. Terminology — four distinct things (do not conflate)

| Concept | Storage | Evidence |
|---|---|---|
| Matter-level address text | `transfers.property_address TEXT NOT NULL` | Display field; required at v1 create, editable via the `f016f3e` PATCH. Independent of any property record — see D-ADDR in §9. |
| Property record | `transfers.properties` (002, extended 003/006/011/019) | Tenant-owned working row (`PROP-YYYY-XXXX` business key). No verification-status column exists — `status` is lifecycle (`active|inactive|sold|under_offer|suspended`), not verification. |
| Matter–property relationship | `transfers.matter_properties` (018/019) | Canonical v1 link: `matter_id` + `property_id` + `property_kind`. |
| External/canonical property reference | `matter_properties.external_property_id TEXT` | Neutral placeholder for the unresolved registry/Entities contract (boundary audit: "all person/company/property canonical data is reached over HTTP through the entities service"). Nothing is written here in this slice. |
| Legacy pointers | `transfers.property_id` (002), `matters.property_id` (003) | Superseded by `matter_properties`; both carry composite tenant FKs (019). `matters.property_id` is never written by any code path. |

## 2. Current state (inspected)

### 2.1 Constraints that govern any write

- `properties` required columns (002 + 019): `property_id` (system via the DB
  function `generate_property_id()` — `PROP-YYYY-XXXX`, loop-unique), `street_address`
  NOT NULL, `city` NOT NULL, `province` NOT NULL, `property_type` NOT NULL with
  the 9-value conveyancing CHECK (006), `accountable_institution_id` NOT NULL
  (019), `status` default `'active'`; `postal_code` has a 4-digit CHECK when
  present (`validate_sa_postal_code`, 002). **No dedup or uniqueness on
  address/erf/title-deed** — `property_id` is the only UNIQUE business key.
- `properties` fires `audit_properties_trigger` (002) → writes
  `public.audit_log` on every INSERT/UPDATE/DELETE. Every v1 property write
  produces legacy audit rows — acknowledged side effect (the boundary audit
  assigns audit writing to `legitify_auditor`, unlanded; listed for Jordan,
  §10).
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
  per-transfer source tag. Rows with any other `property_source` — including
  NULL — are invisible to its DELETE: v1-linked rows cannot be clobbered by it.
- **No request-idempotency columns exist on `properties` or
  `matter_properties`** (`client_request_id`/`request_fingerprint` exist only
  on `transfers` and `transfer_parties`, migration 023). Consequence for §6.

### 2.2 Writers and readers today

- **Only writers are quarantined legacy handlers**: `server/routes/transfers.ts`
  POST create (~line 561: scaffold `properties` row with
  `created_for_transfer_id = <TRF-…>` + set `transfers.property_id`), PUT
  update (~lines 784–852: upsert/create-on-missing + set `transfers.property_id`),
  DELETE (~lines 1169–1196: drop scaffolded property only when
  `created_for_transfer_id` matches and nothing else references it);
  `python_server/routers/transfers.py` mirrors these. All quarantined (503).
- **No v1 code touches the property tables** — verified by grep across
  `python_server` services/repositories/routers and `server/routes/v1/`.
  `matter_properties` is populated only by the 019 backfill and the trigger.
- **Reads:** v1 `GET /api/v1/transfers/{id}` returns `transfers.property_address`
  text plus the staff-only `matter` projection — no `matter_properties` join.
  BFF v1 GETs are served locally off the shared DB; writes are auth-proxied to
  FastAPI (`POST /`, `POST /{id}/parties`, `PATCH /{id}`).
- **UI:** `StepProperty` captures nine fields (address via quarantined Loqate
  → manual entry fallback, city, province/state, postal, property type,
  erf/lot number, year built, square footage, legal description) but
  `persistAggregate` (`src/pages/Transfers.tsx:129`) sends only
  `property_address` + `purchase_price` to `createMatter` — **eight of nine
  captured fields are silently dropped today.** `validatePropertyDetails`
  requires address/city/state/zipCode but **not** `propertyType`, which the DB
  requires — a validation gap the contract closes (§4). The `f016f3e` details
  panel already states property-record details are "managed in separate
  workflows" (`TransferMilestones.tsx:520`).
- Dead code worth noting: quarantined `server/routes/accounts.ts:405` selects
  `properties WHERE transfer_id = $1` — `properties` has no `transfer_id`
  column; it can only ever fail inside its catch.

## 3. Contract — API surface

All v1; FastAPI owns writes and is auth-proxied by the BFF (`DEEDLY_API_BASE_URL`);
GETs are served BFF-locally, matching the parties/milestones precedent.

### 3.1 `GET /api/v1/properties?query=<text>&limit=<n>` — discovery (authorized selection path)

- **Explicitly staff-only and ability-gated:** `require_jwt` +
  `transfers:read`; role-4 denied (the client property-visibility contract is
  undocumented, so fail closed like the `f016f3e` matter projection). No
  privileged-role exception — same-institution applies to every role.
- **Institution-scoped on every query:** `accountable_institution_id =
  <verified claim>` is always a predicate, never taken from the request;
  `query` matched case-insensitively against `property_id` (business key),
  `street_address`, `erf_number`, `title_deed_number`; `limit` capped (≤ 50,
  default 20). No body, no writes.
- Returns a fixed allow-list selection projection — `{id, propertyId,
  streetAddress, city, province, postalCode, propertyType, erfNumber,
  status}` — never a column passthrough.
- Deliberately thin: this is an authorized *selection* path for the firm's own
  register, not a general property browser (filtering/pagination policy is a
  later decision — D-DISC in §9).

### 3.2 `POST /api/v1/transfers/{id}/properties` — link, or capture+link

Strict allow-list body (`_require_body_keys`); **exactly one** of
`property_id` / `property` (XOR — same shape discipline as `party_source` on
party attach):

```jsonc
// Link an existing same-institution property:
{ "property_id": "<uuid>", "client_request_id": "<uuid>" }

// Capture a manual (institution-private, unverified) property and link it:
{
  "client_request_id": "<uuid>",
  "property": {
    "street_address": "12 Example Rd",      // required, non-empty
    "city": "Cape Town",                    // required, non-empty
    "province": "Western Cape",             // required, non-empty
    "property_type": "Freehold",            // required, one of the 9 CHECK values
    "postal_code": "7701",                  // optional; when present must satisfy
                                            //   the 4-digit CHECK — malformed → 422,
                                            //   never silently nulled (legacy did)
    "erf_number": "1234",                   // optional — writes erf_number ONLY
    "legal_description": "Erf 1234 ...",    // optional — writes legal_description ONLY
    "suburb": null,                         // optional string
    "country": null,                        // optional string; defaults 'South Africa'
    "year_built": 2003                      // optional integer
  }
}
```

Not accepted (allow-list 422): `property_kind`, `role_in_matter`,
`registration_status`, `external_property_id`, `property_source`,
`accountable_institution_id`, `status`, `property_id` inside `property`
(caller never sets the business key), and every `properties` column not listed
(`lot_number`, `description`, `title_deed_number`, `rates_number`,
`municipal_valuation`, `square_footage`, `extent_sqm`, `zoning`,
`sectional_title_*`, `latitude/longitude`, `created_for_transfer_id`,
`source_system`, `source_record_id`, etc.) — **unsupported fields are
rejected, not ignored.** `square_footage`/`extent_sqm` are deliberately
outside the allow-list: editable area capture is deferred, so neither column
is writable in this slice and no cross-mapping is possible. The UI marks the
equivalent inputs unavailable so captured data is never silently discarded.

Response: `201` `{id, matterId, propertyId, propertyKind,
registrationStatus, roleInMatter, externalPropertyId, propertySource,
accountableInstitutionId, clientRequestId, createdAt, updatedAt,
property: <§3.3 projection>, created: true}` — the allow-listed link
projection with the property nested; identical replay → `200` with
`created:false` (§6).

### 3.3 `GET /api/v1/transfers/{id}/properties` — readback

BFF-local. **Explicitly staff-only and ability-gated** (`require_jwt` +
`transfers:read`; role-4 denied, same precedent) and institution-scoped on
every join: `accountable_institution_id = <verified claim>` predicates the
transfer, the `matter_properties` link **and** the `properties` row, so a
tenant-inconsistent link simply never appears. Each row returns a fixed
allow-list projection — not every database column:

```jsonc
{
  "id", "matterId", "propertyId", "propertyKind", "registrationStatus",
  "roleInMatter", "externalPropertyId", "propertySource",
  "accountableInstitutionId", "clientRequestId", "createdAt", "updatedAt",
  "property": { "id", "propertyId", "streetAddress", "suburb", "city",
                "province", "postalCode", "country", "propertyType",
                "erfNumber", "legalDescription", "yearBuilt",
                "squareFootage", "extentSqm", "status", "sourceSystem",
                "manual", "accountableInstitutionId", "clientRequestId",
                "createdAt", "updatedAt" },
  // property is null only for kind='output' placeholder rows (CHECK-permitted)
}
```

`manual` is `true` only for `source_system='manual_capture'` rows — the
explicit unverified-capture marker. `squareFootage`/`extentSqm` are returned
verbatim from their own columns (readback only — never cross-mapped and never
writable in this slice).

Field values return verbatim — `propertySource`, `registrationStatus`,
`roleInMatter`, `externalPropertyId`, `sourceSystem` are surfaced as stored
(mostly NULL in this slice), never reinterpreted and never relabelled as
verification state.

## 4. Field mapping — all nine StepProperty fields

| UI field (`propertyDetails`) | Storage column | Req? | Readback field | Notes |
|---|---|---|---|---|
| `address` | `properties.street_address` | **DB req** | `streetAddress` | Also still feeds `transfers.property_address` display text at matter create (unchanged) — divergence question is D-ADDR. |
| `city` | `properties.city` | **DB req** | `city` | Legacy create defaulted `'Unknown'` — v1 requires real input instead. |
| `state` | `properties.province` | **DB req** | `province` | Same. |
| `zipCode` | `properties.postal_code` | UI req, DB opt | `postalCode` | 4-digit CHECK when present; malformed → 422 (legacy create silently nulled it — do not repeat). |
| `propertyType` | `properties.property_type` | **DB req** | `propertyType` | UI list already equals the 9 CHECK values verbatim; **UI must make it required when capturing a manual property** (today it isn't — gap closed here). |
| `lotNumber` (UI label "Erf number") | `properties.erf_number` only | opt | `erfNumber` | **Approved:** `lot_number` is never written. |
| `yearBuilt` | `properties.year_built` | opt | `yearBuilt` | INTEGER; UI string → validated integer, non-numeric → 422. |
| `squareFootage` (UI label "Area (m²)", unavailable) | none — deferred | — | `squareFootage`/`extentSqm` verbatim | **Approved:** editable area capture deferred; field rendered unavailable, existing values preserved, `square_footage`/`extent_sqm` never cross-mapped and neither is writable in this slice. |
| `legalDescription` | `properties.legal_description` only | opt | `legalDescription` | **Approved:** `description` is never written. |

**Minimum required payload for manual capture (approved):** `street_address`,
`city`, `province`, `property_type` — the DB NOT NULLs (002/006/019). No other
field is mandated.

### 4.1 Ambiguous-field decisions (approved)

The columns below were conflated by the legacy mapping or carry misleading UI
labels. Each correction is **approved** — **no silent dual-writes, no
reinterpretation of existing stored values**:

| UI label / field | Stored column | Units / meaning | Current conflation | Approved correction |
|---|---|---|---|---|
| "Erf number" (`lotNumber`) | `erf_number` | Erf number — the surveyed land-parcel number | Legacy API dual-writes the same UI value into `erf_number` **and** `lot_number` (`transferApi.ts` mapping) | Write **`erf_number` only**; `lot_number` stays unwritten until a separate UI field/contract exists. Input relabelled "Erf number". |
| "Legal Description" (`legalDescription`) | `legal_description` | Registered/legal parcel description | Legacy dual-writes into `legal_description` **and** the free-form `description` | Write **`legal_description` only**; `description` stays unwritten. |
| "Area (m²)" (`squareFootage`, unavailable) | none in this slice | Building size vs land extent are distinct columns | Legacy readback displays `extent_sqm` (land extent, m²) as a fallback for `square_footage` — different quantities | **Deferred:** the input is visibly unavailable; existing stored values are preserved; `square_footage`/`extent_sqm` are never cross-mapped and neither is writable in this slice. |
| "Postal code" (`zipCode`) | `postal_code` | SA 4-digit postal code | Label was the US term; legacy silently nulled non-4-digit input | Relabelled "Postal code"; a supplied malformed value → 422. |
| "Province" (`state`) | `province` | SA province | Label was the US term | Relabelled "Province" (cosmetic; the state field name stays internal). |
| "Property Type" (`propertyType`) | `property_type` | One of the 9 CHECK values (006) | UI list matches the CHECK but the field was not required, while the DB requires it | Required in manual-capture UI and payload. |
| "Year Built" (`yearBuilt`) | `year_built` | INTEGER calendar year | None — clarification only | Coerced to integer; non-numeric → 422. |

Existing stored values are **not** repaired or rewritten — e.g. legacy rows
where `lot_number`/`description`/`extent_sqm` hold dual-written or
cross-mapped content stay exactly as stored; readback returns them verbatim
from their own columns.

## 5. Provenance — explicit manual identity, no inferred verification

- **Manual capture is explicitly identifiable, not merely "no external
  link."** Implemented as `properties.source_system = 'manual_capture'` on
  every v1-captured row. The compatibility/consumer check was performed before
  adoption: no runtime code reads `properties.source_system` (every code
  reference is `matters.source_record_id`, a different column; the only
  schema-level consumer is migration 003's provenance intent). The token
  remains subject to Jordan's ratification as model vocabulary — substituting
  it later is a one-word change in `matter_property_service.py`; the
  requirement that manual rows carry *an* explicit marker is unchanged.
- **Unverified is displayed, not inferred.** Verification is never derived
  from the presence of `external_property_id` or any other column — the
  schema has no verification-status field and `properties.status` is
  lifecycle only. The UI labels manually captured rows "manual — not
  registry-verified"; readback surfaces `sourceSystem` verbatim so consumers
  can distinguish provenance without the API asserting a verification claim.
  Legacy and linked-existing properties are likewise never displayed as
  verified: nothing in this slice adds, upgrades or implies a verified status
  for any row.
- **Link provenance (`matter_properties.property_source`):** v1-written links
  keep `property_source = NULL`. The only extant vocabulary is the trigger's
  `legacy_transfer_<uuid>` tag, whose *purpose* is to mark rows the sync
  trigger owns — applying any look-alike value to v1 rows would expose them
  to trigger deletion; minting a new token is vocabulary Jordan must ratify.
  NULL is also self-describing in readback: `propertySource: null` means
  "v1-authored link".
- **Existing provenance is preserved:** legacy `property_source` tags,
  `source_system`/`source_record_id` import values and
  `created_for_transfer_id` markers are returned verbatim and never
  rewritten. `created_for_transfer_id` is **never set** by this slice — it
  marks auto-scaffolded rows for the legacy delete path; a manually captured,
  potentially shared property must not look scaffolded.
- **`source_record_id` is not overloaded** to carry client keys (§6).

## 6. Atomicity, idempotency and retry

**Required precondition — the §6.1 schema change must land with the slice.**
There is no weaker fallback: without request-level idempotency, a
lost-response capture retry would mint a second `properties` row, which the
product requirement forbids. Overloading `source_record_id` or
`created_for_transfer_id` to carry client keys is rejected — it would
corrupt provenance semantics.

**Fingerprint composition** (mirrors the 023 party precedent, extended):
`request_fingerprint` is SHA-256 over a canonical serialization of the
*validated* operation payload **including the target** — `{operation,
transfer_id, matter_id?, link|capture, property_id | property{…}}`. Binding
the target into the fingerprint means the same `client_request_id` replayed
against a different transfer/matter is a fingerprint mismatch → 409, never a
link created elsewhere.

**Replay contract** (both paths): every request — first attempt or replay —
re-runs authorization in full (ability, role-4 denial, transfer tenant, and
for link/existing-key replay the property's tenant) inside the transaction.
A replay with matching key **and** fingerprint returns the *original*
property/link with `200 created:false`; a key reuse with a different
fingerprint is a **409 idempotency conflict**, never a second write.

**One transaction per request** (`with_transaction`), in this order:

1. `SELECT … FROM transfers WHERE id=$1 AND ai=$2 FOR UPDATE` → 404.
2. Resolve matter via `transfers.matter_id` (+ AI predicate +
   `matter_type='transfer'`) — deterministic, identical to the `f016f3e`
   PATCH rule; NULL/inconsistent → error, nothing written. No implicit repair
   of prototype-era rows.
3. **Replay check on the link row, before anything else**
   (`WHERE ai AND client_request_id` → fingerprint compare → return the
   original link + property as `200 created:false`, or 409 on mismatch).
   This runs *before* property resolution and eligibility on purpose: a
   stored link replays even if the property has since gone inactive —
   eligibility governs new links, never history.
4a. *Link path:* `SELECT … FROM properties WHERE id AND ai` → 404 if absent
    or cross-tenant; `status='active'` required for a new link → 400
    otherwise ("Unknown or ineligible property").
4b. *Capture path:* **replay check on the property row**
    (`WHERE ai AND client_request_id` → fingerprint compare → reuse that
    property, or 409) — defence-in-depth for a key whose link never
    committed; otherwise `INSERT INTO properties (property_id =
    generate_property_id(), …, status='active', source_system=
    'manual_capture', accountable_institution_id=<verified claim>,
    client_request_id, request_fingerprint)`.
5. `INSERT INTO matter_properties (matter_id, property_id, 'input',
   client_request_id, request_fingerprint) ON CONFLICT (matter_id,
   property_id, property_kind) DO NOTHING` → a conflict re-selects and
   returns the identical stored link as `200 created:false`. There is no
   multiplicity cap — multiple `input` links per matter are approved.
6. A `UniqueViolationError` on either unique key resolves after rollback by
   re-reading the keyed rows and comparing fingerprints — **no
   duplicate-on-lost-replay fallback**: if nothing stored the key, the error
   propagates.

**Orphan safety:** capture and link commit or roll back together — a link
failure destroys the property insert, so no unlinked "forgotten" property can
be produced by a failed request. A conflicting-reuse 409 similarly rolls back
with nothing written.

### 6.1 Minimum schema dependency — for Jordan's coordination

```sql
ALTER TABLE transfers.properties
    ADD COLUMN client_request_id UUID,
    ADD COLUMN request_fingerprint VARCHAR(64);
CREATE UNIQUE INDEX idx_properties_client_request_id
    ON properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

ALTER TABLE transfers.matter_properties
    ADD COLUMN client_request_id UUID,
    ADD COLUMN request_fingerprint VARCHAR(64);
CREATE UNIQUE INDEX idx_matter_properties_client_request_id
    ON matter_properties (accountable_institution_id, client_request_id)
    WHERE client_request_id IS NOT NULL;
```

- `properties` columns let a capture replay find its original property row;
  `matter_properties` columns let a link replay return its original link and
  let conflicting key reuse fail — including a key replayed against a
  different target (fingerprint mismatch).
- Institution-scoped partial uniques mirror migration 023 exactly: a foreign
  institution reusing the same UUID can neither observe nor collide.
- The tenant trigger overwrites `matter_properties.accountable_institution_id`
  *before* insert completes, so the partial index is always evaluated against
  the parent matter's tenant — no forged-AI key squatting.
- Numbering: `022` is reserved by the unmerged SARS branches; the migration
  was checked across active branches and authored as **`024`** —
  `src/lib/migrations/024_deedly_property_link_idempotency.sql`, schema-
  qualified, pending DB certification. Execution is not authorized yet.

## 7. First-slice rules — multiplicity, link kind, eligibility

All rules below are **approved policy** or derived from existing constraints.

| Rule | Slice value | Status / supporting contract |
|---|---|---|
| Link kind written | `property_kind='input'` only | **Contract** — the only evidenced vocabulary for transfer matters (019 backfill + trigger); `output`/development semantics deferred. |
| Multiplicity | **Multiple `input` links per matter; no cap** | **Approved** — the earlier one-input proposal was rescinded; the schema already permits many. |
| Property eligibility | New links: exists + same `accountable_institution_id` + `status='active'` | **Approved** — tenant half is also **structural** (composite FK). Eligibility is evaluated only when creating a link: a replayed `client_request_id` or an identical-link retry returns the stored link even if the property has since gone inactive — replay restores history, it does not re-validate it. |
| Existing-link readability | Every stored link reads back regardless of current `status` | **Approved** — `GET …/properties` predicates tenant on transfer + link + property but never `status`. |
| Matter eligibility | `transfers.matter_id` resolvable + `matter_type='transfer'` + same AI | **Contract** — identical to the `f016f3e` PATCH rule; prototype-era `matter_id NULL` rows fail closed (D7). |
| Who may write | `require_jwt` + `transfers:write`; role-4 denied | **Approved policy** — same gate as party attach and PATCH; same-institution applies to every role, no privileged exception. |
| Who may read | Staff only (`transfers:read` + tenant predicates) | **Contract** — client contract undocumented → fail closed, consistent with the matter projection. |

**Existing multi-property matters stay fully readable.** `GET …/properties`
returns every link row the tenant predicates allow, however many exist. Matters that already
hold multiple `input` links (e.g. rows the 019 backfill or trigger created
across repeated legacy pointers) read back complete; nothing is filtered,
collapsed or repaired. Detach/relink tooling for such matters is a later
slice, not an implicit fix here.

**Authorization is rechecked on every request including replays:** caller
ability + role, transfer tenant (inside the transaction), property tenant,
and — on capture replay — that the keyed property belongs to the caller's
institution (the index is AI-scoped, so a foreign key can neither observe nor
collide). No response leaks existence across tenants (404, not 403).

## 8. Legacy pointer dependency — explicit non-change

`transfers.property_id` and `matters.property_id` are **not written** by this
slice, and `trg_sync_matter_properties_from_transfer` is untouched:

- 018's contract: `matter_properties` is authoritative; "the legacy column
  must not be written independently for the same relationship."
- Writing `transfers.property_id` would fire the trigger, which inserts its
  own `input` row tagged `legacy_transfer_<uuid>` — provenance mislabelled for
  a v1 link (ON CONFLICT masks the duplicate but the source tag is already
  wrong), and it creates a second write path to keep consistent.
- No live reader uses `transfers.property_id` (every consumer is quarantined);
  leaving it NULL is honest. Its retirement is Jordan's (018/019 note), not
  this slice's.
- Direction-of-safety: the trigger's DELETE predicates on its own
  `legacy_transfer_` source tag — NULL-`property_source` v1 links are never
  matched, so later legacy-path activity cannot strip them.

## 9. Decision ledger — resolved vs still open

**Approved and implemented:**

| # | Decision | Resolution |
|---|---|---|
| D-SCHEMA | §6.1 idempotency columns + partial unique indexes on `properties` **and** `matter_properties` | **Required — no fallback.** Authored as migration `024` (`024_deedly_property_link_idempotency.sql`); execution awaits DB certification with Jordan through Dean. |
| D-PROV | `properties.source_system` token for manual rows | **Adopted `'manual_capture'`** after checking consumers — no runtime code reads `properties.source_system` (all `source_*` code references are `matters.source_record_id`). Still subject to Jordan's vocabulary ratification. |
| D-MULT | Multiplicity | **Approved: multiple `input` links per matter, no cap** (proposal rescinded). |
| D-ELIG | Attachable `properties.status` set | **Approved: `status='active'` for new links only**; existing links stay readable regardless of status, and stored-link replay never re-validates eligibility. |
| D-MAP1 | `lotNumber` mapping | **Approved: `erf_number` only**; `lot_number` never written; input labelled "Erf number". |
| D-MAP2 | `legalDescription` / area mapping | **Approved: `legal_description` only**; no `description` dual-write; editable area deferred — `square_footage`/`extent_sqm` preserved verbatim, never cross-mapped, neither writable. |
| D-MIN | Fields beyond the DB floor | **Resolved: DB floor only** — `street_address`, `city`, `province`, `property_type`. |
| D-ADDR | Sync `transfers.property_address` on link/capture | **Approved as recommended: no** — the display text stays independently PATCH-editable; nothing writes it here. |
| Pointers | `transfers.property_id` / `matters.property_id` / sync trigger | **Approved as recommended: untouched** (§8). |

**Still open (not blocking this slice):**

| # | Decision | Owner |
|---|---|---|
| D-DISC | Discovery filters/pagination beyond the §3.1 minimum | Product; not blocking. |
| D7 (carried) | Prototype-era `matter_id NULL` matters: fail closed, or unique-`source_record_id` fallback | Keep fail-closed — **no implicit repair** of prototype records; bound to model-guide §11.7 which Jordan owns. |

Deferred-vocabulary reminder: `external_property_id`, `role_in_matter`,
`registration_status`, `property_source` semantics stay unwritten by this
slice — ratification is model/upstream work, not route work.

## 10. Boundary list for Dean → Jordan

1. **Schema addition (required, authored not executed)** — migration `024`
   (`024_deedly_property_link_idempotency.sql`) adds `client_request_id` +
   `request_fingerprint` + institution-scoped partial unique indexes on both
   `properties` and `matter_properties`; numbering skips `022` (reserved by
   the unmerged SARS branches). *The only schema change.* Certification and
   execution need Jordan's sign-off through Dean.
2. `matter_properties` — `UNIQUE(matter_id, property_id, property_kind)`,
   output-CHECK, `fk_matter_properties_property_tenant`,
   `trg_matter_properties_set_tenant`; multiplicity is now approved product
   policy (multiple `input` links, no cap) — no structural change needed.
3. `properties` — manual-capture write policy (approved), no dedup
   constraint acknowledged, `source_system='manual_capture'` adopted after a
   consumer check found no runtime readers (still his vocabulary to ratify),
   `status='active'` new-link eligibility approved, and the
   `audit_properties_trigger` → `public.audit_log` side effect on every v1
   write (confirm acceptable vs `legitify_auditor` target state).
4. `transfers.property_id` / `matters.property_id` — canonical-only writes
   confirmed for this slice; neither column nor the sync trigger is touched
   (approved); column-retirement path stays his (018/019 notes).
5. Dual `transfers.matter_id`/`matters.source_record_id` (guide §11.7) — the
   link-resolution rule follows the PATCH precedent; D7 stays his.
6. `erf_number`/`lot_number`, `legal_description`/`description`,
   `square_footage`/`extent_sqm` semantics — corrected mappings approved and
   implemented; underlying column-meaning certification stays his.
7. No reference-table seeding needed (`property_kind` CHECK is
   self-contained; no new FK targets or definitions).

## 11. Acceptance criteria

**FastAPI unit tests (mocked pool):**

1. Allow-list: unknown key, both `property_id`+`property`, neither,
   `property_kind`/`status`/`accountable_institution_id` supplied → 422.
2. Validation: blank required field → 422; `property_type` outside the 9 →
   422; `postal_code` not 4 digits → 422 (never nulled); non-numeric
   `year_built`/`square_footage` → 422; negative `square_footage` → 422.
3. Auth: missing/invalid JWT → 401; no `transfers:write` → 403; role-4 → 403
   on POST (even when their GR is a party); discovery GET and readback GET
   are role-4 → 403 and `transfers:read`-gated; every response is the fixed
   allow-list projection — no extra DB columns leak.
4. Tenant: foreign-AI transfer → 404; foreign-AI `property_id` → 404;
   replay keyed to foreign institution → 404/no collision; readback joins
   predicate tenant on transfer, link and property.
5. Idempotency: link replay → 200 `created:false` returning the original
   link; capture replay with same key+fingerprint → same property id, 200;
   same key + different fingerprint (including a key replayed against a
   different transfer — the fingerprint binds the target) → 409, zero writes.
6. Multiplicity (approved): multiple distinct `input` links on one matter
   attach and read back complete; an identical-link retry returns the stored
   link as `200 created:false`; a link replay succeeds even after the
   property goes `inactive`.
7. Matter resolution: `matter_id` NULL or non-`transfer` → error, zero
   writes, no implicit repair.

**BFF route tests:** POST proxy contract; GET readback + discovery tenant
scoping; client-role projections unchanged.

**Guarded DB suite** (`TEST_DATABASE_URL` + explicit opt-in flag, uniquely
named scratch schema, no ambient-DSN fallback — established convention):

8. Composite FK rejects a cross-tenant link even if service checks were
   bypassed; tenant trigger overwrites a forged link AI.
9. Full capture+link round-trip: one transaction produces exactly one
   property + one link; forced link failure leaves **no** property row.
10. Trigger non-interference: a v1-linked (NULL-`property_source`) row
    survives a `transfers.property_id` update that fires the sync trigger.
11. `FOR UPDATE` serialization: two concurrent capture+links — exactly one
    commits per rule set (multiplicity + idempotency key).

**UI honesty:**

12. Every captured StepProperty field is either sent and persisted or the
    input is visibly unavailable — nothing is silently discarded; the
    manual/unverified label renders; failed attach leaves entries intact with
    an error notice and no success claim; readback renders the server
    projection only.

## 12. Explicitly out of scope

Purchase-price/financial fields, milestone/document scaffolding,
classification changes, status transitions, property detach/delete,
`output`-kind links, external provider/registry integration (Loqate stays
quarantined; no Entities property calls), client-role property visibility,
any change to quarantined legacy routes, and any schema work beyond §6.1.
