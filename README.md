# Legitify Convey Hub

A conveyancing application under development, built with **React, TypeScript, Vite, and Tailwind CSS**, a browser-facing **Node Express BFF**, and a **Python FastAPI/asyncpg** domain service. Offline verification does not certify live authentication, database migrations or pilot readiness.

## Features

- **Modern Tech Stack**: React 18, TypeScript, Vite, Tailwind CSS
- **Python/FastAPI Backend**: Async API powered by FastAPI and asyncpg
- **Enterprise UI**: Clean, professional design with dark/light mode support
- **Component-Based Architecture**: Reusable UI components with proper TypeScript typing
- **Responsive Design**: Mobile-first approach with responsive layouts
- **Dark Mode**: Built-in dark/light theme toggle
- **Type Safety**: Full TypeScript implementation with strict mode
- **Golden Records Integration**: Search and pre-fill transfer details from existing records

## Pages

- **Dashboard**: Overview with stats, recent cases, and upcoming events
- **Cases**: Manage and track all conveyancing cases
- **Documents**: Document management with file uploads and organization
- **Settings**: User profile and application settings
- **New Transfer**: Golden records search and transfer creation
- **Bonds**: Bond management (Coming Soon)
- **Cancellations**: Cancellation tracking (Coming Soon)

## Tech Stack

### Core Technologies
- **React 18** - UI framework with hooks and modern features
- **TypeScript** - Type-safe JavaScript development
- **Vite** - Fast build tool and development server
- **Tailwind CSS** - Utility-first CSS framework
- **Python 3.12+** - Backend runtime
- **FastAPI** - Modern, high-performance Python web framework
- **Uvicorn** - ASGI server for running FastAPI
- **asyncpg** - High-performance PostgreSQL driver for Python

### Additional Libraries
- **React Router DOM** - Client-side routing
- **Lucide React** - Beautiful icon library
- **clsx & tailwind-merge** - Utility for conditional CSS classes
- **dotenv** - Environment variable management
- **httpx, python-dateutil, python-multipart** - Supporting Python utilities

### Data Layer
- **Database**: PostgreSQL with asyncpg connection pooling
- **Migrations**: SQL schema management
- **Services**: FastAPI routers for business logic
- **Hooks**: React state management with data persistence

## Getting Started

### Runtime and prerequisites

Run three processes, not just Vite and Python:

| Process | Command/script | Local port used below | Responsibility |
|---|---|---|---|
| Vite frontend | `npm run dev:client` | 5173 | SPA; proxies `/api` to the Node BFF |
| Node BFF | `npm run dev:server` (`tsx server/index.ts`) | 3000 | Browser auth, JWT verification, scoped reads and FastAPI proxies |
| FastAPI | `python -m uvicorn main:app --app-dir python_server` | 3100 | Authoritative staff list/filter/totals, matter writes, documents and S2S routes |

Use **Node 24.x** (the package engine requirement), npm with the committed
lockfile, Python 3.12+, and PostgreSQL 13+ for an approved database run.
Provisioning a database, applying migrations and
live upstream authentication are separate approvals, not startup steps.
FastAPI opens its database pool during application startup: do not start it
with ambient/shared credentials merely to inspect the UI. Use offline/mocked
checks when no approved environment exists. This checkpoint does not authorize
M1 migration, TLS, infrastructure or pilot-release work.

### Install dependencies

From the repository root, after selecting Node 24:

```powershell
node --version
npm ci
python -m venv python_server/.venv
python_server/.venv/Scripts/python.exe -m pip install -r python_server/requirements.txt
```

On macOS/Linux, use `python3` to create the venv and
`python_server/.venv/bin/python` for subsequent Python commands. Most Python
requirements are currently unpinned; reproducible Python dependency pinning is
still a verification gap, not a guarantee supplied by these instructions.

### Configure an approved local environment

Only if `.env` does not already exist, copy `.env.example` to `.env` in the
repository root. Never overwrite an existing configuration blindly or commit
credentials. Node loads this file from its working directory; Python's
`load_dotenv()` also discovers the root file. Process environment values take
precedence. Do not put database URLs or signing/service keys in `VITE_*`.

| Variable | Consumer and meaning |
|---|---|
| `PORT` | Both APIs read this name. Node defaults to 3001; Python settings default to 3000. Use separate terminal overrides below. |
| `VITE_API_PORT` | Vite config reads **process.env** before `.env` loading; explicitly set it in the frontend terminal to match the BFF. Its fallback is 3001. |
| `VITE_API_BASE_URL` | Browser API base; `/api` keeps requests same-origin through the BFF. |
| `DEEDLY_API_BASE_URL` | Node-only FastAPI origin, locally `http://127.0.0.1:3100`; never point it back to the BFF or to the platform auth gateway. |
| `LEGITIFY_API_BASE_URL` | Approved Legitify gateway; Node uses its `/api/v1/auth/*` routes and Python uses the S2S lane. |
| `JWT_SECRET` | Server-only shared upstream JWT verification secret, provisioned to **both** APIs. Blank/missing means authentication fails closed. |
| `SECRET_KEY` | Server-only Legitify S2S service key; distinct from the JWT verification secret. |
| `AUTH_ALLOWED_ORIGINS` | Optional exact auth-origin allowlist; blank retains the documented same-origin/loopback development policy. Do not broaden it to work around hosting problems. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | Approved database connection when no higher-precedence DSN is present. |
| `DB_SCHEMA` | `transfers` (lowercase) for the migrated application schema. |
| `NODE_ENV` | Set `development` for these local API processes; production has additional secret requirements. |

Both APIs resolve DSNs in this order:
`ConveyHub_Transfers_POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NON_POOLING`,
`ConveyHub_Transfers_POSTGRES_URL`, `POSTGRES_URL`, `DATABASE_URL`.
Check the resolved target without printing credentials; changing only `DB_HOST`
does not override a DSN. Test DSNs/opt-in flags must stay unset outside a
separately approved isolated test run. `API_BASE_URL` is not a runtime setting
used by these three processes.

### Start all three processes locally

Run each block in a **separate PowerShell terminal at the repository root**.
These commands require an already prepared, approved local/test database and
approved upstream configuration; they are not offline verification commands.

**Terminal 1 — FastAPI:**

```powershell
$env:NODE_ENV = "development"
$env:PORT = "3100"
python_server/.venv/Scripts/python.exe -m uvicorn main:app --app-dir python_server --host 127.0.0.1 --port 3100
```

**Terminal 2 — Node BFF:**

```powershell
$env:NODE_ENV = "development"
$env:PORT = "3000"
$env:DEEDLY_API_BASE_URL = "http://127.0.0.1:3100"
npm run dev:server
```

`VERCEL` must be unset in a local BFF terminal: its presence suppresses the
listener for serverless imports. Node currently calls `app.listen(PORT)`
without a host restriction, so it listens on default interfaces; use a trusted
local environment/firewall rather than assuming a loopback-only Node bind.
The commands above explicitly bind FastAPI, and the command below binds Vite,
to loopback. Do not use `python main.py` as a substitute: that entry point
binds `0.0.0.0` and reads the shared `PORT` default.

**Terminal 3 — frontend:**

```powershell
$env:VITE_API_PORT = "3000"
$env:VITE_API_BASE_URL = "/api"
npm run dev:client -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. On macOS/Linux, the equivalent process-local
prefixes are `NODE_ENV=development PORT=3100` for Python,
`NODE_ENV=development PORT=3000 DEEDLY_API_BASE_URL=http://127.0.0.1:3100`
for Node, and `VITE_API_PORT=3000 VITE_API_BASE_URL=/api` for Vite.
Use `python_server/.venv/bin/python` and the same Uvicorn arguments.

`npm run dev` starts **only Vite and Node**, not FastAPI. It can replace
terminals 2/3 only when their process environment settings are supplied together;
FastAPI must still run separately. Neither npm dev script adds a server watcher.
Vite's existing production-React override is intentional and unchanged.

Staff login is the approved platform password/OTP flow, not a local demo login.
Web Locks and Secure cookies are required. Loopback HTTP browser exceptions vary;
if a browser refuses Secure cookies, use approved local HTTPS/same-origin proxy
configuration rather than weakening cookie flags. Missing FastAPI configuration,
unreachable service or upstream 5xx produces a generic 503: the dashboard shows
unavailability and dashes for totals, and the wizard persistence probe disables
saving. There is no direct-DB or fake-auth fallback.

### Builds are not deployments

```powershell
npm run build
npm run build:server
node scripts/fix-server-imports.mjs
```

The SPA is built into `dist`; Node output is under `dist/server`. The import-fix
step is required for the emitted Node ESM imports. `npm start` starts the BFF
only; it does not serve the SPA or start FastAPI. `npm run preview` serves the
built frontend for local review, not production/pilot hosting.

The root Vercel configuration packages the SPA and Node serverless entrypoints;
it does **not** provision FastAPI, PostgreSQL, credentials or provider contracts.
A deployment needs a separately hosted/reachable FastAPI URL in the BFF's
`DEEDLY_API_BASE_URL`, shared verification keys, the approved database/schema,
and the same-origin HTTPS `/api` routing required by auth cookies. Ship compatible
BFF and SPA versions: login/refresh now require the BFF-derived `principalKey`
metadata for session isolation; absent metadata fails closed. It is an invalidation
marker derived from verified JWT claims, never an authorization credential.
Production DB TLS/CA verification remains an unresolved M1 prerequisite; the
current clients still relax certificate verification. These are rollout
prerequisites, not authorization to deploy or begin M1. See the auth certification
checklist and `AGENTS.md` for unresolved live-auth, TLS and release requirements.

### Verification boundaries

Use the offline modes in `AGENTS.md`: disable dotenv loading for Python,
clear test DSNs and every DB opt-in, and guard Node DB access before importing
the app. Never run full discovery with an ambient DSN. Vitest is not installed;
TypeScript suites use Node's test runner through `tsx`. ESLint scripts exist,
but the missing reviewed ESLint configuration remains an open tooling gap.

The session browser regression (`node e2e/session-isolation.check.mjs`) uses a
loopback Vite development server on port 4292 (`SESSION_TEST_BASE` overrides),
intercepts all API/auth requests and blocks external HTTP requests. It imports
the actual session module to exercise transitions without adding runtime test
hooks. Existing matter/list harnesses use a loopback static build. Neither form
of browser evidence certifies live JWT issuance or a deployed upstream contract.

### Session-switch isolation

The BFF adds a non-secret `principalKey` to successful login/refresh responses,
derived from verified user, institution, role, tenant, Golden Record and ability
claims. The browser advances its session generation on logout, a new login or
changed verified claims, not on an ordinary same-principal token refresh.
Protected pages remount at that boundary; old API responses (including delayed
JSON bodies) are discarded, and expired writes cannot be retried under a new
institution. Session-bound intake navigation data cannot repopulate another
session's form through history/Back; persisted matters still reload by UUID.

Cooperating tabs invalidate one another through BroadcastChannel. Cookie checks
on focus, visibility changes and protected request/response boundaries also
catch a changed login marker when that channel is unavailable. They clear local
state rather than adopting another tab's token. This is UI isolation, not
upstream token revocation or cancellation of an already accepted server write.
Live provider authentication and the full M3 client/role shell remain separate.

### Future isolated PostgreSQL verification — deferred, not enabled

Before any DB run, obtain explicit approval for the host/database, synthetic
fixtures, allowed writes, retained rows and cleanup/drop operations. Use a
dedicated disposable target, disable dotenv, override all competing DSNs
process-locally, and assert resolved host/name plus `current_database()` and
`current_schema()` before writes. Preserve historical migration bytes/checksums.
Provisioning/migrations and M1 target/TLS work remain on hold at this checkpoint.

| Relevant suite | Gate and lifecycle to approve separately |
|---|---|
| `test_v1_transfers.py` — 85 DB-gated cases | `TEST_DATABASE_URL`; actual migrated schema. Module setup can commit eight synthetic transfer/financial rows and uses dataset-count assumptions. Do not mix blindly with retained fixtures from another suite. |
| `test_migrations_016.py` — 5 DB cases | `TEST_DATABASE_URL`; exercises migration SQL/constraints inside rollback helpers. Review its DDL and prerequisite schema before approval. Static checks alone do not prove installed constraints. |
| `test_matter_property_workflow_db.py` — 8 cases | `TEST_DATABASE_URL`, `RUN_MATTER_PROPERTY_WORKFLOW_DB_TESTS`, `TEST_DATABASE_HOST`, `TEST_DATABASE_NAME`; exact migrations through 029 must already be installed. Rejects `neondb`/system databases and retains labelled synthetic workflow rows. |
| `test_v1_matter_properties_db.py` / `test_v1_matter_editing_db.py` — 18 / 7 cases | `TEST_DATABASE_URL` plus their respective `RUN_MATTER_PROPERTY_DB_TESTS` / `RUN_MATTER_EDITING_DB_TESTS` opt-in; create/drop scratch schemas. They do not certify the installed migration chain. |
| `test_transfer_status_authority.py` — 8 cases | `TEST_DATABASE_URL`; legacy direct-handler coverage, not certification of current v1 status filtering. |

The current list/filter/totals tests use mocked SQL results. A future guarded
actual-schema test must cover both canonical statuses across two institutions,
roles/abilities/client denial, pagination and empty pages, and totals independent
of filtering. Existing DB suites are not a substitute for that missing case.
Measure representative query plans before deciding on indexes.

Separate-read consistency remains unchanged: page count, rows and institution
totals are separate reads, not a shared transactional snapshot. Concurrent writes
can temporarily make them disagree; no snapshot-consistency claim is made.

Do not enable broad DB discovery: other suites have different lifecycles. In
particular, migration-chain tests use `TEST_MIGRATION_DATABASE_URL` and
`RUN_MIGRATION_CHAIN_TESTS`, require an empty dedicated database, and can drop
entire schemas during cleanup. They are not part of this review checkpoint.
The remaining skipped source-contract module needs `ENTITIES_SOURCE_ROOT` and
runs against a source snapshot, not live authentication or PostgreSQL.

## Project Structure

```
python_server/              # Python/FastAPI backend
├── main.py                 # FastAPI application and middleware
├── db.py                   # asyncpg pool and query helpers
├── requirements.txt        # Python dependencies
├── utils/                  # Python validation utilities
│   ├── __init__.py
│   └── validate.py
└── routers/                # FastAPI route modules
    ├── address.py
    ├── clauses.py
    ├── document_catalogue.py
    ├── documents.py
    ├── generated_documents.py
    ├── health.py
    ├── milestones.py
    ├── template_data_fields.py
    ├── transfers.py
    └── users.py

src/                        # React/TypeScript frontend
├── components/
│   ├── ui/                 # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   └── index.ts
│   ├── DatabaseStatus.tsx  # Database connection status
│   └── transfers/          # Transfer workflow components
│       ├── StepProperty.tsx
│       ├── StepParties.tsx
│       └── TransferForm.tsx
├── layouts/                # Layout components
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   ├── MainLayout.tsx
│   └── index.ts
├── pages/                  # Page components
│   ├── Dashboard.tsx
│   ├── Cases.tsx
│   ├── Documents.tsx
│   ├── Settings.tsx
│   ├── NewTransfer.tsx
│   ├── Bonds.tsx
│   ├── Cancellations.tsx
│   └── index.ts
├── lib/                    # Data access layer
│   ├── api/               # API layer
│   │   └── transferApi.ts
│   ├── services/          # Business logic services
│   │   ├── transferService.ts
│   │   └── userService.ts
│   ├── utils/             # Database utilities
│   │   └── databaseUtils.ts
│   ├── migrations/         # Database schema migrations
│   │   └── 001_initial_schema.sql
│   ├── database.ts         # Database connection
│   └── types.ts          # Data type definitions
├── hooks/                  # Custom React hooks
│   ├── useDatabase.ts     # Database connection hook
│   └── useTransfers.ts    # Transfer state management
├── utils/                  # Utility functions
│   └── cn.ts              # Class name utility
├── assets/                 # Static assets
├── App.tsx                 # Main app component
├── main.tsx               # App entry point
└── index.css              # Global styles
```

## Data Access Layer

The application uses a layered architecture for data management, providing clean separation between UI, business logic, and data persistence.

### API Layer

**Node BFF**
- Browser-facing routes and auth proxy in `server/`; the SPA does not call FastAPI directly.
- New domain behavior stays in FastAPI; existing Node scoped reads remain where not yet migrated.
- Legacy Accounts and other quarantined routes remain unavailable, even with a valid JWT.

**FastAPI Backend**
- **Connection Pooling**: asyncpg pool managed in `python_server/db.py`
- **CORS**: Configured to allow the Vite client in development
- **Routers**: Modular route handlers under `python_server/routers/`
- **Environment**: Secure configuration via `.env` variables

**Key Files**
- `python_server/main.py` - FastAPI app and middleware
- `python_server/db.py` - asyncpg pool, query helper, and transaction wrapper
- `python_server/routers/*.py` - API endpoints

### Frontend Service Layer

**Business Logic Abstraction**
- **Transfer Service**: Handles all transfer-related operations
- **User Service**: Manages user data and authentication
- **API Layer**: Clean interface between UI and backend

**Key Files**
- `src/lib/services/transferService.ts` - Transfer business logic
- `src/lib/services/userService.ts` - User management
- `src/lib/api/transferApi.ts` - API interface layer

### React Hooks Layer

**State Management**
- **useDatabase**: Database connection status and queries
- **useTransfers**: Transfer workflow state management
- **Type Safety**: All hooks return typed data

**Key Files**
- `src/hooks/useDatabase.ts` - Database connection hook
- `src/hooks/useTransfers.ts` - Transfer state management

### Data Flow

```
Browser → same-origin /api → Node BFF → FastAPI → PostgreSQL
                              └── existing scoped reads → PostgreSQL
                              └── auth proxy → Legitify gateway
```

### Golden Records Integration

**Search Functionality**
- **Inline Search**: ID number, name, or registration number search on the New Transfer page
- **Live dependency**: Requires approved Legitify authentication/S2S contracts; mocked test results are not live Golden Records
- **Pre-population**: Auto-fills transfer forms with found records
- **Manual Entry**: Passes the search term into the workflow when no record is found

**Key Components**
- `src/pages/NewTransfer.tsx` - Golden records search and transfer creation page
- `src/components/transfers/StepParties.tsx` - Pre-fills party details from a Golden Record

### Database Schema

**Core Tables**
- **users**: User accounts and profiles
- **transfers**: Property transfer records
- **parties**: Buyer/seller information
- **documents**: File attachments and metadata
- **audit_trail**: Change tracking and compliance

## Design System

### Color Palette

- **Primary**: Navy blue (`navy-600`, `navy-700`)
- **Accent**: Teal (`teal-500`, `teal-600`)
- **Neutral**: Gray scale for text and backgrounds
- **Semantic**: Colors for status, success, warning, error states

### Typography

- **Font Family**: Inter (system-ui fallback)
- **Font Weights**: 300, 400, 500, 600, 700
- **Responsive**: Scales properly across device sizes

### Components

All UI components follow these principles:
- Consistent design patterns
- Proper TypeScript typing
- Accessibility considerations
- Dark mode support
- Responsive behavior

## Development Guidelines

### Component Development

1. Use TypeScript for all components
2. Follow the existing naming conventions
3. Implement proper props interfaces
4. Use the `cn` utility for conditional classes
5. Ensure dark mode compatibility

### Code Style

- Use ES6+ features
- Follow React best practices
- Implement proper error boundaries
- Use semantic HTML elements
- Maintain consistent indentation

### Performance

- Lazy load routes when needed
- Optimize bundle size
- Use React.memo for expensive components
- Implement proper loading states

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support and questions, please contact the development team or create an issue in the repository.
