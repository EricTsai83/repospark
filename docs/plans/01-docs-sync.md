# Plan 01 — Documentation Sync

- **Priority**: P2
- **Scope**: 只改 `docs/*.md`，不動任何程式碼。
- **Conflicts**: 與任何 code plan 都不衝突，可平行執行。
- **Dependencies**: 無。

## 背景

`docs/` 下的 6 份核心文件（system-overview / domain-and-data-model / auth-and-access / repository-lifecycle / chat-and-analysis-pipeline / integrations-and-operations）在資料模型與後端流程層面與程式碼對齊良好，但**前端章節已經落後**，且有 3 份 2026-04-18 的舊文件未被 `docs/README.md` 引用。

## 目標

讓文件與下列實際程式碼狀態對齊，並清理舊文件：

- `src/main.tsx`：providers 順序已改變，且**不**再由 React component tree 直接包 `BrowserRouter`。
- routing 改用 data router：`src/router.tsx` + `src/app-router.tsx` + `src/router-layouts.tsx`。
- `RepositoryShell` 已把 orchestration 抽到 `src/hooks/`。
- 環境變數清單需統一。

## 需要修正的具體項目

### 1. `docs/system-overview.md`

- Providers 清單移除獨立的 `BrowserRouter` provider。實際順序（以 `src/main.tsx` 為準）：
  1. `ErrorBoundary`
  2. `ThemeProvider`
  3. `AuthKitProvider`
  4. `ConvexProviderWithAuthKit`
  5. `App`
- 「`src/App.tsx` currently exposes only two primary routes」那段改寫為：
  - `App.tsx` 只呼叫 `createAppRouter()` 並用 `<AppRouter router={router} />` 渲染。
  - Route table 在 `src/router.tsx`，由 browser data router 建立；chat 頁用 lazy `loadChatRoute`。
  - Layout 與 route guard 在 `src/router-layouts.tsx`（`AppLayout` / `LandingRoute` / `ProtectedLayout`）。
- 「Application Shell」段落修正：`RepositoryShell` 已不再 own 全部 orchestration。現已抽出的 hooks 為：
  - `useRepositoryActions`（sync / delete / send / analysis / deleteThread）
  - `useRepositorySelection`（effective repo 與載入狀態）
  - `useCheckForUpdates`（focus / switch 時檢查 remote commits）
  - 以及 `use-github-connection.ts`、`use-async-callback.ts`、`use-relative-time.ts`、`use-mobile.ts`

### 2. `docs/auth-and-access.md`

- 所有 `ProtectedRoute` 改為 `ProtectedLayout`。
- 在「Frontend Identity Flow」補 `LandingRoute` 行為：已登入使用者會自動 `Navigate` 到 `/chat`。
- 「Convex runtime env」清單補齊（目前缺的）：
  - `SITE_URL`
  - `OPENAI_MODEL`
  - `DAYTONA_API_URL`、`DAYTONA_TARGET`
  - `DAYTONA_AUTO_STOP_MINUTES`、`DAYTONA_AUTO_ARCHIVE_MINUTES`、`DAYTONA_AUTO_DELETE_MINUTES`
  - `DAYTONA_CPU_LIMIT`、`DAYTONA_MEMORY_GIB`、`DAYTONA_DISK_GIB`
  - `DAYTONA_NETWORK_ALLOW_LIST`
- 最終這份清單應該與 `docs/integrations-and-operations.md` 的 env 區塊完全一致，可以互相引用。

### 3. `docs/domain-and-data-model.md`

在「Known Limitations」補兩條：

- `jobs.kind = 'index'` 目前是保留 enum，程式碼中無 `kind: 'index'` 的 insert；索引仍內嵌在 import pipeline 中。
- `analysisArtifacts.version` 所有 insert 固定寫 `1`，尚未實作版本管理。

### 4. 舊文件處理

以下 3 份已不被 `docs/README.md` 引用：

- `docs/daytona-sandbox-lifecycle.md`
- `docs/fast-path-vs-deep-path.md`
- `docs/sandbox-cost-analysis.md`

兩個合理選項（擇一）：

- **A.** 建 `docs/archive/`，把三份移進去，並在 `docs/README.md` 最下面加一段「Archived design notes」指向該資料夾。
- **B.** 直接刪除，並在 commit message 註記這三份已被新 6 份 docs 取代。

## 驗證

- `rg "\bBrowserRouter\b|ProtectedRoute" docs/ --glob '!plans/**'` 無結果。
- `rg "OPENAI_MODEL|SITE_URL" docs/auth-and-access.md` 有結果。
- 新讀者照著 `docs/system-overview.md` 的 providers 順序能在 `src/main.tsx` 找到對應程式碼。
- 舊的 3 份文件要嘛不在 `docs/` 直接層、要嘛已刪除。

## Out of Scope

- 不改任何 `.ts` / `.tsx`。
- 不新增新的設計文件（例如 rate limit、cost 之類的內容由對應 code plan 完成時再另外寫）。
