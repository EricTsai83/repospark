# Plan 08 — Deep Analysis TTL 保護 + GitHub Installation 衝突處理 + Chat 成本估算

- **Priority**: P3
- **Scope**: 三個小改善，但 **8.2 明確收斂成 single-installation invariant**；正式 multi-installation 不在這份 plan 內。
- **Conflicts**:
  - `convex/analysis.ts`：與 Plan 02 衝突。
  - `convex/chat.ts`：與 Plans 02 / 05 / 07 衝突。
  - `convex/github.ts`：與 GitHub 連線流程修改相鄰。
  - `convex/http.ts`：8.2 需要一起改 callback redirect。
- **Dependencies**: 無強依賴。若 Plan 02 已完成，這份 plan 可以直接疊上去。

## 設計原則

這份 plan 以三條規則為準：

1. **只在真的要用 sandbox 時延長 TTL**：避免為了 UI mode 或未來想像中的行為，多留 sandbox、增加成本。
2. **先維持單一 active installation invariant**：目前 repo 的前後端都假設一個 owner 對應一個 active installation，先把衝突變明確，再談多 installation。
3. **成本資料只寫 provider 已確認的 usage**：估算可以保守，但不能讓 usage 缺失或 pricing 缺表時影響主流程。

## 為什麼原版 plan 不夠貼近 repo 現況

原版方向大致正確，但有三個地方需要修正：

1. `chat.sendMessage` 的 `mode === 'deep'` 目前**不會真的讀 sandbox**。若在這裡 bump TTL，只會增加 sandbox 存活時間與成本，沒有對應收益。
2. 「正式支援多 installation」不是小改。現在的 `getGitHubConnectionStatus`、`useGitHubConnection`、`ImportRepoDialog`、`githubAppNode.*`、`importsNode.runImportPipeline`、`githubCheck.checkForUpdates` 都預設只有一個 installation。
3. cost tracking 不應把實作綁死在某個 SDK 欄位名稱上。應該寫成「使用當前 SDK 的 finalized usage 介面」，unknown model 或 usage 缺失時保持 `undefined`。

## 8.1 Deep Analysis TTL 保護

### 背景

目前 `requestDeepAnalysis` 在 mutation 中完成檢查、建立 job、排程 action；真正執行 sandbox 讀取的是後面的 `analysisNode.runDeepAnalysis`。

`sweepExpiredSandboxes` 會根據 `sandboxes.ttlExpiresAt` 決定是否 stop / archive / cleanup。若 deep-analysis request 剛排進 queue，但 sandbox TTL 已接近過期，就可能出現：

1. mutation 成功
2. action 還沒實際跑
3. sandbox 先被 sweep
4. deep analysis 立即失敗

### 採用做法

只修改 `convex/analysis.ts` 的 `requestDeepAnalysis`：

1. 驗證 repository ownership 與 deep mode availability。
2. 在**同一個 mutation transaction** 內，先把 `sandbox.ttlExpiresAt` bump 到 `max(existingTtl, now + 30min)`，並更新 `lastUsedAt`。
3. 再建立 deep-analysis job，最後排程 `runDeepAnalysis`。

建議抽一個很小的 helper（可放同檔或 `convex/lib/`）集中這段 patch，避免之後真的有第二個 sandbox-consuming 路徑時又重複寫一次。

### 明確不做的事

**不要**在 `convex/chat.ts` `sendMessage` 的 `mode === 'deep'` 時 bump TTL。

原因很簡單：現在 chat 的 deep/thorough mode 只有 UI 與 message mode 的語意，後端 reply path 仍然走 `analysisArtifacts + repoChunks`，沒有讀 live sandbox。此時延長 TTL 只會增加成本，不會增加成功率。

如果未來 chat 真的改成 sandbox-backed，再新增共用 helper 讓那條路徑一起 touch TTL。

### 驗證

- `requestDeepAnalysis` 成功後，`sandboxes.ttlExpiresAt >= now + 30min`。
- 若原本 TTL 更長，不應被縮短。
- 既有 `sendMessage` 行為不變，不因 `mode === 'deep'` 而延長 sandbox。

### 建議測試

- `convex/analysis.test.ts`
  - deep analysis request 會延長 TTL。
  - 已有較長 TTL 時不會被覆蓋成更短值。

### Out of Scope

- 不改 `sweepExpiredSandboxes` 規則。
- 不把 Quick chat / Thorough chat 改成 sandbox-backed。

---

## 8.2 GitHub Installation 衝突處理（先不做多 installation）

### 背景

目前 `saveInstallation` 會用 `by_ownerTokenIdentifier_and_status.first()` 找 active installation，找到就直接覆寫。這會造成：

- 第二次 install 看起來成功
- 但第一個 GitHub account / org 的授權其實被悄悄取代

這對使用者與系統都不夠穩定，因為 product 現況其實是「一個 owner 對應一個 active installation」。

更重要的是，repo 目前很多地方都建立在這個 invariant 上：

- `github.getGitHubConnectionStatus`
- `github.getInstallationIdForOwner`
- `githubAppNode.verifyRepoAccess`
- `githubAppNode.listInstallationRepos`
- `githubAppNode.searchGitHubRepos`
- `importsNode.runImportPipeline`
- `githubCheck.checkForUpdates`
- `src/hooks/use-github-connection.ts`
- `src/components/import-repo-dialog.tsx`

所以 **正式支援多 installation 應該是另一份 plan**，不能再當成這份 plan 裡的「小選項 B」。

### 採用做法

這份 plan 只做「明確阻擋第二個 active installation」。

#### `convex/github.ts`

`saveInstallation` 改成明確分支：

1. 查這個 owner 的 active installations（用 bounded query，例如 `take(5)` 即可）。
2. 若找不到 active：
   - insert 新 row。
3. 若已有 active，且 `installationId` 相同：
   - patch metadata，視為重新安裝或更新。
4. 若已有 active，且 `installationId` 不同：
   - **不要覆寫**。
   - 回傳明確結果，例如：
     - `{ kind: 'conflict', existingInstallationId, existingAccountLogin }`

建議這裡用 **discriminated union return value**，不要把「已連過別的 installation」當成例外錯誤字串丟出去。這是已知衝突路徑，不是 unexpected failure。

#### `convex/http.ts`

GitHub callback 收到 `saveInstallation` 的結果後：

- 成功：redirect `?github_connected=true`
- 衝突：redirect `?github_error=already_connected`
- 真正 unexpected error：維持現有 `callback_failed&error_id=...`

這樣可以避免把正常產品衝突誤記成 opaque callback failure。

#### 其他路徑

因為 invariant 仍然是「每個 owner 最多一個 active installation」，所以這一版：

- `getInstallationIdForOwner` 可維持單一回傳值
- `disconnectGitHub` 可維持刪除單一 active installation
- `ImportRepoDialog` / `useGitHubConnection` 不需要一起升級成 multi-installation UI

### 驗證

- 同一個 installation 重裝時，metadata 會更新，不新增衝突。
- 第二個不同 installation 進來時，不會覆蓋原本的 active installation。
- callback 會導回 `?github_error=already_connected`，而不是 generic `callback_failed`。
- 既有 import / verify access / list repos 流程不受影響。

### 建議測試

- `convex/github.test.ts`
  - same installation re-connect 會 patch，不衝突。
  - different installation re-connect 會回 conflict，原 active row 保持不變。
- 若有 HTTP route 測試，再補 callback redirect 行為。

### Out of Scope

- 不做 team / workspace 共享 installation。
- 不做 UI 安裝器切換器。
- 不做真正的 multi-installation access check fan-out。

---

## 8.3 Chat 成本估算（usage-based）

### 背景

schema 已經有：

- `messages.estimatedInputTokens`
- `messages.estimatedOutputTokens`
- `jobs.estimatedInputTokens`
- `jobs.estimatedOutputTokens`
- `jobs.estimatedCostUsd`

但目前沒有任何寫入，所以 observability 有欄位、沒有資料。

### 採用做法

#### 1. 集中 pricing helper

新增 `convex/lib/openaiPricing.ts`，只做三件事：

- 集中維護 model pricing map
- 根據 `model + inputTokens + outputTokens` 算 `estimatedCostUsd`
- 遇到 unknown model 或缺 usage 時回 `undefined`

這個檔案要明確標註：**價格表是手動維護的 snapshot，不是即時真相**。第一版只需要涵蓋 repo 目前會用到的預設 model，例如 `gpt-4o-mini`，其他 model 缺表時不可 throw。

#### 2. 只寫 authoritative usage

`convex/chat.ts` `generateAssistantReply` 在 OpenAI 串流完整結束後，從 **當前 AI SDK 可用的 finalized usage 介面** 取出 provider 回傳的 token usage，再計算 cost。

這裡故意不要把 plan 綁死成某個欄位名稱（例如固定寫死 `response.usage`）。實作時以 repo 當下安裝的 `ai` SDK 版本為準；如果該版本拿不到 usage，就保持 `undefined`，不能讓主流程失敗。

#### 3. `finalizeAssistantReply` 接受 optional usage 欄位

延伸 `finalizeAssistantReply`，新增 optional：

- `inputTokens`
- `outputTokens`
- `costUsd`

在 assistant message 與 job finalize 時一併 patch：

- `messages`: 寫入 input/output tokens
- `jobs`: 寫入 input/output tokens 與 estimated cost

#### 4. fallback path 保持空值

heuristic fallback（沒有 `OPENAI_API_KEY`）與任何 usage 不可得的路徑，維持 `undefined` 即可。不要為了補資料再做 token heuristic，避免把估算誤差包裝成真實 usage。

### 驗證

- 一般 chat 完成後，assistant message 與 job 都會寫入 usage。
- `jobs.estimatedCostUsd` 有合理數值。
- unknown model 不會 throw，只留下 `undefined` cost。
- heuristic fallback 不會寫假 usage。

### 建議測試

- `convex/chat-streaming.test.ts`
  - finalize 時可寫入 usage / cost。
  - usage 缺失時仍可正常完成。
- 若 helper 另建純函式測試，補一個 pricing table 單元測試即可。

### Out of Scope

- 不做 deep analysis cost tracking。
- 不做前端 dashboard / 報表。
- 不做 token-budget limiter。
- 不做 historical backfill。

---

## System Design Doc

See `docs/deep-analysis-installation-cost-system-design.md`.

## 後續延伸（另開 plan）

以下兩件事不要塞回這份 plan：

1. **真正的 multi-installation support**
   - 需要改 public API、UI、repo access check、manage-access UX。
2. **讓 chat 的 deep/thorough mode 真的讀 live sandbox**
   - 那時再把 sandbox TTL bump helper 升級成共用元件。

## Commit 建議

建議拆成 3 個 commit：

1. deep-analysis TTL 保護
2. GitHub installation 衝突處理
3. chat usage-based cost tracking
