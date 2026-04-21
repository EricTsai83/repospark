# Quick Mode vs Deep Mode

> Last updated: 2026-04-18
> Related: [daytona-sandbox-lifecycle.md](./daytona-sandbox-lifecycle.md)

## Overview

The chat system has two modes for answering questions about a repository:

| | Quick Mode | Deep Mode |
|---|---|---|
| **Old name** | Fast path | Deep path |
| **Data source** | Pre-indexed artifacts and code chunks stored in Convex DB | Live filesystem access inside the Daytona sandbox |
| **Requires sandbox** | No | Yes |
| **Speed** | ~2-5 seconds | ~5-30 seconds (+ cold-start if sandbox was stopped) |
| **Accuracy** | Limited to what was captured at import time | Can search the full repository as it exists in the sandbox |
| **Cost** | OpenAI API tokens only | OpenAI tokens + Daytona sandbox compute |

---

## Quick Mode (formerly "Fast Path")

### What Happens When User Sends a Message

```
User message
    |
    v
chat.ts: sendMessage()          ──> Creates user + assistant message records
    |                                Schedules generateAssistantReply()
    v
chat.ts: generateAssistantReply()
    |
    v
chat.ts: getReplyContext()       ──> Queries Convex DB for:
    |                                 1. repository.summary
    |                                 2. repository.readmeSummary
    |                                 3. repository.architectureSummary
    |                                 4. analysisArtifacts (up to 20 records)
    |                                 5. repoChunks (up to 80 records)
    |                                 6. Previous messages in thread (up to 20)
    v
chat.ts: selectRelevantChunks() ──> Scores each chunk against user's question
    |                                by matching keywords in path + summary
    |                                Returns top 6 most relevant chunks
    v
chat.ts: buildUserPrompt()      ──> Assembles prompt with:
    |                                 - Repository summary
    |                                 - README summary
    |                                 - Architecture summary
    |                                 - Top 6 artifacts (each truncated to 1400 chars)
    |                                 - Top 6 code chunks (each truncated to 1200 chars)
    |                                 - User's question
    v
OpenAI API (gpt-4o-mini)        ──> Streams response back
    |
    v
chat.ts: appendAssistantDelta() ──> Flushes to DB every ~240 chars
    |
    v
chat.ts: completeAssistantReply()
```

### Data Sources in Detail

#### 1. Analysis Artifacts (created at import time)

| Kind | Source | Content |
|---|---|---|
| `manifest` | `repoAnalysis.ts: buildRepositoryManifest()` | Framework, languages, package managers, entrypoints |
| `readme_summary` | `importsNode.ts: summarizeReadme()` | First 4 non-empty lines of README (max 240 chars) |
| `architecture` | `repoAnalysis.ts: createArchitectureArtifactMarkdown()` | Framework detection, entrypoints, suggested reading order |
| `deep_analysis` | Only created by Deep Mode | Sandbox inspection results |

#### 2. Code Chunks (created at import time)

From `repoAnalysis.ts: createChunkRecords()`:

- README is chunked into 80-line segments (up to 4 chunks)
- Important files are chunked into 60-line segments (up to 4 chunks per file)
- Maximum 60 total chunks across all files
- Each chunk stores: path, line range, content (max 8000 chars), summary

#### 3. Important Files Read During Import

From `repoAnalysis.ts: shouldReadFile()` + `daytona.ts: collectRepositorySnapshot()`:

Files read during import (up to 12):
- Prioritized by `IMPORTANT_FILE_PATTERNS`: README, package.json, vite.config,
  tsconfig, convex/schema, convex/http, src/main, src/App, app/page, main.py,
  pyproject.toml, Cargo.toml
- Only text file extensions: ts, tsx, js, jsx, json, md, py, rs, go, java, etc.
- Each file truncated to 20,000 chars

### Limitations

- Only sees files that existed at import time
- Only reads up to 12 "important" files in full
- Code chunks are limited to 60 total (many files are never chunked)
- Keyword matching for relevance is basic (no semantic/embedding search)
- If the user asks about a file that wasn't flagged as "important", Quick Mode
  may not have its content

---

## Deep Mode (formerly "Deep Path")

### What Happens When User Sends a Deep Analysis Request

```
User clicks "Run deep analysis" with a prompt
    |
    v
analysis.ts: requestDeepAnalysis()  ──> Creates job record
    |                                     Schedules runDeepAnalysis()
    v
analysisNode.ts: runDeepAnalysis()
    |
    v
analysis.ts: getDeepAnalysisContext() ──> Gets sandbox remoteId and repoPath
    |
    v
daytona.ts: runFocusedInspection()
    |
    v
daytona.ts: getSandbox(remoteId)     ──> Calls daytona.get() to retrieve sandbox
    |                                      (auto-wakes if stopped)
    v
sandbox.process.executeCommand()     ──> Runs Python script INSIDE the sandbox:
    |
    |   The Python script:
    |   1. Tokenizes the user's prompt into keywords (up to 8 tokens, >2 chars)
    |   2. Walks the entire repo directory tree (skips .git, node_modules, dist, etc.)
    |   3. Scores each file path against the keywords
    |   4. Returns top 20 matching file paths as JSON
    |
    v
repoAnalysis.ts: createDeepAnalysisMarkdown()  ──> Wraps results in markdown
    |
    v
analysis.ts: completeDeepAnalysis()  ──> Saves as an analysisArtifact
                                          (kind: 'deep_analysis', source: 'sandbox')
```

### What the Python Script Actually Does

```python
# Runs inside the Daytona sandbox at the repo root
import json, os, re

# 1. Extract keywords from user's prompt
terms = [token for token in re.findall(r"[A-Za-z0-9_]+", prompt.lower())
         if len(token) > 2][:8]

# 2. Walk the full directory tree
matches = []
for root, dirs, files in os.walk(repo_path):
    # Skip irrelevant directories
    dirs[:] = [d for d in dirs
               if d not in {".git", "node_modules", "dist", "build", ".next", ".turbo"}]
    for name in files:
        rel_path = os.path.join(rel_root, name)
        # 3. Score each file by keyword matches in its path
        score = sum(1 for term in terms if term in rel_path.lower())
        if score:
            matches.append((score, rel_path))

# 4. Return top 20 matches
matches.sort(key=lambda item: (-item[0], item[1]))
print(json.dumps({
    "terms": terms,
    "matchingFiles": [path for _, path in matches[:20]]
}))
```

### Key Differences from Quick Mode

| Aspect | Quick Mode | Deep Mode |
|---|---|---|
| File visibility | Only ~12 files read at import | Entire repo directory tree |
| Search method | Keyword match on pre-chunked summaries | Keyword match on all file paths in live filesystem |
| Can find new files | No (frozen at import time) | Yes (sees current sandbox state) |
| Output format | Streamed chat message | Analysis artifact (saved permanently) |
| Where results appear | Chat panel | Artifacts tab |
| Requires OpenAI | Yes (for LLM response) | No (Python script only, no LLM) |

### Current Limitations of Deep Mode

- Only matches file **paths**, not file **contents** (no grep inside files)
- Does not read or return file contents, only lists matching paths
- Keyword extraction is basic regex, no NLP
- Results are saved as artifacts, not integrated into chat context
- No follow-up capability (can't say "now read that file")

---

## Naming Recommendation

"Fast path" and "Deep path" use developer jargon ("path" refers to code
execution paths, not something users intuitively understand).

### Recommended Rename

| Old Name | New Name | Label in UI | Description |
|---|---|---|---|
| Fast path | Quick mode | **Quick** | "Answers from indexed data" |
| Deep path | Deep mode | **Deep** | "Searches the live sandbox" |

The word "path" is removed. "Quick" is universally understood. "Deep" already
conveys the right meaning. Adding short descriptions in the UI makes it
self-documenting.

---

## References

| Resource | URL |
|---|---|
| Project source: chat.ts | `convex/chat.ts` - Quick Mode implementation |
| Project source: analysisNode.ts | `convex/analysisNode.ts` - Deep Mode implementation |
| Project source: daytona.ts | `convex/daytona.ts` - `runFocusedInspection()` |
| Project source: repoAnalysis.ts | `convex/lib/repoAnalysis.ts` - chunking and manifest logic |
| OpenAI Streaming API | https://platform.openai.com/docs/api-reference/streaming |
| Daytona SDK Process Execution | https://www.daytona.io/docs/sdk/typescript/process |
