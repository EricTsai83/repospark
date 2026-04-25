# RepoSpark

Ask the repo, not the internet.

RepoSpark is a repository-centered architecture analysis app. A user signs in with WorkOS, connects a GitHub App installation, imports a repository into a Daytona sandbox, indexes the codebase into Convex, and then explores the project through two complementary analysis modes:

- `Quick chat`: grounded answers from indexed artifacts, code chunks, and recent thread history
- `Deep analysis`: focused inspection against a live sandbox when the repository needs deeper validation

The app is built as a single React frontend plus a Convex backend. Convex handles database storage, backend logic, background jobs, cron tasks, and HTTP endpoints, so there is no separate Express or Nest service.

## Status

RepoSpark is an early-access open source project. Core repository import, chat, artifact generation, sync, and sandbox lifecycle flows are implemented. Sandbox reliability and Daytona webhook reconciliation are still active areas of iteration.

The repository is standardized on Bun as its package manager and script runner.

## Core capabilities

- Import GitHub repositories through a GitHub App instead of personal access tokens
- Index repository structure, files, chunks, and long-lived analysis artifacts
- Ask grounded questions about architecture, data flow, and risk areas
- Run deep analysis in a live Daytona sandbox when indexed data is not enough
- Persist threads, messages, jobs, and analysis artifacts for later review
- Sync imported repositories against newer remote commits
- Reconcile sandbox lifecycle with a mix of request-path cleanup, webhooks, and cron sweeps

## How it works

1. The user signs in with WorkOS AuthKit.
2. The user connects a GitHub App installation.
3. RepoSpark verifies repository access and creates an import workflow.
4. A Daytona sandbox is provisioned and the repository is cloned.
5. The import pipeline scans the repository and writes summaries, artifacts, files, and chunks into Convex.
6. The user can ask questions in `Quick chat` or run `Deep analysis`.
7. Later syncs refresh the active repository snapshot without mixing old and new import data.

## Architecture

### Frontend

- React 19
- Vite 7
- React Router 7
- Tailwind CSS 4
- shadcn/ui and Radix primitives

### Backend

- Convex queries, mutations, actions, internal actions, HTTP actions, and cron jobs
- Convex as the app database, backend runtime, scheduler, and integration entrypoint

### External integrations

- WorkOS AuthKit for browser-side sign-in
- GitHub App for repository authorization and installation lifecycle
- Daytona for repository sandboxes and deep inspection
- OpenAI for chat generation, with a heuristic fallback when no API key is configured

## Project structure

```text
.
├── src/        # React app, routes, layout, and UI
├── convex/     # Convex schema, functions, actions, HTTP endpoints, and crons
├── docs/       # System design and architecture documentation
├── public/     # Static assets
└── .env.example
```

## Prerequisites

Before running the app locally, make sure you have:

- Node.js and npm
- A Convex deployment
- A WorkOS application
- A GitHub App with installation access to the repositories you want to import
- A Daytona account and API key
- An OpenAI API key if you want model-backed chat responses

## Local development

### 1. Install dependencies

```bash
bun install
```

### 2. Configure frontend environment variables

Copy `.env.example` to `.env` and fill in the browser-exposed values:

```bash
cp .env.example .env
```

Required frontend variables:

- `VITE_CONVEX_URL`
- `VITE_WORKOS_CLIENT_ID`

`env.ts` validates these values at build time.

### 3. Configure Convex runtime environment variables

Do not keep backend secrets only in `.env`. Set them in the Convex environment with `npx convex env set` or in the Convex dashboard.

Required or commonly used Convex runtime variables:

- WorkOS
  - `WORKOS_CLIENT_ID`
- GitHub App
  - `GITHUB_APP_ID`
  - `GITHUB_APP_SLUG`
  - `GITHUB_APP_PRIVATE_KEY`
  - `GITHUB_APP_WEBHOOK_SECRET`
- OpenAI
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
- Daytona
  - `DAYTONA_API_KEY`
  - `DAYTONA_API_URL`
  - `DAYTONA_TARGET`
  - `DAYTONA_WEBHOOK_SIGNING_SECRET`
  - `DAYTONA_WEBHOOK_ORGANIZATION_ID`
  - `DAYTONA_AUTO_STOP_MINUTES`
  - `DAYTONA_AUTO_ARCHIVE_MINUTES`
  - `DAYTONA_AUTO_DELETE_MINUTES`
  - `DAYTONA_CPU_LIMIT`
  - `DAYTONA_MEMORY_GIB`
  - `DAYTONA_DISK_GIB`
  - `DAYTONA_NETWORK_ALLOW_LIST`

Rate limit and lease overrides are also supported in Convex runtime env:

- `RATE_LIMIT_IMPORT_PER_HOUR`
- `RATE_LIMIT_DEEP_ANALYSIS_PER_HOUR`
- `RATE_LIMIT_CHAT_PER_MINUTE`
- `RATE_LIMIT_CHAT_BURST_CAPACITY`
- `RATE_LIMIT_GLOBAL_CHAT_PER_MINUTE`
- `RATE_LIMIT_GLOBAL_CHAT_BURST_CAPACITY`
- `RATE_LIMIT_DAYTONA_GLOBAL_PER_HOUR`
- `CHAT_JOB_LEASE_MS`
- `DEEP_ANALYSIS_JOB_LEASE_MS`

### 4. Start the app

```bash
bun run dev
```

This runs the frontend and backend together:

- `vite --open`
- `convex dev`

The `predev` hook also waits for Convex to be ready and opens the Convex dashboard.

## Integration endpoints

When wiring external services, these are the important routes:

- WorkOS redirect URI: usually `http://localhost:5173/callback` for local development
- GitHub App callback: `https://<your-convex-site>/api/github/callback`
- GitHub App webhook: `https://<your-convex-site>/api/github/webhook`
- Daytona webhook: `https://<your-convex-site>/api/daytona/webhook`

For GitHub App installation, the frontend sends its current origin when the install flow starts. The Convex callback stores that origin in the OAuth state and redirects back to it after installation. If GitHub calls back without a usable state, the HTTP endpoint now returns an explicit error response instead of guessing a frontend URL.

Configure Daytona/Svix to sign deliveries for that endpoint, then store the endpoint signing secret in `DAYTONA_WEBHOOK_SIGNING_SECRET`. `DAYTONA_WEBHOOK_ORGANIZATION_ID` can be used as an additional allowlist check.

## Available scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Run frontend and Convex backend in parallel |
| `bun run dev:frontend` | Start the Vite frontend |
| `bun run dev:backend` | Start `convex dev` |
| `bun run build` | Type-check and build the frontend |
| `bun run build:vercel` | Deploy Convex, inject `VITE_CONVEX_URL`, and build for Vercel |
| `bun run typecheck` | Run the app TypeScript build |
| `bun run typecheck:convex` | Type-check Convex code only |
| `bun run lint` | Run type checks and ESLint |
| `bun run test` | Run Vitest |
| `bun run preview` | Preview the production build |
| `bun run format` | Format the repo with Prettier |

## Authentication and access model

- Users sign in through WorkOS AuthKit in the browser.
- The frontend passes the WorkOS access token into Convex.
- Convex validates that token as a custom JWT.
- Repository access is enforced through GitHub App installation state, not user-provided personal tokens.
- Most backend flows derive the current owner from authenticated identity and verify ownership server-side.

## Sandbox and analysis model

- Every import creates a snapshot-oriented workflow instead of mutating repository knowledge in place.
- Indexed knowledge is persisted in Convex as repository summaries, artifacts, files, and chunks.
- `Quick chat` uses that indexed knowledge layer.
- `Deep analysis` depends on a usable Daytona sandbox and stores its output back as a reusable artifact.
- Cleanup and reconciliation rely on cron jobs plus webhook-driven convergence so Daytona resources do not drift too far from Convex state.

## Recommended reading

Start with the system design docs in `docs/`:

1. `docs/system-overview.md`
2. `docs/domain-and-data-model.md`
3. `docs/auth-and-access.md`
4. `docs/repository-lifecycle.md`
5. `docs/chat-and-analysis-pipeline.md`
6. `docs/integrations-and-operations.md`
7. `docs/orphan-resource-handling.md`

The document index lives in `docs/README.md`.

## Deployment model

The current deployment model is intentionally simple:

- frontend: static Vite build
- backend: Convex cloud
- external services: WorkOS, GitHub, Daytona, and OpenAI
- hosting/CD: Vercel Git integration running `bun run build:vercel`
- SPA deep links: handled by `vercel.json` rewrites

There is no separate always-on custom API server in front of the backend.

## License

MIT
