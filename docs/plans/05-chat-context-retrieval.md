# Plan 05 — Chat Context Retrieval 改善

- **Priority**: P2
- **Scope**: 只改 chat 的 context 組裝與 chunk 排序，不動 import pipeline、schema、前端。
- **Conflicts**:
  - `convex/chat.ts`：與 Plans 02 / 07 / 08 衝突。
- **Dependencies**: 無。

## 背景

`convex/chat.ts` 的 `getReplyContext`：

```ts
const chunks = repository.latestImportId
  ? await ctx.db
      .query('repoChunks')
      .withIndex('by_importId_and_path_and_chunkIndex', (q) =>
        q.eq('importId', repository.latestImportId!),
      )
      .take(80)
  : [];
```

- 永遠拿 insertion 順序前 80 個 chunk，不隨問題變動。
- 大型 repo（1600 chunks）後段檔案永遠進不來。

而 `selectRelevantChunks` 的打分：

```ts
if (chunk.path.toLowerCase().includes(token) ||
    chunk.summary.toLowerCase().includes(token)) { return count + 1; }
```

- 只看 path / summary 的 substring match，`chunk.content` 沒看過。
- 小寫 token 過濾 `length > 2`，太粗糙。

結果：同一個 repo、同一個問題永遠會看到同一批檔案。

## 目標（短期）

這份 Plan 只做短期改善，目標是：

1. 候選池要能隨問題變動（不再是固定前 80）。
2. 打分要看 `chunk.content`，不只看 path/summary。
3. 仍維持輕量（無 embedding、無外部 API）。

長期的 embedding 版本留另外一個 Plan，不在此處做。

## 做法

### 1. 候選池策略

`getReplyContext` 改成「latest snapshot 內的 query-aware candidate pool」：

- 先載入最近訊息，取最新一則 user message 當查詢來源。
- 將問題 tokenize，取前 8 個有效 token，組成 Convex text search query。
- 在 `repoChunks` 上新增兩個 `searchIndex`，都用 `importId` 當 filter field：
  - `search_summary`
  - `search_content`
- 查詢時固定 `eq('importId', repository.latestImportId)`，確保只會命中目前發佈中的 import snapshot，不會把舊 snapshot 混回來。
- baseline 不再只拿前 N 個 chunk，而是：
  - `by_importId_and_path_and_chunkIndex` 取前半段
  - 同一個 index `order('desc')` 取後半段
  - 這樣即使 search miss，也不會永遠只看到 path 排序最前面的檔案
- 合併 `summary search hits + content search hits + baseline`，用 `_id` 去重，最後截成固定上限 candidate pool。

### 2. 打分

`selectRelevantChunks` 保留輕量 heuristic，但改成對 candidate pool 做 weighted rerank：

- `path` 命中: `+3`
- `summary` 命中: `+2`
- `content` 命中: `+1`
- token 為空時直接回傳前 `MAX_RELEVANT_CHUNKS`
- 若分數相同，保留 candidate pool 原本的順序當作 tie-break，避免同分 chunk 被 rerank 階段重新洗牌，同時維持可重現的結果

這樣做的原因是：

- path / summary 命中通常更精準，應優先於長段 content 的偶發字串命中
- content 仍然能把原本完全進不了候選池的 chunk 拉進來

### 3. Constants

`convex/lib/constants.ts` 新增：

```ts
export const CHAT_BASELINE_CHUNKS = 30;
export const CHAT_SEARCH_RESULTS_PER_INDEX = 30;
export const CHAT_CANDIDATE_POOL_LIMIT = 90;
```

### 4. 為什麼不採用原本的 `repositoryId` 級查詢

原版 plan 提到的 `by_repositoryId_and_path` / `by_repositoryId_and_symbolName` 有兩個問題：

1. 它們不是 latest snapshot 邊界，容易把歷史 import 的 chunk 混回 candidate pool。
2. 目前 `symbolName` 在現行 chunk 產生流程裡幾乎沒有被填值，短期收益很低。

因此短期最佳實踐不是做 repository-wide prefix probing，而是：

- 先守住 `latestImportId` 的一致性
- 再用 search index 讓候選池對問題有反應
- embedding / richer semantic retrieval 留到後續 plan

## 驗證

- 擴充 `convex/chat-context.test.ts`：
  - 200 chunks 的 fixture，`src/file-180-auth.ts` 不在 baseline head/tail 範圍內，但問題 `"How does auth work?"` 仍會把它帶進 `getReplyContext().chunks`。
  - 問題 token 都 miss 時仍會回 baseline 結果而非空陣列。
  - `content` 命中能影響排序，即使 path / summary 都不含 token，仍能排進前 `MAX_RELEVANT_CHUNKS`。

## Out of Scope

- 不做 embedding / vector index（另起一個 `09-chat-embedding.md` 時再做）。
- 不改 chunk 的產生邏輯（`convex/lib/repoAnalysis.ts` 的 `createChunkRecords` 不動）。
- 不改 prompt template（`buildUserPrompt` 不動）。
