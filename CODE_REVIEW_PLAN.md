# App Code Review Plan

## Goal
- 對整個 app 做可續做的 code review，涵蓋：
  - 寫法與可維護性
  - 邏輯正確性
  - 資安與授權邊界
  - 穩定性與效能風險
  - 測試缺口

## Review Rules
- 先找高影響問題，再看風格與可維護性。
- 每個 finding 需要有：
  - 嚴重度
  - 檔案與 symbol
  - 問題原因
  - 影響
  - 建議修法
- 若無法立即確認，列為 `Open question`，避免把假設當結論。
- 優先 review 真正承載資料流、權限、背景工作與外部整合的模組。

## Scope Buckets
- `convex/`
  - auth / ownership checks
  - GitHub App install flow
  - webhook handling
  - repository import / sync pipeline
  - sandbox lifecycle
  - deep analysis / chat orchestration
- `src/`
  - auth bootstrap
  - route protection
  - repository/thread selection state
  - import / sync / delete UX
  - deep mode availability UX
  - error handling and failure feedback
- Cross-cutting
  - secrets and token handling
  - trust boundaries
  - missing tests

## Progress
- [x] 讀取 workspace 規則與 Convex guidelines
- [x] 盤點主要模組與資料流
- [x] 完成第一輪高風險審查
- [x] 完成第一輪高風險修復（1、2、5、9）
- [x] 重新驗證並修正既有中風險 findings（3、4、6、7、8）
- [x] 補齊更多證據與測試建議
- [ ] 完成下一批模組的第二輪中低風險審查
- [ ] 對每個 finding 排修復優先序

## First-Pass Findings

### 1. GitHub installation 查詢可能拿到錯的紀錄（已完成）
- Severity: High
- Status: 已完成
- Files:
  - `convex/github.ts`
  - `convex/repositories.ts`
  - `convex/githubAppNode.ts`
- Evidence:
  - `getInstallationIdForOwner()` 使用 `by_ownerTokenIdentifier` 後直接 `.first()`
  - `createRepositoryImport()` / `syncRepository()` 也用相同模式
  - schema 已經有 `by_ownerTokenIdentifier_and_status`
- Why it matters:
  - 同一使用者如果存在舊的 `deleted` / `suspended` installation，加上新的 `active` installation，查詢結果可能不穩定。
  - 會導致 UI 顯示未連線、repo access 驗證失敗、import/sync 間歇性失敗。
- Fix direction:
  - 統一改為 `by_ownerTokenIdentifier_and_status`
  - 只查 `status === 'active'`
- Revalidation:
  - 重新檢查後確認 `getGitHubConnectionStatus()`、`getInstallationIdForOwner()`、`createRepositoryImport()`、`syncRepository()` 都曾以 `by_ownerTokenIdentifier` 搭配 `.first()` 取值，風險真實存在。
- Resolved:
  - 相關 installation 查詢已統一改為 `by_ownerTokenIdentifier_and_status` 並只查 `active`。
  - 已新增自動化測試覆蓋 connection status、installation lookup、sync flow。

### 2. Sandbox TTL sweep 的狀態機有缺口（已完成）
- Severity: High
- Status: 已完成
- Files:
  - `convex/ops.ts`
  - `convex/opsNode.ts`
- Evidence:
  - `getExpiredSandboxes()` 只抓 `status === 'ready'`
  - `sweepExpiredSandboxes()` 遇到 Daytona `started` 時只把 DB 標成 `stopped`
  - 之後的 sweep 不會再抓到 `stopped`
- Why it matters:
  - 註解說「下個週期刪除」，但實際上下一輪 query 撈不到。
  - 可能造成遠端 sandbox 長期殘留，DB 狀態與實際環境脫節。
- Fix direction:
  - `started` 分支直接 stop/delete 遠端 sandbox，或
  - 讓 sweep 也處理 `stopped` 且已過 TTL 的紀錄
- Revalidation:
  - 重新檢查後確認 `getExpiredSandboxes()` 只查 `ready`，而 `started` 分支只更新 DB 為 `stopped`，下一輪不會再被掃到，風險真實存在。
- Resolved:
  - sweep 現在會同時處理過期的 `ready` 與 `stopped` sandbox。
  - `started` 分支會先真的呼叫 Daytona stop，再標記為 `stopped` 供下一輪刪除。
  - `stopped` 分支只有在刪除成功後才標為 `archived`，失敗時會保留可重試狀態。
  - 已新增自動化測試覆蓋 expired query、started -> stopped、delete retry 行為。

### 3. Webhook JSON parsing 缺少防護（已完成）
- Severity: Medium
- Status: 已完成
- File: `convex/http.ts`
- Evidence:
  - webhook body 驗簽後直接 `JSON.parse(body)`
  - 沒有 `try/catch`
- Why it matters:
  - 惡意或損毀 payload 可能直接造成 5xx
  - 增加 webhook retry 與噪音
- Fix direction:
  - 將 parse failure 明確回 400
  - 把 invalid payload 視為 request error，不是 server crash
- Revalidation:
  - 重新檢查後確認 webhook 驗簽成功後仍直接 `JSON.parse(body)`，invalid JSON 會直接丟例外，風險真實存在。
- Resolved:
  - webhook payload parsing 已加上 `try/catch`，invalid JSON 會回 `400 Invalid JSON payload`，不再直接變成 5xx。

### 4. Repository file count 會在大型 repo 低估（已完成）
- Severity: Medium
- Status: 已完成
- File: `convex/repositories.ts`
- Evidence:
  - `getRepositoryDetail()` 用 `.take(400).length` 當 `fileCount`
- Why it matters:
  - 超過 400 個檔案的 repo 會被錯誤顯示
  - 產品資訊不正確，未來若被拿來做限制判斷會更危險
- Fix direction:
  - 增設計數欄位或獨立 count 策略
  - 至少把 UI 標示成 `400+`
- Revalidation:
  - 重新檢查後確認 `getRepositoryDetail()` 仍直接把 `.take(400).length` 當總數回傳，超過 400 個檔案時會低估，風險真實存在。
- Resolved:
  - `getRepositoryDetail()` 改為抽樣 `401` 筆並回傳 `fileCountLabel`。
  - UI 現在會把超過上限的結果顯示為 `400+`，避免把近似值誤當精確總數。
  - 已新增自動化測試覆蓋大型 repo 的 `400+` 顯示邏輯。

### 5. Threads 載入中被誤判成空列表（已完成）
- Severity: High
- Status: 已完成
- File: `src/components/app-sidebar.tsx`
- Evidence:
  - `if (!threads?.length) { onSelectThread(null) }`
  - `threads === undefined` 與 `threads.length === 0` 被混在一起
- Why it matters:
  - repo 切換期間會先清空 thread selection
  - 容易造成閃爍、額外 state churn、與後續 selection 修正互相打架
- Fix direction:
  - 先分成三態：
    - `undefined`: loading，不更新 selection
    - `[]`: 明確設 `null`
    - 有資料: 檢查目前選取是否還存在
- Revalidation:
  - 重新檢查後確認 `if (!threads?.length)` 會把 `undefined` 與空陣列混在一起，載入中的確會誤觸 `onSelectThread(null)`。
- Resolved:
  - 已改為 loading / empty / populated 三態處理。
  - 若 `defaultThreadId` 不存在於目前列表，會退回第一個有效 thread，避免選到不存在的 id。
  - 已新增前端測試覆蓋 loading 不清空 selection 與 empty list 才清空 selection。

### 6. Deep analysis 不可用時前後端仍允許排入工作（已完成）
- Severity: Medium
- Files:
  - `convex/analysis.ts`
  - `convex/analysisNode.ts`
  - `convex/repositories.ts`
  - `convex/lib/sandboxAvailability.ts`
  - `src/components/deep-analysis-dialog.tsx`
  - `src/components/repository-shell.tsx`
- Evidence:
  - `requestDeepAnalysis()` 原本沒有先檢查 sandbox 是否仍可用
  - `runDeepAnalysis()` 只在真正執行時才因 sandbox 狀態失敗
  - `DeepAnalysisDialog` 在送出後會立刻關閉，失敗時看不到清楚回饋
- Why it matters:
  - 使用者在 sandbox 過期後仍可排入 deep analysis job，錯誤要等到後端稍後失敗才看得到
  - 前端與後端對「deep mode 是否可用」的判斷不一致，容易造成 UX 混亂
- Fix direction:
  - UI 禁止送出 deep analysis request
  - mutation / action 共用同一套 sandbox availability guard
- Revalidation:
  - 重新檢查後確認真正會 late-fail 的是 `requestDeepAnalysis()` / `runDeepAnalysis()` 流程，不是一般 `sendMessage()`；原 finding 的風險真實存在，但範圍比最初假設更精確。
- Resolved:
  - 新增共享的 sandbox availability helper，讓 `getRepositoryDetail()`、`requestDeepAnalysis()`、`runDeepAnalysis()` 用同一套條件判斷。
  - deep analysis dialog 在不可用時會停用送出按鈕，且失敗時不再先關閉。
  - 已新增自動化測試覆蓋 expired sandbox guard 與 dialog 不會立即關閉的行為。

### 7. 非同步操作失敗時多數沒有使用者可見回饋（已完成）
- Severity: Medium
- Files:
  - `src/components/repository-shell.tsx`
  - `src/components/deep-analysis-dialog.tsx`
- Evidence:
  - `DeepAnalysisDialog` 在 `onRun()` 後立即關閉
  - sync / delete / send / deep analysis 失敗時缺少共享的可見錯誤回饋
- Why it matters:
  - mutation/action 失敗時，使用者很容易只看到「像是沒反應」
  - 對 destructive / expensive actions 特別不友善
- Fix direction:
  - 增加 toast 或 inline error
  - dialog 應 await 成功後再關閉，或關閉後明確顯示任務與錯誤狀態
- Revalidation:
  - 重新檢查後確認 deep analysis dialog 仍會先關閉，而且 repository-level async action 沒有共用的失敗顯示，風險真實存在。
- Resolved:
  - repository shell 現在會在 sync / delete / send / deep analysis 失敗時顯示可見錯誤訊息。
  - deep analysis dialog 改為成功後才關閉，失敗時會保留開啟並顯示錯誤。
  - 已新增前端測試覆蓋 dialog 不會在送出瞬間自動關閉。

### 8. Auth loading 與 runtime error 暴露體驗偏弱（已完成）
- Severity: Medium
- Files:
  - `src/App.tsx`
  - `src/providers/convex-provider-with-auth-kit.tsx`
  - `src/providers/error-boundary.tsx`
- Evidence:
  - auth loading 時直接 render `null`
  - WorkOS token 取得失敗只 log
  - ErrorBoundary 直接渲染原始錯誤字串
- Why it matters:
  - 使用者會看到白屏或難懂錯誤
  - production 可能暴露內部錯誤訊息
- Fix direction:
  - 顯示 loading shell
  - 明確處理 token failure
  - production 隱藏 raw error，改用 generic message + trace id
- Revalidation:
  - 重新檢查後確認 auth loading 仍會 render `null`、WorkOS token failure 仍只 log、ErrorBoundary 仍會直接顯示 raw error，風險真實存在。
- Resolved:
  - auth loading 現在會顯示明確的 loading shell，不再白屏。
  - WorkOS token fetch 失敗時會觸發 app-level 可見錯誤訊息，不再只有 console log。
  - ErrorBoundary 在 production 只顯示友善訊息；raw error 只保留在 development。

### 9. 缺少自動化測試（已完成）
- Severity: High
- Status: 已完成
- Files:
  - `convex/**`
  - `src/**`
- Evidence:
  - 尚未發現 `test` / `spec` 檔案
- Why it matters:
  - 目前的高風險流程幾乎都靠人工驗證
  - installation、sweep、thread selection、deep mode guard 都容易回歸
- Fix direction:
  - 先補最容易出事的流程：
    - installation status selection
    - expired sandbox sweep
    - thread selection effect
    - deep mode submit guard
- Revalidation:
  - 重新檢查後確認專案原本沒有 `test` / `spec` 檔，這些高風險流程確實缺少回歸保護。
- Resolved:
  - 已新增 `vitest` 測試基礎設施與 `npm test` script。
  - 已補上 installation status selection、expired sandbox sweep、thread selection effect 的聚焦測試。
  - deep mode submit guard 仍可在後續處理中低風險項目時補上，但不影響這輪高風險修復的回歸保護。

## Open Questions
- `githubInstallations` 是否有意保留多筆歷史紀錄？如果有，active row 是否應保證唯一？
- Daytona 是否一定會在平台端自動回收過期 sandbox？如果不保證，sweep 缺口就更嚴重。
- deep chat mode 的 server-side 是否也應直接拒絕已失效 sandbox，而不是只讓後續流程失敗？

## Next Review Pass
- 第二輪優先看：
  - `convex/importsNode.ts`
  - `convex/daytona.ts`
  - `convex/githubCheck.ts`
  - `src/components/import-repo-dialog.tsx`
  - `src/components/profile-card.tsx`
  - `src/pages/*`
- 補查項目：
  - race condition / duplicate job creation
  - long-running data growth
  - token / secret log exposure
  - empty / failed states 是否一致

## How To Continue Later
- 先讀這份 `CODE_REVIEW_PLAN.md`
- 依 `Next Review Pass` 逐項檢查
- 新 finding 追加到 `First-Pass Findings` 之後，並更新 `Progress`
- 若某項已修，新增 `Resolved` 小節紀錄修法與剩餘風險
