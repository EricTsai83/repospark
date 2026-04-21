# Plan 03 — Daytona Sandbox 孤兒保護

- **Priority**: P1
- **Scope**: Convex backend 的 import 流程與 ops 流程。
- **Conflicts**:
  - `convex/importsNode.ts`：與 Plan 04 衝突，建議**先做這份**（或先做 Plan 04 再回頭做這份，擇一序列化）。
  - `convex/imports.ts`：與 Plans 04 / 06 衝突。
  - `convex/opsNode.ts` / `convex/crons.ts`：其他計劃不動，安全。
- **Dependencies**: 無。

## 背景

目前 provisioning 順序（`convex/importsNode.ts`）：

1. `provisionSandbox()` → Daytona 端 `daytona.create()` 成功，拿到 `remoteId`。
2. `ctx.runMutation(internal.imports.registerSandbox, ...)` → DB 寫入 sandbox row。

在步驟 1 與步驟 2 之間，如果 action crash（OOM / 逾時 / 網路抖動 / deploy 中斷 / 其他 throw）：

- Daytona 端有一個 sandbox 在扣費。
- Convex DB 完全沒有這個 sandbox 的 row。
- `sweepExpiredSandboxes` 只掃 DB `sandboxes` 表，看不到這個孤兒。
- 只能靠 Daytona 自身的 `autoDeleteInterval`（預設 24h）兜底，這段時間錢持續燒。

同時，`provisionSandbox` 裡有一段「先 name-based lookup 刪除同名舊 sandbox」，但這只能在**同一個 repo 再次 import** 時才會踩到。

## 目標

兩條都做：

1. **DB-first provisioning**：在呼叫 Daytona `create` 之前，先插 `status: 'provisioning'` 的佔位 row，這樣無論 action 之後在哪裡 crash，cleanup 流程都能從 DB 認領到這個 sandbox。
2. **Label-based reconciliation cron**：定期從 Daytona 端列出所有 `app: 'architect-agent'` label 的 sandbox，與 DB 比對，刪掉沒有對應 DB row 且年齡超過安全門檻的孤兒。

## 做法

### A. DB-first provisioning（主要）

#### 1. 新增 / 調整 mutation

`convex/imports.ts`：

- 新增 `reserveSandboxRow(args: { importId, repositoryId, ownerTokenIdentifier, sourceAdapter, sandboxName })`：
  - 插入 sandbox row，`status: 'provisioning'`、`remoteId: ''`、`workDir: ''`、`repoPath: ''`、`cpuLimit/memoryLimitGiB/...` 先寫預期值或 0、`ttlExpiresAt: Date.now() + <safety window, e.g. 30 min>`。
  - 同時 `patch` import 的 `sandboxId`、`repository.latestSandboxId`。
  - 回傳 `sandboxId`。
- 把現有 `registerSandbox` 改名為 `attachSandboxRemoteInfo(args: { sandboxId, remoteId, workDir, repoPath, cpu/mem/disk/...intervals })`：
  - 只 patch 那筆已存在的 row，補上 `remoteId` 等欄位，**不要** insert 新的。

#### 2. 調整 pipeline

`convex/importsNode.ts` → `runImportPipeline`：

```
archive 舊 sandbox（維持現狀）
                ↓
reserveSandboxRow（新增）  ← DB 寫入 provisioning row
                ↓
provisionSandbox（維持現狀）  ← Daytona create
                ↓
attachSandboxRemoteInfo（原 registerSandbox）
                ↓
cloneRepositoryInSandbox / collectRepositorySnapshot（維持現狀）
```

#### 3. 失敗路徑

- 若 `provisionSandbox` 失敗 → 捕捉後 `markImportFailed`（已有）之外，額外排程 `runSandboxCleanup`（現在的版本只會刪 Daytona 端；需要它對「沒有 remoteId」的情況能 graceful skip）。
- `convex/opsNode.ts` `runSandboxCleanup`：若 `sandbox.remoteId` 為空字串，直接 `completeSandboxCleanup` 標 archived 不呼叫 Daytona delete。

### B. Label-based reconciliation cron（補漏）

#### 1. Daytona client 新增 API

`convex/daytona.ts`：

- 新增 `listSandboxesByLabel(label: Record<string, string>)`：用 `@daytona/sdk` 的 list API 回傳 `{ remoteId, labels, createdAt }[]`。（若 SDK 沒提供 list，則跳過 B 方案，用 A 方案已足夠。）

#### 2. Ops action

`convex/opsNode.ts` 新增 `reconcileDaytonaOrphans` internalAction：

1. `listSandboxesByLabel({ app: 'architect-agent' })`
2. 逐個比對 Convex `sandboxes.by_remoteId`。
3. 若 DB 裡找不到，且 Daytona 端 `createdAt > 10 分鐘之前`（避免誤殺正在 register 中的），呼叫 `deleteSandbox(remoteId)` 並 `logInfo('reconcile', 'orphan_deleted', ...)`。

#### 3. Cron

`convex/crons.ts` 新增：

```ts
crons.interval(
  'reconcile daytona orphans',
  { hours: 6 },
  internal.opsNode.reconcileDaytonaOrphans,
  {},
);
```

## 驗證

- 單元測試：
  - `reserveSandboxRow` 後立刻 throw，`markImportFailed` 能把該 sandbox 導向 cleanup job。
  - `runSandboxCleanup` 對 `remoteId === ''` 的 row 不會呼叫 Daytona delete。
- 手動：
  - 在 `provisionSandbox` 之後、`attachSandboxRemoteInfo` 之前手動 throw，確認 DB 留下 `provisioning` row 且後續有 cleanup job。
  - 在 Daytona 端手動建一個帶 `app: architect-agent` label 但 DB 沒有的 sandbox，跑 `reconcileDaytonaOrphans`，應該刪除。

## Out of Scope

- 不處理「DB 有 row 但 Daytona 端沒有」的反向孤兒（這部分現有 `sweepExpiredSandboxes` 在 `destroyed` 分支已處理）。
- 不改 `provisionSandbox` 裡 name-based 預清除邏輯（保留）。
- 不改 rate limit（見 Plan 02）。
