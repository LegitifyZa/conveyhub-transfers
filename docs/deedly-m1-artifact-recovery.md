# M1 immutable migration artifact — recovery procedure

Companion to `deedly-m1-migration-preflight.md`. Covers recovery of the
**engineering-owned migration artifact only**: the ordered `.sql` files
under `src/lib/migrations/` plus `manifest.json`, which together are the
reviewed, sha256-pinned bytes the runner applies and ledgers.

**Out of scope:** external document/blob storage recovery (files in
`transfer_documents.file_path`, generated/signed evidence). Per the
megaplan, immutable-file recovery belongs to the M0 operational-acceptance
restore rehearsal ("database, immutable files and the metadata/file
relationship") and M7's document-transport/immutable-version work — it
is not part of M1's recoverable-release-procedure exit and is not
verified here. Database content recovery is the §5 `pg_dump`/`pg_restore`
procedure, not this slice.

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
node scripts/migration-recover.mjs --revision=<sha> --output=<empty-dir> `
  --expect-manifest-sha256=<approved-manifest-digest>

# Verify a retained copy in place:
node scripts/migration-recover.mjs --verify=<dir> `
  --expect-manifest-sha256=<approved-manifest-digest>
```

`--expect-manifest-sha256` pins the manifest itself to an **independent
trust reference** — required for retained-copy verification and strongly
recommended for revision recovery. Without it a copy carrying a *rewritten*
manifest (digests recomputed over tampered files) verifies against itself
and reports OK. Obtain the approved digest from the recorded revision:

```powershell
git show <approved-sha>:src/lib/migrations/manifest.json | sha256sum
# Windows without sha256sum:
git show <approved-sha>:src/lib/migrations/manifest.json |
  Set-Content -AsByteStream $env:TEMP\m1-mf.json -NoNewline
Get-FileHash -Algorithm SHA256 $env:TEMP\m1-mf.json
```

Both modes fail closed: missing file, checksum mismatch, unlisted extra
file, malformed/missing manifest, unsafe manifest path (traversal,
absolute or nested entries), duplicate entries, symlink or non-regular
entries (a link can resolve outside the artifact dir — rejected via
`lstat`, never followed), unsorted manifest, manifest-digest mismatch
against the expected value, non-empty output dir, or unreadable revision
→ named failure, non-zero exit. Extraction fetches all blob bytes before
any disk write and leaves a `.recovery-incomplete` marker for the whole
write window, so a partial or interrupted recovery can never verify as a
complete artifact. Recovery is confined to the selected output directory.
The tool never writes the schema ledger, never edits a migration, and
never reconciles a mismatch by changing bytes.

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

## Does the earlier disposable-DB validation cover the recovered bytes?

Partially, and precisely: `deedly_m1_verify_lf` was built by applying the
canonical LF artifact at its recorded revision, and its ledger digests
matched the manifest (27/27). Recovery from that same recorded revision
produces **byte-identical** files (proven by the rehearsal's
`git show`-equality check and the manifest digests), so that validation
transfers to the recovered copy of *that* revision. A separate
artifact-based apply is required when: (a) recovering a different
revision than the validated one, or (b) acceptance requires applying
from the recovered directory itself rather than the working tree — the
runner currently reads `src/lib/migrations`, so applying a recovered copy
would need an explicit reviewed step. No new DB rehearsal was run for
this slice.

## Verification performed (offline rehearsal)

`scripts/migration-recover.test.mjs` — 12 tests on temp copies only:
intact recovery (27/27 digests), tampered-file detection by name,
missing-file detection, unlisted-extra detection, tampered-file +
rewritten-manifest rejected when the approved manifest digest is pinned
(proving a self-referential manifest is not accepted as the approved
artifact), unsafe manifest path entries (traversal/absolute/nested)
rejected, duplicate entries rejected, symlink-in-place-of-file rejected
via `lstat` without following it, missing/malformed manifest rejection,
exact-blob recovery from `HEAD` (byte-for-byte vs `git show`), and
non-empty-output / bad-revision refusal. The original artifact and all
evidence files are untouched.
