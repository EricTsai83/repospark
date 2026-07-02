# Plan 001: Enforce the cascade write budget in the repository artifact drain

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3458fd0..HEAD -- convex/lib/repositoryOwnedDataAdapters.ts convex/lib/artifactWrites.ts`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the repository-deletion cascade; must not orphan rows)
- **Depends on**: none
- **Category**: perf / reliability
- **Planned at**: commit `3458fd0`, 2026-07-02

## Why this matters

Repository deletion drains owned data in budgeted batches so each mutation
stays under Convex's per-transaction read/write limits. The file already
defines `CASCADE_SAFE_READ_LIMIT = 30_000` / `CASCADE_SAFE_WRITE_LIMIT = 15_000`
and a `CascadeBudget` that some drains honor (e.g.
`drainToolCallEventsByMessageId`). But `drainArtifactsByRepositoryId` ignores
the budget: it takes up to `CASCADE_BATCH_SIZE = 200` artifacts and calls
`deleteArtifactWrite` for each, and each of those calls internally deletes up
to 200 chunks plus all views, versions, and HTML storage refs for that
artifact — with no cap visible to the caller. Worst case a single mutation
attempts tens of thousands of writes and the deletion mutation fails outright,
stalling the repository-retirement state machine. This plan threads a write
budget through the artifact drain so one pass always stays under the safe
limit and the lifecycle's existing `more`/reschedule loop absorbs the rest.

## Current state

- `convex/lib/repositoryOwnedDataAdapters.ts` — adapter chain for repository
  owned-data draining. Key excerpts at commit `3458fd0`:
  - Lines 9–16: budget constants and the `CascadeBudget` type:
    ```ts
    const STREAM_CHUNK_DRAIN_PASS_LIMIT = 8;
    const CASCADE_SAFE_READ_LIMIT = 30_000;
    const CASCADE_SAFE_WRITE_LIMIT = 15_000;

    interface CascadeBudget {
      reads: number;
      writes: number;
    }
    ```
  - Lines 46–56: `canReadBatch` / `canWriteBatch` / `canStartBatch` helpers.
  - Lines 58–78: `drainToolCallEventsByMessageId(ctx, messageId, budget)` —
    the exemplar of a budget-aware drain. Match this pattern.
  - Lines 80–87: the offending drain (no budget):
    ```ts
    async function drainArtifactsByRepositoryId(ctx: MutationCtx, repositoryId: Id<"repositories">): Promise<boolean> {
      const docs = await ctx.db
        .query("artifacts")
        .withIndex("by_repositoryId", (q) => q.eq("repositoryId", repositoryId))
        .take(CASCADE_BATCH_SIZE);
      for (const doc of docs) await deleteArtifactWrite(ctx, doc._id);
      return docs.length === CASCADE_BATCH_SIZE;
    }
    ```
  - Line ~389 (inside `drainRepositoryContentState`): the call site
    `more = (await drainArtifactsByRepositoryId(ctx, args.repositoryId)) || more;`
    The chain returns `more: boolean`; the lifecycle layer
    (`convex/lib/repositoryOwnedDataLifecycle.ts`) reschedules another pass
    when `more` is true — so returning early with `more = true` is safe and
    is the intended backpressure mechanism.
- `convex/lib/artifactWrites.ts:337-363` — `deleteArtifactWrite(ctx, artifactId)`
  deletes, per artifact: all `artifactChunks` (paged 100 at a time, up to
  `MAX_ARTIFACT_CHUNKS_PER_ARTIFACT = 200`), all `artifactViews`, then
  `deleteArtifactVersionsAndHtmlStorage` (all `artifactVersions` + storage
  blobs), then the artifact row. It currently returns `Promise<void>`.
- Repo conventions: budget-aware drains mutate a `CascadeBudget` object passed
  by reference and stop when `canStartBatch` fails (see
  `drainToolCallEventsByMessageId`). Deletion helpers that report work done
  return counts — see `deleteMessageStreamState` in
  `convex/chat/streamStore.ts:119-140`, whose docstring explains the
  "return the count so callers can budget" convention. Match both.

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck && bun run typecheck:convex` | exit 0              |
| Lint      | `bun run lint`                                  | exit 0              |
| Tests     | `bun run test convex/repositories-delete.test.ts` | all pass         |
| Full tests| `bun run test`                                  | all pass            |
| Format    | `bun run format`                                | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `convex/lib/artifactWrites.ts`
- `convex/lib/repositoryOwnedDataAdapters.ts`
- `convex/repositories-delete.test.ts` (extend)

**Out of scope** (do NOT touch, even though they look related):
- `convex/lib/repositoryOwnedDataLifecycle.ts` — the reschedule loop already
  handles `more: true`; no change needed there.
- The other non-budgeted drains in the same file
  (`drainArtifactChunksByRepositoryId`, `drainThreadsByRepositoryId`, etc.) —
  their per-pass fan-out is bounded by `CASCADE_BATCH_SIZE` single-row
  deletes; only the artifact drain has unbounded per-item fan-out. If you
  believe another drain has the same problem, STOP and report instead of
  expanding scope.
- Any schema change.

## Git workflow

- Branch: `advisor/001-cascade-write-budget-artifact-drain`
- Commit style: short imperative subject, matching `git log` (e.g.
  "Enforce cascade write budget in artifact drain").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make `deleteArtifactWrite` report its write count

In `convex/lib/artifactWrites.ts`, change
`deleteArtifactWrite(ctx, artifactId): Promise<void>` to return
`Promise<number>` — the total number of `ctx.db.delete` / storage-delete
operations performed (chunks + views + versions + storage blobs + the artifact
row itself). Have `deleteArtifactVersionsAndHtmlStorage` return its own count
and add it in. Keep the docstring convention used by
`deleteMessageStreamState` in `convex/chat/streamStore.ts`: explain that the
count exists so callers can budget across artifacts.

Update any existing callers of `deleteArtifactWrite` (find them with
`grep -rn "deleteArtifactWrite" convex --include='*.ts'`) — they may ignore
the return value; that is fine and needs no other change.

**Verify**: `bun run typecheck:convex` → exit 0.

### Step 2: Thread a budget through `drainArtifactsByRepositoryId`

In `convex/lib/repositoryOwnedDataAdapters.ts`, rewrite the drain to:

1. Create a local `CascadeBudget` (or accept one — follow the
   `drainToolCallEventsByMessageId` signature style; a local budget scoped to
   this pass is acceptable since the adapter chain runs several drains per
   mutation — prefer a conservative per-drain allowance, e.g. stop once this
   drain alone has issued 5_000 writes).
2. Read artifacts with the existing index query, but iterate one artifact at a
   time: before each `deleteArtifactWrite`, check the budget can absorb a
   worst-case artifact (use `MAX_ARTIFACT_CHUNKS_PER_ARTIFACT` + a small
   fixed overhead, e.g. +100 for views/versions/storage). If not, return
   `true` (more work remains) immediately.
3. Accumulate the count returned by Step 1's `deleteArtifactWrite` into the
   budget.
4. Return `true` when the page was full OR the budget stopped the loop early;
   `false` only when a partial page completed fully.

Add a short comment stating the invariant: one pass of this drain never
exceeds its write allowance, and the lifecycle reschedule loop finishes the
rest.

**Verify**: `bun run typecheck:convex && bun run lint` → exit 0.

### Step 3: Extend the deletion tests

In `convex/repositories-delete.test.ts` (use its existing seeding helpers as
the structural pattern), add:

1. A test seeding one repository with enough artifacts+chunks that a single
   drain pass must stop early (e.g. 30 artifacts × 200 chunks with a test
   allowance, or expose the allowance as an exported constant so the test can
   reason about it), asserting: the first deletion pass leaves some artifacts
   behind, and repeated passes (drive the lifecycle the same way existing
   tests do) eventually delete everything with no orphaned `artifactChunks`,
   `artifactViews`, or `artifactVersions` rows.
2. A regression test asserting `deleteArtifactWrite` returns the exact count
   for a small artifact (e.g. 3 chunks + 1 view + 1 version → expected count).

**Verify**: `bun run test convex/repositories-delete.test.ts` → all pass,
including the new tests.

## Test plan

Covered in Step 3. Full-suite gate: `bun run test` → all pass (note: a handful
of UI tests are timing-sensitive under heavy parallel load; re-run a failing
file in isolation before concluding it is broken).

## Done criteria

- [ ] `bun run lint` exits 0
- [ ] `bun run test` exits 0; the two new tests exist and pass
- [ ] `deleteArtifactWrite` returns a number and `drainArtifactsByRepositoryId`
      stops early on budget exhaustion (verify by reading the diff)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift).
- `deleteArtifactWrite` turns out to have callers that depend on it deleting
  everything in one call within a larger uninterruptible flow (i.e. a caller
  that cannot tolerate a budget-limited partial pass upstream).
- The existing repositories-delete tests fail before you make any change.
- You find yourself wanting to modify `repositoryOwnedDataLifecycle.ts`.

## Maintenance notes

- Any future drain added to `drainRepositoryContentState` whose per-item
  deletion fans out (deletes child rows per parent row) must take the same
  budget treatment; single-row-per-item drains are fine with just
  `CASCADE_BATCH_SIZE`.
- Reviewer should scrutinize the early-return paths: returning `false` while
  rows remain would silently strand data (the lifecycle would consider the
  drain finished).
- Deferred: unifying all drains onto one shared per-mutation budget object.
  Worth doing only if a second unbounded drain appears.
