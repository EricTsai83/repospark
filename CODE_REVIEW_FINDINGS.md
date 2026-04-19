# Code Review Findings

Reviewed on 2026-04-20.

Scope:
- Core Convex backend flows: import, sandbox lifecycle, chat, GitHub integration
- Main React shell and auth error handling

Validation:
- `npm test` passed (`8` files, `16` tests)
- `npm run lint` passed

This is not a full line-by-line audit of the entire repo. It is a prioritized list of the issues that look most worth fixing first.

## Priority 0

### 1. [已完成] Deleting a repository does not delete the remote Daytona sandbox

Why this matters:
- `deleteRepository` removes the Convex `repositories` row immediately, then `cascadeDeleteRepository` deletes related `sandboxes` rows.
- That cleanup never calls the Daytona deletion path.
- Once the sandbox row is gone, the hourly sweep in `convex/crons.ts` can no longer discover or reconcile that remote sandbox.
- Result: orphaned Daytona environments can continue consuming quota or cost until Daytona reclaims them on its own.

Relevant files:
- `convex/repositories.ts`
- `convex/ops.ts`
- `convex/opsNode.ts`
- `convex/crons.ts`

Suggested fix:
- When deleting a repository, schedule remote sandbox cleanup before deleting the sandbox records.
- Reuse the existing cleanup path in `ops`/`opsNode` instead of adding a second deletion mechanism.
- Consider making repository deletion a staged state transition first, so long-running jobs can observe that deletion is in progress.

Missing tests:
- A test that deleting a repository with `latestSandboxId` schedules remote cleanup.
- A test that repository deletion does not leave a sandbox only on Daytona.

### 2. [已完成] Sandbox naming is not collision-safe and can delete the wrong sandbox

Why this matters:
- `provisionSandbox` uses `architect-${safeLabel(repositoryKey)}`.
- `safeLabel()` normalizes and truncates to 48 chars.
- Two different repos can collapse to the same sandbox name after normalization/truncation.
- The provisioning flow explicitly deletes any existing Daytona sandbox with that derived name before creating a new one.
- In the collision case, one repo import can delete another repo's sandbox.

Relevant files:
- `convex/daytona.ts`
- `convex/importsNode.ts`

Suggested fix:
- Make sandbox names globally unique, for example by including a stable hash or repository id.
- Keep the human-readable repo label only as a prefix/suffix for debugging.
- Do not treat same-name lookup as authoritative ownership unless you also verify metadata/labels.

Missing tests:
- A unit test proving two different repository keys cannot collide.
- A regression test that provisioning repo B cannot delete repo A's sandbox.

### 3. [已完成] Deleting a repository during an active import can leave the import pipeline in an inconsistent state

Why this matters:
- `deleteRepository` removes the repository before the import action finishes.
- Later, `persistImportResults` and `markImportFailed` still assume `repositoryId` exists and patch it.
- `persistImportResults` throws if the repository is gone.
- `markImportFailed` patches the repository without checking whether it still exists.
- This can leave background jobs failing on cleanup/error paths instead of finishing cleanly.

Relevant files:
- `convex/repositories.ts`
- `convex/imports.ts`
- `convex/importsNode.ts`

Suggested fix:
- Add a repository tombstone or deletion status so in-flight jobs can exit cleanly.
- Guard `markImportFailed` and similar mutations against a missing repository.
- Decide whether delete should cancel in-flight import jobs or wait for them to stop.

Missing tests:
- A test for deleting a repository while an import is running.
- A test proving the failure path does not throw when the repository row is already gone.

## Priority 1

### 4. Chat history queries return the oldest messages instead of the most recent ones

Why this matters:
- `listMessages` uses `.withIndex('by_threadId').take(100)` with no descending order.
- `getReplyContext` does the same with `MAX_CONTEXT_MESSAGES`.
- In Convex, that means ascending creation order by default.
- Once a thread grows beyond the cap, the UI and the assistant context are built from stale early messages instead of the latest conversation.

Relevant files:
- `convex/chat.ts`
- `convex/lib/constants.ts`

Suggested fix:
- Query recent messages in descending order, then reverse them before rendering/prompt construction if chronological display is still desired.
- Keep UI pagination/context limits aligned so the assistant sees the same recent conversation the user sees.

Missing tests:
- A query test proving `listMessages` returns the most recent N messages.
- A reply-context test proving old messages are trimmed and the latest ones are preserved.

### 5. Auth token failures are hidden from signed-in users

Why this matters:
- The WorkOS/Convex auth wrapper dispatches `AUTH_TOKEN_ERROR_EVENT` when `getAccessToken()` fails.
- `App.tsx` stores that error, but only shows it when `isAuthenticated` is false.
- If WorkOS still has a user object but Convex token fetch is failing, the user lands in the app with broken backend calls and no visible explanation.

Relevant files:
- `src/providers/convex-provider-with-auth-kit.tsx`
- `src/App.tsx`

Suggested fix:
- Show token-fetch errors even when the user is nominally signed in.
- If needed, distinguish between "signed in to WorkOS" and "able to authenticate Convex requests".
- Consider offering a clear recovery action, such as retry, refresh, or sign out.

Missing tests:
- A UI test where `getAccessToken()` rejects but the auth hook still reports a user.
- A regression test proving the error banner is visible in that state.

## Suggested Fix Order

1. Fix remote sandbox cleanup on repository deletion.
2. Make sandbox identity collision-safe.
3. Make delete-vs-import behavior explicit and safe.
4. Fix chat history ordering for both UI and assistant context.
5. Fix auth error visibility.

## Notes

- I intentionally did not write fixes into `CODE_REVIEW_PLAN.md` because that file already has uncommitted changes.
- If you want, I can next take item `1` and implement it in a minimal patch with tests.
