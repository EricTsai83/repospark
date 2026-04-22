# Plan 10 — Lawn-Style Vercel + Convex Deployment

- **Priority**: P2
- **Scope**: `package.json`, `vercel.json`（新）, `.env.example`, `README.md`, `docs/integrations-and-operations.md`。
- **Conflicts**:
  - `package.json`: 與任何 script / build 流程改動衝突。
  - `README.md`: 若有人同時在重寫專案 setup/deploy 說明，容易衝突。
  - `docs/integrations-and-operations.md`: 若同時在調整 deployment model 章節，需合併。
- **Dependencies**:
  - 現有 `convex.json` 已經有 `preview` / `prod` 的 Vercel `buildEnv` 整合，這份 plan 直接沿用。

## 背景

`pingdotgg/lawn` 的 production / CI/CD 做法非常簡單：

1. 不用 GitHub Actions。
2. 直接把 GitHub repo 接到 Vercel。
3. Vercel build 時先跑 `convex deploy`。
4. `convex deploy` 完成後，把 deployment URL 注入前端 build。
5. 再產出靜態前端。

對 Repospark 而言，這個模型是可直接套用的，因為目前架構本來就是：

- frontend: Vite static app
- backend: Convex
- auth/domain callbacks: Convex HTTP routes
- 沒有另一台必須常駐的 Express / Nest API server

換句話說，Repospark 不需要額外自建 CI/CD 編排層，也不需要為部署再引入 Docker 或 GitHub Actions 才能上 production。

## 目標

把 Repospark 的部署方式收斂成和 `lawn` 同一種模型：

1. **Vercel 負責 frontend hosting 與 Git-based deploy trigger**
2. **Convex deploy 直接內嵌在 Vercel build**
3. `**VITE_CONVEX_URL` 由 deploy 階段自動注入**
4. **Preview 與 Production 各自對應自己的 Convex deployment**
5. **CD 保持最小化，由 Vercel 負責 deploy**
6. **CI 若需要，僅用於品質檢查，不接手 production deploy**

## 非目標

- 不新增另一個 always-on backend server。
- 不引入 Docker-based deployment。
- 不在第一版建立複雜的 CI matrix。
- 不把 production deploy 改成 GitHub Actions 主導。

## 建議做法

### A. 在 `package.json` 新增 `build:vercel`

保留既有 `build`：

- `build` 仍然負責 `tsc -b && vite build`

新增一個給 Vercel 用的 wrapper script：

```json
"build:vercel": "npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL"
```

這一步完全對應 `lawn` 的做法，只是把 `bun run build` 改成 Repospark 目前的 `npm run build`。

### B. 新增 `vercel.json`

新增一份最小設定：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build:vercel",
  "outputDirectory": "dist",
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

理由：

- `buildCommand`：讓 Vercel build 時先做 Convex deploy，再做前端 build。
- `outputDirectory`：Repospark 的 Vite output 是 `dist`，不是 `dist/client`。
- `routes` fallback：這個 repo 是 SPA，React Router 需要把未知路徑回寫到 `index.html`。

### C. Vercel 環境變數分層

`lawn` 的重點不是只有 `CONVEX_DEPLOY_KEY`，而是**把 deploy key 依 Vercel environment 分開配置**。

Repospark 也應該照做：

#### Preview environment

- `CONVEX_DEPLOY_KEY=<preview deploy key>`
- `VITE_WORKOS_CLIENT_ID=<public preview value>`
- `VITE_WORKOS_REDIRECT_URI=https://${VERCEL_BRANCH_URL}/callback`

#### Production environment

- `CONVEX_DEPLOY_KEY=<production deploy key>`
- `VITE_WORKOS_CLIENT_ID=<public production value>`
- `VITE_WORKOS_REDIRECT_URI=https://${VERCEL_PROJECT_PRODUCTION_URL}/callback`

重要原則：

- **不要**讓 Preview 與 Production 共用同一把 `CONVEX_DEPLOY_KEY`
- `VITE_CONVEX_URL` 不需要手動填進 Vercel，交給 `convex deploy --cmd-url-env-var-name` 注入即可

### D. Convex deployment 環境也要對齊

這個 repo 已經在 `convex.json` 內宣告：

- `preview` 使用 `VERCEL_BRANCH_URL`
- `prod` 使用 `VERCEL_PROJECT_PRODUCTION_URL`

因此實作時應維持兩套 Convex deployment：

1. **preview Convex deployment**
2. **production Convex deployment**

而且各自要有對應的 Convex runtime env。

至少要確認：

- `SITE_URL`
- `WORKOS_CLIENT_ID`
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`

其中 `SITE_URL` 尤其重要，因為 `convex/http.ts` 的 GitHub callback redirect 會用到它。  
Preview deployment 的 `SITE_URL` 應該指向 preview domain，production deployment 的 `SITE_URL` 應該指向正式網域。

### E. CI/CD 模型就採用 Vercel Git Integration

照 `lawn` 的方式，Repospark 的最小 CD 應該是：

1. push branch
2. Vercel 產生 preview deployment
3. Vercel 執行 `npm run build:vercel`
4. 先 `convex deploy`
5. 再 `npm run build`
6. 輸出 `dist`
7. Vercel 提供 preview URL

Production 則是：

1. merge / push 到 production branch
2. Vercel 觸發 production build
3. 用 production `CONVEX_DEPLOY_KEY` 部署 Convex
4. build frontend
5. 發佈正式站點

這個模型下：

- **CD** 由 Vercel 完成
- **backend deploy** 由 Vercel build 內的 `convex deploy` 完成
- **GitHub Actions 若存在，也只負責 CI 檢查**

### E-1. 建議補一條最小 CI，但只做檢查

雖然 `lawn` 本身沒有在 repo 內放 GitHub Actions，但對 Repospark 來說，**最佳實踐仍然是補一條輕量 CI**，專門做品質 gate，而不是做 deploy。

建議原則：

- **CI**：跑 `lint` / `test` / `build`
- **CD**：仍由 Vercel + Convex 處理
- **不要**在 GitHub Actions 裡持有 production deploy 權限，除非之後真的有多環境 release orchestration 需求

依照目前 `package.json`，最小可行檢查組合可直接用現有 scripts：

1. `npm ci`
2. `npm run lint`
3. `npm run test`
4. `npm run build`

補充：

- `npm run lint` 目前已經串了 `typecheck` 與 `typecheck:convex`，因此不一定要再額外跑一次獨立 typecheck job
- `npm run build` 應保留在 CI，因為它能提早發現 Vite / TS build 階段才會出現的錯誤
- 若之後測試量變大，再把 `lint`、`test`、`build` 拆成平行 jobs 即可；第一版不需要

實務上建議把這條 CI 掛在：

- pull request
- push 到主要開發分支

而 branch protection 可要求：

- CI workflow 必須通過後才能 merge

這樣的分工最穩定：

- GitHub Actions 負責「檢查這次變更有沒有壞掉」
- Vercel 負責「把通過合併的版本部署出去」
- Convex deploy 仍然跟著 Vercel build 一起走，避免把 deploy 權限與 app hosting 流程拆散

### F. 文件同步

若採用這個方案，建議同步補三個地方：

#### 1. `README.md`

補一個簡短 deployment section，說明：

- production / preview 都走 Vercel
- Vercel build 會呼叫 `npm run build:vercel`
- `CONVEX_DEPLOY_KEY` 需要在 Vercel 設定

#### 2. `.env.example`

補註解說明：

- `VITE_CONVEX_URL` 在本地可手動設定
- 在 Vercel build 中由 `convex deploy` 自動注入

#### 3. `docs/integrations-and-operations.md`

把 `Minimal Deployment Model` 從抽象描述改成更明確的現況 / 目標模型：

- frontend hosting: Vercel
- backend: Convex cloud
- CI checks: optional GitHub Actions for lint / test / build only
- deploy trigger: Vercel Git integration
- no additional GitHub Actions pipeline required

## 建議的實作順序

1. `package.json`：加入 `build:vercel`
2. 新增 `vercel.json`
3. 在 Vercel 專案設定 preview / production 的 `CONVEX_DEPLOY_KEY`
4. 補齊 Vercel 的 `VITE_WORKOS_`*
5. 補齊 Convex preview / production runtime env
6. 視需要新增最小 CI workflow（`lint` / `test` / `build`，不含 deploy）
7. 更新 `README.md` 與 `.env.example`
8. 更新 `docs/integrations-and-operations.md`

## 驗證

- push 任一 branch 後，Vercel 能建立 preview deployment。
- preview build 使用 preview `CONVEX_DEPLOY_KEY`，不會誤 deploy 到 production Convex。
- production build 使用 production `CONVEX_DEPLOY_KEY`。
- build 完成後前端能正確讀到 `VITE_CONVEX_URL`。
- React Router 直接打深層路由時，不會在 Vercel 得到 404。
- GitHub callback redirect 會回到正確的 `SITE_URL`。
- 若有加 CI，PR 上至少會跑 `npm run lint`、`npm run test`、`npm run build`，且不包含 deploy 步驟。

## Out of Scope

- Docker image build
- 自架 runner
- 多階段 release trains
- 複雜的 smoke test / e2e gate
- 用 GitHub Actions 直接接手 production deploy

