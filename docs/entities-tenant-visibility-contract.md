# Entities Tenant-Scoped Golden Record Visibility Contract

**Branch:** `deedly-v1-create`  
**Date:** 2026-08-31 (original proposal) · 2026-09-04 (resolution, §8)  
**Status:** **Sections 1–7 are HISTORICAL and partly WRONG. Read §8 first — it is the implemented contract.**

---

## ⚠ READ THIS FIRST — the implemented contract

> The proposal in §§3–6 below was **not adopted**. It assumed the upstream Entities service would accept an `X-Accountable-Institution-Id` header and enforce accountable-institution visibility on ConveyHub's behalf. Per the *Deedly (ConveyHub) — External S2S Integration Guide* (Authoritative, 2026-09-03), **neither will ever exist**: S2S callers deliberately bypass all upstream authorization, and Deedly enforces tenant visibility itself.
>
> **Do not implement, send, or expect:**
> - ❌ `X-Accountable-Institution-Id` on any Entities call — the header does not exist upstream.
> - ❌ Upstream tenant/visibility enforcement — Entities will happily return any Golden Record to a service-key caller.
> - ❌ A single-call "scoped lookup" against Entities — there is no such endpoint.
> - ❌ `tenant_id` equality as a visibility test — Golden Records are shared across tenants by design.
> - ❌ Any unscoped or fallback lookup when the scoped check fails.
>
> **Do implement** the two-call recipe (full detail in §8.2):
>
> ```text
> 1. Authorize the transfer locally, then derive ai = transfer.accountable_institution_id
>    (from the transfer row — never from the request body).
> 2. GET /api/v1/users/clients/s2s/by-golden-record/{gr}?accountable_institution_id={ai}
>       404 -> "Unknown or inaccessible Golden Record" -> 400. STOP. Do not call Entities.
> 3. GET /api/v1/entities/{gr}?entity_type={expected}      (only if step 2 returned 200)
>       404 -> type mismatch or missing -> 400.  200 -> the record must be active/usable.
> 4. Open a short DB transaction, re-check the parent transfer, insert, commit.
> ```
>
> No database transaction may be open during steps 2–3. In code this lives in
> `python_server/services/golden_record_visibility.py::resolve_visible_golden_record`;
> use it rather than calling the client directly.

---

## 1. Objective

This contract defines the service-to-service integration required before `POST /v1/transfers/{id}/estate-contexts` and `POST /v1/transfers/{id}/representative-assignments` can be implemented. Both routes need to assert that a Golden Record (GR) is (a) known to the upstream Entities service, (b) of the expected entity type, and (c) visible to the transfer's accountable institution. The existing ConveyHub Entities client cannot make that third assertion, so the routes are intentionally deferred.

## 2. Current-state gap

### 2.1 Client endpoints in use

The ConveyHub Python `EntitiesClient` (`python_server/clients/entities.py`) currently exposes three operations:

| Operation | Method / Path | Auth | Tenant scope |
|-----------|---------------|------|--------------|
| `get_entity` | `GET /api/v1/entities/{entity_id}?entity_type={person\|company}` | `X-Service-Key: {SECRET_KEY}` | **None** — only `entity_type` is supplied. |
| `search_entities` | `POST /api/v1/entities/search` | `X-Service-Key: {SECRET_KEY}` | **None** in the request structure audited. |
| `submit_person` | `POST /api/v1/entities/submit` | `X-Service-Key: {SECRET_KEY}` | `tenant_id` is embedded in the JSON body, but this is a *create* operation, not a *visibility* lookup. |

The TypeScript/Express side has **no Entities client** today; the relevant routes either do not exist or are intentionally absent.

### 2.2 Authentication mechanism

The client is constructed with a single shared `X-Service-Key` header:

```python
httpx.AsyncClient(
    base_url=settings.entities_service_url,
    headers={"X-Service-Key": settings.secret_key},
)
```

This header proves that the caller is the ConveyHub service. It does **not** prove the tenant context of the specific transfer, matter, or user.

### 2.3 Missing tenant context

No header, query parameter, or body field conveys the ConveyHub `accountable_institution_id` of the matter to the Entities service during a lookup. The existing lookup is therefore a **global** service-key lookup.

### 2.4 No local Entities service

There is no local Entities service or data table inside ConveyHub that records tenant-bound Golden Record visibility. ConveyHub must rely on the upstream service for this assertion.

### 2.5 Security consequence of the global lookup

A global, unscoped lookup would allow ConveyHub to retrieve or confirm the existence of any Golden Record known to the Entities service, regardless of whether the transfer's `accountable_institution_id` has any legal or contractual relationship with that record. Consequences include:

- Cross-tenant data leakage (confirmation of existence, name, ID, or other metadata).
- Construction of estate contexts or representative assignments for Golden Records that the current tenant has never seen.
- Violation of the tenant-isolation model enforced by the `transfers` schema.

### 2.6 Routes blocked by the gap

The following routes are **not implemented** because they require a tenant-scoped GR assertion:

| Route | Required GR assertion | Why it is blocked |
|-------|----------------------|-------------------|
| `POST /v1/transfers/{id}/estate-contexts` | `deceased_golden_record_id` must resolve to a `person` GR visible to the transfer's `accountable_institution_id`. | Without tenant scoping, ConveyHub could create an estate context for a deceased person the tenant has no right to reference. |
| `POST /v1/transfers/{id}/representative-assignments` | `person_golden_record_id` must resolve to a `person` GR visible to the transfer's `accountable_institution_id`. | Without tenant scoping, ConveyHub could assign a representative who has no relationship to the tenant. |

### 2.7 Why transfer authorization alone is insufficient

Transfer authorization (JWT role/ability checks, `accountable_institution_id` match, existing transfer ownership) only proves that the caller may act on the ConveyHub transfer record. It does **not** prove that the Golden Record the caller wants to reference is visible to that same accountable institution inside the **separate** Entities domain. The two authorizations must be composed, not conflated.

## 3. Required service behaviour

The upstream Entities service must support the following before ConveyHub enables the deferred POST routes.

> **Superseded in part — see §8.** The S2S Integration Guide answered each row directly: 3.1, 3.3 and 3.5 are met; **3.2 and 3.4 will deliberately never be provided** for S2S callers; 3.6 is a Deedly-side obligation; 3.7 is not consumed upstream.

| # | Requirement | Rationale | Guide disposition |
|---|-------------|-----------|-------------------|
| 3.1 | **Service-to-service authentication** | The endpoint must reject requests without a valid `X-Service-Key` (or equivalent mTLS/token). | **Met** — `X-Service-Key`. |
| 3.2 | **Explicit accountable-institution scope** | The caller must supply the tenant whose visibility is being asserted. The service must not infer it from the service key. | **Not implemented upstream.** Entities will not accept or enforce `X-Accountable-Institution-Id`. Asserted via the users-service linkage endpoint instead. |
| 3.3 | **Lookup by Golden Record ID and expected entity type** | The contract must accept `entity_id` and `entity_type` so ConveyHub can verify the record is the kind of entity it intends to use. | **Met** — `entity_type` mismatch returns 404. |
| 3.4 | **Actual visibility enforcement within Entities** | The service must consult its own tenancy/permission model and return a negative result when the GR is not linked to the supplied `accountable_institution_id`. | **Deliberately not provided** for S2S callers. Deedly is first-party and enforces visibility itself, like every sibling service. |
| 3.5 | **Tenant-safe not-found behaviour** | The service must return a 404 (or 403) for both (a) unknown GRs and (b) GRs not visible to the tenant. ConveyHub must not be able to distinguish between the two cases. | **Met by composition** — the linkage endpoint returns an identical 404 for unknown GR and not-linked-to-this-AI. |
| 3.6 | **No fallback to unscoped global lookup** | The endpoint must never fall back to a global search when the scoped lookup returns no match. | **Deedly-side obligation** — never skip the linkage check or retry without the AI filter. |
| 3.7 | **Audit and correlation metadata** | The endpoint must accept a `X-Correlation-Id` header and include it in audit logs so cross-service debugging is possible without exposing PII. | **Not consumed** — Legitify services neither echo nor log it today. Optional for our own logs; a candidate future improvement. |

## 4. Short-term request contract

> **⚠ Superseded by §8.** This section proposed a header-scoped single-call lookup. That contract was **not** adopted: `X-Accountable-Institution-Id` does not exist upstream and must not be sent. The implemented contract is the two-call recipe in §8.2. This section is retained only as the record of what was proposed.

Until a more complete Graph/REST API is available, ConveyHub and Entities should implement the following minimal contract.

### 4.1 Request

```text
NOT ADOPTED — DO NOT COPY. The proposal was a single request of the form:

  GET /api/v1/entities/{entity_id}?entity_type=person
  Host:            entities.legitify.internal      <- wrong: calls go through the nginx gateway
  X-Service-Key:   <credential>                    <- correct, and the only header we send
  X-Accountable-
    Institution-Id: <transfer AI>                  <- DOES NOT EXIST UPSTREAM; never sent
  X-Correlation-Id: <uuid>                         <- optional; not consumed upstream

The implemented request pair is in §8.2.
```

Query parameters:

| Parameter | Required | Allowed values | Notes |
|-----------|----------|----------------|-------|
| `entity_id` | Yes | UUID | The Golden Record identifier the transfer wants to reference. |
| `entity_type` | Yes | `person`, `company`, `trust` | ConveyHub must supply the type it expects to find. The service must validate that the GR matches this type. |

Headers:

| Header | Required | Notes |
|--------|----------|-------|
| `X-Service-Key` | Yes | Service-to-service credential. Must be rotated and stored in the existing `SECRET_KEY` / `LEGITIFY_API_BASE_URL` (formerly `ENTITIES_SERVICE_URL`) configuration path. |
| ~~`X-Accountable-Institution-Id`~~ | **Not adopted** | Does not exist upstream. The AI is passed as the `accountable_institution_id` query parameter of the users-service linkage endpoint instead (§8.2). |
| `X-Correlation-Id` | Optional | UUID or trace ID. Legitify services neither echo nor log it today, so it is not currently sent. |

### 4.2 Successful response

HTTP `200 OK`.

```json
{
  "message": "OK",
  "data": {
    "id": "{entity_id}",
    "entity_type": "person",
    "name": "Public Display Name",
    "is_active": true
  }
}
```

Fields the ConveyHub consumer may rely on:

| Field | Required | Notes |
|-------|----------|-------|
| `id` | Yes | Must match the requested `entity_id`. |
| `entity_type` | Yes | Must match the requested `entity_type`. |
| `name` | No | Tenant-safe display label; may be null if the Entities policy is to withhold it. |
| `is_active` | Yes | ConveyHub must reject inactive or soft-deleted records. |

### 4.3 Visibility-denied response

HTTP `404 Not Found`.

```json
{
  "message": "Not found",
  "data": null
}
```

The service must return the same `404` shape for:

- an unknown `entity_id`;
- a known `entity_id` that is not linked to the supplied `X-Accountable-Institution-Id`;
- an `entity_id` whose `entity_type` does not match the query parameter.

ConveyHub must treat this as a tenant-safe "not visible" result and surface it as `400` to the route caller with the message "Unknown or inaccessible Golden Record".

### 4.4 Error responses

| Status | Meaning | ConveyHub action |
|--------|---------|------------------|
| `401` / `403` | Invalid or missing service key. | Log at error level and raise an `EntityServiceError`; do not proceed. |
| `404` | GR unknown or not visible to the tenant. | Translate to `400` on the transfer route: "Unknown or inaccessible Golden Record". |
| `422` | Invalid `entity_type` or malformed `entity_id`. | Translate to `400` on the transfer route: "Invalid Golden Record reference". |
| `5xx` | Entities service failure. | Raise `EntityServiceError` and return `503` or fail closed; do not mutate the transfer. |

## 5. ConveyHub consumer obligations

ConveyHub must not call the Entities lookup until the transfer route has already performed its own authorization. The consumer must:

| # | Obligation | Where it is enforced |
|---|------------|---------------------|
| 5.1 | Call only after transfer-level authorization has succeeded. | Route handler (`requireJwt`, `_authorize_transfer`). |
| 5.2 | Use the transfer's `accountable_institution_id`, not the caller's `user.accountable_institution_id` and not the JWT tenant. *(Passed as the linkage query parameter, not a header — §8.2.)* | `_get_parent_accountable_institution_id` in `transfer_party_service`. |
| 5.3 | Validate `entity_type` against an allow-list (`person` for `deceased_golden_record_id` and `person_golden_record_id`; `trust` only when a trust party exists). | Route handler before the request; `SUPPORTED_ENTITY_TYPES` in the client. |
| 5.4 | ~~Generate and forward an `X-Correlation-Id` for every request.~~ **Optional** — upstream neither echoes nor logs it. | Not implemented. |
| 5.5 | Treat any `404` as a denial; never retry with a different scope or fall back to an unscoped call. | Client wrapper (`_send` never retries 4xx). |
| 5.6 | Keep the Entities call outside any database transaction. | `link_party_to_transfer` ordering. Confirmed correct by the guide (§5.4). |

## 6. Route implementation guardrails (when the contract is available)

> **Step 3 superseded by §8.2**; the rest of this sequence stands and is what the guide confirms.

When the Entities endpoint supports the contract above, the deferred POST routes should be implemented in this order:

```text
1. Authenticate/authorize transfer (existing pattern).
2. Determine the transfer's accountable_institution_id and transfer_id.
3. [SUPERSEDED — see §8.2] Two calls, linkage first:
     3a. GET /api/v1/users/clients/s2s/by-golden-record/{gr}?accountable_institution_id={ai}
     3b. GET /api/v1/entities/{gr}?entity_type={expected}
4. If both return 200 and entity_type/is_active match, proceed.
5. If either returns 404 (or 403/422), return 400 to the caller.
6. Open a short DB transaction, recheck the parent record, insert, commit.
```

No ConveyHub database transaction may be open while the Entities request is in flight.

### 6.1 `POST /v1/transfers/{id}/estate-contexts`

- Accept `deceased_golden_record_id`.
- Verify `entity_type=person` with the Entities service.
- Validate `masters_estate_reference` format.
- Reject `estate_reference`, `accountable_institution_id`, actor IDs, and any other protected fields in the body.
- Insert `matter_estate_contexts` with tenant derived from the transfer.

### 6.2 `POST /v1/transfers/{id}/representative-assignments`

- Accept `person_golden_record_id` and `capacity`.
- Accept exactly one of `represented_estate_context_id` or `represented_transfer_party_id`.
- If the represented target is a `matter_estate_context`, the capacity must be `executor` or `masters_representative`.
- If the represented target is a `transfer_party`, the party's `entity_type` must be `trust` and the capacity must be `trustee`.
- Verify `person_golden_record_id` with `entity_type=person` against the transfer's `accountable_institution_id`.
- Reject `accountable_institution_id`, actor IDs, and `assignment_state` in the body.

## 7. Open questions to resolve before implementation

All five were answered in the S2S Integration Guide §7.

1. Does the Entities service require `X-Accountable-Institution-Id` as an integer or as a string UUID?  
   **Answered:** neither — no header is used. `accountable_institution_id` is an **integer**, the `users.accountable_institutions` primary key, passed as a query parameter to the linkage endpoint. Each AI row also carries a separate `tenant_id` **UUID** used for setup-data scoping and as `tenant_id` on `POST /entities/submit`. Map between them via the AI row; never guess.
2. Should `X-Tenant-Id` (the JWT `tenant_id` claim) also be forwarded for audit correlation?  
   **Answered: no** — moot, since scope enforcement is Deedly-side. For submits, pass the AI's `tenant_id` UUID in the body.
3. Are there rate limits or circuit-breaker expectations for the scoped lookup?  
   **Answered: none on the S2S lane.** Be a polite internal citizen: honour the §3.3 timeouts, no unbounded fan-out, retries with backoff only on 5xx/timeouts. Reads are safe to retry; submits are get-or-create and concurrent-safe but must not be hammered. Implemented as 3 read attempts / 2 submit attempts with exponential backoff.
4. Is a bulk visibility check (multiple GRs at once) preferable?  
   **Answered: not available.** Loop the linkage call — it is a single indexed query. If a hot path needs a batch variant, request it as a small users-service addition.
5. What PII fields are permitted in the `200` response body?  
   **Answered:** as a trusted first-party caller ConveyHub receives the **full** Golden Record, and must minimise what it persists — `golden_record_id` plus the display cache (name / id_number / email + `synced_at`). Everything else is used for the visibility decision and discarded.

## 8. Resolution — implemented tenant-scoped visibility (2026-09-04)

**Source of truth:** *Deedly (ConveyHub) — External S2S Integration Guide*, status Authoritative 2026-09-03, which responds directly to this document. Its standing decisions:

1. Deedly is a **first-party** Legitify product, not an external partner, and is expected to be absorbed into `legitify-be` as a sibling service later. Integration choices should keep that migration cheap.
2. Deedly gets **full service-to-service trust** — the platform `X-Service-Key`, the same credential every internal service uses. There is no scoped-down partner credential.
3. Corollary: **Deedly owns its own tenant scoping.** S2S callers bypass every ability check and the entities linkage gate by design. Upstream services will not enforce accountable-institution visibility on Deedly's behalf.
4. The golden-record database is never accessed directly — everything goes over HTTP to the entities service.

Consequently no `X-Accountable-Institution-Id` header exists or is sent, and the §4 header-based request contract is superseded by the two-call recipe below. Visibility is asserted through the users service, which owns the client ↔ accountable-institution linkage.

### 8.1 Connectivity

| Setting | Value | Notes |
|---------|-------|-------|
| `LEGITIFY_API_BASE_URL` | nginx gateway base URL (local `http://localhost:8000`, staging `https://staging-api.legitify.co.za`, production `https://api.legitify.co.za`) | Replaces `ENTITIES_SERVICE_URL`. Both the entities and users services are reached through the gateway. |
| `SECRET_KEY` | platform `X-Service-Key` | Delivered out-of-band (AWS Secrets Manager / Clive). Distinct from `JWT_SECRET`. Server-side only: excluded from `Settings.__repr__`; never in the SPA bundle, never in `VITE_*` / `NEXT_PUBLIC_*`, never in logs. |

Per guide §9, a single client — `python_server/clients/entities.py` (`EntitiesClient`) — issues every Legitify call, so in-cluster absorption only changes configuration to service DNS. The service key bypasses all upstream authorization, so the client **never** decides visibility; it only transports requests and categorises failures.

⚠ Staging uses real provider credentials: a person/company submit on staging can trigger billable ThisIsMe/Loom/CIPC calls. Prefer local dev for iteration.

### 8.2 Visibility recipe (`python_server/services/golden_record_visibility.py`)

`resolve_visible_golden_record(client, golden_record_id, accountable_institution_id, expected_entity_type)` runs these steps in this order and never any other:

```text
0. Inputs are validated locally: golden_record_id must be a UUID, accountable_institution_id a
   positive integer (derived from the authorised transfer row, never from the request body),
   expected_entity_type one of {person, company, trust}. Nothing is sent otherwise.
1. GET /api/v1/users/clients/s2s/by-golden-record/{gr}?accountable_institution_id={ai}
     404  -> reason "not_visible"  (unknown GR or not a client of this AI; deliberately
             indistinguishable). Fail closed. The entities call is NOT made.
     5xx / timeout / network / other non-2xx -> reason "upstream_unavailable".
     200 with a non-object payload -> reason "invalid_response".
2. GET /api/v1/entities/{gr}?entity_type={expected}   (only after step 1 succeeded)
     404  -> reason "type_mismatch_or_missing" (the service defaults to person and 404s on
             a type mismatch). Fail closed.
     200  -> the record must echo the requested id and entity_type (otherwise
             "invalid_response" / "type_mismatch_or_missing") and must be usable:
             is_active != false, is_deleted != true, deleted_at is null, status not in
             {inactive, deleted, archived} (otherwise reason "inactive").
```

There is no fallback to an unscoped lookup and no retry with a different scope. No database transaction may be open while either call is in flight.

**Two traps the guide calls out, both avoided by construction:**

- **`tenant_id` equality is not a visibility test.** A record fetched in step 2 carries a `tenant_id`, but Golden Records are shared across tenants by design — the same person can be a client of many accountable institutions. The linkage endpoint exists precisely to avoid this trap. `resolve_visible_golden_record` never reads `tenant_id`, and it is not persisted.
- **Linkage is asserted through `users.clients`** — "this Golden Record is a client of this AI". That is the correct test for conveyancing parties (buyers, sellers, deceased estates, trustees). It will **not** match staff members or Golden Records that exist only as transaction related-parties. If a legitimate Deedly flow ever needs one of those, raise it upstream rather than widening the check.

### 8.3 Error mapping (`GoldenRecordVisibilityError`)

| `reason` | `is_rejection` | Route status | Public message |
|----------|----------------|--------------|----------------|
| `not_visible`, `type_mismatch_or_missing`, `inactive` | yes | `400` | `Unknown or inaccessible Golden Record` |
| `upstream_unavailable`, `invalid_response` | no | `503` | `Golden Record service unavailable` |

Upstream failures are never reported as a tenant decision, and rejections never reveal which of the three rejection reasons applied. `operation` and `status_code` are retained on the exception for server-side logging only.

### 8.4 Client transport semantics (`EntitiesClient`)

Timeouts (guide §3.3) — 5 s connect throughout:

| Call | Guide band | Implemented |
|------|-----------|-------------|
| Reads: `get_entity`, `search_entities`, clients linkage | 5–10 s | 10 s read |
| Person submit (live provider lookups) | 30 s | 30 s read |
| Company / trust submit (CIPC + ThisIsMe + director cascade) | 120–180 s | **not implemented** — see §8.6 |

- Retries: only on 5xx responses and transport timeouts/network errors, with exponential backoff (0.25 s base). Reads get 3 attempts, submits 2. **Any 4xx, including the tenant-safe 404, is returned immediately and never retried**, so a scoped lookup can never be re-issued differently.
- Response envelope (guide §3.4): every response is `{"message": ..., "data": ...}`, empty `data` is `[]` rather than null, there is no `status`/`status_code` key in the body, and validation errors add `"errors": {field: [msgs]}`. A missing `data` key is treated as malformed rather than as an empty result.
- `EntityServiceError` carries `operation`, `status_code`, `category` (`not_found`, `validation_error`, `http_error`, `timeout`, `network`, `malformed_json`, `missing_data_envelope`) and, for 422s, the offending field names only. Response bodies are never retained.
- `entity_type` is always sent on retrieval, including for persons, and accepts `person`, `company` and `trust`.
- Search results are unscoped by tenant and are never treated as proof of visibility.

### 8.5 Persistence boundary (`python_server/services/transfer_party_service.py`)

`link_party_to_transfer` is the only entrypoint that accepts a caller-supplied `golden_record_id`:

```text
1. Read accountable_institution_id from the parent transfers row (TransferPartyServiceError if missing).
2. resolve_visible_golden_record(...) with that tenant — no transaction open.
3. Open a short transaction: re-read the parent row, abort with "Parent transfer tenant changed"
   if the tenant differs or the row is gone, then insert_transfer_party(...).
```

Only `golden_record_id` and the display cache derived from the fetched record (`cached_name`, `cached_id_number`, `cached_email`, `synced_at`) are stored. `attach_party_to_transfer` remains the persistence-only step for already-validated records and performs no upstream call. The repository layer has no dependency on the client.

### 8.6 Cache freshness (guide §8)

An externally-hosted Deedly cannot consume the platform's Redis Streams event bus, and partner webhooks currently forward no `entity.*` events. Until absorption in-cluster, freshness is polled:

| Guide obligation | Status |
|------------------|--------|
| **Fetch-after-create, always** — never cache display fields from a submit or search response; fetch with `GET /entities/{gr}` and cache from that | **Satisfied by construction.** `DisplayCache` is only ever derived from a `resolve_visible_golden_record` result, whose sole source is `get_entity`. `submit_person` and `search_entities` results are never persisted. |
| **Refresh on read where staleness matters** (party detail / compliance views); list views may serve the cache | `refresh_party_cache_from_golden_record` re-runs the full visibility recipe using the stored row's own tenant and entity type, then refreshes only the cache. No route calls it yet, and no `synced_at` TTL comparison exists. |
| **On-demand re-verification** via `POST /entities/resubmit` or `profiles/{slug}/run` with `force_refresh: true` (billable) | Not implemented; no consumer. |

### 8.7 Still outstanding

| Item | Status |
|------|--------|
| `POST /v1/transfers/{id}/estate-contexts` and `POST /v1/transfers/{id}/representative-assignments` (§2.6, §6) | Not implemented. They must call `resolve_visible_golden_record` with `expected_entity_type="person"` after `_authorize_transfer`, following §8.5's ordering. |
| Company / trust submit (120–180 s budget) | **Blocked.** The request shapes live in `transfers_golden_record_providers_auth.md` §2.4–§2.6, which this repository does not have. `EntityReconciliationService.reconcile_company` still raises "submit contract not defined". No consumer needs it yet. |
| `X-Correlation-Id` | Not sent. Guide §3.7: upstream neither echoes nor logs it, so this is optional rather than outstanding. |
| Route-level staleness policy (TTL on `synced_at`) | Not defined; see §8.6. |
| `entity.*` events | Unavailable to an externally-hosted Deedly. If prompt reaction to `entity.screening_completed` / `entity.vital_status_deceased` becomes necessary, request that the notifications service add them to partner-webhook `SUPPORTED_EVENTS` rather than building a workaround. |

### 8.8 Certification

Unit coverage lives in `python_server/tests/`: `test_s2s_integration_contract.py` (guide conformance against a simulated gateway), `test_clients_entities.py`, `test_golden_record_visibility.py`, `test_transfer_parties.py`, `test_config.py`, `test_db.py` and `test_entity_reconciliation.py`. Run with `python -m unittest discover -s tests -t . -p "test_*.py"` from `python_server/`.

`test_s2s_integration_contract.py` drives the real client and visibility service through `httpx.MockTransport`, asserting the emitted paths, query parameters and headers. Its simulator answers an unfiltered linkage lookup with `422 UNSCOPED LOOKUP` and any unsanctioned path with `404 UNSANCTIONED PATH`, so a regression that widens the lookup fails loudly rather than silently passing.

The DB-backed suites (`test_v1_transfers.py`, `test_v1_specialist_contexts.py`, `test_migrations_0xx.py`) require `TEST_DATABASE_URL` pointing at a migration-020 baseline and are skipped otherwise.
