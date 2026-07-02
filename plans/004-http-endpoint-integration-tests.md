# Plan 004: Add endpoint-level integration tests for the HTTP webhook routes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update
> the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3458fd0..HEAD -- convex/http.ts`
> On drift, re-read the route handlers before writing tests against them.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (tests only; no production code changes expected)
- **Depends on**: 003 (small merge overlap in `convex/http.ts` imports — land
  003 first to avoid conflicts; not a hard dependency)
- **Category**: tests
- **Planned at**: commit `3458fd0`, 2026-07-02

## Why this matters

`convex/http.ts` (739 lines) wires three security-sensitive routes —
`/api/github/callback` (OAuth callback with returnTo allowlist),
`/api/github/webhook` (HMAC-verified GitHub App events), and
`/api/daytona/webhook` (signature-verified sandbox lifecycle events). The
underlying pure helpers are well tested (`convex/lib/returnTo.test.ts`,
`convex/lib/daytonaWebhookVerification.test.ts`, `convex/github.test.ts`),
but there is **zero test at the `httpAction` layer**: nothing pins that a bad
signature actually yields a rejection response, that the right status codes
are returned, or that header parsing and the helper wiring compose correctly.
A refactor of `http.ts` could silently drop a verification step and every
existing test would stay green.

## Current state

- `convex/http.ts` route registrations at commit `3458fd0`:
  - line 329: `path: "/api/github/callback"` (GET)
  - line 572: `path: "/api/github/webhook"` (POST) — reads
    `GITHUB_APP_WEBHOOK_SECRET` from `process.env`, returns 500 if unset,
    computes HMAC-SHA256 over the raw body and compares against
    `x-hub-signature-256` via `constantTimeEqual` (line ~617), rejecting
    mismatches.
  - line 675: `path: "/api/daytona/webhook"` (POST) — delegates verification
    to `convex/lib/daytonaWebhookVerification.ts` (Svix-style headers,
    `DAYTONA_WEBHOOK_SIGNING_SECRET`).
- Testing stack: `convex-test` + vitest + `@edge-runtime/vm` (see
  `vitest.config.ts`). `convex-test` supports HTTP action testing via
  `t.fetch(path, requestInit)` — no existing test in this repo uses it yet,
  so this plan introduces the pattern.
- Structural pattern to follow for setup/seeding:
  `convex/daytonaWebhooks.test.ts` (convexTest setup, `seedRepository`
  helper, module map via `import.meta.glob` — see
  `convex/_generated/ai/guidelines.md` "Testing guidelines").
- Env vars in tests: set via `process.env.X = "..."` inside the test with
  `vi.stubEnv` (check how existing tests handle env, e.g. grep
  `stubEnv\|process.env` in `convex/*.test.ts`, and match that convention).

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Typecheck | `bun run typecheck:convex`                | exit 0              |
| Lint      | `bun run lint`                            | exit 0              |
| New tests | `bun run test convex/http.test.ts`        | all pass            |
| Full      | `bun run test`                            | all pass            |

## Scope

**In scope**:
- `convex/http.test.ts` (create)

**Out of scope**:
- Any change to `convex/http.ts` behavior. If a test reveals a real defect,
  STOP and report the defect with the failing test — do not fix production
  code under this plan.
- Re-testing the pure helpers (returnTo normalization, signature math) —
  already covered; test the *wiring*, not the math.

## Git workflow

- Branch: `advisor/004-http-endpoint-integration-tests`
- Commit style: short imperative subject matching `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Scaffold `convex/http.test.ts`

Standard convexTest scaffold (schema + `import.meta.glob` module map, per the
guidelines file). Confirm `t.fetch` reaches the router with a smoke test:
request to an unregistered path (e.g. `/nope`) → expect 404.

**Verify**: `bun run test convex/http.test.ts` → smoke test passes.

### Step 2: GitHub webhook signature gate

Tests for `POST /api/github/webhook`:
1. Missing secret env → 500 (per the handler's documented behavior).
2. Secret set, wrong `x-hub-signature-256` → rejection status (read the
   handler for the exact code — 401/403; assert that exact code).
3. Secret set, correct signature (compute HMAC-SHA256 hex over the exact raw
   body with the test secret, prefix per the header format the handler
   expects) with a minimal valid event payload (pick the simplest event the
   handler accepts, e.g. `ping` or an installation event — read the handler
   to choose) → success status, and any expected DB side effect asserted via
   `t.run`.

**Verify**: `bun run test convex/http.test.ts` → all pass.

### Step 3: Daytona webhook signature gate

Tests for `POST /api/daytona/webhook`, mirroring the valid/invalid signature
construction already used in `convex/lib/daytonaWebhookVerification.test.ts`
(reuse its header-building helpers if exported; otherwise replicate
minimally):
1. Invalid signature → rejection status.
2. Valid signature, minimal event → accepted; assert the webhook event row is
   recorded (same assertion style as `convex/daytonaWebhooks.test.ts`).

**Verify**: `bun run test convex/http.test.ts` → all pass.

### Step 4: GitHub callback returnTo gate

Tests for `GET /api/github/callback`:
1. A request whose `returnTo`/state resolves to a non-allowlisted origin →
   the handler must NOT redirect there (assert on the `Location` header /
   status per the handler's actual contract — read `convex/http.ts:329-...`
   and `convex/lib/returnTo.ts` first).
2. An allowlisted returnTo → redirect to it.

If the callback flow requires seeded OAuth state rows, seed them via `t.run`
following the state-row shapes used in `convex/github.test.ts`.

**Verify**: `bun run test convex/http.test.ts` → all pass.

## Test plan

This plan *is* the test plan. Final gate: `bun run test` → full suite green
(UI test files can be timing-flaky under parallel load; re-run a failing file
in isolation before concluding it broke).

## Done criteria

- [ ] `convex/http.test.ts` exists with ≥7 tests covering: router 404, GitHub
      webhook (missing secret / bad sig / good sig), Daytona webhook (bad sig
      / good sig), callback returnTo (blocked / allowed)
- [ ] `bun run lint` exits 0
- [ ] `bun run test` exits 0
- [ ] No production files modified (`git status` shows only the new test file
      and `plans/README.md`)

## STOP conditions

- `t.fetch` is not available in the installed `convex-test` version
  (`bun pm ls convex-test` / check its README) — report; do not fall back to
  extracting handlers.
- The GitHub webhook handler requires GitHub-App-level setup that cannot be
  satisfied with env stubs and seeded rows — write the signature-gate tests
  (1–2) anyway and report the accepted-path gap.
- A test exposes a genuine production defect (e.g. a bypassable check) —
  STOP and report with the failing test as evidence.

## Maintenance notes

- These tests intentionally pin status codes; changing a status code in
  `http.ts` should require updating a test — that is the point.
- Once this pattern exists, new HTTP routes should ship with a section in
  this file; reviewer should push back on new routes without one.
