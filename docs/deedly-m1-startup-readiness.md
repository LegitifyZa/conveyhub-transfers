# M1 — Startup configuration validation and liveness/readiness separation

Scope: fail-closed production startup + bounded read-only readiness probes for
the Node BFF (`server/`) and the DEEDLY FastAPI service (`python_server/`).
No migrations are run, no databases created, no live credentials used.
Migration runner/artifact work is unchanged and referenced, not reopened.

## Liveness vs readiness

| Endpoint | BFF | FastAPI | Semantics |
|---|---|---|---|
| Liveness | `GET /api/health/live` | `GET /api/health/live` | Process is running. **No dependency checks** — a dead database must not keep an orchestrator from reaching it. Always 200. |
| Readiness | `GET /api/health/ready` | `GET /api/health/ready` | 200 only when configuration is valid **and** the database answers a bounded read-only probe **and** the migration ledger contains every manifest file with its approved sha256 **and** (BFF) a configured `DEEDLY_API_BASE_URL` upstream answers liveness. Otherwise 503 with fixed label strings. |
| Legacy aggregate | `GET /api/health` | `GET /api/health/` | Unchanged back-compat health check for existing dashboards. |

Readiness probe contract:

- **Bounded**: BFF relies on the pool's `connectionTimeoutMillis`/`query_timeout`;
  FastAPI uses `fetchval(..., timeout=5)`. Both do at most two `SELECT`s
  (`SELECT 1`, then the ledger count).
- **Read-only**: no writes, no DDL, no migrations, no `CREATE DATABASE`.
- **Fail closed**: any probe error, unreadable manifest, mismatched ledger
  count, or invalid configuration → `not-ready`. Nothing is cached between
  probes, so a recovered dependency flips readiness back on the next call.
- **Credential-free output**: responses and logs contain only fixed labels
  (`ok`, `unavailable`, `ledger-missing`, `schema-incomplete`,
  `manifest-unavailable`, `invalid-configuration`, `unknown`). Driver
  exceptions, hostnames, DSNs and secret values are never surfaced.

Schema prerequisite: `public.transfers_schema_migrations` is compared
per-file against `src/lib/migrations/manifest.json` — every manifest file
must exist in the ledger **with the manifest's sha256**. Labels:
`ledger-missing` (table absent/unreadable), `schema-missing-migrations`
(a required file absent — covers equal-count wrong-name drift),
`schema-checksum-mismatch` (right name, wrong digest — covers a replayed
or tampered apply), `schema-drift` (**any ledger row beyond the manifest**
— for the controlled pilot the schema must equal the approved artifact
exactly; loosening drift to forward-compatible extras is a decision for
when rolling deploys exist), `manifest-unavailable` (approved manifest
unreadable — fails closed). Ordering/deeper integrity remains
`migrate-preflight.mjs`'s job.

Essential vs optional dependencies:

| Service | Essential (blocks readiness) | Optional |
|---|---|---|
| BFF | PostgreSQL + approved schema; FastAPI at `DEEDLY_API_BASE_URL` **when configured** (v1 golden-record/transfer/document proxies depend on it — required in production, optional locally for BFF-only dev) | — |
| FastAPI | PostgreSQL + approved schema | `REDIS_URL`, `AUDIT_DATABASE_URL` (parsed into Settings but have no runtime consumer today), Legitify upstream at `LEGITIFY_API_BASE_URL` (config-required in production but deliberately **not probed** — an external S2S dependency outage must not flap DEEDLY readiness) |

Timeout coverage: BFF — pool acquisition `connectionTimeoutMillis=10s`,
queries `query_timeout=30s` plus an explicit 5s per-probe race, upstream
GET `AbortSignal.timeout(3s)`. FastAPI — `fetch*(..., timeout=5)` covers
acquisition + statement; `timeout=10` bounds connection establishment at
pool creation; httpx reads/writes already carry `CONNECT_TIMEOUT_SECONDS`.
`get_pool` is serialized by an asyncio lock so concurrent outage probes
cannot race `create_pool` into duplicate pools.

## Production configuration validation

Both services validate at startup; a production process with invalid
configuration exits before listening (BFF) or before the lifespan completes
(FastAPI `load_settings` raises). Outside `NODE_ENV=production` validation is
a no-op, preserving local development.

| Variable | Required in production | Validation |
|---|---|---|
| `DATABASE_URL` (or `ConveyHub_Transfers_POSTGRES_URL[_NON_POOLING]` / `POSTGRES_URL[_NON_POOLING]`) | one DSN **or** the discrete set below | valid `postgres(s)://` URL with hostname + password; `sslmode=disable`/`no-verify` rejected |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | required when no DSN | non-empty, not a placeholder (`your_username`/`your_password`) |
| `SECRET_KEY` | yes | non-empty, not `dev-secret-change-me` (FastAPI already enforced; now covered before lifespan) |
| `JWT_SECRET` | yes | non-empty, not a placeholder — every authenticated request depends on it |
| `LEGITIFY_API_BASE_URL` | yes | **https-only** in production, non-loopback — the lane carries bearer tokens + PII; a plain-http internal contract is not yet decided so this fails closed (dev keeps `http://localhost`) |
| `DEEDLY_API_BASE_URL` (BFF only) | yes | same https rule; the v1 proxy routers are pilot-essential |
| `LEGACY_ACCOUNTABLE_INSTITUTION_ID` | must be **unset** | unauthenticated legacy-tenant bridge — refused in production |
| `DB_SSL_NO_VERIFY` | must not be `true` | refused in production (FastAPI also refuses at connection time) |
| `DOCUMENT_TOKEN_SECRET` | optional | falls back to `SECRET_KEY`; set it if policy requires independent rotation — left as a decision below |
| `REDIS_URL`, `AUDIT_DATABASE_URL`, `MIGRATIONS_MANIFEST` | not required by this slice | no production consumer gates readiness today; revisit when a consumer lands |

The BFF pool now resolves TLS through the shared M1 resolver
(`scripts/db-tls.mjs`) instead of the previous unconditional
`rejectUnauthorized: false`: certificate + hostname verification is the
default whenever TLS is used; a trusted CA comes from the DSN
`sslrootcert` param, `PGSSLROOTCERT`, or `DB_SSL_CA_FILE` (missing CA file
fails closed); `sslmode=no-verify` / `DB_SSL=no-verify` is refused in
production; `channel_binding=require` is rejected because the `pg` driver
cannot strictly enforce SCRAM-SHA-256-PLUS (`prefer` is mapped to pg's
`enableChannelBinding`, best-effort). Discrete-credential config keeps
`DB_SSL=true` → verified TLS (was unverified).

Built runtime: `npm run build:server` now also runs
`scripts/copy-server-assets.mjs`, which copies `scripts/db-tls.mjs` and
`src/lib/migrations/manifest.json` into the `dist/server/` layout so the
compiled service resolves the same TLS helper and approved manifest it is
type-checked and tested against (`node dist/server/server/index.js` was
verified to resolve both). `MIGRATIONS_MANIFEST` may point readiness at a
manifest outside the package for artifact-driven deploys.

Issue strings carry the variable **name** and the rule only — never the
value. Errors are aggregated so one startup failure reports every problem.

## How secrets are supplied

- **Local development**: `.env` (dotenv) — the existing workflow is unchanged;
  development still permits placeholders and loopback upstreams.
- **Production**: environment variables injected by the deployment provider's
  secret store. **The provider contract is not yet decided** — this slice
  defines which names must exist and what values are unsafe; the delivery
  mechanism (e.g. platform env vars, a secrets manager, or mounted files for
  `DB_SSL_CA_FILE`) remains an explicit open decision. Nothing here reads a
  secret file itself.

## M1 checklist mapping

| Megaplan M1 criterion | Status / evidence |
|---|---|
| Raw historical checksum enforcement | **Done** — PR #9 preflight (`docs/deedly-m1-migration-preflight.md`) |
| Immutable migration artifact + manifest | **Done** — manifest exists; recovery hardened in PR #13 (`docs/deedly-m1-artifact-recovery.md`) |
| Exact-artifact clean install + repeat-run | **Done** — PR #14, `deedly_m1_artifact_verify` rehearsal (`docs/deedly-m1-artifact-execution.md`) |
| Historical mismatch / target-mismatch rejection | **Done** — preflight + runner (PRs #9, #11, #14) |
| Negative TLS tests | **Done** — `db-tls*.test.mjs`, `test_db_ssl_context.py` (PR #10) |
| Migrator serialization (advisory lock) | **Done** — PR #11; deploy-level coordination still open below |
| Recovery for SQL-applied/ledger-not-recorded | **Done** — documented + rehearsed (PRs #12, #13) |
| Backup/restore rehearsal | **Done** — `docs/deedly-m1-backup-restore-evidence.md` (PR #12) |
| Migration preservation checks | **Done** — transaction-semantics preserved in runner |
| Fail-closed startup readiness | **This slice** — `/ready` implemented; live-environment certification is operational acceptance, pending deployment |
| Approved fresh pilot target | **Open** — no pilot database provisioned/approved yet |
| Approved deployment/CI configuration + release manifest | **Open** — provider not decided; only offline CI exists |
| Service credentials delivery | **Open** — provider contract undecided (see above) |
| Recovery objectives / alert ownership / incident sign-off | **Open** — runbook sign-off outstanding |
| `neondb` legacy outside pilot path | **Done** — untouched; all evidence on disposable DBs |

## Remaining decisions before M1 close

1. **Deployment provider + secret-delivery contract** — determines how the
   required names above are injected and whether `DB_SSL_CA_FILE` is a mounted
   file or a platform-managed CA. Relatedly, whether any internal hop
   (e.g. BFF→FastAPI inside a private network) is permitted plain HTTP —
   currently refused (`https` required); relaxing it needs a documented
   private-network contract, not a default.
2. **`DOCUMENT_TOKEN_SECRET` policy** — independent secret vs. `SECRET_KEY`
   fallback.
3. **Deploy-lock coordination** — ensure a release can't race a migrator
   (runner-level advisory lock is merged; CI/release integration is not).
4. **Fresh pilot database approval** — `deedly_m1_artifact_verify` was
   disposable evidence, not the approved pilot target.
5. **Operational acceptance** — restore rehearsal ownership, alert ownership,
   incident procedures, and live readiness-probe verification in the deployed
   environment.
