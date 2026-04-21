# Daytona Sandbox Lifecycle & System Design

> Last updated: 2026-04-18
> SDK version: `@daytona/sdk@0.167.0`

## Overview

This project uses [Daytona](https://www.daytona.io/) managed sandboxes to clone, inspect,
and analyse imported GitHub repositories. Each sandbox is an isolated environment with its
own CPU, memory, disk, and network configuration.

Understanding the sandbox lifecycle is critical because the **Deep Path** feature
(`analysisNode.ts` -> `runFocusedInspection`) executes commands **inside** the sandbox.
If the sandbox is no longer available, deep analysis will fail.

---

## Architecture Diagram

```
User imports a GitHub repo
        |
        v
┌─────────────────────────────────────────────────────────────────┐
│  Convex Backend                                                │
│                                                                │
│  repositories.ts ──> importsNode.ts ──> daytona.ts             │
│       │                   │                 │                  │
│       │            provisionSandbox()       │                  │
│       │                   │                 │                  │
│       │                   v                 v                  │
│       │          ┌─────────────────────────────────┐           │
│       │          │  Daytona Cloud Platform         │           │
│       │          │  ┌───────────────────────────┐  │           │
│       │          │  │  Sandbox (per repository) │  │           │
│       │          │  │  - git clone              │  │           │
│       │          │  │  - file system access     │  │           │
│       │          │  │  - process execution      │  │           │
│       │          │  └───────────────────────────┘  │           │
│       │          └─────────────────────────────────┘           │
│       │                                                        │
│       │   Chat (Fast Path)        Chat (Deep Path)             │
│       │      │                       │                         │
│       │      v                       v                         │
│       │   chat.ts                analysisNode.ts               │
│       │   (uses indexed           (calls sandbox               │
│       │    artifacts only,         .process.executeCommand()   │
│       │    NO sandbox needed)      REQUIRES live sandbox)      │
│       │                                                        │
└────────────────────────────────────────────────────────────────┘
```

---

## Sandbox Lifecycle States

```
                     import repo
                         |
                         v
                  ┌─────────────┐
                  │ provisioning │
                  └──────┬──────┘
                         │  clone + index complete
                         v
  API call       ┌─────────────┐     10 min idle (auto-stop)
  (auto-wake) -> │   started   │ ───────────────────────────┐
       ^         │  (running)  │                            │
       │         └───────┬─────┘                            v
       │                                                ┌─────────────┐
       └─────────────── (SDK interaction) ──────────────│   stopped   │
                                                        │ (hibernated)│
                                                        └──────┬──────┘
                                                               │ continuously stopped
                                                               │ for 24 hours
                                                               v
                                                        ┌─────────────┐
                                                        │  archived   │
                                                        │ (reclaimed) │
                                                        └──────┬──────┘
                                                               │ 24 hours total
                                                               v
                                                        ┌─────────────┐
                                                        │  destroyed  │
                                                        │  (deleted)  │
                                                        └─────────────┘
```

### State Descriptions

| State | Trigger | Can execute commands? | Recovery |
|---|---|---|---|
| **provisioning** | `provisionSandbox()` called during import | No (not ready yet) | Wait for import to complete |
| **started** | Import complete, or auto-wake from stopped | Yes | N/A |
| **stopped** | Idle for `autoStopInterval` (default 10 min), or eagerly stopped after import | Yes - SDK calls auto-wake the sandbox | Automatic on next API interaction |
| **archived** | Continuously stopped for `autoArchiveInterval` (default 24h), or swept by cron | No | Must re-import the repository |
| **destroyed** | After `autoDeleteInterval` (default 24h) | No | Must re-import the repository |

---

## Auto-Wake Mechanism (stopped -> started)

The key design insight: **auto-stop does NOT mean unavailable.**

When a sandbox is in the `stopped` state, any SDK interaction (e.g.,
`sandbox.process.executeCommand()`, `sandbox.fs.listFiles()`) triggers the Daytona
platform to automatically restart the sandbox before executing the operation.

This is why **Deep Path still works the next day** even though the sandbox
auto-stopped after 30 minutes of inactivity:

1. User sends a Deep Path message
2. `analysisNode.ts` calls `runFocusedInspection(remoteSandboxId, ...)`
3. `daytona.ts` calls `getSandbox(remoteId)` -> `daytona.get(remoteId)`
4. Then `sandbox.process.executeCommand(...)` is called
5. Daytona platform detects the sandbox is stopped -> auto-wakes it
6. Command executes normally (with a few seconds of cold-start delay)

Source: Daytona SDK `Sandbox.js` documentation:
> "Events include any state changes or interactions with the Sandbox through the SDK."

The auto-stop timer resets on every SDK interaction, so active usage keeps the
sandbox alive indefinitely.

---

## Default Configuration

Defined in `convex/daytona.ts` and overridable via Convex environment variables:

```typescript
// Lifecycle timers
const DEFAULT_AUTO_STOP_MINUTES = 10;           // env: DAYTONA_AUTO_STOP_MINUTES
const DEFAULT_AUTO_ARCHIVE_MINUTES = 60 * 24;   // env: DAYTONA_AUTO_ARCHIVE_MINUTES  (24h)
const DEFAULT_AUTO_DELETE_MINUTES = 60 * 24;    // env: DAYTONA_AUTO_DELETE_MINUTES   (24h)

// Resource limits
const DEFAULT_CPU_LIMIT = 2;    // env: DAYTONA_CPU_LIMIT
const DEFAULT_MEMORY_GIB = 4;   // env: DAYTONA_MEMORY_GIB
const DEFAULT_DISK_GIB = 10;    // env: DAYTONA_DISK_GIB
```

---

## Sandbox Provisioning Flow (Import)

When a user imports a repository, the following happens in sequence:

1. **`repositories.ts`** - Creates the repository record and import job
2. **`importsNode.ts`** - Orchestrates the import
3. **`daytona.ts:provisionSandbox()`** - Creates the sandbox on Daytona Cloud
   - Deletes any pre-existing sandbox with the same name (conflict avoidance)
   - Configures resource limits and lifecycle timers
4. **`daytona.ts:cloneRepositoryInSandbox()`** - Git clones the repo into the sandbox
5. **`daytona.ts:collectRepositorySnapshot()`** - Walks the file tree, reads important files
6. **`imports.ts:persistImportResults()`** - Saves everything to Convex DB, sets sandbox status to `ready`

---

## Chat Paths & Sandbox Dependency

### Fast Path (No sandbox required)

```
sendMessage() -> generateAssistantReply() -> OpenAI API
                        |
                        v
              Uses pre-indexed data only:
              - analysisArtifacts
              - repoChunks
              - repository summary
```

The Fast Path queries the Convex database for already-indexed artifacts and code
chunks. It streams a response via OpenAI. **No sandbox interaction occurs.**

### Deep Path (Sandbox required)

```
requestDeepAnalysis() -> runDeepAnalysis() -> runFocusedInspection()
                                                    |
                                                    v
                                        sandbox.process.executeCommand()
                                        (runs Python script inside sandbox)
```

The Deep Path runs a Python inspection script directly inside the Daytona sandbox
to find files matching the user's query. **Requires an active or auto-wakeable sandbox.**

---

## What the Frontend Does NOT Show

Currently, the application **does not display sandbox status** to the user:

- The `sandboxes` table tracks `status` in the DB, but this value is only updated
  during import (`provisioning` -> `ready`) and cleanup (`ready` -> `archived`).
- Daytona-side state changes (auto-stop, auto-archive, auto-delete) are **not**
  synced back to the Convex database.
- The frontend (`App.tsx`) has a "Clean sandbox" button but no status indicator.

### Potential Improvement

Consider adding a sandbox status badge in the thread UI that queries the Daytona
API for real-time state, or at minimum shows the `sandboxes.status` from the DB
with the `ttlExpiresAt` countdown.

---

## Eager Stop After Import

When an import completes successfully, `importsNode.ts` immediately calls
`stopSandbox()` to release CPU and memory. The sandbox remains on disk in
`stopped` state, so Deep Path can auto-wake it later with only a few seconds
of cold-start delay.

This avoids wasting up to 10 minutes of running time per import when no one
is actively using the sandbox.

---

## Scheduled Sweep (Cron)

`convex/crons.ts` runs `sweepExpiredSandboxes` every hour. The sweep:

1. Queries the `sandboxes` table for records with `status = 'ready'` and
   `ttlExpiresAt < now`.
2. For each match, checks the actual Daytona-side state via `getSandboxState()`.
3. If Daytona reports `archived` or `destroyed`, marks the Convex record as
   `archived`.
4. If Daytona reports `stopped`, proactively deletes it and marks as `archived`.
5. If Daytona reports `started` (still running past TTL), marks as `stopped` so
   it gets cleaned up on the next cycle.

This ensures the Convex DB stays in sync with Daytona and prevents paying for
orphaned sandboxes.

---

## Key Source Files

| File | Role |
|---|---|
| `convex/daytona.ts` | Daytona SDK wrapper - provision, clone, inspect, stop, delete, state check |
| `convex/importsNode.ts` | Import orchestrator - provisions sandbox, indexes repo, eagerly stops sandbox |
| `convex/imports.ts` | Import mutations - registers sandbox in DB, persists results |
| `convex/analysisNode.ts` | Deep analysis action - calls `runFocusedInspection()` |
| `convex/chat.ts` | Chat handler - Fast Path uses indexed data, Deep Path uses sandbox |
| `convex/ops.ts` | Operations - sandbox cleanup, sweep queries/mutations |
| `convex/opsNode.ts` | Node actions - sandbox deletion, scheduled sweep logic |
| `convex/crons.ts` | Cron jobs - hourly sweep of expired sandboxes |
| `convex/schema.ts` | DB schema - `sandboxes` table definition |

---

## References

### Daytona Official

| Resource | URL |
|---|---|
| Daytona Documentation (homepage) | https://www.daytona.io/docs |
| Daytona SDK GitHub Repository | https://github.com/daytonaio/daytona |
| Daytona SDK npm Package | https://www.npmjs.com/package/@daytona/sdk |
| Daytona Sandbox Lifecycle Docs | https://www.daytona.io/docs/sandbox/lifecycle |
| Daytona SDK Sandbox Class Reference | https://www.daytona.io/docs/sdk/typescript/sandbox |
| Daytona Auto-Stop / Auto-Archive | https://www.daytona.io/docs/sandbox/lifecycle#auto-stop |

### SDK Source Code (local, `@daytona/sdk@0.167.0`)

| File | Key Observations |
|---|---|
| `node_modules/@daytona/sdk/src/Sandbox.js` | `start()`, `stop()`, `waitUntilStarted()` implementations; auto-stop timer docs |
| `node_modules/@daytona/sdk/src/Daytona.js` | `get()`, `create()`, `start()`, `delete()` - top-level sandbox management |
| `node_modules/@daytona/sdk/src/Process.js` | `executeCommand()` - sends commands to sandbox; does not explicitly check/start state |
| `node_modules/@daytona/sdk/src/Sandbox.d.ts` | Type definitions; `refreshActivity()` docs explain auto-stop timer reset |

### Conceptual References

| Concept | Reference |
|---|---|
| Serverless sandbox cold-start pattern | Similar to AWS Lambda cold starts; Daytona auto-wakes stopped sandboxes on API access |
| Copy-on-write sandbox isolation | Daytona `_experimental_fork()` uses CoW clones, similar to Firecracker microVMs |
| Lifecycle management (stop/archive/delete) | Common pattern in cloud sandbox providers (e.g., GitHub Codespaces, Google Cloud Workstations) |
