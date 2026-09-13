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

## AI/institution security boundaries and safe verification

- Legacy transfer, milestone, document, document-template, local-profile and address
  routers are quarantined in both servers. The Accounts router is quarantined under
  both `/api/accounts` and `/api/v1/accounts`. Missing/invalid JWT context returns
  401; verified callers receive 503 before any legacy handler, cache, DB or provider
  operation. Restoring these paths requires an approved authenticated contract,
  not simply removing the quarantine dependency/middleware.
- Only roles 1 and 6 have the documented cross-institution matter-access exception;
  institution ID 1 is not a privileged role. Other callers require their verified
  institution, including clients who must additionally prove GR party membership.
  Standalone GR discovery/retrieval keeps its existing linkage-scoped projection;
  no charging trigger or new entitlement policy is enabled.
- Accounts browser requests no longer use institution-unscoped memory/localStorage
  fallbacks or claim offline saves succeeded. Existing legacy browser storage is
  not automatically deleted; restoration/data recovery needs an approved decision.
- `server/tests/aiTenantSecurity.test.ts` uses guarded DB mocks and loopback HTTP.
  Do not run `server/tests/v1SpecialistRoutes.test.ts` against ordinary environment
  configuration: it seeds/deletes rows and does not guard on `TEST_DATABASE_URL`.
  It needs an explicitly approved isolated database.
- The standard server type check retains the existing TS6059 shared-source
  `rootDir` issue. A non-emitting check with `--rootDir .` covers those sources
  without changing project configuration. Baseline `84c0269` also has 11 mypy
  errors in `db.py` and `routers/v1/transfers.py`; distinguish these from the
  independently checked auth, policy and internal-link modules.

Focused security checks (repo root unless stated otherwise):

```powershell
npx tsx --test server/tests/aiTenantSecurity.test.ts server/tests/v1GoldenRecordSearch.test.ts
npx tsx --test src/lib/api/accountsApi.test.ts src/components/GoldenRecordsSearch.test.tsx
npx tsc --noEmit
npx tsc -p server/tsconfig.tests.json --noEmit --rootDir .
```

From `python_server/`, without an upstream service or database:

```powershell
python -m pytest -q -rs -p no:cacheprovider tests/test_auth.py tests/test_policy.py tests/test_ai_tenant_security.py tests/test_transfer_parties.py
python -m mypy --follow-imports=silent --ignore-missing-imports --no-incremental --cache-dir=nul auth/current_user.py auth/jwt.py auth/policy.py auth/dependencies.py services/transfer_party_service.py main.py
```

## P0 review handover: discovery, authority and restoration

- **P0 discovery-contract blocker:** the available upstream snapshot's
  `docs/deedly_external_integration.md` section 4 explicitly requires the clients
  linkage check on each search candidate before exposing it. Current DEEDLY search
  consequently does not expose records unlinked to the requesting AI, even as
  limited results. Global S2S search capability is not evidence of an approved
  end-user unlinked-discovery entitlement or field mask. Obtain that contract and
  deployed evidence from Clive/Louis before changing this boundary; do not describe
  unlinked discovery as implemented. Canonical retrieval stays linkage-gated.
- Discovery creates no linkage and enables no charging trigger. The source search
  path reads repositories/serializers; submit, resubmit and provider/profile runs
  are separate. Deployed discovery/billing behaviour remains unverified.
- **Documented role authority:** upstream
  `docs/transfers_golden_record_providers_auth.md` sections 4.3 and 5.5 name role 1
  (Super Admin) and role 6 (Admin Agent) as cross-institution by design; everyone
  else is locked to their JWT AI, with additional GR membership for clients.
  This exception does not bypass abilities or standalone GR linkage checks.
  `test_policy.py`, `test_ai_tenant_security.py` and `aiTenantSecurity.test.ts`
  cover privileged roles and ordinary/client users, including ID/scope tampering.
- **P0 legacy restoration:** authenticated matter saving and durable GR attachment,
  documents, profiles, templates, Accounts and address-provider controls remain
  separate work. Do not restore handlers merely by removing quarantine.
- **P0 infrastructure:** browser JWT integration, external-ingress/key-rotation
  HOLD, verified DB TLS/CA configuration, isolated PostgreSQL verification and
  deployment proxy/artifact/logging checks remain open. The current DB clients
  still disable certificate verification; this branch does not change that config.
- **P1 baseline typing debt:** the existing TS6059 server `rootDir` failure and 11
  mypy errors in `db.py`/`routers/v1/transfers.py` are separate from introduced
  issues. Do not relax checks or change security controls to hide them.
- Parent Create remains **P0 blocked/incomplete pending D1–D6**. Louis's charging
  decision, name/DOB decisions and matter/file-reference lookup are not implemented
  by this security branch.

### Quarantine UI handling — P0 functional states applied

Source-level audit of currently routed screens (not live browser certification).
Functional failure states are P0 release requirements; the shared
`UnavailableNotice` + `serviceUnavailableMessage` (`src/components/ui`,
`src/lib/api/serviceStatus.ts`) provide status-only messaging:

| Screen | Quarantine failure presentation |
|---|---|
| `/accounts`, `/calculators` | Explicit unavailable alert; no default figures/actions before settings load. |
| Transfer milestones: Accounts tab | Explicit unavailable alert; stale request/statement state discarded. |
| `/settings`: Firm Accounts tab | Spinner only while loading; after failure an explicit unavailable notice replaces it. |
| `/settings`: Profile tab | Explicit unavailable notice; form and save are removed until a profile loads. |
| `/dashboard` | Explicit unavailable notice; stat cards show `—` instead of misleading zeros; recent-cases failure is stated. |
| `/cases` | Explicit unavailable notice; case table hidden on failure; New Case disabled. |
| `/transfers` (dashboard) | Explicit unavailable notice; stat cards show `—`; list shows "no data available" instead of an empty-results state. |
| `/transfers/workflow` (`/transfers/new`, edit) | One-shot `GET /api/transfers?limit=1` probe disables Save Draft/Submit Transfer up front and shows an unavailable notice; save handlers no-op while persistence is down. Step document uploads/catalogue add are disabled with a notice; per-item failures remain inline. |
| Workflow: property/address lookup | Address provider failures show a friendly unavailable message; manual address entry stays usable. |
| `/transfers/:transferId/milestones` | Transfer/milestone/activity failures surface as unavailable notices; milestone tab hides seed data and editing on failure; failed saves roll back local milestone edits and add no audit entries; summary fields show `—` when no transfer loaded. |
| Transfer milestones: Documents tab | Load failures show unavailable notices; document list, upload/replace and catalogue-add controls are hidden/disabled on failure. |
| `/documents` | Load failure shows an unavailable notice instead of "No documents found"; upload is disabled; totals show `—`. |
| `/document-catalogue`, `/clause-library` | Load failure shows an unavailable notice and bundled sample entries are labeled as non-live reference data; add forms are disabled while offline. |
| `/data-dictionary`, `/template-engine` | Same labeled sample-data fallback; generation stays a local-only preview with a notice that nothing is saved. |
| `/document-generator` | Clause-library failure shows a labeled sample-data notice; history failures surface as unavailable; generated files are stated to be local-only and audit-record save failures are reported. |
| `/transfers/new` | GR APIs are not quarantined; browser JWT integration blocks live use and downstream saving is quarantined (Save/Submit disabled by the probe above). |

`/bonds` and `/cancellations` are currently placeholders with no affected API calls.
Remaining P1 items are cosmetic only (wording, retry controls, iconography). The
unavailable states above do not certify that quarantined workflows work — the
routes stay quarantined until approved authenticated contracts exist.

### P0 PostgreSQL verification prerequisite

`python_server/tests/test_transfer_party_postgres.py` prepares 12 PostgreSQL cases
plus two no-DB guard tests. The real-DB cases require both `TEST_DATABASE_URL` and
`RUN_ISOLATED_SECURITY_DB_TESTS=1`; neither the flag nor a DSN alone proves approval
or isolation. They must not run without explicit approval of an isolated database
and the following test-owned lifecycle:

- PostgreSQL 13+; CREATE/DROP permissions for random
  `deedly_security_test_<uuid>` schemas, with synthetic data only.
- Separate sessions exercise the production query/repository/transaction code;
  barriers and `pg_blocking_pids` verify blocking rather than relying on sleeps.
- Covers link idempotency/rollback, tenant changes during visibility, parent locks
  held until insert commit, cache-only refresh, concurrent GR/type/parent/AI
  changes, and parent/party locks held until cache update commit.
- Uses minimal transfer/party tables in its own search path; it does not apply or
  certify production migrations, full constraints or upstream entitlements.
- Visibility/Entities calls are mocked. Only the operator-approved isolated DSN
  is used; application DSNs are never a fallback. Cleanup drops only the freshly
  created scratch schema, after cancelling tasks and releasing connections.

This review found `TEST_DATABASE_URL` unset: no PostgreSQL connection or DDL was
attempted. To collect/run the guards safely without opting in, from `python_server/`:

```powershell
python -m pytest -q -rs -p no:cacheprovider tests/test_transfer_party_postgres.py
```

Configure the isolated DSN securely and set the opt-in flag only after the above
specific approval. Skipped PostgreSQL cases are a P0 prerequisite, not certification.
