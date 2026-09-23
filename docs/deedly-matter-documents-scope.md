# Authenticated Matter Documents — scope and readiness review

**Status:** scope review complete; the decisions in
`deedly-matter-documents-decisions.md` were **approved on 2026-09-18** and a
bounded implementation now exists on
`deedly/mvp0/documents/upload-and-readback` (`f9c33d3`, unmerged). The scope
findings below describe the pre-implementation state and remain accurate as
of `f016f3e`.

**Base:** freshly fetched `main` at `f016f3e73dbf698e2a668c13a47110c33668bccb`.
Branch: `docs/deedly-matter-documents-scope`. The property branch
`deedly/mvp0/properties/manual-capture-and-linking` stays unmerged and In
Review; relevant differences are noted in §10.

**Existing state for context:** Production Authentication remains Blocked
(mock-tested wiring only); Property Capture and Linking is implemented on
its own unmerged branch.

---

## 1. Headline finding

**Every document write/read the UI calls goes through the quarantined
legacy lane.** `quarantineLegacyRoute` runs `requireJwt` first (missing or
bad token → 401), then returns `503 "Legacy endpoint unavailable"` — so the
handlers behind it are dead code today, on both the Node BFF and FastAPI.

The **only live document endpoint in the system** is a metadata-only
`GET /api/v1/transfers/{id}/documents` — and **no frontend code calls it**.
No upload, status-write, or file-download endpoint is reachable.

Consequence: document statuses chosen in the UI (`pending`, `uploaded`,
`not_required`, …) are React reducer state only. They are representable in
the schema but are **never persisted** on the live path.

## 2. Endpoint inventory

### Live (reachable, authenticated)

| Endpoint | Server | Auth | Notes |
|---|---|---|---|
| `GET /api/v1/transfers/{id}/documents` | `server/routes/v1/transfers.ts:432` and `python_server/routers/v1/transfers.py:400` | `requireJwt`; client role → 404; `transfers:read` → 403; institution-scoped via `authorizeTransfer`/`_authorize_transfer` | Metadata projection only — `file_path` and `uploaded_by` deliberately excluded. **Uncalled by the UI.** |

### Quarantined (401/503, dead handlers)

Router-level `quarantineLegacyRoute` on `server/routes/{transfers,milestones,documents,documentCatalogue,generatedDocuments}.ts` and the mirrored `python_server/routers/*` files:

| Endpoint | Handler location | What the dead code does |
|---|---|---|
| `GET /api/transfers/{id}/documents` | `server/routes/transfers.ts:1220` | list `transfer_documents` |
| `POST /api/transfers/{id}/documents` | `transfers.ts:1279` | catalogue-linked insert (`ON CONFLICT DO UPDATE`) or free-name insert, `status='pending'` |
| `POST /api/transfers/{id}/documents/{docId}/upload` | `transfers.ts:1241` → `saveTransferDocumentUpload` (`:215`) | base64 data-URL → disk write → `UPDATE … status='uploaded', file_path=…` |
| `PATCH /api/transfers/{id}/documents/{docId}` | `transfers.ts:1330` | status/notes update; whitelist `pending|uploaded|verified|rejected|not_required` |
| `PUT /api/transfers/{id}` (documents block) | `transfers.ts:980` | per-row status/notes update inside the aggregate |
| `POST /api/transfers` create | `seedTransferDocuments` (`:181`) | seeds one `pending` row per Active `module='Transfers'` catalogue entry |
| `GET /api/documents` | `routes/documents.ts:29` | reads `public.documents` — a **different table** the transfer flow never writes |
| `GET/POST /api/catalogue[/{id}]` | `routes/documentCatalogue.ts` | `document_catalogue` + fields/requirements/templates |
| `GET/POST /api/generated-documents[/{id}]` | `routes/generatedDocuments.ts` | metadata rows only; no file bytes |
| `GET/PUT/PATCH /api/transfers/{id}/milestones…`, `GET …/activity` | `routes/milestones.ts` | `matter_milestones` + `milestone_history` + `transfers.progress` sync |

### Simulated by the recent browser harness only

The Playwright check (`e2e/matter-properties.check.mjs`, on the **property
branch**, not on main) mocks `GET /api/catalogue`,
`POST /api/transfers/{id}/documents` and the status select — so catalogue
listing, document add and `not_required` transitions in that check were
simulated, not exercised against any real handler. There is no `e2e/`
directory on main; document behavior has zero browser evidence on this
branch.

## 3. Where file bytes and metadata live

- **Bytes:** local disk only. Node writes `<repo>/uploads/transfers/<transferUuid>/<ts>-<rand>.<ext>` (`server/routes/transfers.ts:12,237`); the FastAPI legacy handler writes a **different** directory, `python_server/uploads/transfers/<uuid>/` (`routers/transfers.py:20`). Filenames are sanitised to `[a-zA-Z0-9_.-]`; content is a base64 data-URL inside the JSON body. **No endpoint serves file bytes back** — no `res.download`, `sendFile`, or `createReadStream` exists anywhere in `server/`. Uploads are write-only artifacts today.
- **Metadata:** `transfers.transfer_documents` (migration `005`, moved to the `transfers` schema in `010`, `uploaded_by_user_id` added in `013`): `id`, `transfer_id → transfers ON DELETE CASCADE`, `catalogue_document_id → document_catalogue ON DELETE SET NULL`, `name`, `status CHECK (pending, uploaded, verified, rejected, not_required) DEFAULT 'pending'`, `notes`, `file_path TEXT`, `file_size`, `file_type`, `original_file_name`, `uploaded_by → users SET NULL`, `uploaded_at`, timestamps, `UNIQUE (transfer_id, catalogue_document_id)`, `updated_at` trigger.
- **Tenant scoping:** `transfer_documents` has **no** `accountable_institution_id` — scoping is inherited through the parent transfer join. That is not in itself a proven vulnerability: the live v1 metadata GET already enforces tenancy by authorizing the parent transfer before reading document rows. What it means is that every future document query path (list, download, upload, status writes) must apply the same parent-transfer authorization — a boundary to **verify** for each new endpoint rather than assume. It also has **no audit trigger** (the `audit_trigger` is on `public.documents`, which this flow never writes).
- **Catalogue:** `document_catalogue` + `document_catalogue_fields` + `document_catalogue_requirements` + `document_templates`/`_versions` + `document_parties` (migrations `003`, `004` seeds, `007`).

## 4. Failure, retry and orphan behavior (dead-code analysis)

Reading the quarantined handlers as the best available spec for what the
slice must improve on:

- **Orphan-on-failure:** `saveTransferDocumentUpload` writes the file to
  disk *before* the `UPDATE` (`transfers.ts:242` then `:246`). If the UPDATE
  fails, the file stays — no cleanup, no transaction spanning storage+DB.
- **Orphan-on-replace:** re-uploading writes a new timestamped file and
  overwrites `file_path`; the old file is never deleted.
- **Duplicates:** `UNIQUE(transfer_id, catalogue_document_id)` +
  `ON CONFLICT DO UPDATE` on catalogue adds; free-name adds have no
  dedupe. No `client_request_id`/`request_fingerprint` idempotency anywhere
  in the document lane.
- **UI-level:** `StepDocuments` shows per-row errors on upload failure;
  `TransferDocumentsPanel` (milestones "Documents" tab) surfaces the 503
  per row. `mapServerDocument` (`transferApi.ts:152`) silently maps any
  unrecognised server status to `'uploaded'` — a mis-mapping risk worth
  correcting in any new read path.
- **Wizard gate:** `validateDocuments` requires ≥1 document with every doc
  `uploaded`/`not_required`. Since uploads and status writes are
  quarantined, this gate is currently satisfiable only by local state (or
  via the mocked harness) — it is not a persisted gate.

## 5. What `uploaded` and `not_required` are today

Both are values in the `transfer_documents.status` CHECK constraint —
**the schema supports them**, and the dead PATCH/upload handlers would
persist them. But on the reachable path they are **local UI state only**:
`StepDocuments`' status select calls only `dispatch(UPDATE_DOCUMENT)`; the
wizard never sends documents to `createMatter` (`CreateMatterRequest` has
no documents field; `updateTransfer` is uncalled by any page). Nothing
persisted, nothing authorized.

## 6. Proposed smallest useful slice — upload + readback (not approved)

Smallest coherent unit that makes the feature real without inventing
workflow rules:

**API (v1, authenticated, institution-scoped — mirroring the property
slice's proven pattern):**

- `POST /api/v1/transfers/{id}/documents` — create a `pending` row
  (catalogue-linked or named). Body: `{catalogue_document_id | name,
  client_request_id}`.
- `POST /api/v1/transfers/{id}/documents/{docId}/file` — upload bytes for
  an existing pending row. Multipart (preferred over base64-in-JSON) with
  an explicit size cap and extension/MIME allow-list; declared type checked
  against sniffed content.
- `GET /api/v1/transfers/{id}/documents` — already live; reuse as the
  readback projection (metadata only).
- `GET /api/v1/transfers/{id}/documents/{docId}/file` — authenticated
  download: re-authorizes caller + tenant on every request, streams the
  stored object, never exposes `file_path`/`storage_key`.

Auth rules follow the property slice: `transfers:write` for upload/add,
`transfers:read` for list/download, client role fails closed, tenant
predicate via the parent transfer/matter, replay re-authorizes.

**UI:** keep `StepDocuments` and `TransferDocumentsPanel` shapes; wire the
existing catalogue select, Add, file input and status select to the v1
endpoints; honest failure (no optimistic success), retry with the same
`client_request_id`.

**Consistency/cleanup (design requirement, not yet implemented):** write
the DB row `pending` first; store the file; mark `uploaded` only after
storage confirms. On storage failure the row stays `pending` with no
`file_path` (retryable, no orphan DB side); on DB failure after a
successful store, attempt a compensating delete of the stored object.
A compensating delete alone does not fully solve orphan recovery:

- If the compensating delete itself fails (storage unreachable, crash
  mid-cleanup), the object remains orphaned with no DB row pointing at
  it — recovery needs a reconciliation path (sweep comparing stored
  objects against `file_path` references, or a tombstone/pending-cleanup
  record the sweep can find).
- If the upload succeeds but the response is lost, the client retries:
  the `client_request_id` must resolve to the already-persisted row and
  stored object (replay), not write a second file or second row. The
  idempotency record must be able to find the stored object — store the
  storage reference on the row as part of the same idempotent write.

Replacement uploads must delete or tombstone the prior object (with the
same sweep fallback). Idempotency via `client_request_id` + fingerprint,
as in the property slice — likely a follow-on schema dependency.

**File-safety dependencies — all explicitly pending decisions:**
storage provider (local disk is unserved and duplicated across two
directories today — object storage or a single configured root is
required before download can be honest), malware scanning (external
dependency — flag), max size and type allow-list, retention/deletion
policy, and download authorization semantics (who may fetch file bytes —
staff only? reviewers? clients? — undecided). Document-status transitions
and any gating are likewise undecided (§7); the slice above persists only
`pending`/`uploaded` as direct consequences of row creation and a
successful upload.

**Focused test coverage:** unit (validation, allow-list, authz matrix,
projection excludes `file_path`/`uploaded_by`, replay/conflict), guarded
Postgres (row+status transitions, tenant isolation, rollback leaves no
`uploaded` row without a stored object), browser check (upload → listed →
downloaded; failure preserves the pending row; retry reuses key), plus the
quarantine assertions already in `server/tests/aiTenantSecurity.test.ts`.

**Schema/storage dependencies for review:** possible `accountable_institution_id`
on `transfer_documents` for direct tenant indexing; `checksum_sha256` for
integrity; `storage_key` vs `file_path` (provider-agnostic reference);
`client_request_id`/`request_fingerprint` idempotency columns (same pattern
as migration 024); audit coverage for document writes (none today);
storage provider configuration.

## 7. Product decisions needed before implementation (Dean/Louis)

Flagged — **not** invented here:

1. Status semantics: is `not_required` staff-settable? Who may set
   `verified`/`rejected` (reviewer permission model)?
2. Required-document rules per matter classification — no
   classification-specific requirements exist today and none are proposed.
3. Submission/completion gates: does document state gate matter
   submission or milestones?
4. Re-upload/replacement rules and whether prior versions are retained.
5. File constraints: allowed types, max size, retention, deletion rights.
6. Storage provider and environment (local disk vs object storage);
   malware-scanning requirement.
7. Whether catalogue entries auto-seed `pending` rows on matter creation
   (legacy behavior) or are added on demand.
8. Client-role document visibility (currently fails closed — keep?).

## 8. Explicitly out of scope

Classification-specific document requirements, reviewer permissions,
rejection/replacement rules, completion gates, catalogue authoring UI,
generated documents, and the separate `public.documents` legacy table's
fate (read only by the quarantined `GET /api/documents`).

## 9. Known side-findings

- **Wizard save lane permanently disabled on main (confirmed defect,
  fix under review).** `probeMatterPersistence`
  (`src/lib/api/serviceStatus.ts:17`) keys on `response.success`, but
  every v1 success envelope is `{message, data}` with no `success` field
  (`server/routes/v1/transfers.ts:255` and siblings). A healthy probe
  therefore always returns a failure → `isPersistenceDisabled` →
  **Save Draft and Submit are disabled whenever the wizard loads**,
  blocking the entire save path that any documents slice would build on.
  The earlier browser check only passed because its mock returned
  `success: true`. Fixed on `fix/probe-matter-persistence-envelope`
  (`d34d510`, unmerged) — the probe now validates that
  `data.transfers` is an array and fails closed otherwise; the corrected
  harness mock was replayed green against it on the property branch.
- `python_server/tests/test_v1_transfers.py` `test_legacy_documents_embedded_unchanged`
  still expects `GET /api/transfers/{id}` → 200 — stale vs. quarantine.
- Node and FastAPI legacy upload handlers write to **different**
  directories — a real dual-write hazard if ever unquarantined as-is.

## 10. Dean-supplied requirements & guidance (implementation pending)

Recorded requirements supplied by Dean for P0 – Documents & Document
Requirements. These are approved guidance, not proposals — implementation
is pending and listed under the backlog/future tasks.

### 10.1 Signature dates must spell the month in full words

**Requirement (Dean-supplied, 2026-09-18):** signature dates on DEEDLY
documents must render the month in full words — e.g. **17 September
2026** — never `17/9/2026` and never an abbreviated month (`17 Sep
2026`). Purpose: prevent Deeds Office rejections of lodged documents.

**Carries into:**

- Generated-document templates (`document_templates` /
  `document_template_versions` and the `documentGenerator` lane).
- PDF/export output (any date placeholder rendered for signature blocks).
- Document-review guidance (reviewers should flag numeric/abbreviated
  signature dates on uploaded evidence).

**Explicit boundary:** already-signed uploaded documents are **not**
altered automatically — the rule applies to what DEEDLY generates and to
review guidance, not to rewriting third-party signed files.

**Status:** recorded, implementation pending — no runtime change made in
this step.

**Relevant future implementation task:** when the generated-document /
template pipeline slice is scheduled, add a shared signature-date
formatter (full month name, `d MMMM yyyy`) used by every template
placeholder and PDF/export path, plus a review-guidance note; verify no
existing template emits numeric or abbreviated months.

## 11. Certification boundary

This review is static code inspection on `f016f3e` plus prior mock/unit
evidence. The browser-harness document behavior was simulated; no live
endpoint, storage, or database was exercised. Claims above are code-level
facts, not production certification.
