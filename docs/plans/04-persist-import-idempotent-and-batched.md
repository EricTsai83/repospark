# Plan 04 — import persist 冪等化、分批化、延後 publish

- **Priority**: P1
- **Scope**: import pipeline 的持久化與 completion publish 邏輯。
- **Conflicts**:
  - `convex/imports.ts`：與 Plans 03 / 06 衝突。建議依順序 03 → 04 → 06。
  - `convex/importsNode.ts`：與 Plan 03 衝突。
  - `convex/schema.ts`：新增 index 會與 Plans 02 / 06 / 07 / 08 衝突。
- **Dependencies**: 建議先做 Plan 03，但不是硬性前置。

## 結論

原版方向是對的，但**不是最佳實踐**，因為它少了四個關鍵保護：

1. `analysisArtifacts` 在 header retry 時仍可能重複寫入。
2. 若在 header 就更新 repository 的 summary/readme/architecture，UI 會提早看到「尚未 publish 的新 snapshot」。
3. 分批途中若 cancellation / failure，會留下半套 `repoFiles` / `repoChunks` / `analysisArtifacts`。
4. 把整份 `fileIdsByPath` map 傳進每個 chunk batch，repo 放大後會讓 action-to-mutation payload 不必要地膨脹。

因此修正版的核心不是只有「拆 batch」，而是要採用：

- **idempotent upsert**
- **staged writes**
- **single finalize publish**
- **failure cleanup**

## 背景

原先的 `persistImportResults` 在單一 mutation 內同時做：

- insert `repoFiles`
- insert `repoChunks`
- insert `analysisArtifacts`
- patch `imports` / `jobs` / `repositories` / `sandboxes`

這會造成兩種問題：

1. **retry 不安全**：同一個 import 若被 action retry，資料可能重複插入。
2. **單 transaction 太大**：repo 變大時容易撞上 Convex mutation 的 read/write/byte 上限。

## 目標

讓 persist 階段具備以下特性：

- 可安全 retry
- 單批 bounded，能支援更大的 repo
- 只有在 finalize 時才切換可見 snapshot
- 任一批次發現 tombstone 或終態，都能安全退出
- 失敗/取消後不留下 partial snapshot

## 修正版做法

### A. 終態保護不只放在最後一個 mutation

除了 persist mutations 本身要 guard，`getImportContext` 與 `markImportRunning` 也要尊重 import 終態：

- 若 `imports.status === 'completed'`，直接 no-op
- 若 `imports.status === 'failed' | 'cancelled'`，不得再把它打回 `running`
- `markImportFailed` / cancellation flow 不得覆寫已完成 repository 的 `importStatus: 'completed'`

這是為了防止 action retry 把已結束的 import 重新啟動。

### B. 拆成四個 persistence steps

#### 1. `persistImportHeader`

- 只做小而穩定的 metadata 寫入：
  - upsert import artifacts
  - patch `imports.commitSha` / `imports.branch`
  - patch `jobs.stage = 'persisting_files'`
- **不更新 repository 可見欄位**

`analysisArtifacts` 需用 `by_jobId_and_kind` 做 dedupe / upsert，否則 header retry 仍會重複寫入。

#### 2. `persistRepoFilesBatch`

- 每批最多 200 筆
- 透過 `by_importId_and_path` 去重
- 已存在則 skip

#### 3. `persistRepoChunksBatch`

- 每批最多 200 筆
- 透過 `by_importId_and_path_and_chunkIndex` 去重
- `fileId` 在 mutation 內用 `by_importId_and_path` 解析，不把完整 `fileIdsByPath` map 在 action 裡一路傳遞

#### 4. `finalizeImportCompletion`

只有這一步能做 publish：

- `imports.status = completed`
- `jobs.status = completed`
- 更新 repository 的：
  - `latestImportId`
  - `latestImportJobId`
  - summary/readme/architecture
  - `detectedLanguages`
  - `packageManagers`
  - `entrypoints`
  - `lastImportedAt`
  - `lastIndexedAt`
  - `lastSyncedCommitSha`
- `sandboxes.status = ready`
- 若有舊 completed import，排程 `cleanupSupersededImportSnapshot`

### C. 失敗與取消都要清 partial snapshot

這是原版 plan 最大的缺口。

分批後，一旦其中某一批之前已經成功寫入，後續若 cancellation / failure：

- `repoFiles`
- `repoChunks`
- `analysisArtifacts`

都可能留下半套資料。

因此：

- `finalizeImportCancellation`
- `markImportFailed`

都必須排程 `cleanupSupersededImportSnapshot(importId, jobId)` 去清掉**當前 import 的 partial snapshot**。

### D. Schema

需要新增兩個 index：

```ts
analysisArtifacts
  .index('by_jobId_and_kind', ['jobId', 'kind'])

repoFiles
  .index('by_importId_and_path', ['importId', 'path'])
```

`repoChunks.by_importId_and_path_and_chunkIndex` 已存在，可直接沿用。

### E. `importsNode.runImportPipeline` 調整

生成 `fileRecords` / `chunkRecords` 後，改成：

```ts
persistImportHeader(...)

for each batch of 200 files:
  persistRepoFilesBatch(...)

for each batch of 200 chunks:
  persistRepoChunksBatch(...)

finalizeImportCompletion(...)
```

這裡不再傳遞 cumulative `fileIdsByPath`，因為 chunk mutation 會自行查本批需要的 file rows。

### F. Publish 規則

新的 invariant：

- `repoFiles` / `repoChunks` / import artifacts 可以先 staged
- **repository 的可見 summary 與 latest pointers 只能在 finalize 更新**

這樣 UI 與 downstream queries 永遠只會看到「上一個完整 snapshot」或「新的完整 snapshot」，不會看到中間態。

## 驗證

- 單元測試：
  - 完整 persist flow 連跑兩次，`repoFiles` / `repoChunks` / `analysisArtifacts` 數量不變
  - partial persist 後再 tombstone，能 mark cancelled 並清掉 staged rows
  - partial persist 後 `markImportFailed`，能保留上一個 completed snapshot，且清掉本次 partial rows
- 手動：
  - 用較大 repo 驗證多批次完成
  - 驗證 repository detail / chat 只會讀到 finalized snapshot

## Out of Scope

- 不改 snapshot 蒐集邏輯（`collectRepositorySnapshot` / `createRepoFileRecords` / `createChunkRecords` 保持不變）
- 不引入 embedding（屬於 Plan 05）
- 不改 `cleanupSupersededImportSnapshot` 的 batch/self-reschedule 模式，只重用它來清 partial snapshot
