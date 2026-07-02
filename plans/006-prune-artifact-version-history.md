# Plan 006: Prune artifact version history to a retention cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `plans/README.md` —
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5ea355c..HEAD -- convex/lib/artifactWrites.ts convex/artifactVersions.ts convex/artifactStore.test.ts convex/libraryArtifactDrafts.ts convex/artifactHtml.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (deletes user data by design — retention semantics must be
  exactly right; HTML storage blobs are shared across versions and must not
  be deleted while still referenced)
- **Depends on**: none
- **Category**: perf / data lifecycle
- **Planned at**: commit `5ea355c`, 2026-07-02

## Why this matters

Every artifact edit inserts a full snapshot row into `artifactVersions`
(title + description + full `contentMarkdown`, plus an HTML storage blob for
HTML artifacts) and nothing ever prunes them — rows and blobs accumulate for
the artifact's whole life. The UI can only ever read the latest 50 versions
(`ARTIFACT_VERSION_LIST_LIMIT = 50` in `convex/artifactVersions.ts:8`), so
everything older is pure dead weight: unbounded table growth, unbounded
storage cost, and progressively heavier full-drain work in
`deleteArtifactWrite`. This plan caps retained history at 50 versions and
prunes beyond the cap incrementally on each new version write, with correct
handling of HTML blobs that are shared between versions.

**Provenance**: a previous advisor session prototyped exactly this
(commit `e9b6bc2`, now only reachable via reflog — the branch was deleted as
stale on 2026-07-02). Its design was reviewed and is sound; this plan
re-specifies it against the current codebase (which has since drifted — do
NOT cherry-pick `e9b6bc2`) and adds one improvement: a per-call deletion
bound so a large legacy backlog drains across multiple updates instead of
one unbounded transaction.

## Current state

- `convex/lib/artifactWrites.ts` (510 lines) — all artifact write helpers.
  - `updateArtifactWrite` at line 131. When content/metadata changed, it
    inserts a new version row and bumps the artifact:
    ```ts
    // convex/lib/artifactWrites.ts:219-244 (abridged)
    const nextVersion = artifact.version + 1;
    ...
    const versionId = await createArtifactVersionWrite(ctx, { artifactId: artifact._id, version: nextVersion, ... });
    patch.version = nextVersion;
    patch.currentVersionId = versionId;
    ...
    patch.updatedAt = Date.now();
    await ctx.db.patch(args.artifactId, patch);
    await scheduleArtifactReindex(ctx, { ... });
    ```
    There is NO pruning anywhere in this file (verify:
    `grep -n "prune" convex/lib/artifactWrites.ts` → no matches).
  - `createArtifactVersionWrite` at line 253 — the only place version rows
    are inserted. The create path writes version 1; only
    `updateArtifactWrite` writes versions > 1.
  - `deleteArtifactWrite` at line ~345 — full drain on artifact deletion. It
    already demonstrates the shared-HTML-blob rule this plan must follow: a
    `deletedStorageIds: Set<Id<"_storage">>` guard so each blob is deleted
    once (lines ~388-395). Note it returns a count (write-budget convention
    from plan 001) — your new prune helper should follow the same
    "return the count" convention.
- `convex/schema.ts:619-639` — `artifactVersions` table with indexes
  `by_artifactId` and `by_artifactId_and_version` (`["artifactId", "version"]`).
  The compound index supports both the retained-range read
  (`.gt("version", threshold)`) and the stale-range read
  (`.lte("version", threshold)`).
- `convex/artifactVersions.ts:8` — `const ARTIFACT_VERSION_LIST_LIMIT = 50;`
  the UI read cap. The retention cap must be ≥ this so nothing listable is
  ever pruned. Keep the two constants explicitly linked by comment.
- **Blob sharing is real, in two ways** (both verified at `5ea355c`):
  1. Version↔version: in `updateArtifactWrite` (line 231) a new version
     reuses `previousHtml.htmlStorageId` when the HTML didn't change — one
     `_storage` blob can back many version rows. A pruned row's blob may only
     be storage-deleted when NO retained version references it.
  2. Draft↔version: `applyDraft` in `convex/libraryArtifactDrafts.ts` passes
     `htmlStorageId: draft.htmlStorageId` into the artifact write via
     `requireHtmlFieldsForApply` (lines 156-183, spread at lines 305 and
     341), and the apply patches (lines 313-317 create, 356-360 update) mark
     the draft `applied` WITHOUT clearing `htmlStorageId` — so an applied
     draft row keeps referencing the same blob as the version it produced.
     Only the discard path deletes the draft's blob
     (`deleteUnappliedDraftHtmlStorage`, lines 185-190).
  This plan resolves (2) by transferring blob ownership at apply time (see
  Step 3) so the prune's retained-version check in (1) is sufficient going
  forward. The only reader of a draft's blob is `getDraftPreviewUrl`
  (`convex/artifactHtml.ts:52-69`), a pre-apply preview that already
  degrades gracefully (`!url` → returns null) — so legacy applied drafts
  whose blob is later pruned degrade to a null preview, not a crash.
- **No restore feature exists** (verify: `grep -rn "restoreArtifactVersion\|restoreVersion" convex src`
  → no matches), so pruning does not break any user-facing restore path
  today. A restore feature was planned in an earlier session — see
  Maintenance notes.
- Conventions: version-history tests live in `convex/artifactVersions.test.ts`
  (106 lines — use its seeding style); update-path behavior tests live in
  `convex/artifactStore.test.ts`. Batched deletes use paged
  `.take(PAGE_SIZE)` loops (see `deleteArtifactWrite`).

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Install   | `bun install`                                   | exit 0              |
| Typecheck | `bun run typecheck && bun run typecheck:convex` | exit 0              |
| Lint      | `bun run lint`                                  | exit 0              |
| Tests     | `bun run test convex/artifactStore.test.ts convex/artifactVersions.test.ts` | all pass |
| Full      | `bun run test`                                  | all pass            |
| Format    | `bun run format`                                | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `convex/lib/artifactWrites.ts`
- `convex/libraryArtifactDrafts.ts` (apply-time blob ownership transfer only)
- `convex/artifactStore.test.ts` (extend — prune-on-update behavior)
- `convex/artifactVersions.test.ts` (extend — listing unaffected by prune)
- `convex/libraryArtifactDrafts.test.ts` (extend — ownership transfer)

**Out of scope** (do NOT touch):
- `convex/artifactVersions.ts` — the read cap stays as is.
- `convex/schema.ts` — the existing indexes are sufficient; no schema change.
- `deleteArtifactWrite` and the repository deletion cascade — full-drain
  deletion is a separate, already-budgeted path (plan 001).
- Any backfill cron for artifacts that are never edited again — see
  Maintenance notes for why this is deliberately deferred.

## Git workflow

- Branch: `advisor/006-prune-artifact-version-history`
- Commit style: short imperative subject matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the retention constants and prune helper

In `convex/lib/artifactWrites.ts`, add near the top:

```ts
/**
 * Retention cap for artifactVersions rows per artifact. Must stay >= the
 * UI read cap (`ARTIFACT_VERSION_LIST_LIMIT = 50` in
 * convex/artifactVersions.ts) so nothing listable is ever pruned.
 */
const MAX_ARTIFACT_VERSIONS = 50;

/**
 * Per-call bound on prune work so a large legacy backlog drains across
 * successive updates instead of one unbounded transaction. Steady state
 * deletes exactly one stale row per update.
 */
const MAX_PRUNE_DELETES_PER_UPDATE = 200;
```

Then add `pruneArtifactVersions(ctx, artifactId, latestVersion): Promise<number>`
(returning the number of delete operations performed, matching the
`deleteArtifactWrite` convention). Logic:

1. `threshold = latestVersion - MAX_ARTIFACT_VERSIONS`; if `threshold < 1`,
   return 0 (fewer rows than the cap can exist — version numbers start at 1
   and increment by 1 per update).
2. Collect the `htmlStorageId`s of RETAINED rows: query
   `by_artifactId_and_version` with `.gt("version", threshold)` and
   `.take(MAX_ARTIFACT_VERSIONS + 1)` (the retained range is bounded by the
   cap by construction; `.take` keeps the repo's bounded-read rule), building
   a `retainedStorageIds` set.
3. Delete STALE rows: page through `.lte("version", threshold)` with
   `.take(PAGE_SIZE)` (PAGE_SIZE 100, matching `deleteArtifactWrite`),
   deleting each row, and storage-deleting its `htmlStorageId` only when it
   is in neither `retainedStorageIds` nor a local `deletedStorageIds` set.
   Stop early once the combined count of row-deletes + storage-deletes
   reaches `MAX_PRUNE_DELETES_PER_UPDATE`; remaining backlog drains on the
   next update.

**Verify**: `bun run typecheck:convex` → exit 0.

### Step 2: Hook the prune into the version-bump path

In `updateArtifactWrite`, immediately after the existing
`await ctx.db.patch(args.artifactId, patch);` (line ~244) and before
`scheduleArtifactReindex`, add:

```ts
if (patch.version !== undefined) {
  await pruneArtifactVersions(ctx, args.artifactId, patch.version);
}
```

Do not hook the create path (version 1 can never exceed the cap).

**Verify**: `bun run typecheck:convex && bun run lint` → exit 0.

### Step 3: Transfer blob ownership from draft to version at apply time

In `convex/libraryArtifactDrafts.ts`, in BOTH apply patches (the create
branch at lines 313-317 and the update branch at lines 356-360), clear the
draft's blob reference when the draft is HTML-backed, e.g.:

```ts
await ctx.db.patch(draft._id, {
  status: "applied",
  appliedAt: now,
  updatedAt: now,
  ...(outputFormat === "html" ? { htmlStorageId: undefined } : {}),
});
```

(Patching a field to `undefined` unsets it in Convex. Keep `htmlHash` /
`htmlByteLength` — they are metadata, not references.) Add a one-line comment:
the version row now owns the blob; leaving the reference on the applied draft
would make version-history pruning unsafe.

Do NOT change `deleteUnappliedDraftHtmlStorage` or the discard path — a
discarded draft's blob was never transferred and must still be deleted there.

**Verify**: `bun run typecheck:convex` → exit 0, and
`bun run test convex/libraryArtifactDrafts.test.ts` → existing tests pass.

### Step 4: Tests

In `convex/artifactStore.test.ts` (follow its existing update-path seeding):

1. **Steady-state prune**: create an artifact, drive it past the cap (seed
   version rows directly via `t.run` to avoid 51 mutation round-trips —
   match the direct-insert pattern used for fence tests elsewhere, e.g.
   `convex/artifactViews.test.ts`), perform one real update, then assert:
   rows with `version <= latest - 50` are gone, the newest 50 remain, and
   `artifact.currentVersionId` still resolves.
2. **Shared-blob protection**: seed two version rows sharing one
   `htmlStorageId` where one falls below the threshold and one above; after
   prune, assert the blob still exists (`ctx.db.system.get(storageId)` not
   null) while the stale row is gone. Then push the second row below the
   threshold with further updates and assert the blob is deleted once no
   retained row references it.
3. **Backlog bound**: seed a backlog larger than
   `MAX_PRUNE_DELETES_PER_UPDATE` below the threshold (export the constants
   from `artifactWrites.ts` so tests import them); one update must delete at
   most the bound and leave the rest; a second update continues the drain.

In `convex/artifactVersions.test.ts`: one test asserting the version listing
query still returns the retained versions (newest-first, unchanged shape)
after a prune has occurred.

In `convex/libraryArtifactDrafts.test.ts` (follow its existing apply-flow
tests):

4. **Ownership transfer**: apply an HTML draft; assert the applied draft row
   no longer carries `htmlStorageId`, the produced version row does, and the
   blob still exists. Also assert `getDraftPreviewUrl` returns null for the
   applied draft (graceful, not throwing) while the artifact's version
   preview URL still resolves.

If a seeded fixture exceeds ~2s runtime, give that single test an explicit
`30_000` ms timeout with a "heavy by design" comment (precedent:
`convex/repositories-delete.test.ts:943`).

**Verify**: `bun run test convex/artifactStore.test.ts convex/artifactVersions.test.ts convex/libraryArtifactDrafts.test.ts`
→ all pass, including the 5 new tests.

## Test plan

Covered in Step 3. Full-suite gate: `bun run test` → all pass (if an
unrelated file fails on a 5s timeout, re-run it in isolation once before
treating it as a failure).

## Done criteria

- [ ] `bun run lint` exits 0
- [ ] `bun run test` exits 0; the 5 new tests exist and pass
- [ ] `grep -n "MAX_ARTIFACT_VERSIONS" convex/lib/artifactWrites.ts` shows the
      constant and `grep -n "pruneArtifactVersions" convex/lib/artifactWrites.ts`
      shows exactly one definition plus one call site in `updateArtifactWrite`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (unless reviewer maintains it)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift).
- You find a code path other than `createArtifactVersionWrite` that inserts
  `artifactVersions` rows, or a path that reads versions older than the UI
  cap (e.g. a restore/diff feature landed since planning) — pruning would
  then need a product decision.
- Version numbers turn out not to be dense/monotonic (+1 per update) for
  some artifacts — the `threshold` arithmetic assumes they are.
- You find a blob reference source OTHER than `artifactVersions` and
  `artifactDrafts` (the draft case is known and handled by Step 3) — e.g. a
  new table or feature also storing `htmlStorageId` — the retained-set check
  would be insufficient for it.
- `getDraftPreviewUrl` (or any other reader) turns out to be called for
  APPLIED drafts somewhere in `src/` in a way where a null preview is a
  user-visible regression rather than a non-event.

## Maintenance notes

- **Restore feature interaction**: an earlier session planned
  "restore artifact version". If that ships later, it can only restore what
  retention keeps (50 versions) — the two features must be reviewed together;
  the restore UI should never offer versions the prune may delete mid-flight.
- **Legacy backlog for dormant artifacts**: artifacts that are never edited
  again keep their oversized history forever (prune only runs on update).
  Deliberately deferred: a one-shot backfill via `@convex-dev/migrations`
  (see the `convex-migration-helper` skill) is the right tool if the
  operator wants the storage back; don't bolt a cron onto this plan.
- Reviewer should scrutinize: the early-return `threshold < 1` (off-by-one
  here silently disables pruning or deletes one row too many), and that the
  storage-delete guard checks BOTH the retained set and the already-deleted
  set.
- `artifactDrafts` also carries `htmlStorageId` fields — today drafts copy
  content into a version on apply; if a future change makes drafts SHARE
  blobs with versions, the STOP condition above becomes a real bug. Watch in
  review.
