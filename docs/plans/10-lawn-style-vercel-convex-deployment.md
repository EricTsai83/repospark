# Plan 10 — Reviewed Vercel + Convex Deployment

- **Priority**: P2
- **Status**: revise before implementation
- **Scope**: `package.json`, `vercel.json`（new）, frontend auth bootstrap, GitHub callback redirect design, deployment docs
- **Related design doc**: `docs/vercel-convex-deployment-system-design.md`
- **Conflicts**:
  - `package.json`: any script or build flow changes
  - `README.md`: any setup/deploy rewrite
  - `docs/integrations-and-operations.md`: any deployment model rewrite
- **Dependencies**:
  - `convex.json` already uses Vercel `buildEnv` for `preview` and `prod`

## Review Verdict

The overall direction is correct, but the original version is **not** ready for direct implementation as a long-term best practice.

Three parts need to be corrected first:

1. **SPA fallback should use `rewrites`, not `routes`**  
   Vercel's current docs recommend `rewrites` for Vite SPA deep-link fallback.
2. **The plan mixes two different callback problems**  
   WorkOS browser redirect and GitHub App server callback should not be solved with the same environment-variable strategy.
3. **GitHub callback must redirect from state, not from a guessed frontend URL**  
   If preview deployments matter, the callback should redirect back to the **origin that started the flow**, not to one shared URL.

So the right next step is:

- revise the deployment plan
- leave a small system design document
- implement only after the redirect ownership is clear

## What Still Stays True

These parts of the original idea are still good:

1. Vercel should own frontend hosting and Git-triggered deploys.
2. `convex deploy` should run inside the Vercel build.
3. `VITE_CONVEX_URL` should be injected by `convex deploy`.
4. Preview and production must use different Convex deploy keys.
5. GitHub Actions, if added, should be CI-only and should not own production deploy.

## Long-Term Design

### A. Keep CD simple

Repospark fits the same high-level model as `lawn`:

- frontend: static Vite app
- backend: Convex
- external callbacks: Convex HTTP routes
- no separate always-on API server

That means the long-term deployment target should still be:

- **Vercel** for hosting and deploy trigger
- **Convex** for backend deploy and runtime
- **optional GitHub Actions** for quality checks only

### B. Build through `convex deploy`

`package.json` should still grow a Vercel-specific wrapper:

```json
"build:vercel": "bunx convex deploy --cmd 'bun run build' --cmd-url-env-var-name VITE_CONVEX_URL"
```

Why this is still the right shape:

- it keeps Convex deploy and frontend build in one pipeline
- it avoids manually copying `VITE_CONVEX_URL`
- it keeps preview and production deployment URLs aligned with the build that produced the frontend bundle

### C. Use `rewrites` in `vercel.json`

The recommended Vercel config for this repo is:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "bun run build:vercel",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Why:

- `buildCommand`: run Convex deploy before the Vite build
- `outputDirectory`: Vite outputs to `dist`
- `rewrites`: preferred Vercel SPA fallback for React Router deep links

### D. Separate environment ownership clearly

The original draft was too coupled here. Long-term maintainability is better if configuration is split by **who owns the value**.

#### 1. Vercel project env

Preview:

- `CONVEX_DEPLOY_KEY=<preview deploy key>`
- `VITE_WORKOS_CLIENT_ID=<preview public value>`

Production:

- `CONVEX_DEPLOY_KEY=<production deploy key>`
- `VITE_WORKOS_CLIENT_ID=<production public value>`

Important rules:

- **Never** share one `CONVEX_DEPLOY_KEY` across preview and production
- `VITE_CONVEX_URL` should **not** be entered manually in Vercel
- Vercel **System Environment Variables must be exposed to the build**, otherwise `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL` will not be available where `convex.json` expects them

#### 2. Convex runtime env

Preview and production deployments each need their own runtime configuration for secrets and server-side integrations, including:

- `WORKOS_CLIENT_ID`
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`

The key design rule is:

- keep secrets in Convex runtime env
- keep browser-exposed values in Vercel env
- do not duplicate the same domain logic in both places unless there is a clear reason

### E. Treat WorkOS callback and GitHub callback as two different designs

This is the biggest correction.

#### E-1. WorkOS browser redirect

For the browser-side auth callback, the frontend already knows its own origin at runtime.

So the preferred long-term model is:

- derive redirect URI from `window.location.origin`
- use `new URL('/callback', window.location.origin).toString()`

Why this is better:

- no need to create `VITE_VERCEL_BRANCH_URL`
- no duplicated branch-domain logic in frontend build config
- local dev, preview, and production all use the same rule

`convex.json` should continue to use `buildEnv.VERCEL_BRANCH_URL` and `buildEnv.VERCEL_PROJECT_PRODUCTION_URL` for WorkOS/AuthKit-side allowlisted URLs. That is a provider configuration problem, not a frontend runtime problem.

#### E-2. GitHub App callback redirect

This one is different because the callback lands on **Convex**, not on the frontend.

The current implementation should not depend on one global frontend URL, because that is not robust for multi-preview operation.

The better long-term model is:

1. frontend starts GitHub install from its current origin
2. backend stores that origin together with the OAuth state
3. GitHub redirects to Convex callback
4. Convex validates the state
5. Convex redirects back to the stored origin

That means preview correctness should come from state-bound `returnTo`, not from manually maintaining per-branch server env.

This is the main reason the original plan should not be implemented as-is.

### F. CI remains separate from CD

The recommended split stays simple:

- **CI**: `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, `bun run build`
- **CD**: Vercel Git integration + `convex deploy`

This keeps:

- deploy permissions out of GitHub Actions
- production delivery tied to the same host that serves the frontend
- operational ownership easier to understand

## Recommended Implementation Order

### Phase 1: deployment baseline

1. Add `build:vercel` to `package.json`
2. Add `vercel.json` with `rewrites`
3. Create separate preview and production `CONVEX_DEPLOY_KEY`
4. Enable Vercel system environment variables for the build

### Phase 2: callback hardening

5. Change frontend WorkOS bootstrap to derive redirect URI from runtime origin
6. Change GitHub install state to store `returnTo`
7. Change GitHub callback to redirect to stored `returnTo`, and return an explicit error when no usable state exists

### Phase 3: docs and quality gates

8. Update `README.md`
9. Update `.env.example`
10. Update `docs/integrations-and-operations.md`
11. Optionally add a minimal CI workflow for `lint`, `test`, and `build`

## Validation

- pushing a branch creates a Vercel preview deployment
- preview build uses the preview `CONVEX_DEPLOY_KEY`
- production build uses the production `CONVEX_DEPLOY_KEY`
- the frontend receives `VITE_CONVEX_URL` from `convex deploy`
- React Router deep links do not 404 on Vercel
- WorkOS callback resolves to the current frontend origin
- GitHub install started from a preview returns to that same preview
- GitHub Actions, if present, perform checks only and do not deploy

## Out Of Scope

- Docker image deployment
- self-hosted runners
- multi-stage release trains
- complex smoke-test or e2e gate design
- moving production deploy ownership into GitHub Actions

