# LegitifyConveyHub — agent notes

## Runtime: two API servers, distinct ports required for local E2E

This repo runs two API servers against the same database:

- **Node Express BFF** (`server/`) — browser-facing. The Vite dev proxy sends
  all `/api` traffic here (`VITE_API_PORT`/`PORT`).
- **DEEDLY FastAPI service** (`python_server/`) — owns the routes that need the
  Legitify S2S lane (Golden Record visibility flow, specialist writes, Golden
  Record search).

**Both read `PORT`** (`server/index.ts` and `python_server/config.py`). To run
them together for E2E testing they MUST use distinct ports, e.g. Node on
`PORT=3000` and FastAPI on `PORT=3100`, with the Node server configured with:

```text
DEEDLY_API_BASE_URL=http://localhost:3100
```

so the auth-forwarding BFF proxy `POST /api/v1/golden-records/search` can reach
FastAPI. See `server/routes/v1/goldenRecords.ts`.

## Golden Record Search / Retrieve status

Search and Retrieve are completed on `main` at the accepted checkpoint
`7d8101c4928238d555b9c958241adbac6a6c3b24`. This status does not certify live
browser authentication or a deployed upstream contract.

- Person, company, and trust search implemented end-to-end (tenant-safe: search
  → candidate ids → linkage visibility → typed fetch → visible results only).
- DEEDLY sends the upstream generic `query` payload and `entity_type:
  person|company|trust`; trust search uses `entity_type=trust` and canonical
  trust retrieval uses `entity_type=company`.
- Browser-side JWT issuance/storage/`Authorization` header wiring is deferred
  to the separate **Authentication, RBAC & Tenant Security** project. No fake
  tokens, service keys, or auth bypasses may be added in the interim.

## Useful commands

```powershell
# Python tests (from python_server/)
python -m unittest tests.<module>
# Full regression (set ENTITIES_SOURCE_ROOT to run landed contract tests)
$env:ENTITIES_SOURCE_ROOT = "D:\WORK\Legitify\Projects\legitify-be-main\legitify-be-main"
python -m unittest discover -s tests -p 'test_*.py'

# Node route tests
npx tsx --test server/tests/<file>.test.ts
npx tsx --test src/components/GoldenRecordsSearch.test.tsx

# Typecheck (note: pre-existing TS6059 rootDir error on
# server/utils/conveyancingAccounts.ts is unrelated to current work)
npx tsc --noEmit
npm run typecheck:server
```

## Golden Record retrieval P0

- `GET /api/v1/golden-records/{uuid}?entity_type=person|company|trust` uses the
  authenticated Node BFF → FastAPI path. FastAPI requires `transfers:read`, denies
  client-role access, and derives the linkage AI from the verified user.
- Every retrieval rechecks AI linkage before the canonical Entities GET. Trust
  retrieval remains company-style upstream with strict trust classification.
  The detail projection is transient; retrieval performs no DB writes and does
  not expand the persistent display cache.
- Browser JWT wiring remains an external Authentication-project blocker. The
  upstream `docs/deedly_external_integration.md` also contains an unresolved
  external-ingress/key-rotation HOLD. Do not bypass either dependency or claim
  live browser/S2S certification from mock-transport tests.
- The configured Entities source directory is a snapshot without Git metadata;
  executing its contract tests does not attest an upstream or deployed SHA.

For full Python verification, from `python_server/`, set `ENTITIES_SOURCE_ROOT`
(as above) and run `python -m pytest -q -rs -p no:cacheprovider tests`. Unlike
unittest discovery, pytest executes the function-based landed-source contracts.
DB-dependent tests require `TEST_DATABASE_URL`; an unset value means skipped
DB integration coverage, not a successful database certification.

## Create Golden Record foundation — slices A/B only

- `python_server/clients/entity_submissions.py` contains typed, side-effect-free
  request adapters and a response-reference parser. They are not wired into
  `EntitiesClient.submit_person`, a route, or the UI. Runtime submit payloads,
  returns, timeouts and retries remain unchanged.
- Shared definitions/decoding live in configuration-free `clients.entity_protocol`.
  Adapters do not import the runtime client or configuration. The client re-exports
  the same exception/type objects and delegates decoding, retaining its existing
  configuration bootstrap. Fresh-process tests install import/dotenv/HTTP-client
  guards before importing adapters; call-time no-I/O guards remain in place.
- Request checks cover source structure, not approved P0 business requirements.
  Person requests use `id_number`; there is no passport-pair adapter. The existing
  client's unused passport transport remains unchanged. Trust requests require
  an explicit office and preserve leading zeros during source-matched normalization.
- A parsed `SubmissionReference` contains only UUID and logical type. It is not
  evidence of a newly created, verified, visible or registered record. A 409 is
  an error, never authorization. Canonical details still require the existing
  linkage-before-fetch workflow; no submit display data may become a cache.
- The upstream `SubmitClientRequest`, submit route, serializers, trust utilities
  and passport limitations are exercised through the existing landed-source
  test harness using `ENTITIES_SOURCE_ROOT`. No upstream service is called.
  This snapshot has no Git metadata and is not deployed-contract evidence.
- Parent Create Golden Record remains blocked/incomplete: D1 registration and
  relationship eligibility; D2 AI-to-tenant resolution and write authorization;
  D3 non-prod ingress/credentials/deployed evidence; D4 passport uniqueness;
  D5 deadlines/recovery/verification/billing; D6 approved P0 fields and types.
  Durable matter attachment and authenticated matter saving remain separate P0 work.

Focused Python type checks from `python_server/` (Windows; `nul` disables cache):

```powershell
python -m mypy --follow-imports=silent --ignore-missing-imports --no-incremental --cache-dir=nul clients/entity_protocol.py clients/entities.py clients/entity_submissions.py services/entity_reconciliation.py
python -m mypy --strict --follow-imports=silent --ignore-missing-imports --no-incremental --cache-dir=nul clients/entity_protocol.py clients/entity_submissions.py
```

Adapter/client checks use `tests/test_entity_submissions.py` and
`tests/test_clients_entities.py`. Include `tests/test_landed_entities_search_contract.py`
with `ENTITIES_SOURCE_ROOT` set for executable source-contract coverage. Its SQL
fixtures are synthetic in-memory SQLite, not PostgreSQL migration certification.
