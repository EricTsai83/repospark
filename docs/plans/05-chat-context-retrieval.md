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

`getReplyContext` 的 chunk 查詢改成「query-aware 候選池」：

- Tokenize 問題（沿用 `selectRelevantChunks` 的切詞邏輯，但 token 取前 8 個）。
- 對每個 token 執行兩種 index 查詢（limit 小一點，例如每 token 20）：
  - `by_repositoryId_and_path`：`q.eq('repositoryId', ...).gte('path', token).lt('path', token + '\uffff')`（前綴式探路），抓 path 含 token 的 chunk。
  - `by_repositoryId_and_symbolName`：`q.eq('repositoryId', ...).eq('symbolName', token)`，抓 symbol 命中的 chunk。
- 再額外拿一組「預設 baseline」chunks（`by_importId_and_path_and_chunkIndex` take 40）保證即使 token 都 miss 也還有 context。
- 以 `_id` 去重合併，最終候選池上限例如 120 個。

或更務實的做法（若 index 改動太大）：

- 保持 `take(80)` 當 baseline，但**額外**呼叫一次 `by_repositoryId_and_path` 的前綴查詢（針對問題中像路徑的 token，例如含 `/`、`.ts`、`.py`）再 merge。

### 2. 打分

`selectRelevantChunks`：

- 加上 `chunk.content` 的 substring 命中（每個 token hit +1）。
- path hit 權重 2，symbol/summary hit 權重 1.5，content hit 權重 1（避免長 content 壓過精準 path）。
- 維持 `MAX_RELEVANT_CHUNKS` 截斷。

### 3. Constants

`convex/lib/constants.ts` 新增（若 baseline 策略要調）：

```ts
export const CHAT_CANDIDATE_POOL_LIMIT = 120;
export const CHAT_BASELINE_CHUNKS = 40;
```

若不改 baseline 策略則不需要。

## 驗證

- 擴充 `convex/chat-context.test.ts`：
  - 200 chunks 的 fixture，chunks[180].path 含 `auth`，問題 `"How does auth work?"` 應該 selectRelevantChunks 結果包含 chunks[180]（以前不會，因為它在前 80 之外）。
  - 問題 token 都 miss 時仍會回 baseline 結果而非空陣列。
  - content 命中能影響排序（path 完全不含 token、但 content 多次命中 的 chunk 會排進前 `MAX_RELEVANT_CHUNKS`）。

## Out of Scope

- 不做 embedding / vector index（另起一個 `09-chat-embedding.md` 時再做）。
- 不改 chunk 的產生邏輯（`convex/lib/repoAnalysis.ts` 的 `createChunkRecords` 不動）。
- 不改 prompt template（`buildUserPrompt` 不動）。
