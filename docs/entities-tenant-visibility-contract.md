# Entities Tenant-Scoped Golden Record Visibility Contract

**Branch:** `deedly-v1-create`  
**Date:** 2026-08-31  
**Scope:** Design and integration contract only — no implementation, no simulation of the external Entities service.  

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

| # | Requirement | Rationale |
|---|-------------|-----------|
| 3.1 | **Service-to-service authentication** | The endpoint must reject requests without a valid `X-Service-Key` (or equivalent mTLS/token). |
| 3.2 | **Explicit accountable-institution scope** | The caller must supply the tenant whose visibility is being asserted. The service must not infer it from the service key. |
| 3.3 | **Lookup by Golden Record ID and expected entity type** | The contract must accept `entity_id` and `entity_type` so ConveyHub can verify the record is the kind of entity it intends to use. |
| 3.4 | **Actual visibility enforcement within Entities** | The service must consult its own tenancy/permission model and return a negative result when the GR is not linked to the supplied `accountable_institution_id`. |
| 3.5 | **Tenant-safe not-found behaviour** | The service must return a 404 (or 403) for both (a) unknown GRs and (b) GRs not visible to the tenant. ConveyHub must not be able to distinguish between the two cases. |
| 3.6 | **No fallback to unscoped global lookup** | The endpoint must never fall back to a global search when the scoped lookup returns no match. |
| 3.7 | **Audit and correlation metadata** | The endpoint must accept a `X-Correlation-Id` header and include it in audit logs so cross-service debugging is possible without exposing PII. |

## 4. Short-term request contract

Until a more complete Graph/REST API is available, ConveyHub and Entities should implement the following minimal contract.

### 4.1 Request

```http
GET /api/v1/entities/{entity_id}?entity_type=person HTTP/1.1
Host: entities.legitify.internal
X-Service-Key: <conveyhub-service-credential>
X-Accountable-Institution-Id: <authorised-transfer-tenant-id>
X-Correlation-Id: <uuid-or-trace-id>
```

Query parameters:

| Parameter | Required | Allowed values | Notes |
|-----------|----------|----------------|-------|
| `entity_id` | Yes | UUID | The Golden Record identifier the transfer wants to reference. |
| `entity_type` | Yes | `person`, `company`, `trust` | ConveyHub must supply the type it expects to find. The service must validate that the GR matches this type. |

Headers:

| Header | Required | Notes |
|--------|----------|-------|
| `X-Service-Key` | Yes | Service-to-service credential. Must be rotated and stored in the existing `SECRET_KEY` / `ENTITIES_SERVICE_URL` configuration path. |
| `X-Accountable-Institution-Id` | Yes | The `accountable_institution_id` of the ConveyHub transfer, not the caller's user AI or any other tenant. |
| `X-Correlation-Id` | Recommended | UUID or trace ID. The Entities service should return it in the response and include it in logs. |

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
| 5.2 | Use the transfer's `accountable_institution_id`, not the caller's `user.accountable_institution_id` and not the JWT tenant, as `X-Accountable-Institution-Id`. | Route handler before the Entities request. |
| 5.3 | Validate `entity_type` against an allow-list (`person` for `deceased_golden_record_id` and `person_golden_record_id`; `trust` only when a trust party exists). | Route handler before the request. |
| 5.4 | Generate and forward an `X-Correlation-Id` for every request. | Client wrapper or request helper. |
| 5.5 | Treat any `404` from Entities as a denial; never retry with a different scope or fall back to an unscoped call. | Client wrapper. |
| 5.6 | Keep the Entities call outside any database transaction. | Route handler transaction order. |

## 6. Route implementation guardrails (when the contract is available)

When the Entities endpoint supports the contract above, the deferred POST routes should be implemented in this order:

```text
1. Authenticate/authorize transfer (existing pattern).
2. Determine the transfer's accountable_institution_id and transfer_id.
3. Call the Entities tenant-scoped lookup with:
     entity_id      = supplied Golden Record
     entity_type    = expected type
     X-Accountable-Institution-Id = transfer.accountable_institution_id
4. If Entities returns 200 and entity_type/is_active match, proceed.
5. If Entities returns 404/403/422, return 400 to the caller.
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

1. Does the Entities service require `X-Accountable-Institution-Id` as an integer or as a string UUID?
2. Should `X-Tenant-Id` (the JWT `tenant_id` claim) also be forwarded for audit correlation, or is `X-Accountable-Institution-Id` sufficient?
3. Are there rate limits or circuit-breaker expectations for the scoped lookup?
4. Is a bulk visibility check (multiple GRs at once) preferable for routes that may reference several GRs?
5. What PII fields, if any, are permitted in the `200` response body for ConveyHub to consume?
