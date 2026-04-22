# Plan 08 — Deep Mode TTL 保護 + 多 GitHub Installation + 成本追蹤

- **Priority**: P3（三項小改善集中在一個 Thread 完成）
- **Scope**: 三個彼此獨立、改動都不大的小項目。
- **Conflicts**:
  - `convex/analysis.ts`：與 Plan 02 衝突。
  - `convex/github.ts`：其他 plan 不動。
  - `convex/chat.ts`：與 Plans 02 / 05 / 07 衝突。
  - `convex/schema.ts`：與 Plans 02 / 04 / 06 / 07 衝突。
- **Dependencies**: 無強依賴。若已做 Plan 02，sendMessage / requestDeepAnalysis 已有 rate limit 防護，此處專注功能。

> 如果想再拆更細，這份 Plan 可以切成 `08a-deepmode-ttl-protection.md` / `08b-multi-github-installations.md` / `08c-cost-tracking.md`，但三者都很小，合在一起執行仍可管理。

---

## 8.1 Deep Mode TTL 保護

### 背景

目前 `requestDeepAnalysis` 通過檢查 → 排程 `runDeepAnalysis` → action 內才真正跑。`sweepExpiredSandboxes` cron 每小時執行，可能在 mutation 與 action 之間把 sandbox 轉成 stopped / archived，導致 action 開跑時 sandbox 已不可用，job 剛 queued 就 fail。

### 做法

`convex/analysis.ts` 的 `requestDeepAnalysis`：

- 在 `ctx.db.insert('jobs', ...)` 之前或之後，對 `sandbox` 做一次 patch：

```ts
await ctx.db.patch(sandbox._id, {
  ttlExpiresAt: Math.max(sandbox.ttlExpiresAt, Date.now() + 30 * 60_000),
  lastUsedAt: Date.now(),
});
```

同樣的 bump 應用在 `convex/chat.ts` `sendMessage`，**但只在 `mode === 'deep'`** 且 `repository.latestSandboxId` 存在時才 patch。

### 驗證

- 執行 deep analysis 後，`sandboxes.ttlExpiresAt` 被延後到至少 30 分鐘後。
- sweep cron 在 30 分鐘內不會動到這個 sandbox。

### Out of Scope

- 不改 sweep cron 本身的行為。

---

## 8.2 多 GitHub Installation 支援（或明確阻擋）

### 背景

`convex/github.ts` `saveInstallation` 用 `by_ownerTokenIdentifier_and_status.first()` 找已存在的 active，並 `patch` 覆寫；這意味著同一個使用者在兩個 GitHub account 裝 App 時，第二次會覆蓋第一次，表面上看似成功但第一個 account 的 repo 就不能 import 了。

其他受影響路徑：

- `getInstallationIdForOwner` 只回單一 installationId（`importsNode.runImportPipeline` 就是用這個做 access check）。
- `disconnectGitHub` 只 disconnect 單一 active。

### 做法（擇一）

**選項 A — 最小改動：明確阻擋第二次 install**

- `saveInstallation` 改邏輯：查現有 active。
  - 若找不到：insert。
  - 若找到且 `installationId` 相同：patch（等同更新 metadata）。
  - 若找到且 `installationId` 不同：throw `Error('You already have a GitHub App installation connected. Please disconnect it before connecting a different account.')`。
- HTTP callback 收到這個 throw 後，redirect 回 `?github_error=already_connected`。

**選項 B — 正式支援多 installation**

- `saveInstallation`：以 `(ownerTokenIdentifier, installationId)` 當主鍵 upsert。
- 新增 `getActiveInstallationsForOwner`（internalQuery），回所有 active 陣列。
- `importsNode.runImportPipeline` 中的 access check：對所有 active installation 依序嘗試 `checkRepoAccess`，第一個成功就用；全部失敗才 throw。
- `disconnectGitHub`：改成 list 所有 active 並全部標 deleted，或新增 `disconnectGitHubInstallation({ installationId })` 讓 UI 明確指定。

建議：預設先做選項 A（使用者會清楚看到衝突），避免一次引入太多複雜度。

### 驗證

- 手動：在兩個 GitHub account 各自 install App，第二次應顯示明確錯誤（選項 A）或兩個 installationId 都在 DB 中（選項 B）。
- 既有單一 installation 流程不受影響。

### Out of Scope

- 不做 team / workspace 層級的共享 installation。
- 不改 GitHub webhook 處理邏輯。

---

## 8.3 Cost Tracking

### 背景

Schema 中已有 `messages.estimatedInputTokens / estimatedOutputTokens`、`jobs.estimatedInputTokens / estimatedOutputTokens / estimatedCostUsd`，但**沒有任何寫入**。

### 做法

1. 新增 `convex/lib/openaiPricing.ts`：

```ts
export type OpenAIPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const PRICING: Record<string, OpenAIPricing> = {
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  // 其他 model 依需要加。
};

export function estimateCostUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  const pricing = PRICING[model];
  if (!pricing || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}
```

2. `convex/chat.ts` `generateAssistantReply` 串流結束後取 usage：

- `ai` 套件的 `streamText` 完成後 `await response.usage` 可拿 `{ promptTokens, completionTokens, totalTokens }`。
- 將 `promptTokens` / `completionTokens` / `estimateCostUsd(...)` 傳入新的 `finalizeAssistantReply` 參數。

3. 延伸 `finalizeAssistantReply` 的參數與寫入：

```ts
await ctx.db.patch(args.assistantMessageId, {
  content: finalContent,
  status: 'completed',
  estimatedInputTokens: args.inputTokens,
  estimatedOutputTokens: args.outputTokens,
});
await ctx.db.patch(args.jobId, {
  status: 'completed',
  stage: 'completed',
  progress: 1,
  completedAt: now,
  outputSummary: 'Assistant reply generated.',
  estimatedInputTokens: args.inputTokens,
  estimatedOutputTokens: args.outputTokens,
  estimatedCostUsd: args.costUsd,
});
```

4. Heuristic fallback 路徑不寫 usage（保持 undefined）。

### 驗證

- 發一則 chat message 後：
  - `messages[_id].estimatedOutputTokens` 與 OpenAI 回傳的 usage 一致。
  - `jobs[_id].estimatedCostUsd` 有合理數字。
- 未設定定價表的 model 不 throw，只留 undefined。

### Out of Scope

- 不做 deep analysis 的 cost（deep analysis 目前沒呼叫 OpenAI）。
- 不建 cost dashboard / 報表（資料先存著，前端展示另開 plan）。
- 不做匯率換算、幣別切換。

---

## 合併 Commit 策略

建議在這個 Thread 裡拆成 3 個 commit，分別對應 8.1 / 8.2 / 8.3，方便日後 revert 單一子項目。
