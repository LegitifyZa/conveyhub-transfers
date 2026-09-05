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

- Person search implemented end-to-end (tenant-safe: search → candidate ids →
  linkage visibility → typed fetch → visible results only).
- Company/trust return a controlled `unsupported` result; **blocked on the
  upstream search payload contract from Clive** — do not guess payloads.
- Browser-side JWT issuance/storage/`Authorization` header wiring is deferred
  to the separate **Authentication, RBAC & Tenant Security** project. No fake
  tokens, service keys, or auth bypasses may be added in the interim.

## Useful commands

```powershell
# Python tests (from python_server/)
python -m unittest tests.<module>

# Node route tests
npx tsx --test server/tests/<file>.test.ts

# Typecheck (note: pre-existing TS6059 rootDir error on
# server/utils/conveyancingAccounts.ts is unrelated to current work)
npx tsc --noEmit
npm run typecheck:server
```
