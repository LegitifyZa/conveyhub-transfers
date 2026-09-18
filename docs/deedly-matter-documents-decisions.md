# Matter Documents — implementation decision table for Dean/Louis

Companion to `docs/deedly-matter-documents-scope.md` (scope review on
`f016f3e`). This document lists the decisions needed to implement
Authenticated Matter Documents. For each item it separates **established
constraints** (what existing source material already fixes) from
**recommendation** (proposed, needs sign-off) and identifies the decider.

Status of surrounding work: Property Capture and Linking — In Review
(unmerged). Production Authentication — Blocked. This document proposes
nothing that requires either to land first.

---

## 0. Approval record (2026-09-18)

The decisions below were reviewed and **approved with the following
outcomes**; implementation proceeded on
`deedly/mvp0/documents/upload-and-readback` (commit `f9c33d3`). Where the
approval differs from the recommendation in the table, the approval wins.

| Item | Approved outcome |
|---|---|
| D1 Storage provider | **Provider abstraction** with one configured local development adapter now; files-service/S3-compatible backend prepared behind the interface — direct S3 access is NOT assumed to replace the files-service contract. `FilesServiceStorage` client shell exists and fails closed until `FILES_SERVICE_BASE_URL` is configured. |
| D2 Provisioning | **Clive still needs to confirm the non-production endpoint and credentials.** The documented port 8005 is not confirmation of a deployed service. Files-service integration remains unverified. |
| D3 File types | **PDF, DOCX, JPG/JPEG, PNG only**, server-side content validation (magic-byte sniffing; DOCX additionally requires the `.docx` name since it is a ZIP container). |
| D4 File size | **Hard 25 MB per-file limit enforced during upload.** |
| D5 Scanning | **Malware-scanner interface + ClamAV adapter** (clamd INSTREAM). Files remain unavailable until a clean result; scanner failure/unavailability never releases them. The no-scanner-fallback in the original D5 row is superseded — storage, scanning and human-review states are kept separate; human verification/rejection is outside this slice. |
| D6–D8 Permissions | Staff upload: `transfers:write` + same-institution matter. Staff list/download: `transfers:read` + same-institution. **Client document access remains excluded.** |
| Download links | **Short-lived secure links issued after authorization** — opaque HMAC bearer token, 5-minute default TTL, no individual revocation before expiry (documented limitation); document clean/uploaded state re-checked at retrieval; internal paths/storage keys never exposed. "Link issued" and "file retrieved" are distinct audit events. |
| Retry/recovery | Established idempotency pattern, bound to institution + matter + document + file fingerprint; same key with changed content conflicts; retries return the same document/object. Partial failures recorded durably in `document_operation_log` with identifiers/outcome for reconciliation — no file contents, credentials or tokens logged. |
| Replacement/retention | **No replacement, version overwrite, physical deletion or automatic object cleanup in this slice.** Metadata cascades must not silently destroy the only record of retained files — the `transfer_id ON DELETE CASCADE` risk is flagged for Jordan's review in migration 025 §E. |
| Audit | Platform audit logger contract is a **flagged missing integration** (`legitify_auditor`/`AUDIT_DATABASE_URL` unconfirmed); the slice's adapter is `document_operation_log`. Audit-delivery failure behavior is explicit: it does not roll back the business operation and is surfaced for reconciliation. |
| Required documents | **Included in P0** — baseline requirements per classification plus conditional additions, evaluated by a rules engine. **Dean will supply the approved catalogue and rule definitions** — the mechanism ships with an empty rules table; the bond-approval-letter example remains illustrative only. Seeding is idempotent; a requirement is distinct from an uploaded file; recalculation preserves existing uploads; a requirement that stops applying is withdrawn in place and its evidence is never auto-deleted. Submission/milestone gates and waiver permissions remain undecided product questions (§4). |
| Schema | Migration 025 authored for review (not executed): `accountable_institution_id` on `transfer_documents`, idempotency/storage/scan columns, `document_requirement_rules`, `transfer_document_requirements`, `document_operation_log`, and the proposed cascade-path change — all coordinated through Dean to Jordan. |


## 1. Evidence base

What source material already establishes:

- **Target storage:** `docs/deedly-data-boundary-audit.md` §3 —
  "Binary data lives in the `files` service (MinIO/S3). Transfers keeps
  only status, `storage_key`, `file_instance_id` and
  `uploaded_by_user_id`." Recommended transition already recorded: add
  `storage_key`/`file_instance_id` nullable to `transfer_documents`, keep
  writing `file_path` until integration, then batch-migrate.
- **Evidence-status vocabulary:** `docs/deedly-specialist-role-capacity-contract.md`
  defines `not_supplied | uploaded | pending_verification | verified |
  rejected` with `verified_at`/`verified_by_actor_id` and
  `accountable_institution_id` — a platform-level concept that document
  status should align with rather than invent a parallel set.
- **Audit target:** platform `AuditLogger` → `legitify_auditor`
  (audit doc §3/§5.8). `transfer_documents` has no audit trigger today.
- **Missing evidence — flagged, not assumed:** no `files` service URL,
  credentials, or env var exists anywhere in this repo
  (`python_server/config.py`, `server/`, `.env` samples all checked).
  Whether a deployed/non-production `files` service actually exists is
  unknown — the audit records intent, not provisioning. This must be
  confirmed before assuming either "use the service" or "we need a new
  service".
- **Current reality:** bytes go to unserved local disk in two different
  directories (BFF repo-root `uploads/` vs `python_server/uploads/`);
  no download endpoint exists; statuses are UI-local state (scope doc §3–5).

## 2. Decision table

| # | Topic | Established constraint (evidence) | Recommendation | Decider | Blocks |
|---|---|---|---|---|---|
| D1 | Storage provider | Platform target is the `files` service (MinIO/S3) with `storage_key`/`file_instance_id` on the row | Integrate the `files` service rather than building new storage. If it is not provisioned for non-prod, implement behind a storage-provider interface with a single configured local root as the dev adapter — never the repo-relative dual directories of the dead code | Dean confirms provisioning; platform owns the service | Start (provider interface choice); Deploy (actual service) |
| D2 | Provisioning owner + non-prod availability | None — no config evidence found | Platform team confirms whether a `files` service instance + credentials exist for dev/staging; if not, the slice must be scoped to the local adapter with integration marked unverified | Dean → platform | Deploy |
| D3 | Allowed file types | None found | Allow-list by extension + sniffed content (not client-declared MIME): pdf, jpg, png, tiff, docx as the probable conveyancing set — confirm the list | Dean/Louis | Start |
| D4 | Maximum file size | None found; dead code had no cap | Recommend 25 MB per file (typical scanned deed bundles); enforce server-side before store, reject larger with 422 | Dean/Louis | Start |
| D5 | Scanning/quarantine | None found; no scanning exists today | If a scanner is available: files land `pending_scan` and become downloadable only after a clean result. If no scanner exists: documents upload-and-download within the same institution immediately, and scanning is recorded as a deployment prerequisite — do not fake a scan state | Dean/Louis + platform (scanner availability) | Start (state model); Deploy (scanner) |
| D6 | Staff upload permission | `transfers:write` is the established write ability (property slice precedent) | Upload/add requires `transfers:write` + same-institution matter | Established | Start |
| D7 | Staff download permission | `transfers:read` precedent; live metadata GET already gates on it | Download requires `transfers:read` + same-institution, re-authorized per request; `file_path`/`storage_key` never leave the API | Established pattern — confirm | Start |
| D8 | Client upload/download | Clients are fail-closed everywhere today (role 4 → 404) | Keep fail-closed; client document access is a separate product feature (portal), not this slice | Dean/Louis confirm | Start |
| D9 | Upload states | DB CHECK: `pending, uploaded, verified, rejected, not_required`; platform vocabulary adds `not_supplied`, `pending_verification` | Slice persists only `pending` → `uploaded` (row create + successful store). `verified`/`rejected`/`not_required` stay unset — reviewer semantics pending (§4). Do not adopt the platform vocabulary mid-flight without mapping legacy values | Dean/Louis (semantics); engineer (mapping) | Start |
| D10 | Retry/recovery | Idempotency pattern established (migration 024: `client_request_id` + fingerprint) | Same pattern on document rows + upload; lost-response retry replays to same row/object; failed compensating deletes feed a reconciliation sweep — a delete alone is not orphan recovery (scope doc §6) | Established pattern; schema via Dean→Jordan | Start |
| D11 | Replacement | Legacy dead code overwrote `file_path` leaving orphans | Replacement writes a new object, updates the row, tombstones the prior object for sweep — whether replacement is allowed at all pre-verification is a product decision | Dean/Louis | Start |
| D12 | Retention/deletion | `transfer_id` CASCADE deletes rows on transfer delete; no file retention policy exists | DB cascade keeps metadata tidy; file-object deletion policy (delete with matter vs retain for audit) needs a decision; recommend retain-object + soft tombstone until policy is set | Dean/Louis + compliance | Deploy |
| D13 | Audit coverage | Target is platform `legitify_auditor`; `transfer_documents` has no audit trigger | Document writes emit audit events through the established AuditLogger path when wired; do not add a local audit trigger in this slice | Dean→Jordan coordination | Deploy |
| D14 | Catalogue seeding | Dead code seeded `pending` rows per Active catalogue entry on transfer create | On-demand add only in the slice — auto-seeding encodes required-document rules that are undecided (§4) | Dean/Louis | Start |
| D15 | Auto-seeding / required docs per classification | None — no classification rules exist | Out of scope; flag as future decision, not a slice dependency | Dean/Louis | — |

## 3. Smallest useful slice (proposed, not approved)

**Scope:** staff-only, same-institution, ability-gated upload + readback on
an existing matter:

1. `POST /api/v1/transfers/{id}/documents` — create `pending` row
   (`catalogue_document_id | name` + `client_request_id`).
2. `POST /api/v1/transfers/{id}/documents/{docId}/file` — multipart upload
   to the storage provider; row → `uploaded` only on confirmed store.
3. `GET /api/v1/transfers/{id}/documents` — existing live metadata GET.
4. `GET /api/v1/transfers/{id}/documents/{docId}/file` — authenticated,
   re-authorized download stream.
5. UI: wire existing `StepDocuments` + `TransferDocumentsPanel` to the v1
   endpoints; statuses remain display-only until §4 semantics land.

**Acceptance criteria:**

- Staff with `transfers:write` on a same-institution matter can add a
  document row, upload a file within the type/size allow-list, see it
  listed, and download it back — all authenticated, all tenant-scoped.
- Client role and foreign institutions get 404/403 on every path.
- A failed store leaves `pending` with no storage reference; a lost
  response retries to the same row/object via `client_request_id`; a
  failed compensating delete is discoverable by the reconciliation sweep.
- Download responses carry no `file_path`/`storage_key`; metadata
  projection unchanged.
- Tests: unit (validation/authz/projection), guarded Postgres (state
  transitions, tenant isolation, idempotent replay), browser harness
  (upload→list→download, failure honesty, retry same key) — clearly
  labelled mock evidence, not live certification.

## 4. Deferred decisions (not blocking this slice)

Explicitly pending — none are invented here: reviewer permission model
(`verified`/`rejected`), `not_required` semantics, required-document rules
per classification, submission/milestone gating, replacement policy for
verified docs, retention schedule, client document access.

## 5. Schema/storage dependencies — Dean → Jordan

- `transfer_documents`: `storage_key` + `file_instance_id` nullable
  columns (the audit doc's recorded transition), `client_request_id` +
  `request_fingerprint` idempotency columns (024 pattern), possibly
  `accountable_institution_id` for direct tenant indexing (boundary per
  scope doc §3 — the join-based scoping must be verified regardless).
- Storage provider interface + credentials config.
- Migration numbering coordination as before.
