# Plan 003: Single-source the `constantTimeEqual` webhook-verification primitive

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update
> the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3458fd0..HEAD -- convex/http.ts convex/lib/daytonaWebhookVerification.ts`
> On drift, compare the excerpts below against the live code first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (mechanical extraction of a pure function on a security path;
  existing signature-verification tests pin behavior)
- **Depends on**: none
- **Category**: tech-debt / security hygiene
- **Planned at**: commit `3458fd0`, 2026-07-02

## Why this matters

The constant-time string comparison used for webhook HMAC verification is
defined twice, byte-for-byte identical: once for the GitHub webhook handler
and once for Daytona webhook verification. A timing-attack-resistant
comparison is exactly the kind of security-critical primitive that must have
one source of truth — a future fix or hardening applied to one copy and not
the other is a silent divergence on an authentication boundary.

## Current state

- `convex/http.ts:28-35` — `function constantTimeEqual(a: string, b: string): boolean`,
  used at `convex/http.ts:617` to compare the computed GitHub webhook HMAC
  against the `x-hub-signature-256` header value.
- `convex/lib/daytonaWebhookVerification.ts:37-44` — identical function, used
  at line 215 to compare the allowed organization ID (and within Svix-style
  signature checks in that module).
- Both copies have the same shape: length check first, then XOR-accumulate
  over `charCodeAt`.
- Convention: shared backend helpers live in `convex/lib/` as small
  single-purpose modules with a JSDoc explaining the *why* (see
  `convex/lib/ownedDocs.ts` for the documentation style to match).

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck:convex`                      | exit 0              |
| Lint      | `bun run lint`                                  | exit 0              |
| Tests     | `bun run test convex/daytonaWebhookVerification.test.ts convex/daytonaWebhooks.test.ts convex/github.test.ts` | all pass |
| Format    | `bun run format`                                | exit 0              |

## Scope

**In scope**:
- `convex/lib/constantTimeEqual.ts` (create)
- `convex/lib/constantTimeEqual.test.ts` (create)
- `convex/http.ts` (remove local copy, import shared)
- `convex/lib/daytonaWebhookVerification.ts` (remove local copy, import shared)

**Out of scope**:
- Any behavioral change to signature verification, header parsing, or error
  responses in either handler.
- Migrating to `crypto.timingSafeEqual` — `convex/http.ts` runs in the
  default Convex runtime (no Node `crypto` module); keep the pure-TS
  implementation.

## Git workflow

- Branch: `advisor/003-extract-constant-time-equal`
- Commit style: short imperative subject matching `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the shared module

Create `convex/lib/constantTimeEqual.ts` exporting the function verbatim from
`convex/http.ts:28-35`, with a JSDoc stating: (a) it exists to avoid
timing side-channels when comparing signatures/secrets, (b) it must remain
free of early-exit on content (only length may early-exit), and (c) it must
stay dependency-free because it is imported from the default Convex runtime.

**Verify**: `bun run typecheck:convex` → exit 0.

### Step 2: Switch both call sites

- In `convex/http.ts`: delete the local function, add
  `import { constantTimeEqual } from "./lib/constantTimeEqual";`.
- In `convex/lib/daytonaWebhookVerification.ts`: delete the local function,
  add `import { constantTimeEqual } from "./constantTimeEqual";`.

**Verify**:
`grep -rn "function constantTimeEqual" convex --include='*.ts' | grep -v _generated`
→ exactly one match, in `convex/lib/constantTimeEqual.ts`.

### Step 3: Add unit tests

Create `convex/lib/constantTimeEqual.test.ts` (plain vitest, no convexTest
needed — model after other pure-lib tests like
`convex/lib/titleSanitization.test.ts`): equal strings → true; same length
different content → false; different lengths → false; empty vs empty → true;
unicode content compares by code unit consistently.

**Verify**: `bun run test convex/lib/constantTimeEqual.test.ts` → all pass.

### Step 4: Run the webhook regression suites

**Verify**: `bun run test convex/daytonaWebhookVerification.test.ts convex/daytonaWebhooks.test.ts convex/github.test.ts`
→ all pass (pins that signature verification behavior is unchanged).

## Test plan

Covered in Steps 3–4.

## Done criteria

- [ ] Exactly one definition of `constantTimeEqual` outside `_generated`
- [ ] `bun run lint` exits 0
- [ ] `bun run test` exits 0 including the new unit tests
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The two existing copies are NOT identical when you read them (they were at
  commit `3458fd0`) — a deliberate divergence would need investigation, not
  merging.
- Importing `./lib/constantTimeEqual` from `convex/http.ts` fails typecheck
  for runtime-boundary reasons.

## Maintenance notes

- Reviewer: confirm no accidental change to the comparison semantics (the
  XOR-accumulate loop must not gain early exits).
- If a Node-runtime module ever needs the same primitive, import this one —
  do not add a `crypto.timingSafeEqual` variant without folding it into this
  module behind a runtime check.
