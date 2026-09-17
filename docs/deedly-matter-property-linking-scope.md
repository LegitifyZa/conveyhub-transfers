# Authenticated Matter–Property Linking and Readback — Implementation Contract

**Status:** scoped contract for review, not implemented. P0 – Property
Integration.
**Source commit:** `f016f3e73dbf698e2a668c13a47110c33668bccb` (`origin/main`).
**Model reference:** `docs/deedly-core-transfer-matter-data-model.md` (this
branch) — schema checkpoint `f5c6a33`, runtime checkpoint `f016f3e`.
**Approved product scope (2026-09-17):** DEEDLY may create institution-private
manual property records and link them to the institution's matters. Manual
capture requires no prior search, external response or Golden Record, makes no
upstream writes, and carries no implied registry verification. External
verification/linking remains separate work.
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
    "erf_number": "1234",                   // optional
    "lot_number": null,                     // optional — see D-MAP1 in §9
    "year_built": 2003,                     // optional integer
    "square_footage": 210.5,                // optional finite ≥ 0
    "legal_description": "Erf 1234 ..."     // optional — see D-MAP2 in §9
  }
}
```

Not accepted (allow-list 422): `property_kind`, `role_in_matter`,
`registration_status`, `external_property_id`, `property_source`,
`accountable_institution_id`, `status`, `property_id` inside `property`
(caller never sets the business key), and every `properties` column not listed
(`suburb`, `title_deed_number`, `rates_number`, `municipal_valuation`,
`extent_sqm`, `zoning`, `sectional_title_*`, `latitude/longitude`,
`created_for_transfer_id`, `source_system`, `source_record_id`, `description`,
etc.) — **unsupported fields are rejected, not ignored.** The UI marks the
equivalent inputs unavailable so captured data is never silently discarded.

Response: `201` `{link: {id, matterId, propertyId, propertyKind,
propertySource, createdAt}, property: <§3.3 projection>, created: true}`;
identical replay → `200` with `created:false` (§6).

### 3.3 `GET /api/v1/transfers/{id}/properties` — readback

BFF-local. **Explicitly staff-only and ability-gated** (`require_jwt` +
`transfers:read`; role-4 denied, same precedent) and institution-scoped on
every join: `accountable_institution_id = <verified claim>` predicates the
transfer, the `matter_properties` link **and** the `properties` row, so a
tenant-inconsistent link simply never appears. Each row returns a fixed
allow-list projection — not every database column:

```jsonc
{
  "link": { "id", "propertyKind", "propertySource", "registrationStatus",
            "roleInMatter", "externalPropertyId", "createdAt" },
  "property": { "id", "propertyId", "streetAddress", "city", "province",
                "postalCode", "propertyType", "erfNumber", "lotNumber",
                "yearBuilt", "squareFootage", "legalDescription",
                "status", "sourceSystem" },
  // property is null only for kind='output' placeholder rows (CHECK-permitted)
}
```

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
| `lotNumber` | `properties.erf_number` (+ `lot_number`? — D-MAP1) | opt | `erfNumber`/`lotNumber` | Legacy API maps UI `lotNumber` into **both** `erf_number` and `lot_number`; single UI field can't feed two semantic columns — flag which is canonical (D-MAP1). |
| `yearBuilt` | `properties.year_built` | opt | `yearBuilt` | INTEGER; UI string → server coerces, non-numeric → 422. |
| `squareFootage` | `properties.square_footage` | opt | `squareFootage` | NUMERIC(12,2) (003). Legacy readback falls back to `extent_sqm` — a distinct column with its own meaning; v1 does not cross-map them (D-MAP2). |
| `legalDescription` | `properties.legal_description` | opt | `legalDescription` | Legacy also copied it into `description` — dual-write question flagged (D-MAP2). |

**Minimum required payload for manual capture:** `street_address`, `city`,
`province`, `property_type` — the DB NOT NULLs (002/006/019). No other field is
mandated by constraint; whether conveyancing practice should require more
(e.g. `erf_number`/`legal_description`) is a business decision — flagged,
not invented (D-MIN).

### 4.1 Ambiguous-field decisions (for Dean/Jordan)

The columns below were conflated by the legacy mapping or carry misleading UI
labels. The contract corrects each deliberately — **no silent dual-writes, no
reinterpretation of existing stored values**:

| UI label / field | Stored column | Units / meaning | Current conflation | Recommended correction |
|---|---|---|---|---|
| "Lot / Erf Number" (`lotNumber`) | `erf_number` | Erf number — the surveyed land-parcel number | Legacy API dual-writes the same UI value into `erf_number` **and** `lot_number` (`transferApi.ts` mapping) | Write **`erf_number` only**; `lot_number` stays unwritten until a separate UI field/contract exists. Relabel the input "Erf number". |
| "Legal Description" (`legalDescription`) | `legal_description` | Registered/legal parcel description | Legacy dual-writes into `legal_description` **and** the free-form `description` | Write **`legal_description` only**; `description` stays unwritten. |
| "Square Footage" (`squareFootage`) | `square_footage` | Building size (NUMERIC(12,2)) | Legacy readback displays `extent_sqm` (land extent, m²) as a fallback for `square_footage` — different quantities | Write/read **`square_footage` only**; never substitute `extent_sqm`. Relabel "Building size (m²)" pending units confirmation. |
| "Zip Code" (`zipCode`) | `postal_code` | SA 4-digit postal code | Label is the US term; legacy silently nulled non-4-digit input | Relabel "Postal code"; reject malformed input with 422. |
| "State" (`state`) | `province` | SA province | Label is the US term | Relabel "Province" (cosmetic). |
| "Property Type" (`propertyType`) | `property_type` | One of the 9 CHECK values (006) | UI list matches the CHECK but the field is not required, while the DB requires it | Make required in manual-capture UI and payload. |
| "Year Built" (`yearBuilt`) | `year_built` | INTEGER calendar year | None — clarification only | Coerce to integer; non-numeric → 422. |

Existing stored values are **not** repaired or rewritten — e.g. legacy rows
where `lot_number`/`description`/`extent_sqm` hold dual-written or
cross-mapped content stay exactly as stored; readback returns them verbatim
from their own columns.

## 5. Provenance — explicit manual identity, no inferred verification

- **Manual capture must be explicitly identifiable, not merely "no external
  link."** Proposed representation: `properties.source_system =
  'manual_capture'` on every v1-captured row. `'manual_capture'` is a
  **proposed token, not ratified** — its compatibility with the column's
  import-provenance semantics and its consumers (019's provenance reads, the
  quarantined legacy paths, any reporting) must be checked with Jordan before
  implementation (D-PROV). If a different token is chosen the contract
  substitutes it; the requirement that manual rows carry *an* explicit marker
  is not negotiable.
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
3a. *Link path:* `SELECT … FROM properties WHERE id=$3 AND ai=$4` → 404 if
    absent or cross-tenant; eligibility check per §7. Then the
    **replay check on the link row** (`client_request_id` match → fingerprint
    compare → return original or 409).
3b. *Capture path:* validate the §4 payload; **replay check on the property
    row** (`WHERE ai=$4 AND client_request_id=$5` → fingerprint compare →
    reuse that property id, or 409). Otherwise
    `INSERT INTO properties (property_id = generate_property_id(), …,
    accountable_institution_id = <verified claim>,
    client_request_id, request_fingerprint)`.
4. **Identical-link check before multiplicity:** if a
   `(matter_id, property_id, 'input')` row already exists, return it as the
   replay (`200 created:false`) *before* evaluating the multiplicity cap —
   replaying an existing link must succeed even when the proposed cap is in
   force.
5. Multiplicity check (§7, proposal): a second `input` link → 409. Race-free
   under the `FOR UPDATE` lock held since step 1.
6. `INSERT INTO matter_properties (matter_id, property_id, 'input',
   client_request_id, request_fingerprint)` — plain insert; any unexpected
   conflict after the checks aborts the transaction.

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
- Numbering: `022` is reserved by the unmerged SARS branch; this would be
  `024` (or later) and must not reuse `022` (guide §11 item 13).

## 7. First-slice rules — multiplicity, link kind, eligibility

The multiplicity cap and the status-eligibility restriction below are
**proposals, not approved policy** — they ship only if confirmed (D-MULT,
D-ELIG). Everything else is derived from existing constraints or approved
policy.

| Rule | Slice value | Status / supporting contract |
|---|---|---|
| Link kind written | `property_kind='input'` only | **Contract** — the only evidenced vocabulary for transfer matters (019 backfill + trigger); `output`/development semantics deferred. |
| Multiplicity | At most **one** `input` link per matter; a second → 409 | **Proposal** (D-MULT). Matches the legacy single-property model; the schema permits many, so enforcement is service-side under the `FOR UPDATE` transfer lock — check-then-insert is atomic, so the cap is concurrency-safe. Ordering guarantee: the identical-link replay check runs *before* the cap, so replaying an existing link always returns `200` — the cap rejects only genuinely different second links. |
| Property eligibility | Exists + same `accountable_institution_id` + `status='active'` | Tenant half is **structural** (composite FK); `status='active'` is a **proposal** (D-ELIG). |
| Matter eligibility | `transfers.matter_id` resolvable + `matter_type='transfer'` + same AI | **Contract** — identical to the `f016f3e` PATCH rule; prototype-era `matter_id NULL` rows fail closed (D7). |
| Who may write | `require_jwt` + `transfers:write`; role-4 denied | **Approved policy** — same gate as party attach and PATCH; same-institution applies to every role, no privileged exception. |
| Who may read | Staff only (`transfers:read` + tenant predicates) | **Contract** — client contract undocumented → fail closed, consistent with the matter projection. |

**Existing multi-property matters stay fully readable.** The multiplicity cap
(if approved) constrains *new writes* only — `GET …/properties` returns every
link row the tenant predicates allow, however many exist. Matters that already
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

## 9. Genuinely unresolved decisions (nothing else blocks)

| # | Decision | Recommendation / owner |
|---|---|---|
| D-SCHEMA | §6.1 idempotency columns + partial unique indexes on `properties` **and** `matter_properties` — exact DDL in §6.1 | **Jordan coordination — required, no fallback.** Replay duplication is not an acceptable substitute. |
| D-PROV | `properties.source_system` token for manual rows — `'manual_capture'` proposed | Jordan: check token compatibility with the column's import-provenance semantics and its consumers before implementation; `matter_properties.property_source` stays NULL regardless (§5). |
| D-MULT | One-`input`-per-matter cap — **proposal**, not approved; service-enforced under the row lock, or partial unique index if preferred | PO/Jordan confirm; service rule ships either way once approved. |
| D-ELIG | Attachable `properties.status` set — `'active'` only is a **proposal**, not approved | PO/Jordan confirm. |
| D-MAP1 | `lotNumber` → `erf_number` only (recommended in §4.1) | Confirm recommendation; `lot_number` stays unwritten. |
| D-MAP2 | `legalDescription` → `legal_description` only; `square_footage` ≠ `extent_sqm` (§4.1) | Confirm recommendations; no dual-writes, no cross-mapping. |
| D-MIN | Whether `erf_number`/`legal_description` should be required beyond the DB floor | PO decision. |
| D-ADDR | Should linking/capture sync `transfers.property_address` from `street_address`? | **Recommend no** — the display text is separately editable via PATCH; no automatic overwrite. Confirm. |
| D-DISC | Discovery filters/pagination beyond the §3.1 minimum | Product; not blocking. |
| D7 (carried) | Prototype-era `matter_id NULL` matters: fail closed, or unique-`source_record_id` fallback | Keep fail-closed — **no implicit repair** of prototype records; bound to model-guide §11.7 which Jordan owns. |

Deferred-vocabulary reminder: `external_property_id`, `role_in_matter`,
`registration_status`, `property_source` semantics stay unwritten by this
slice — ratification is model/upstream work, not route work.

## 10. Boundary list for Dean → Jordan

1. **Schema addition (required, exact DDL in §6.1)** — `client_request_id` +
   `request_fingerprint` + institution-scoped partial unique index on both
   `properties` and `matter_properties`; numbering must skip `022` (reserved
   by the unmerged SARS branch). *The only proposed schema change.*
2. `matter_properties` — `UNIQUE(matter_id, property_id, property_kind)`,
   output-CHECK, `fk_matter_properties_property_tenant`,
   `trg_matter_properties_set_tenant`; D-MULT structural-vs-service choice.
3. `properties` — manual-capture write policy (approved at product level),
   no dedup constraint acknowledged, `source_system='manual_capture'` is a
   **proposed** token pending compatibility/consumer check (D-PROV),
   `status` eligibility is a **proposal** (D-ELIG), and the
   `audit_properties_trigger` → `public.audit_log` side effect on every v1
   write (confirm acceptable vs `legitify_auditor` target state).
4. `transfers.property_id` / `matters.property_id` — confirm canonical-only
   writes and the column-retirement path (018/019 notes); trigger untouched.
5. Dual `transfers.matter_id`/`matters.source_record_id` (guide §11.7) — the
   link-resolution rule follows the PATCH precedent; D7 stays his.
6. `erf_number`/`lot_number`, `legal_description`/`description`,
   `square_footage`/`extent_sqm` semantics (D-MAP1/2) — model-level column
   meaning, his certification territory.
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
6. Multiplicity (if approved): a second, different `input` link → 409, while
   an identical-link replay still returns 200 — ordering guaranteed; a
   matter already holding multiple `input` links still reads back complete.
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
