# M1 immutable migration artifact — recovery procedure

Companion to `deedly-m1-migration-preflight.md`. Covers recovery of the
**engineering-owned migration artifact only**: the ordered `.sql` files
under `src/lib/migrations/` plus `manifest.json`, which together are the
reviewed, sha256-pinned bytes the runner applies and ledgers.

**Out of scope:** external document/blob storage recovery (files in
`transfer_documents.file_path`, generated/signed evidence) — that is
M7/provider work and is not verified here. Database content recovery is
the §5 `pg_dump`/`pg_restore` procedure, not this slice.

## What is being recovered

- 27 migration SQL files + `src/lib/migrations/manifest.json`.
- Canonical bytes are LF (`.gitattributes` enforces `eol=lf`); the
  manifest digests are sha256 over raw bytes — a CRLF rendering is a
  different artifact and fails verification.

## Recovery paths

1. **Recorded git revision** (primary): the artifact is reproducible
   from any commit. `git show <rev>:src/lib/migrations/<file>` yields the
   exact committed blob bytes regardless of the local checkout's EOL
   settings.
2. **Retained artifact copy** (secondary): a directory of the `.sql`
   files + `manifest.json` stored outside the repo (e.g. release bundle,
   offline backup).

```powershell
# From a recorded revision — extracts then verifies every byte:
node scripts/migration-recover.mjs --revision=<sha> --output=<empty-dir>

# Verify a retained copy in place:
node scripts/migration-recover.mjs --verify=<dir>
```

Both modes fail closed: missing file, checksum mismatch, unlisted extra
file, malformed/missing manifest, unsorted manifest, non-empty output
dir, or unreadable revision → named failure, non-zero exit, nothing
written elsewhere. The tool never writes the schema ledger, never edits
a migration, and never reconciles a mismatch by changing bytes.

## After recovery — before any apply

1. `node scripts/migration-manifest.mjs --check` on the recovered tree
   (or `--verify` already did this per-byte).
2. Run `migrate-preflight.mjs` against the target; its ledger-vs-file
   checksum comparison decides history agreement. A mismatch means the
   target's ledger belongs to a different artifact line — **stop**. Do
   not rewrite ledger digests and do not modify historical migration
   files to force agreement; the reconciliation path is the documented
   inspect-and-manual-ledger procedure in the runbook's failure-handling
   section, which requires human review, never automation.
3. Apply with `migrate.mjs` only after preflight PASS.

## Provenance and trust boundary

- The manifest is the reviewable record of approved bytes; its own
  integrity is anchored by git (revision → blob → recorded digest).
- A recovered artifact proves *byte identity*, not *authorization*: the
  decision of which revision/manifest is the approved one is a human
  release step. This tool attests "these bytes are the recorded bytes",
  nothing more.

## Retention/ownership decisions still needed

- Who owns the retained-copy store and its retention period (release
  bundle vs. offline backup vs. git-only reliance).
- Whether a signed manifest (cosign/PGP) is required for pilot —
  currently integrity rests on git + sha256, not signatures.
- Whether the rehearsal DBs' dumps (`m1br.dump` etc.) become the
  retained DB-side artifact or stay disposable evidence.

## Verification performed (offline rehearsal)

`scripts/migration-recover.test.mjs` — 8 tests on temp copies only:
intact recovery (27/27 digests), tampered-file detection by name,
missing-file detection, unlisted-extra detection, missing/malformed
manifest rejection, exact-blob recovery from `HEAD` (byte-for-byte vs
`git show`), non-empty-output and bad-revision refusal. The original
artifact and all evidence files are untouched.
