# Matter Documents — Upload & Readback Slice Status

Assessment of the authenticated document upload-and-readback lane against
`docs/deedly-matter-documents-decisions.md`, plus the bounded implementation
slice delivered alongside it.

**Scope deliberately excluded:** pending catalogue/rule seed, condition
vocabulary, stage gating, readiness semantics, replacement/retention, and
client document access — all remain undecided and untouched.

## 1. Selected slice

Two bounded gaps found in the existing lane; both implemented:

1. **Audit-completeness on rejections.** The decisions doc lists
   `upload_rejected` events for "size/type/conflict/concurrency", but
   empty-file and unsupported-type rejections raised before any
   `record_operation` — invisible in the operation log. Both now write an
   `upload_rejected` row (`reason: "empty_file"` / `"unsupported_type"`).
2. **Rescan-stored-object recovery.** After a scanner outage
   (`scan_status='error'`) the only retry path was re-uploading the identical
   bytes — up to 25 MB resent to trigger a rescan of an object already
   stored. New `POST /api/v1/transfers/{id}/documents/{documentId}/rescan`
   (staff `transfers:write`, same-tenant) fetches the stored bytes under the
   document's content-addressed key and re-scans them. `clean` and
   `infected` verdicts are final and replay unchanged; a document with no
   stored object returns 409. The UI "Retry scan" button now calls this
   endpoint instead of forcing a file re-pick.

No new external contracts were introduced — the rescan path uses the
existing `DocumentStorage.get` and `MalwareScanner.scan` interfaces only.

## 2. Implemented and verified

| Area | State | Evidence |
|---|---|---|
| Staff-only upload (`transfers:write`), tenant-scoped, client denied | Done | Route tests: auth/ability/tenant/client gates |
| 25 MB limit — declared + actual bytes | Done | FastAPI `file.read(cap+1)` + `UploadBodyLimitMiddleware`; BFF streaming byte-count `Transform`; declared-oversize 413 at both layers |
| Content validation (magic bytes; DOCX = OOXML package + `.docx`) | Done | Synthetic PDF/PNG/DOCX accepted; EXE/renamed-ZIP rejected |
| Storage state | Done | `LocalDocumentStorage`: atomic publish, content-addressed keys, never-overwrite — real-filesystem + thread tests |
| Scan state | Done | `pending`/`clean`/`infected`/`error` separate from lifecycle `status`; scanner failure → `error`, never releases; infected final per bytes |
| Authorized download | Done | `transfers:read` issues 5-min HMAC bearer token; retrieval re-checks clean/uploaded; `no-store` + `Content-Disposition`; storage key never projected |
| Retry/recovery | Done | Same-bytes replay, different-bytes conflict, rescan without re-upload (this slice), durable op-log for storage/persist failures |
| Op-log durability | Done | Best-effort with stderr alert on write failure; rejections, scans, link issuance, retrievals and denials recorded |

Test totals after this slice: **69** in
`python_server/tests/test_v1_matter_documents.py` (was 57) and **13** in
`server/tests/v1Documents.test.ts` (was 12). All synthetic files; no live
service contacted.

## 3. Flagged — not fixed in this slice

- **BFF read-path duplication.** `GET /:id/documents` on the BFF mirrors the
  FastAPI evaluation-flag logic (`unevaluatedFacts`/`unevaluatedRules`) in
  TypeScript while all mutations proxy to FastAPI. Two implementations of the
  same semantics can drift; a future change should make the BFF proxy the
  FastAPI read, or lift the shared logic. Behaviour is currently consistent
  and tested on both sides.
- **`document_operation_log` is the audit stand-in.** The platform audit
  logger contract (`legitify_auditor` / `AUDIT_DATABASE_URL`) is unconfirmed
  — flagged in the service docstring, not invented.
- **Reconciliation sweep** — the decisions reference failure records being
  "discoverable by the reconciliation sweep"; no sweep exists. Op-log failure
  rows carry `storage_key`/`file_instance_id` so one can be built.

## 4. Blocked — external contracts (do not implement against stubs)

| Dependency | Status | Needed for |
|---|---|---|
| Files-service endpoint + credentials | Missing (Clive) | `FilesServiceStorage` verification — shell fails closed when `FILES_SERVICE_BASE_URL` unset |
| Deployed ClamAV (`clamd`) | Missing | `ClamAvScanner` verified only against fake scanner doubles |
| Platform audit logger | Missing | Replace `document_operation_log` stand-in |
| Transfer-delete FK policy | Jordan's decision | Whether transfer deletion cascades to documents/op-log |
| Live deployment + browser certification | Not attempted | Production sign-off |

`DOCUMENT_STORAGE_BACKEND` unset/`local` → local adapter; `files_service`
without `FILES_SERVICE_BASE_URL` → fails closed. `DOCUMENT_SCANNER_BACKEND`
default `none` → `UnavailableScanner` releases nothing.

## 5. Acceptance checks — what each guarantees

- Unauthorized/cross-tenant/client upload → 401/404/403 before storage.
- Declared oversize → 413 pre-consumption (both layers); chunked oversize →
  413 mid-stream; misleading extension/MIME → 422 with `upload_rejected`
  logged.
- Clean scan → `uploaded` + downloadable; infected → quarantined, never
  downloadable; scanner outage → `error`, bytes retained, rescan recovers.
- Same bytes → replay (no rescan, no duplicate object); different bytes →
  409, winner never overwritten.
- Download link: issued only to staff on clean docs; tampered/expired/
  cross-doc/cross-tenant tokens → 403; state re-checked at retrieval.
- Internal identifiers (`storage_key`, `file_instance_id`, `sha256`,
  uploader id) absent from every client projection.
