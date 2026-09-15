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
- Browser JWT issuance/storage/`Authorization` header wiring is implemented on
  `deedly/mvp0/auth/production-authentication` (see "Production Authentication"
  below): upstream OTP login via the BFF, in-memory access token, HttpOnly
  refresh cookie. This is mock-tested wiring only — live browser/S2S
  certification still requires the deployed upstream contract evidence below.
  No fake tokens, service keys, or auth bypasses may be added.

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
- Browser JWT wiring is implemented on the auth branch (see below); live use
  remains blocked on the deployed upstream contract and the unresolved
  external-ingress/key-rotation HOLD in upstream
  `docs/deedly_external_integration.md`. Do not bypass either dependency or
  claim live browser/S2S certification from mock-transport tests.
- The configured Entities source directory is a snapshot without Git metadata;
  executing its contract tests does not attest an upstream or deployed SHA.

For full Python verification, from `python_server/`, set `ENTITIES_SOURCE_ROOT`
(as above) and run `python -m pytest -q -rs -p no:cacheprovider tests`. Unlike
unittest discovery, pytest executes the function-based landed-source contracts.
DB-dependent tests require `TEST_DATABASE_URL`; an unset value means skipped
DB integration coverage, not a successful database certification.

## Create Golden Record foundation — superseded by product decision

**Product decision:** DEEDLY does not create Golden Records and does not
register clients in Legitify. DEEDLY supports only (a) searching/retrieving
and linking existing institution-authorised Golden Records and (b) capturing
firm-private manual parties with no Golden Record link. Central Create Golden
Record is cancelled/superseded — it is not blocked awaiting implementation.
The adapter foundation below is completed historical work: the
`entity_submissions.py` adapters are unused by the product flow, while
`clients/entity_protocol.py` remains in live use by the runtime client through
the prior extraction — it is not unused and must not be removed.

- `python_server/clients/entity_submissions.py` contains typed, side-effect-free
  request adapters and a response-reference parser. They are not wired into
  `EntitiesClient.submit_person`, a route, or the UI, and no wiring is planned
  under the cancelled create scope. Runtime submit payloads,
  returns, timeouts and retries remain unchanged.
- Shared definitions/decoding live in configuration-free `clients.entity_protocol`,
  which the runtime client actively uses: it re-exports
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
- Parent Create Golden Record is closed by the product decision above, not by
  resolution of its blockers. Each D-item's create-specific half is superseded;
  its surviving concerns are renamed as follow-ups so nothing is lost:
  - D1 → **Relationship eligibility** — registration orchestration is
    superseded; eligibility of existing firm/client relationships still
    governs Search/Retrieve/Link.
  - D2 → **Institution context** — create-specific context is superseded;
    trusted institution context and read/write authorization remain.
  - D3 → **Live read/link ingress** — submit-specific access is superseded;
    live read/link ingress, credentials and deployed evidence remain (the
    external-ingress/key-rotation HOLD below).
  - D4 → **Passport search concerns** — new-record uniqueness is superseded;
    passport ambiguity, country and changed-number search concerns remain
    tracked.
  - D5 → **Existing-record entitlement** — create-specific submission/recovery
    is superseded; existing-record entitlement, charging and
    verification-display questions remain.
  - D6 → **Manual-party fields** — central-create fields are superseded;
    manual-party field requirements continue in their own workstream.
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

## Production Authentication / Browser JWT Integration

Implemented on `deedly/mvp0/auth/production-authentication` (based on
`c94074ea12f0090ebd6d1c77d524d54ec5396964`). Mock-tested wiring only — live
certification needs the deployed upstream evidence listed below.

### Upstream contract (legitify-be-main snapshot, `services/auth`)

Staff login is OTP-based — never a direct password→token exchange:

1. `POST /api/v1/auth/initiate-login` — `{id_number | passport_number,
   password, user_id?}`. Exactly one identifier; `user_id` disambiguates
   multiple accounts (including two accounts at the same institution). On
   success returns `{message, data:{user_id, requires_otp:true}}`; when several
   accounts match it returns `data.accounts[]` (each with `user_id`,
   `accountable_institution_id/_name`, `role_id/_name`) and
   `requires_otp:false`. It does NOT send the OTP.
2. `POST /api/v1/auth/otp` — `{user_id, delivery_method?: CELL|EMAIL|BOTH}`
   generates+sends the OTP; returns `data:{confirmation_pin}` (anti-phishing;
   `dev_otp` is included only when upstream `app_debug` is on).
3. `POST /api/v1/auth/login` — `{user_id, otp:int 6-digit}` →
   `data:{user, client, popia_consent, answered_onboarding_questions, token,
   expires:int unix ts, refresh_token}`.
4. `POST /api/v1/auth/refresh` — `{refresh_token}` → `data:{token, expires}`.
   Refresh tokens are stateless and NOT rotated; no server-side revocation
   exists (upstream issue notes a blacklist may come later). Logout does not
   revoke the refresh token upstream.
5. `POST /api/v1/auth/logout` — requires Bearer with `api` ability; burns any
   active OTP. Client login (`/client-login`, role 4 OTP-only, no password) is
   a separate upstream flow and out of scope for the staff slice.

Token claims: access JWT `HS256` shared `JWT_SECRET`, `type=access`, `iat`,
`exp` (default 24h), `user_id`, `golden_record_id`, `abilities`,
`accountable_institution_id`, `user_roles_id`, `tenant_id`. Refresh JWT
`type=refresh`, `user_id` only, 30-day default. No `iss`/`aud` validation in
the inspected shared JWT helper. Envelope everywhere: `{message, data,
errors?}` — no `success` field.

### Session design

- **Access token: browser memory only** (`src/lib/api/session.ts`) — never
  localStorage/sessionStorage. `apiRequest` attaches it as
  `Authorization: Bearer` on BFF routes; the BFF verifies it and forwards it
  unchanged to FastAPI on proxied routes, so claims are server-verified per
  request. On 401, `apiRequest` makes one refresh attempt and retries once —
  and only while the session's sid is unchanged, so an in-flight write is
  never replayed under a different user/institution (institution-scoped
  `client_request_id` keys alone would not catch that).
- **Refresh credential: sid-bound cookie pair.** On login the BFF generates a
  per-login session id and sets `deedly_refresh=<sid>.<refresh_token>`
  (HttpOnly, `Path=/api/auth`) plus `deedly_sid=<sid>` (readable, `Path=/` —
  `document.cookie` is only visible under the cookie's path, and every SPA
  route must read it for post-reload restore). Both `Secure; SameSite=Strict`.
  `/refresh` requires the client to echo the sid via `X-Deedly-Session`
  (double-submit); it **never emits Set-Cookie**, so a late refresh response
  can never create, overwrite or clear a cookie. `/logout` clears the pair
  **only when the presented sid matches the cookie's**, so a logout for
  session A cannot strip session B's cookie, and it responds without waiting
  on upstream (upstream logout is fire-and-forget) to keep the in-flight
  clear window small.
- **Serialized auth operations, including across tabs — Web Locks required.**
  Login-complete, refresh and logout run through one promise queue
  (`enqueueAuthOp`) wrapped in the Web Locks mutex `deedly-auth`: a tab holds
  the lock for its whole request/response window, so a delayed logout/login
  Set-Cookie in one tab cannot interleave with another tab's auth operation —
  the BFF's request-time sid check stays effective and Set-Cookie ordering
  follows operation order. **Without `navigator.locks` the browser is
  unsupported**: `enqueueAuthOp` rejects, refresh fails closed (clears the
  session, fires no request), login cannot be completed, and the Login page
  shows an unsupported-browser message. `logoutSession` still performs
  immediate local teardown (memory clear + readable-cookie hygiene) but sends
  no cookie-changing request.
- **Logout semantics under interleaving.** `logoutSession` clears local state
  immediately and bumps a `logoutEpoch` tombstone: refresh/login ops capture
  the epoch at call time and discard their result if a logout was requested
  while they were queued or in flight — logout always wins over a pending
  login/refresh. The logout's BFF request presents the sid it may
  legitimately end: the call-time session sid, or the jar sid when this tab's
  own auth pipeline installed it (`tabSessionSids`, including login responses
  discarded by the tombstone whose Set-Cookie still landed). A foreign sid —
  a newer login from another tab — is never presented and survives. Limit:
  the guarantee covers cooperating app tabs; code outside the app's auth path
  (any same-origin page can issue uncoordinated requests) is outside it —
  same-origin JS is already trusted with the in-memory token.
- **BFF auth proxy** (`server/routes/auth.ts`, mounted at `/api/auth`):
  `initiate-login`, `otp`, `login`, `refresh`, `logout`. `login` strips
  `refresh_token`/`refresh_expires`/`dev_otp` from the browser-visible body
  and verifies the issued access token against the BFF's own JWT checks (so
  retired/unknown roles fail closed at session creation). `refresh` applies
  the same claim verification to the returned access token before relaying it.
  `otp` strips `dev_otp` — upstream debug OTPs are never exposed through
  DEEDLY. `logout` forwards the Bearer token upstream best-effort. Input is
  validated at the BFF before any upstream call; upstream 5xx/unreachable/
  unset `LEGITIFY_API_BASE_URL` → generic 503.
- **Session transitions** clear the legacy `legitify_auth` prototype flag and
  notify `onSessionChange` listeners; the app holds no other user/institution-
  scoped caches (accounts reads are `no-store`; `darkMode` is cosmetic).
- `RequireAuth` waits for the silent refresh attempt (`isRestoring`) before
  redirecting, so a page reload with a valid cookie pair restores the session
  instead of bouncing to `/login`.

### Cookie / CSRF / hosting requirements

- **Explicit origin guard before any upstream activity** (router-level
  middleware): `Sec-Fetch-Site: cross-site` → 403; a present `Origin` must
  match `AUTH_ALLOWED_ORIGINS` (comma-separated exact list) when configured,
  else the request `Host` — the supported same-origin `/api` deployment — or
  a loopback origin outside production (Vite dev proxy). A **missing** Origin
  does not establish trust: `Sec-Fetch-Site: same-origin`/`none` attests
  provenance on its own; otherwise only requests carrying no `Cookie` header
  (non-browser probes with no ambient authority) pass — a cookie-bearing
  request with no origin evidence is an ambiguous browser and gets 403. This
  does not rely on CORS or SameSite alone; on top of it sit
  `SameSite=Strict`, no credentialed CORS, and the sid double-submit header.
- Deployment requirement: the BFF must be reachable **same-origin under
  `/api`** from the SPA (as the Vite dev proxy does) and served over HTTPS —
  `Secure` requires it and a cross-site BFF host would break refresh. Do not
  weaken `Secure`/`SameSite`/`Path` or broaden `AUTH_ALLOWED_ORIGINS` to
  accommodate a cross-site deployment.
- The 401 refresh-and-retry reissues the identical serialized request body, so
  `client_request_id` idempotency keys on matter/party creates are preserved
  and replays deduplicate upstream (`(accountable_institution_id,
  client_request_id)` unique index). Our 401s are additionally always raised
  before any handler or upstream call, so no partial write can have occurred,
  and the sid-unchanged gate prevents replay under a newer session entirely.
- Passwords, OTPs and tokens are not logged; BFF 503/400 responses carry no
  upstream detail. Logout clears only the local session — upstream tokens are
  stateless and expire naturally; it is NOT upstream revocation.

### Test evidence (focused, mocked — no upstream contacted)

- `server/tests/authProxy.test.ts` — 31 tests: input validation without
  upstream calls, contract forwarding, account-picker relay, sid-bound cookie
  pair on login (`deedly_refresh` HttpOnly `Path=/api/auth`; `deedly_sid`
  readable `Path=/`), `dev_otp` stripping on `otp`/`login`, local verification
  of issued and refreshed tokens (retired role / wrong signature rejected),
  sid double-submit enforcement and refresh's no-Set-Cookie invariant,
  logout's match-before-clear cookie rule and fire-and-forget upstream
  forwarding, refresh contract-violation 503, explicit
  origin/Sec-Fetch-Site rejection before upstream activity, missing-Origin
  policy (cookie-bearing requests with no origin evidence → 403;
  credential-free probes and `same-origin` metadata pass),
  `AUTH_ALLOWED_ORIGINS` allowlist behaviour incl. same-site entries.
- `src/lib/api/session.test.ts` — 28 tests: Bearer attachment (and its
  exclusion on auth-ingress paths), one-shot refresh+retry on 401, no retry
  loop, failed-refresh session clearing, refresh single-flight, sid-echo on
  refresh incl. post-reload cookie restore, serialized auth-op ordering
  (logout while refresh in flight discards the refresh result, then runs),
  routing through the `deedly-auth` Web Lock, unsupported-browser fail-closed
  (no auth requests fire; local teardown still immediate), logout-epoch
  discard of still-queued refreshes, stale refresh/login responses discarded
  after logout or a newer login, pending writes never replayed under a
  changed session, identical-body write retry preserving
  `client_request_id`, logout Bearer+sid/cleanup under transport failure,
  foreign-sid cookie preservation, session-change notification, legacy flag
  removal, no token persistence to storage.
- **Local browser verification** (Playwright/Chromium + mocked upstream, run
  locally, harness not committed): three processes — mock upstream on :8000
  (minting test JWTs signed with the BFF's `JWT_SECRET`), the real BFF on
  :3001 (`LEGITIFY_API_BASE_URL` → mock), Vite dev server on :5173 proxying
  `/api` same-origin. Scenarios verified: (1) real-UI OTP login →
  `deedly_sid` readable via `document.cookie` on `/transfers` → reload at the
  SPA route restores the session; (2) two tabs sharing one browser context —
  tab1 logout with its **response** held at the network layer (Playwright
  `route.fetch()` then delayed `route.fulfill()`, i.e. a delayed
  Set-Cookie-bearing response, not a delayed request) → tab2 fired zero auth
  requests while the `deedly-auth` lock was held → on release the stale clear
  landed first, tab2's login then established sid-B → reload under sid-B
  restored; (3) uncoordinated raw `fetch` (outside `enqueueAuthOp`) issuing a
  sid-B logout whose held response landed after a sid-C login → sid-C's
  refresh cookie was cleared — the documented residual outside the
  cooperating-tabs guarantee.
- `src/lib/api/accountsApi.test.ts` — updated to the new retry contract (a 401
  may trigger one `/api/auth/refresh` call; auth-flag cleanup is excluded from
  the institution-storage assertions).

### Remaining live-certification dependencies / open questions

- `LEGITIFY_API_BASE_URL` must point at the deployed nginx gateway per
  environment; `JWT_SECRET` must equal the platform's shared signing secret.
  Both are deployment config — unverified here.
- The snapshot has no Git metadata; the deployed auth service's actual
  contract/SHA is unverified. External-ingress/key-rotation HOLD stands.
- OTP delivery requires configured upstream SendGrid/Twilio and an approved
  test account; no live provider calls were made.
- Upstream refresh tokens are non-rotating and non-revoked on logout (upstream
  tracks a blacklist as future work) — accepted limitation of the current
  contract; confirm whether production policy requires revocation.
- `iss`/`aud` claims are neither issued (beyond defaults) nor validated by the
  inspected code — confirm production expectations.
- The upstream `/otp` response shape is `{data:{confirmation_pin,dev_otp?}}`;
  OTP resend rate-limiting upstream is unverified.

## AI/institution security boundaries and safe verification

- Legacy transfer, milestone, document, document-template, local-profile and address
  routers are quarantined in both servers. The Accounts router is quarantined under
  both `/api/accounts` and `/api/v1/accounts`. Missing/invalid JWT context returns
  401; verified callers receive 503 before any legacy handler, cache, DB or provider
  operation. Restoring these paths requires an approved authenticated contract,
  not simply removing the quarantine dependency/middleware.
- Same-institution isolation applies to every caller — approved policy removed
  the former cross-institution exception for privileged roles entirely: no
  role may read, list or mutate another accountable institution's matters or
  child resources, and matter creation is always attributed to the verified
  caller's institution. Institution ID 1 is not a privileged role. Only the
  deployed roles 1–4 can authenticate at all: retired IDs 5/6 and unknown IDs
  are rejected at JWT verification in both servers (see the confirmed role
  authority note below). Clients must
  additionally prove GR party membership. Standalone GR discovery/retrieval
  keeps its existing linkage-scoped projection; no charging trigger or new
  entitlement policy is enabled.
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

- **Party-branch BFF verification (fresh, 2026-09-15):** on exact HEAD
  `2b57f97257cf808f429d54c20f66dbe7944208a5` — clean working tree and local HEAD
  confirmed equal to `origin/deedly/mvp0/parties/manual-and-gr-sources` after
  fetch — fresh runs pass: `npx tsx --test server/tests/v1MatterParties.test.ts
  server/tests/aiTenantSecurity.test.ts server/tests/v1GoldenRecordSearch.test.ts`
  (103/103). Coverage includes the corrected awaited `POST /api/v1/transfers/`
  proxy handler and client-role write denial (matter create and party attach
  denied before any upstream call even with `transfers:write`), plus the GR
  search/retrieval proxy suite. `npx tsc -p server/tsconfig.tests.json --noEmit
  --rootDir .` is clean. `v1SpecialistRoutes.test.ts` was deliberately not run
  (unapproved DB seeding; see the guard above). Python and component results
  from prior sessions are reused evidence, not re-run. Merge order remains the
  corrected `security/review-fixes` first, then the party branch; no merge to
  main, deployment or migrations yet.
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
- **Documented role authority — confirmed:** Clive confirmed the deployed
  platform uses roles 1–4 exactly as the `DEEDLY_Role_CRUD_Permissions`
  workbook lists them: 1 Super Admin, 2 Manager [Compliance Officer],
  3 User [General Staff], 4 Client. The role-ID mapping question, including
  Client = 4, is closed; the upstream six-role
  `docs/transfers_golden_record_providers_auth.md` model is superseded for
  DEEDLY. Product decision: retired roles 5/6 and any unknown role ID have no
  access whatsoever — validly signed tokens carrying them are rejected, never
  remapped, at JWT claim validation in both servers
  (`python_server/auth/jwt.py`, `server/auth/jwt.ts`, `DEPLOYED_ROLE_IDS`), so
  they receive 401 before any protected handler, database or upstream call
  even when the token carries read/write abilities. Previously such tokens
  verified as non-client staff with same-institution access — the gap this
  closes. Per approved product policy, DEEDLY applies same-institution
  isolation to every deployed caller regardless of role: abilities and GR
  party membership still apply, and standalone GR linkage checks are
  unchanged. Scoping never consults `user_roles_id` for privileged
  exceptions. `test_auth.py`, `test_policy.py`,
  `test_ai_tenant_security.py` and `aiTenantSecurity.test.ts` cover deployed,
  retired and unknown roles and ordinary/client users, including ID/scope
  tampering.
- **Test tenant identifiers received** (`Documentation/test data/Test platform
  identifiers.txt`): AI 1 Legitify, 2 Remax Evolve, 3 Rockstar Realty, 4 Kruger
  Attorneys & Conveyancers Inc, 5 QA Sandbox; Legitify and QA Sandbox are
  offered for test use. These are platform test tenants only — they do not
  change the approved same-institution isolation policy or certify any
  production AI assignment.
- **P0 legacy restoration:** authenticated matter saving and durable GR attachment,
  documents, profiles, templates, Accounts and address-provider controls remain
  separate work. Do not restore handlers merely by removing quarantine.
- **P0 infrastructure:** browser JWT integration is implemented on
  `deedly/mvp0/auth/production-authentication` pending live certification;
  external-ingress/key-rotation HOLD, verified DB TLS/CA configuration,
  isolated PostgreSQL verification and deployment proxy/artifact/logging
  checks remain open. The current DB clients still disable certificate
  verification; this branch does not change that config.
- **P1 baseline typing debt:** the existing TS6059 server `rootDir` failure and 11
  mypy errors in `db.py`/`routers/v1/transfers.py` are separate from introduced
  issues. Do not relax checks or change security controls to hide them.
- Parent Create Golden Record is **cancelled by product decision** (DEEDLY does
  not create Golden Records or register clients); D1–D6 are closed as
  superseded, with their surviving concerns carried forward as the named
  follow-ups in the reassessment above. Louis's charging decision, name/DOB
  decisions and matter/file-reference lookup remain open and are not
  implemented by this security branch.

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
| `/transfers/new` | GR APIs are not quarantined; live use awaits deployed upstream auth certification (wiring now exists on the auth branch) and downstream saving is quarantined (Save/Submit disabled by the probe above). |

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
