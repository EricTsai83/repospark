# Plan 002: Bound the `listViewStateByRepository` query

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3458fd0..HEAD -- convex/artifactViews.ts src/hooks/use-artifact-view-state.ts`
> On any change to these files, compare the "Current state" excerpts against
> the live code first; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (read-only query; degraded mode already exists client-side)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3458fd0`, 2026-07-02

## Why this matters

`listViewStateByRepository` is the only unbounded `.collect()` on a
user-facing reactive query path in the backend. It powers the "unread dot"
state in the repository guide navigator and re-runs reactively for every
subscribed client. Row count equals the number of artifacts the viewer has
opened in that repository — small today, but `custom_document` artifacts have
no per-repo cap, so the read amplification grows without a fence. The repo's
own Convex guidelines (`convex/_generated/ai/guidelines.md`, "Query
guidelines") say: always return a bounded collection instead of `.collect()`.
This plan adds the fence and a graceful degraded mode that reuses the
existing `bootstrapPending`-style dot suppression.

## Current state

- `convex/artifactViews.ts:119-151` — the query. Excerpt:
  ```ts
  const records = await ctx.db
    .query("artifactViews")
    .withIndex("by_ownerTokenIdentifier_and_repositoryId", (q) =>
      q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("repositoryId", args.repositoryId),
    )
    .collect();

  const views: Record<string, number> = {};
  for (const record of records) {
    views[record.artifactId] = record.viewedAt;
  }
  ```
  The return shape is `{ bootstrap, views, bootstrapPending }`. Per the
  docstring (lines 100–117): when `bootstrapPending` is true the client must
  suppress dots because the data is not trustworthy. That is exactly the
  degraded semantics we want on overflow.
- `src/hooks/use-artifact-view-state.ts` — the client consumer;
  `useQuery(api.artifactViews.listViewStateByRepository, ...)` at line 55, and
  an optimistic-update helper reading/writing the same query at lines 42–52.
- Rows in `artifactViews` are deleted when their artifact is deleted
  (`convex/lib/artifactWrites.ts:350-360`), so the table is bounded by live
  artifacts per repo — the fence is a safety net, not a cleanup substitute.

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck && bun run typecheck:convex` | exit 0              |
| Lint      | `bun run lint`                                  | exit 0              |
| Tests     | `bun run test convex/artifactViews.test.ts src/hooks` | all pass      |
| Format    | `bun run format`                                | exit 0              |

## Scope

**In scope**:
- `convex/artifactViews.ts`
- `convex/artifactViews.test.ts` (extend)

**Out of scope**:
- `src/hooks/use-artifact-view-state.ts` and all client code — the degraded
  mode reuses the existing `bootstrapPending` contract, so no client change
  is needed. If you find the client would misbehave, STOP and report.
- Introducing a per-repo artifact cap (separate product decision).
- Every other `.collect()` in the repo (they were audited: bounded by small
  key ranges).

## Git workflow

- Branch: `advisor/002-bound-artifact-view-state-query`
- Commit style: short imperative subject matching `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace `.collect()` with a fenced `.take()`

In `convex/artifactViews.ts`:

1. Add a module-level constant with a short comment:
   ```ts
   /**
    * Fence for the per-(viewer, repo) view-state read. Far above any
    * realistic artifact count per repository; if the fence is hit the
    * query degrades to `bootstrapPending: true` so the navigator
    * suppresses dots instead of rendering from truncated data.
    */
   const ARTIFACT_VIEW_STATE_LIMIT = 1_000;
   ```
2. Replace `.collect()` with `.take(ARTIFACT_VIEW_STATE_LIMIT + 1)`.
3. If `records.length > ARTIFACT_VIEW_STATE_LIMIT`, return
   `{ bootstrap: <as computed>, views: {}, bootstrapPending: true }` —
   the documented "data not trustworthy, suppress dots" mode. Otherwise
   behave exactly as today.
4. Update the query docstring (lines 100–117) to document the overflow case
   alongside the existing `bootstrapPending` explanation.

**Verify**: `bun run typecheck:convex && bun run lint` → exit 0.

### Step 2: Add tests

In `convex/artifactViews.test.ts` (follow its existing convexTest setup
pattern):

1. Below the fence: seed a handful of view rows, assert `views` contains them
   and `bootstrapPending` reflects the bootstrap row as before (this pins the
   unchanged behavior).
2. Above the fence: seed `ARTIFACT_VIEW_STATE_LIMIT + 1` rows (export the
   constant from `convex/artifactViews.ts` so the test imports it rather than
   hardcoding 1000; if seeding 1001 rows is too slow, lower the exported
   constant only via a test-visible mechanism — do NOT lower the production
   value), assert the query returns empty `views` with
   `bootstrapPending: true`.

**Verify**: `bun run test convex/artifactViews.test.ts` → all pass.

## Test plan

Covered in Step 2. Also run `bun run test src/hooks/use-artifact-view-state.test.ts`
if it exists (`ls src/hooks | grep artifact-view`) to confirm the client
contract is unaffected.

## Done criteria

- [ ] `grep -n "\.collect()" convex/artifactViews.ts` returns no matches
- [ ] `bun run lint` exits 0
- [ ] `bun run test` exits 0 with the two new tests passing
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The current-state excerpt doesn't match the live file.
- You discover a client code path that renders dots even when
  `bootstrapPending` is true (would make the degraded mode wrong).
- Seeding the above-fence test proves impractical within the test runtime
  and there is no clean way to inject a smaller limit — report options
  instead of hacking the production constant.

## Maintenance notes

- If a per-repo artifact cap is ever introduced, set
  `ARTIFACT_VIEW_STATE_LIMIT` to that cap + margin and simplify the overflow
  branch to an invariant violation log.
- Reviewer: check the overflow branch returns the same *shape* as the normal
  path (the docstring promises shape stability so the client never
  special-cases null).
