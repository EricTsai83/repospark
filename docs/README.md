# Repospark System Design

This folder contains the system design documentation for the current Repospark codebase. The documents focus on the current state and are meant to help engineers quickly understand the system boundaries, core data model, key workflows, and external integrations.

## Recommended Reading Order

1. `system-overview.md`
2. `domain-and-data-model.md`
3. `auth-and-access.md`
4. `repository-lifecycle.md`
5. `chat-and-analysis-pipeline.md`
6. `integrations-and-operations.md`

## What Each Document Answers

### `system-overview.md`

- What runtimes and external services make up Repospark?
- How do the main user actions flow through the frontend, Convex, and external services?
- Which modules form the backbone of the product?

### `domain-and-data-model.md`

- What are the core entities in the system?
- How does `ownerTokenIdentifier` enforce data isolation?
- Which tables carry workflow state?

### `auth-and-access.md`

- How are WorkOS and Convex connected?
- Where do the frontend and backend each enforce access control?
- How is a GitHub App installation bound to the current signed-in user?

### `repository-lifecycle.md`

- What steps does a repository go through from import to chat readiness?
- How do sandboxing, indexing, artifacts, sync, and deletion connect together?
- Which jobs and states are updated along this flow?

### `chat-and-analysis-pipeline.md`

- What data sources do Quick chat and Deep analysis each depend on?
- How is an assistant reply created, streamed, completed, or failed?
- Why can deep mode become unavailable because of sandbox state?

### `integrations-and-operations.md`

- What roles do GitHub, Daytona, and OpenAI each play?
- How do the HTTP callback/webhook, cron, and cleanup flows work?
- How are frontend `.env` variables and Convex runtime environment variables separated?

## Writing Principles

- Use English.
- Prioritize stable architecture boundaries and responsibility splits rather than translating the codebase file by file.
- Do not invent designs that do not exist, and do not describe future ideas as current capabilities.
- Each document should stay focused on answering a small number of important questions and avoid repetition.

## Archived Design Notes

Older design notes that are no longer part of the core reading set live under `archive/`:

- `archive/daytona-sandbox-lifecycle.md`
- `archive/fast-path-vs-deep-path.md`
- `archive/sandbox-cost-analysis.md`

## Out of Scope

The following are intentionally outside the scope of this document set:

- API-by-API or function-by-function reference material
- SRE runbooks and incident playbooks
- Historical ADR records
- Detailed design notes for every individual UI component