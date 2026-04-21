# Plan 06 — `getRepositoryDetail` Read Amplification

- **Priority**: P2
- **Scope**: 主畫面 subscription 的 over-fetch 修正。
- **Conflicts**:
  - `convex/schema.ts`：與 Plans 02 / 04 / 07 / 08 衝突。
  - `convex/imports.ts`：與 Plans 03 / 04 衝突。
  - `convex/repositories.ts`：與 Plan 02 衝突。
- **Dependencies**: 建議在 Plan 04 後做（因為 `persistImportResults` 可能已被拆成多階段，要把 `fileCount` 寫入的位置搬到正確的 finalize step）。

## 背景

`convex/repositories.ts` 的 `getRepositoryDetail` 是前端主畫面的 live subscription：

```ts
const latestImportId = repository.latestImportId;
const sampledFiles = latestImportId
  ? await ctx.db
      .query('repoFiles')
      .withIndex('by_importId', (q) => q.eq('importId', latestImportId))
      .take(FILE_COUNT_DISPLAY_LIMIT + 1)  // = 401
  : [];
const fileCount = Math.min(sampledFiles.length, FILE_COUNT_DISPLAY_LIMIT);
const fileCountLabel =
  sampledFiles.length > FILE_COUNT_DISPLAY_LIMIT ? `${FILE_COUNT_DISPLAY_LIMIT}+` : String(fileCount);
```

僅僅為了顯示「檔案總數」或「400+」，每次 subscription re-run 都 take 最多 401 筆 `repoFiles`。而任何 `jobs` / `artifacts` / `repository` 的變動都會觸發這個 query 重新執行，造成大量 read amplification。

## 目標

把 fileCount 持久化到 `repositories` 上，讓 `getRepositoryDetail` 不再掃 `repoFiles`。

## 做法

### 1. Schema

`convex/schema.ts` `repositories` 新增：

```ts
fileCount: v.optional(v.number()),
```

### 2. 寫入位置

`convex/imports.ts`（或 Plan 04 拆出的 `finalizeImportCompletion`）：

- `applyImportCompletionState` / `finalizeImportCompletion` 在 patch `repository` 時帶上 `fileCount: repoFilesCount`。
- 數量來源：直接從 `args.repoFiles.length`（完整列表長度），或在 Plan 04 分批的情況下，由 `runImportPipeline` 累積 batch 總數後傳入 finalize mutation。

### 3. 讀取位置

`convex/repositories.ts` `getRepositoryDetail`：

- 刪掉 `sampledFiles` 相關 query。
- `fileCount = repository.fileCount ?? 0`。
- `fileCountLabel = repository.fileCount && repository.fileCount >= FILE_COUNT_DISPLAY_LIMIT ? `${FILE_COUNT_DISPLAY_LIMIT}+` : String(repository.fileCount ?? 0)`。

> 注意：`FILE_COUNT_DISPLAY_LIMIT` 目前在 `repositories.ts` 內，保留即可；它只是顯示上限。

### 4. 舊資料 backfill

由於 `fileCount` 是新欄位，已存在的 repository 不會有這個欄位。處理方式（擇一）：

- **A.** 下次 sync / 下次 re-import 時自然補上（可接受的漸進式 backfill）。
- **B.** 寫一次性 internalMutation `backfillRepositoryFileCounts`：用 `by_importId` 掃每個 repo 的 `latestImportId` 下的 files count，然後寫入。適合在 Convex dashboard 手動觸發。

建議採 B，寫完以後 archive 掉這個 mutation（加註解說明已跑過）。

## 驗證

- 訂閱 `getRepositoryDetail`，Convex dashboard 看這個 query 的 bytes read / function latency 應顯著下降。
- 新 import 完成後 repository 的 `fileCount` 有值；UI 顯示的 label 不變。
- 跑過 backfill 後，既有 repository 也有正確 `fileCount`。

## Out of Scope

- 不改 `artifacts` / `jobs` / `threads` 的 take 數量。若這些真的成為瓶頸再另開 plan。
- 不做 `getImportedRepoSummaries` 的優化（目前 take 200 可接受）。
- 不改 UI 端的顯示邏輯。
