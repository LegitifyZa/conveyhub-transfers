# DEEDLY Authentication — Non-Production Certification Checklist

**Status:** PREPARATION ONLY. No deployment, live login/OTP/provider call,
database change or migration is authorized by this document. The checklist is
ready to execute once the missing prerequisites in §6 land.

**Basis:** `main` @ `f5c6a338543ca43c5a7b227a82df30214d3e183e` (merge of
`deedly/mvp0/auth/production-authentication`). All code-level evidence below
was produced locally with a mocked upstream; nothing here certifies live
behavior.

**Evidence rules:** capture screenshots, HAR files, and response envelopes
with tokens, OTPs, passwords, ID/passport numbers, names and contact details
redacted. Cookie *attributes* and value *shape* may be shown; never cookie
values. Never paste `JWT_SECRET`, `SECRET_KEY`, or any credential into tickets,
docs, logs or chat.

**Evidence-status qualifiers:**
- DEEDLY previously had Vercel previews; a suitable same-origin HTTPS
  frontend/BFF/FastAPI deployment has **not yet been verified**. Nothing in
  §2 may be treated as satisfied until such a deployment exists. Vercel is
  being replaced; Clive and Dean own the new hosting/configuration — final
  URL, routing and environment readiness remain pending (§6.3).
- The upstream staging endpoint (`staging-api.legitify.co.za`) and the
  staging infrastructure described in `docs/staging-environment.md` of the
  upstream snapshot are **documentation evidence only**. **Owner
  confirmation received 2026-09-16 (Clive):** the supplied OTP/token
  contract is confirmed and user-auth traffic is permitted through the
  staging gateway. This is owner confirmation, **not** executed
  certification; the deployed SHA/version remains outstanding unless
  supplied.

**Confirmed decisions (2026-09-16):**
- OTP/token contract + user-auth staging-gateway permission: confirmed by
  Clive (owner confirmation only; deployed SHA outstanding — §7.1).
- Retired/unknown-role rejection: mocked evidence is retained with the
  live-verification limitation stated; **no** retired-role users will be
  created and **no** ad-hoc live tokens minted (§5.5, §7.6).
- Hosting/configuration: owned by Clive and Dean; Vercel replaced; final
  URL, routing and environment readiness pending (§6.3).
- Disposable staging accounts/matters for two-institution tests: approved
  under a bounded cleanup plan, on an explicitly identified approved
  staging target only — never production or customer data (§5, §6.3).
- Browser policy: supported matrix settled — Chrome/Edge current Stable
  and Extended Stable; Firefox current release and ESR; Safari current and
  previous major; IE11 and Edge Legacy unsupported; other out-of-policy
  browsers get a warning and best-effort support only where mandatory
  security capabilities exist. Web Locks remains mandatory for
  authentication — the per-page fallback is not reintroduced. Record exact
  browser name+version for every executed check (§2).
- OTP policy: routine certification/QA must not send real SMS/email — use
  the local mock or a platform-approved test OTP mechanism. Real delivery
  requires separate explicit E2E approval covering account scope,
  recipients, cost and rollback (§4.4, §7.5).

---

## 1. Scope under certification

Browser → ConveyHub BFF (`server/routes/auth.ts`, mounted at `/api/auth`) →
upstream Legitify auth service (`{LEGITIFY_API_BASE_URL}/api/v1/auth/*`),
plus authenticated API calls carrying the in-memory access token to the BFF
and the DEEDLY FastAPI service (`python_server`, `verify_jwt`).

---

## 2. Checklist — hosting, origins and cookies

Run each browser-dependent check on the supported matrix (Chrome/Edge current
Stable and Extended Stable; Firefox current release and ESR; Safari current and
previous major) and **record the exact browser name and version** in the
evidence for every executed check. IE11 and Edge Legacy are unsupported;
out-of-policy browsers get a warning and best-effort support only where the
mandatory security capabilities (Web Locks) are present — Web Locks remains
mandatory for authentication.

| # | Check | Expected outcome | Evidence |
|---|---|---|---|
| 2.1 | SPA and BFF reachable same-origin under `/api` over HTTPS (e.g. `https://<staging-host>/` and `https://<staging-host>/api/auth/...`) | All auth POSTs are same-origin requests; no cross-site auth traffic | HAR showing request URLs share the SPA origin |
| 2.2 | `AUTH_ALLOWED_ORIGINS` set to the deployed SPA origin (or unset with Origin==Host matching) | Login POST with a forged cross-site `Origin` → 403, **before** any upstream call | Response capture + BFF log showing no upstream hit |
| 2.3 | `Sec-Fetch-Site: cross-site` mutation | 403 | Response capture |
| 2.4 | Cookie-bearing POST with no `Origin` and no `Sec-Fetch-Site` | 403 (ambiguous browser request rejected) | Response capture (curl/scripted) |
| 2.5 | `deedly_refresh` Set-Cookie on login | `HttpOnly; Secure; SameSite=Strict; Path=/api/auth`; value shape `<sid>.<token>` | DevTools cookie table, values redacted |
| 2.6 | `deedly_sid` Set-Cookie on login | `Secure; SameSite=Strict; Path=/`; JS-readable | `document.cookie` on an SPA route shows `deedly_sid` |
| 2.7 | Browser without `navigator.locks` (or Locks disabled) | Login page shows the unsupported-browser message; **zero** `/api/auth/*` requests fire | Screenshot + empty network log |

## 3. Checklist — deployed upstream/auth configuration

| # | Check | Expected outcome | Evidence |
|---|---|---|---|
| 3.1 | `LEGITIFY_API_BASE_URL` set on the BFF to the approved non-prod gateway (`https://staging-api.legitify.co.za` — user-auth traffic permitted per owner confirmation 2026-09-16) | Auth POSTs reach upstream; a deliberately wrong base URL yields 503 `Authentication service unavailable` | Config diff of env var *names only*; 503 capture |
| 3.2 | Deployed auth-service version/contract confirmed equal to the reviewed snapshot (OTP flow: initiate → otp → login → refresh/logout) — **contract confirmed by owner 2026-09-16; deployed SHA/version still outstanding** | Owner supplies deployed SHA or contract version | Written confirmation in ticket |
| 3.3 | `JWT_SECRET` provisioned to **both** BFF and FastAPI via AWS Secrets Manager (never committed/printed) — must equal the auth service's signing secret | Login succeeds and issued tokens verify locally; a tampered-signature token → 401 | Successful login evidence + negative JWT test |
| 3.4 | `dev_otp` never surfaces | `/api/auth/otp` and `/api/auth/login` responses contain no `dev_otp` field even if upstream emits one | Response capture |
| 3.5 | No secrets in logs/errors | BFF/FastAPI logs contain no password, OTP, refresh or access token | Redacted log excerpt |

## 4. Checklist — accounts, OTP and lifecycle (live sequence)

| # | Step | Expected outcome | Evidence | Side effects |
|---|---|---|---|---|
| 4.1 | Initiate login, approved staff test account (single account) | `{user_id, requires_otp}`; **no OTP sent yet** | Redacted response | Upstream audit row |
| 4.2 | Initiate login, multi-account identifier | `data.accounts[]` picker, per-account role/institution | Redacted response | Upstream audit row |
| 4.3 | Wrong password | 401 `Invalid credentials` | Response capture | Upstream failed-attempt counter/audit |
| 4.4 | `POST /api/auth/otp` | Routine runs: OTP obtained via the local mock or a platform-approved test OTP mechanism — **no real SMS/email during certification/QA**. Real delivery is a separate gated run requiring explicit E2E approval (covering account scope, recipients, cost and rollback); only then: OTP delivered via approved channel (CELL/EMAIL); `confirmation_pin` shown in UI | Screenshot + delivery evidence (device/mailbox, code redacted) | Test-OTP path: none. Gated real-delivery run: real SMS/email sent; rate-limit consumption |
| 4.5 | Wrong OTP | 401/400 `Invalid or expired verification code` | Response capture | Upstream failed-OTP counter |
| 4.6 | Correct OTP → `/api/auth/login` | Access token + `sid` in body; cookie pair set; UI lands on `/transfers` | Screenshots + redacted response | Upstream session/audit row; refresh token issued |
| 4.7 | Reload on an SPA route | Silent restore via refresh cookie; stays authenticated | Screen recording | One upstream refresh call |
| 4.8 | Let access token expire / force 401 on a protected call | Transparent refresh+retry; request succeeds once | HAR (token values redacted) | Upstream refresh call |
| 4.9 | Logout | Cookies cleared immediately; `/login` redirect; subsequent `/api/auth/refresh` → 401 | Screenshots + response capture | Fire-and-forget upstream logout |
| 4.10 | Two tabs: hold tab-1 logout response (DevTools request blocking/throttling), tab-2 logs in during the hold | Tab-2 fires **zero** auth requests during hold; on release the stale clear lands first and tab-2's session survives; reload restores tab-2's session | Screen recording + network log | As above |
| 4.11 | After logout, reload | No session resurrection | Screenshot | — |

## 5. Checklist — roles, institution isolation, client-write denial

**Settled policy (recorded, not open):** only role IDs 1–4 are valid; retired
roles 5/6 and unknown role IDs are rejected. **Verification method resolved
2026-09-16:** mocked coverage stands and the live-verification limitation is
stated in evidence — do not create retired-role users or mint ad-hoc tokens
for live testing.

**Correction on write-attempt safety:** a "denied" write check is only
side-effect-free if the control *works*. A failed authorization control would
permit persistence — so every live mutation attempt must target an **approved
disposable fixture** with a **bounded cleanup plan** (pre-approved statements
plus post-run verification that each created row was removed). Never aim a
mutation attempt at a real customer matter.

| # | Check | Method | Expected | Data impact |
|---|---|---|---|---|
| 5.1 | Role-3 staff login and matter read | Disposable institution-A fixture matter | 200, own-institution data only | None (read) |
| 5.2 | Institution isolation (negative) | Role-3 user requests a disposable institution-B fixture matter id | 404 | None (read) |
| 5.3 | Client-role write denial | Role-4 user attempts matter create / party attach **against a disposable fixture** | 403/401 before persistence; cleanup verifies nothing was written — and if the control failed, the fixture (not a real matter) absorbs it | Disposable fixture + bounded cleanup |
| 5.4 | Roles 1–4 login | One approved account per role where available | Each logs in; abilities honored | None (read) |
| 5.5 | Retired/unknown role (5/6) | Mocked evidence retained — **decided 2026-09-16**: no retired-role users created, no ad-hoc live tokens minted; live verification not performed and that limitation is stated in the evidence | 401 at login, no cookie set (mocked coverage proves this) | None |

**Fixture requirements:** approved disposable fixtures — a matter in each of
two test institutions and a role-4 client account — plus a written cleanup
plan (exact removal steps and a post-run verification query per fixture).
**Approved 2026-09-16** subject to: an explicitly identified approved staging
target, the bounded cleanup plan, and no production or customer data.

## 6. Prerequisites

### 6.1 Already available and evidenced (local)

- Merged implementation @ `f5c6a33`: sid-bound cookie pair, double-submit
  refresh, match-before-clear logout, origin/CSRF guard, Web-Locks-required
  client, epoch/ledger stale-response protection, `dev_otp` stripping.
- Tests: 245/245 non-DB suite green; both typechecks clean; mocked-browser
  verification of login/reload/restore/cross-tab races.
- Upstream contract mapped from the landed snapshot + `docs/deedly_external_integration.md`
  (OTP flow, envelope shape, token claims, staging base URLs, Secrets
  Manager channel).
- `.env.example` documents every required env var including
  `AUTH_ALLOWED_ORIGINS`.

### 6.2 Missing configuration/access (requests — §7)

- Non-prod hosting for DEEDLY SPA + BFF (and FastAPI reachability) with
  same-origin `/api` over HTTPS — **owners assigned: Clive and Dean**; Vercel
  is being replaced; final URL, routing and environment readiness pending.
- `LEGITIFY_API_BASE_URL` value + confirmation the auth service is deployed
  there (user-auth traffic permitted per owner confirmation 2026-09-16).
- `JWT_SECRET` for that env, via Secrets Manager/Clive — to **both** BFF and FastAPI.
- `AUTH_ALLOWED_ORIGINS` = the deployed SPA origin.
- Approved staff test accounts: single-account user, multi-account user,
  role-4 client, roles 1–2 coverage; institution assignments; an approved
  second institution's fixture matter for the isolation check.
- A platform-approved test OTP mechanism for staging (routine certification
  must not send real SMS/email). Real-delivery targets are needed only if the
  separate E2E approval for live OTP delivery is granted.
- Deployed auth-service SHA/version — still outstanding; the contract itself
  is owner-confirmed (2026-09-16).

### 6.3 Decisions — status

- **Hosting — owners assigned, readiness pending.** Clive and Dean own the
  new non-production hosting/configuration; Vercel is being replaced. Final
  URL, routing (same-origin `/api` under HTTPS without weakening
  `Secure`/`SameSite=Strict`) and environment readiness remain pending.
- **Disposable fixtures + cleanup — approved with bounds (2026-09-16).**
  Our team may prepare disposable staging accounts/matters for the
  two-institution tests (5.1–5.3): an explicitly identified approved staging
  target only, bounded cleanup plan with pre-approved removal steps and
  post-run verification per fixture, no production or customer data.
- **Browser support — matrix settled (2026-09-16).** Chrome and Edge:
  current Stable and Extended Stable. Firefox: current release and ESR.
  Safari: current and previous major. IE11 and Edge Legacy: unsupported.
  Other out-of-policy browsers: warning + best-effort only where mandatory
  security capabilities are available. Web Locks stays mandatory — no
  per-page fallback. Record exact browser versions when tests execute.
- **Retired-role verification — resolved (2026-09-16).** Roles 1–4 valid /
  5–6 and unknown rejected is settled policy; mocked evidence is retained
  and the live-verification limitation is stated. No retired-role users are
  created and no ad-hoc live tokens are minted.

## 7. Exact outbound requests

**To Clive (platform/auth service):**

1. ~~Deployed auth-service SHA (or contract version) on
   `staging-api.legitify.co.za`, and confirmation it matches the OTP
   contract~~ — **contract confirmed by Clive 2026-09-16** (owner
   confirmation, not executed certification). **Outstanding:** the deployed
   SHA/version itself, unless supplied.
2. The staging `JWT_SECRET` for DEEDLY's BFF **and** FastAPI service, delivered
   via AWS Secrets Manager — never in chat/tickets.
3. ~~Confirmation that browser user-auth traffic (`POST /api/v1/auth/*` with no
   `X-Service-Key`) remains permitted through the staging gateway~~ —
   **confirmed by Clive 2026-09-16**: the S2S `X-Service-Key` ingress HOLD
   does not close the user-auth path.
4. Approved staff test accounts for staging: one single-account user, one
   multi-account user, one role-4 client, roles 1–2 where available; their
   `accountable_institution_id` assignments; and an approved disposable
   fixture matter in a second test institution for the isolation check.
5. A platform-approved **test OTP mechanism** for staging (routine
   certification must not send real SMS/email). Approved CELL/EMAIL delivery
   targets and rate-limit/lockout details are needed only if the separate
   real-delivery E2E run is approved.
6. ~~Agreement on the retired-role (5/6) verification method~~ — **resolved
   2026-09-16**: mocked evidence retained with the live-verification
   limitation stated; no retired-role users or ad-hoc live tokens.
7. Answers to the retained production questions (§8): refresh revocation/
   rotation plans, `iss`/`aud` expectations, external-ingress/key-rotation
   HOLD resolution.

**To Louis (product/ops):**

8. ~~Decision: where DEEDLY's non-production SPA+BFF+FastAPI will be hosted
   and who owns it~~ — **owners assigned 2026-09-16: Clive and Dean**; Vercel
   being replaced. **Outstanding:** final URL, same-origin `/api` routing and
   environment readiness.
9. ~~Decision: approval to create disposable test fixtures~~ — **approved
   2026-09-16** for the explicitly identified approved staging target, under
   the bounded cleanup plan; no production or customer data.
10. ~~Decision: supported-browser matrix sign-off~~ — **settled 2026-09-16**:
    Chrome/Edge Stable+Extended Stable; Firefox release+ESR; Safari current
    and previous major; IE11/Edge Legacy unsupported; Web Locks mandatory;
    record exact versions at execution.
11. Approval for real OTP delivery — **policy set 2026-09-16**: routine
    certification uses mock/test OTP only; real SMS/email needs a separate
    explicit E2E approval covering account scope, recipients, cost and
    rollback. This item stays open only for that gated run.

## 8. Open production questions — retained, not resolved

- Upstream refresh tokens are stateless, non-rotating, non-revocable; local
  logout is local teardown only, **not** upstream revocation.
- `iss`/`aud` are neither issued nor validated in the inspected code.
- Upstream OTP resend rate limits/lockouts unverified.
- External-ingress/key-rotation HOLD (`deedly_external_integration.md`
  2026-09-03) unresolved — S2S lane only; user-auth path permitted through
  the staging gateway per owner confirmation 2026-09-16 (§7.3).
- Deployed auth-service SHA unverified (snapshot has no Git metadata);
  contract owner-confirmed 2026-09-16, deployed SHA/version still
  outstanding.

**Production Authentication is NOT marked complete.** This checklist certifies
a non-production deployment only; production certification additionally needs
the above answers plus deployed-prod evidence.
