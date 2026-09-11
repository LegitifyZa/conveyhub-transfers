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

## Golden Record search branch status

Branch `deedly/mvp0/entities-golden-record/golden-record-search` — do not merge.

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
