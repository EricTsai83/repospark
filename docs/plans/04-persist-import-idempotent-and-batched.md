# Plan 04 — persistImportResults 冪等性 + 分批化

- **Priority**: P1
- **Scope**: import pipeline 的後半段（持久化階段）。
- **Conflicts**:
  - `convex/imports.ts`：與 Plans 03 / 06 衝突。建議依順序 03 → 04 → 06。
  - `convex/importsNode.ts`：與 Plan 03 衝突。
  - `convex/schema.ts`：可能加 index，會與 Plans 02 / 06 / 07 / 08 衝突。
- **Dependencies**: 建議先做 Plan 03（DB-first sandbox reservation 提供更穩的前置狀態），但不強制。

## 背景

`convex/imports.ts` 的 `persistImportResults` 目前在**單一 mutation** 內完成：

- Insert 最多 400 個 `repoFiles`（`MAX_LISTED_FILES`）
- Insert 最多 1600 個 `repoChunks`（`MAX_LISTED_FILES * MAX_CHUNKS_PER_FILE`）
- Insert 3 個 `analysisArtifacts`
- Patch `import` / `job` / `repository` / `sandbox`

兩個問題：

1. **不是冪等的**：若這個 mutation 被 retry（Convex action 在某些條件會 retry），會重複插入一整批資料，且沒有任何 dedupe key。
2. **離上限不遠**：Convex 單一 mutation 有 byte / ops 上限。目前大型 repo 已接近邊界，未來加 embedding / 把 `MAX_LISTED_FILES` 拉高就會撞牆，而撞牆等於整輪 import 失敗、得重 clone。

## 目標

讓 persist 階段：

- 可安全 retry（冪等）
- 可處理 10 倍大小 repo（分批寫入，單批小於單 mutation 軟上限）
- 維持對 `deletionRequestedAt` 的尊重（任一批次發現 tombstone 就 cancel）

## 做法

### A. 冪等性守門

1. `persistImportResults` 最前面加：

```ts
const importRecord = await ctx.db.get(args.importId);
if (importRecord?.status === 'completed') {
  return { kind: 'completed' as const };
}
```

2. 對已 `completed` 的 repository，`markImportFailed` 不要覆寫 `importStatus: 'failed'`（目前會蓋掉）。

### B. 拆成三階段 mutation

將現在的 `persistImportResults` 拆成：

1. **`persistImportHeader`**（mutation）
   - 參數：`importId`, `repositoryId`, `jobId`, `sandboxId`, `commitSha`, `branch`, `detectedLanguages`, `packageManagers`, `entrypoints`, `summary`, `readmeSummary`, `architectureSummary`, `artifacts`。
   - 動作：
     - 檢查 `deletionRequestedAt`，有則 `finalizeImportCancellation`。
     - Insert 3 個 artifacts。
     - Patch repository summary / readme / architecture / detectedLanguages / packageManagers / entrypoints。
     - Patch import 的 `commitSha` / `branch` / `startedAt`（但**不要** mark completed）。
     - Patch job 的 `stage: 'persisting_files'`、`progress: 0.5`。

2. **`persistRepoFilesBatch`**（mutation）
   - 參數：`importId`, `repositoryId`, `files: array<FileRecord>`（每批最多 200 筆）。
   - 檢查 tombstone。
   - Insert `repoFiles`（寫入前用 `by_importId_and_path` unique 先檢查，若已存在則 skip — dedupe 邏輯）。
   - 回傳 `fileIdsByPath: Record<string, Id<'repoFiles'>>`。

3. **`persistRepoChunksBatch`**（mutation）
   - 參數：`importId`, `repositoryId`, `chunks: array<ChunkRecord>`（每批最多 200 筆），`fileIdsByPath`。
   - 檢查 tombstone。
   - 用 `by_importId_and_path_and_chunkIndex` 檢查去重。
   - Insert `repoChunks`。

4. **`finalizeImportCompletion`**（mutation）
   - 參數：`importId`, `repositoryId`, `jobId`, `sandboxId`, `previousCompletedImportId`, `previousCompletedImportJobId`。
   - 把原 `applyImportCompletionState` 的全部動作搬進來（mark completed、切 `latestImportId` 等 pointer、sandbox ready）。
   - 排程 `cleanupSupersededImportSnapshot`（若需要）。

### C. Schema

`convex/schema.ts` `repoFiles` 加：

```ts
.index('by_importId_and_path', ['importId', 'path'])
```

`repoChunks` 的 `by_importId_and_path_and_chunkIndex` 已存在，可直接拿來 dedupe。

### D. `importsNode.runImportPipeline` 調整

在生成 `fileRecords` / `chunkRecords` 之後：

```
persistImportHeader(...)                        // 一次
for each batch of 200 files:                    // 迴圈
  fileIdsByPath = persistRepoFilesBatch(...)
  // 合併到 cumulative map
for each batch of 200 chunks:
  persistRepoChunksBatch(..., fileIdsByPath)
finalizeImportCompletion(...)                   // 一次
```

每個 mutation 之間檢查 `ctx.runQuery(internal.imports.getImportContext, ...)`，若變 cancelled 就 break out。

## 驗證

- 單元測試：
  - 連續呼叫兩次完整 persist 流程，最終 `repoFiles` / `repoChunks` / `artifacts` 數量不變。
  - 對 800 files × 4 chunks = 3200 chunks 的假資料，pipeline 能成功完成（以前會在單 mutation 撞牆）。
  - 中途把 repository 設 `deletionRequestedAt` 後繼續呼叫剩餘批次，能 early exit 並 mark cancelled。
- 手動：`imports.test.ts` 擴充 case（可參考既有的 `imports.test.ts` 結構）。

## Out of Scope

- 不改 snapshot 蒐集邏輯（`collectRepositorySnapshot` / `createRepoFileRecords` / `createChunkRecords` 保持不變）。
- 不引入 embedding（那屬於 Plan 05 的長期項目）。
- 不改 `cleanupSupersededImportSnapshot`（已經是 batch + self-reschedule 的模式，不動）。
