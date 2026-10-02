# M1 backup/restore rehearsal — evidence report

Executed 2026-10-02 against the approved Neon project, branch
`m1/backup-restore-rehearsal` at `4309fa1` (procedure §5 of
`deedly-m1-migration-preflight.md`). This run had **deviations** — it is
not a deviation-free certification. Everything below is recorded fact.

## Targets

- Source `deedly_m1_backup_src` — built by applying the canonical
  migration artifact (27 files) to an empty database.
- Restore target `deedly_m1_restore_verify` — empty `CREATE DATABASE`.
- `deedly_m1_verify` and `deedly_m1_verify_lf` were never source, target,
  or subject of any statement; both preserved unchanged.

## Tools and connection security

- PostgreSQL 17.7 client tools, binaries-only zip
  (`postgresql-17.7-1-windows-x64-binaries.zip` from get.enterprisedb.com)
  extracted to `C:\Users\Dean\pg17-client` — **no installer ran, no
  server/service created**; `Get-Service` confirmed no new `postgresql*`
  service. Recorded versions: pg_dump/pg_restore/psql all 17.7.
- All connections: direct endpoint
  `ep-red-term-awh8wnfa.c-12.us-east-1.aws.neon.tech`, `sslmode=verify-full`.
- **Cert trust:** `PGSSLROOTCERT=system` FAILED closed on this libpq
  build (certificate verify failed — correctly refused). Fallback used:
  ISRG Root X1 exported from `Cert:\LocalMachine\Root`
  (thumbprint CABD2A79A1076A31F21D253635CB039D4329A5E8) to
  `%APPDATA%\postgresql\root.crt`; verify-full then succeeded.
- **Credentials:** temp pgpass file `%TEMP%\m1br_pgpass.conf`
  (host:port:*:user:password). Password never on a command line or
  printed. Node scripts used `DB_*` env vars only.
  - **First creation:** `icacls /inheritance:r /grant:r "$env:USERNAME:R"`
    applied, `Get-Acl` asserted — protected from inheritance, single
    user Allow. (That `:R` grant later blocked the `finally` delete —
    see deviations.)
  - **Second creation** (recreated mid-run for the residual-count
    query): the `icacls` command **failed** — `Invalid parameter
    "/grant:r"` — so that file ran with default inherited TEMP ACLs and
    its ACL was never re-verified. It was used for queries and then
    deleted. Verified afterward: file absent (manual `rm`, confirmed);
    the credential itself was never written to any ACL-broad location
    and the TEMP directory is the user-private profile dir.
  - File deleted post-run — verified absent (`Test-Path`/`ls`).

## Commands (recorded forms)

- `pg_dump --format=custom --no-owner --no-acl -d deedly_m1_backup_src -f m1br.dump`
- `pg_restore --no-owner --no-acl --exit-on-error -d deedly_m1_restore_verify m1br.dump`
  (flag corrected: `--exit-on-error`, not `--exit_on_error`)
- All `psql` calls: `-X -v ON_ERROR_STOP=1 -d <db>` with
  `current_database()` asserted before mutating operations.
- Node: `migrate-preflight.mjs --expect-host --expect-database
  --expect-environment=disposable`; `migrate.mjs` via `DB_*` env vars.

## Timings

- `pg_dump`: **38.36s**, 268,379 bytes.
- `pg_restore`: **150s**, exit 0 with `--exit-on-error`.
- `migrate.mjs` source build: 27/27 applied (advisory lock held; direct
  endpoint).

## Verification results (all pass)

| Check | Result |
|---|---|
| Source pre/post preflight | PASS — fresh→27 pending; then 27 applied/0 pending |
| Ledger vs manifest | 27/27 canonical LF digests |
| Schema diff (raw dumps preserved) | identical after banner-strip + reviewed allowlist (below) |
| Catalog parity | 265 constraint defs + 210 index defs identical |
| Extension parity | `plpgsql 1.0`, `uuid-ossp 1.1` on both |
| Row counts | 63/63 tables identical |
| Seeded-table content hashes | `transfers.transfers`, `transfers.transfer_documents` identical |
| Ledger deep-equal | 27 rows identical incl. `applied_at` |
| Restored-target preflight | PASS, 27 applied / 0 pending |
| Restored-target migrate | 0 applied, all skipped — advisory-lock runner works |
| FK + artifact | doc row resolves to transfer; artifact sha256 unchanged |
| Fixture cleanup | **0 residual M1BR- rows on BOTH src and dst** |

## Original schema differences — reviewed and allowlisted

Raw schema-only diff: **104 lines**, all 52 CHECK constraints using
`x = ANY (ARRAY[...])`. Two deparse variants of identical expressions:

- Source renders `(ARRAY['x'::character varying,…])::text[]`
  (cast on the whole array).
- Restored renders `ARRAY[('x'::character varying)::text,…]`
  (per-element cast).

Equivalence was **verified, not assumed**: literal sets extracted per
constraint are identical on both sides; and 104 live `SELECT` probes on
both databases (first literal accepted, `'ZZZ_M1BR_INVALID'` rejected,
`NULL` → NULL = CHECK passes) all matched — pure SELECTs, zero writes,
baseline untouched. After the allowlist, zero residual schema diff.

Affected constraints (52): audit_log_action_check, bonds_status_check,
cancellations_status_check, clause_versions_status_check,
communications_{communication_type,direction,status}_check,
document_catalogue_{module,status}_check,
document_template_versions_status_check, document_templates_status_check,
documents_status_check, fica_verifications_{risk_rating,status}_check,
firms_status_check, generated_documents_output_format_check,
matter_parties_role_check, party_bank_accounts_{purpose,
verification_status}_check, template_data_fields_data_type_check,
users_role_check, clearance_records_{clearance_type,status}_check,
compliance_certificates_{certificate_type,status}_check,
document_operation_log_{operation,outcome}_check,
document_requirement_rules_status_check, matter_account_entries_{category,
entry_type}_check, matter_accounts_{account_type,status}_check,
matter_milestones_status_check, matter_properties_property_kind_check,
matters_{matter_type,priority,status}_check, parties_type_check,
check_property_type, properties_status_check, refunds_status_check,
representative_assignments_assignment_state_check,
transfer_conditions_{condition_type,status}_check,
transfer_document_requirements_{source,status}_check,
transfer_documents_{scan_status,status}_check,
transfer_guarantees_status_check,
transfer_parties_{party_source,source_fields}_check,
transfers_status_check.

## Deviations (execution continued past these; recorded honestly)

1. **Seed insert failed once** — `transfer_documents.accountable_institution_id`
   is NOT NULL (later migration); the seed was corrected and re-run.
   Execution continued.
2. **Schema diff mismatch on first comparison** — the 104-line
   CHECK-deparse difference above; execution continued after the
   equivalence review and allowlist.
3. `PGSSLROOTCERT=system` rejected the chain — PEM fallback used.
4. Credential handling failed twice, honestly recorded: (a) the first
   pgpass `:R` ACL blocked the `finally` delete — manual `rm` completed
   it; (b) the second pgpass creation's `icacls` command failed outright
   (`Invalid parameter "/grant:r"`), so that file's ACL was not the
   restricted set and was not re-verified — it was deleted after use.
   Procedure doc corrected to `:F`.
5. `--exit-on-error` flag spelling corrected from `--exit_on_error`.
6. A transient connection stall hit psql mid-review (Neon compute
   wake-up); Node `pg` connections were unaffected.
7. The credential secret was passed to non-interactive shells via a
   process env var (`M1BR_PW`) rather than the documented interactive
   `Read-Host -AsSecureString` — env-only, never on a command line.

## Metadata↔file check — scope label

The artifact check verified **DB-side metadata↔file linkage only**: a
`transfer_documents` row's `file_path`/`file_size` still resolves to a
local file whose sha256 (`daa6558…`) was unchanged. It did NOT restore an
external file-storage backup; immutable-blob recovery remains
outstanding (§7 of the preflight doc).

## Evidence inventory and access

- `C:\Users\Dean\m1br-run\` — `m1br.dump` (sha256
  `c67c47c98d807d4e4abe1b6cdd1e78b2b74f944fb80ecb7ad9b8662f9913c70e`,
  268,379 B), `schema-src.sql`, `schema-dst.sql`, `src-ledger.tsv`,
  `dst-ledger.tsv`, `src-counts.txt`, `src-constraints.txt`,
  `src-indexes.txt`, `src-extensions.txt`, `src-hashes.txt`.
  ACL: SYSTEM, Administrators, Dean — FullControl (user-profile dir).
- `C:\Users\Dean\m1br-artifact.bin` (sha256 `daa6558…3b4d`) +
  `.sha256` sidecar.
- Both rehearsal databases preserved as evidence; contain only
  migration-seed data after fixture cleanup.
- `m1br-constraints.mjs` (analysis script) left untracked in the
  worktree, deleted after use.

## Outstanding M1 items

- Immutable-artifact/blob storage recovery rehearsal (not this slice).
- Backup/restore **schedule and RPO/RTO** for real pilot data — this
  proved the manual path only, on synthetic data.
