# Plan 02 — Best-Practice Rate Limiting + In-Flight Guards

- **Priority**: P0
- **Scope**: 以 Convex backend 為主，外加一個很小的前端錯誤正規化調整（`src/lib/errors.ts`），讓 structured error 能穩定顯示成使用者訊息。
- **Conflicts**:
  - `convex/schema.ts`：需新增 job lease 欄位與 index，會和 Plans 04 / 06 / 07 / 08 衝突，建議**先做這份**。
  - `convex/chat.ts`：會和 Plans 05 / 07 / 08 衝突，建議**先做這份**。
  - `convex/analysis.ts`：會和 Plan 08 衝突。
  - `convex/repositories.ts`：會和 Plans 04 / 06 有相鄰修改。
  - `convex/{opsNode,crons}.ts`：需新增 stale-job recovery。
  - `convex/convex.config.ts`：新檔，低衝突但需要先落地，之後其他 component 類變更要一起看。
- **Dependencies**:
  - 新增 npm dependency：`@convex-dev/rate-limiter`
  - 需要 `npx convex dev` / codegen 生成 `components.rateLimiter`

## 設計決策原則

這份計劃**永遠以 Performance 與 Robustness 為優先**。實際決策規則：

1. **先擋最便宜的失敗路徑**：先做 auth / ownership / active-job guard，再消耗 rate-limit token，再建立 job / message。
2. **避免自造 hot document**：不要自己在 app schema 裡做單點 counter table，避免 OCC conflict、retry、延遲飄高。
3. **優先保護昂貴資源**：Daytona sandbox、OpenAI request、背景 job queue，都要在進入昂貴階段前被擋下。
4. **以 Robustness 為導向的 burst 控制**：對正常互動保留小幅 burst，但對持續尖峰與濫用流量維持保守上限。
5. **先上穩定的 request guard，再做更精細的 token / cost guard**：因為後者依賴更準確的 usage 訊號，不能在沒有量測的情況下瞎估。
6. **active work 一律用 lease，不只看 status**：任何 single-flight guard 都必須能自動從 crash / scheduler miss / deploy 中斷中恢復。

## 背景

以下 mutation 目前完全沒有 request-level 限流，任何登入使用者都可以連發：

- `convex/repositories.ts` → `createRepositoryImport`、`syncRepository`
- `convex/analysis.ts` → `requestDeepAnalysis`
- `convex/chat.ts` → `sendMessage`

這三條路徑都直接連到高成本資源：

- import / sync：會開 Daytona sandbox，消耗 CPU / Memory / Disk
- deep analysis：會在 sandbox 內跑較重的分析工作
- chat：會建立 job、寫 message、並呼叫 OpenAI streaming

此外，import / sync 路徑已經有 repository-level 的 active-import guard；但 `requestDeepAnalysis` 與 `sendMessage` 仍缺少對應的 in-flight guard。也就是說，單純做 request limit 還不夠，還要擋掉「同一個資源上同時排太多昂貴工作」。

## 目標

### 主要目標

1. 對高成本 mutation 建立 production-grade rate limit，而不是只做 MVP counter。
2. 把 request burst 與 in-flight concurrency 分成兩層控制。
3. 保持 Convex hot path 小、避免 OCC 熱點與不必要的 retry。
4. 提供穩定錯誤契約，讓前端能顯示明確訊息。
5. 文件化所有 limit 與 override 方式，讓後續營運可調。

### 非目標

- 不做 IP-based edge rate limiting。
- 不對 GitHub callback / webhook 做限流。
- 不在這份計劃內做精準 token-cost accounting；那應在有 usage 訊號後再做。
- 不為了這份計劃新增 app 自管的 `rateLimits` table。

## System Design

### 總體架構

採四層防線：

1. **Request rate limiting**
  - 使用官方 `@convex-dev/rate-limiter` component。
  - 避免自己在 `convex/schema.ts` 管 counter document。
  - 對不同 bucket 選擇最適合的演算法。
2. **In-flight concurrency guard**
  - 同一個 repository / thread 上，不能同時堆太多相同類型的昂貴工作。
  - 這層保護的目的是防止「limit 還沒打滿，但併發已經把資源打爆」。
3. **Lease-based stale recovery**
  - 任何拿來當 single-flight guard 的 active work，都必須有明確的過期時間。
  - 過期後不能永久卡住資源，必須能被自動標記為 failed。
4. **Fail-cheap sequencing**
  - mutation 內部步驟順序必須固定：
  1. `requireViewerIdentity`
  2. ownership / state validation
  3. in-flight guard
  4. rate limiter consume
  5. 建立 DB side effects（job / message）
  6. schedule background action

這樣可以保證：

- 不會因為已有 active job 而白白消耗 rate-limit quota
- 不會在被限流後留下半成品 job / message
- 不會因為 stale `queued/running` 狀態而永久卡死 thread / repository
- 昂貴資源永遠在最晚的時候才被觸發

### 為什麼不用自刻 `rateLimits` table

不採用原本的 `in-DB counter` 方案，原因如下：

1. **OCC 風險更高**
  - 同一個 `ownerTokenIdentifier + bucket` 會形成熱點 document。
  - 在 burst 流量下，Convex mutation 會自動 retry；retry 本身就是額外延遲與浪費。
2. **演算法彈性差**
  - 手刻 fixed window 很容易做，但 chat 更適合 token bucket。
  - 之後若要加 global limits / shards / reserve / check，自己維護的成本會快速上升。
3. **維運成本更高**
  - 自己設計 schema、清理策略、錯誤格式、測試細節。
  - 官方 component 已經把這些核心細節包好，對 correctness 與 operability 更有利。

以 Performance / Robustness 的角度，結論是：**優先使用官方 component，避免 app 自己管理 limiter state。**

### 演算法選擇

#### 1. `import`：per-owner fixed window

- bucket：`importRequests`
- 建議值：`5 / hour`
- key：`ownerTokenIdentifier`

原因：

- import / sync 是低頻、人工觸發、昂貴的操作。
- 我們要的是簡單明確的上限，不需要保留太多 burst 彈性。
- fixed window 已足夠，且讀起來最直觀。

#### 2. `deep_analysis`：per-owner fixed window

- bucket：`deepAnalysisRequests`
- 建議值：`10 / hour`
- key：`ownerTokenIdentifier`

原因：

- deep analysis 是高成本但低頻的請求。
- 這類操作重點是防濫用與成本上限，不是高吞吐。
- fixed window 較容易營運理解與調整。

#### 3. `chat`：per-owner token bucket

- bucket：`chatRequestsPerOwner`
- 建議值：`rate = 30 / minute`
- `capacity = 6`
- key：`ownerTokenIdentifier`

原因：

- chat 是互動型操作，使用者會有短時間 burst。
- fixed window 有邊界效應，容易在 window 切換時放大尖峰。
- token bucket 可以保留小 burst，但持續濫發會被平滑壓住。
- `capacity` 故意不設太大，因為這裡要偏向系統穩定性與可預期性，而不是無限制寬鬆。

#### 4. `chat`：global token bucket

- bucket：`chatRequestsGlobal`
- 建議值：`rate = 300 / minute`
- `capacity = 60`
- `shards = 10`
- key：無（global）

原因：

- per-owner limit 只能擋單一帳號；擋不住多帳號 / 機器群集。
- OpenAI 與背景工作池需要 app-level backstop。
- global limit 在高併發下可能變成熱點，所以要開 sharding 降低 contention。

#### 5. `daytona`：shared global fixed window

- bucket：`daytonaRequestsGlobal`
- 建議值：`30 / hour`
- `shards = 10`
- key：無（global）
- 適用：`createRepositoryImport`、`syncRepository`、`requestDeepAnalysis`

原因：

- Daytona 是 shared resource，只做 per-owner limit 不足以保護整體容量。
- 我們需要一個 coarse global backstop，避免多個 owner 在各自 quota 內同時把 Daytona 打滿。
- 這裡先用**單一 shared global bucket**，而不是一開始就做 weighted budget，因為第一版目標是簡單、穩、可營運。

### 套件與檔案設計

#### 1. 安裝 component

```bash
npm install @convex-dev/rate-limiter
```

新增 `convex/convex.config.ts`：

```ts
import { defineApp } from 'convex/server';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';

const app = defineApp();
app.use(rateLimiter);

export default app;
```

#### 2. 新增 app-side limiter helper

新增 `convex/lib/rateLimit.ts`，由 app 端負責：

- 建立 `RateLimiter` instance
- 集中定義 bucket config
- 集中定義 error normalization
- 匯出 helper 給 app mutations 呼叫

這個 helper 留在 app，而不是塞進 component，因為：

- auth 在 app resolve（component 內不直接碰 `ctx.auth`）
- 營運 override 讀 `process.env` 也應在 app 邊界處理
- 前端需要的錯誤契約應由 app 控制，而不是把 component 細節外露

建議結構：

```ts
import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  importRequests: { kind: 'fixed window', rate: 5, period: HOUR },
  deepAnalysisRequests: { kind: 'fixed window', rate: 10, period: HOUR },
  chatRequestsPerOwner: {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 6,
  },
  chatRequestsGlobal: {
    kind: 'token bucket',
    rate: 300,
    period: MINUTE,
    capacity: 60,
    shards: 10,
  },
  daytonaRequestsGlobal: {
    kind: 'fixed window',
    rate: 30,
    period: HOUR,
    shards: 10,
  },
});
```

另外提供：

- `consumeImportRateLimit(ctx, ownerTokenIdentifier)`
- `consumeDeepAnalysisRateLimit(ctx, ownerTokenIdentifier)`
- `consumeChatRateLimit(ctx, ownerTokenIdentifier)`
- `consumeDaytonaGlobalRateLimit(ctx)`
- `throwRateLimitExceeded(bucket, retryAfterMs)`

### In-Flight Guard 設計

request rate limit 只限制「頻率」；但對昂貴工作來說，還要限制「同時進行數」。

### Active Lease 設計

**不要只用 raw status 當 active lock。**

這份方案改採 `jobs.leaseExpiresAt` 作為 active-work lease：

- `convex/schema.ts` `jobs` 新增：
  - `leaseExpiresAt: v.optional(v.number())`
- `jobs` 新增 index：
  - `by_status_and_leaseExpiresAt`

規則：

1. 只有 `status in ('queued', 'running')` 且 `leaseExpiresAt > Date.now()` 的 job，才算 active。
2. `requestDeepAnalysis` / `sendMessage` 建立 job 時就要寫入 lease。
3. 進入真正執行階段時，要 refresh lease。
4. `completed` / `failed` / `cancelled` 時清掉 `leaseExpiresAt`。

建議預設：

- `CHAT_JOB_LEASE_MS = 10 * 60_000`
- `DEEP_ANALYSIS_JOB_LEASE_MS = 60 * 60_000`

這兩個值都應做成 constants / env override，而不是硬編在 mutation 內。

### Stale Recovery 設計

新增一條 cron：

- `convex/crons.ts`：`reconcile stale interactive jobs`
- 頻率：每 5 分鐘

新增 `convex/opsNode.ts` internalAction：

1. 用 `jobs.by_status_and_leaseExpiresAt` 查 `queued` / `running` 且 lease 已過期的 jobs
2. 只處理 `kind === 'chat'` 與 `kind === 'deep_analysis'`
3. 對 `chat`
  - 呼叫新的 `internal.chat.recoverStaleChatJob`
  - 透過 `messages.by_jobId` 找出 assistant message
  - 將 job / assistant message 一起標成 `failed`
4. 對 `deep_analysis`
  - 呼叫 `internal.analysis.failDeepAnalysis`
  - 同時清掉 `leaseExpiresAt`

這樣 single-flight guard 才不會因為 scheduler miss、deployment restart、action crash 而永久卡死。

#### 1. Import / Sync

這條路徑已有 repository-level guard：

- `repository.importStatus === 'queued' || 'running'` 時直接拒絕

這個 guard 保留，不新增額外 limiter 狀態。

#### 2. Deep Analysis

新增 per-repository single-flight guard：

- 同一個 repository 若已有 `kind === 'deep_analysis'` 且 lease 仍有效的 active job，直接拒絕。

實作上先**重用現有 index**：

- `jobs.by_repositoryId_and_status`

對 `queued` / `running` 各查一次，再在記憶體中篩：

- `kind === 'deep_analysis'`
- `leaseExpiresAt > now`

這裡**先不新增 index**，因為：

- 這個 guard 是低頻操作
- 同 repo 同時 queued/running 的 job 數通常很小
- 新增 index 會增加每次 job write 的成本

這是明確的 trade-off：**先壓低 write amplification，只有在觀測到這條 guard 變熱時才升級成專用 index。**

#### 3. Chat

新增 per-thread single-flight guard：

- 同一個 thread 只允許一個 lease 仍有效的 active chat job。

判斷方式：

- 查 `jobs.by_threadId`
- 取最近幾筆 thread jobs
- 篩出：
  - `kind === 'chat'`
  - `status in ('queued', 'running')`
  - `leaseExpiresAt > now`

這裡改用 `jobs`，不再用 `messages` 當 lock source。

原因：

- `jobs` 有比較明確的 workflow 狀態與 lease
- `messages` 應該代表 UI 狀態，不應扛 workflow locking 責任
- 以目前 traffic shape，讀少量 thread jobs 的成本仍低於新增全域 write overhead

### 各 mutation 的落地方式

#### `createRepositoryImport`

順序：

1. `requireViewerIdentity`
2. 驗證 GitHub installation / repository state
3. 檢查該 repository 沒有 active import
4. `consumeImportRateLimit`
5. `consumeDaytonaGlobalRateLimit`
6. queue import workflow

#### `syncRepository`

順序與 import 相同。保留現有「同 repo 不能重複 sync」保護，再消耗 quota。

#### `requestDeepAnalysis`

順序：

1. `requireViewerIdentity`
2. repository ownership / sandbox availability 檢查
3. deep-analysis single-flight guard
4. `consumeDeepAnalysisRateLimit`
5. `consumeDaytonaGlobalRateLimit`
6. 建 job（含 lease）並 schedule action

#### `sendMessage`

順序：

1. `requireViewerIdentity`
2. thread / repository ownership 檢查
3. thread single-flight guard
4. `consumeChatRateLimit(owner)`
5. `consumeChatGlobalRateLimit()`
6. 建立 `jobs` / `messages`（job 含 lease）
7. schedule `generateAssistantReply`

`sendMessage` 是最需要 fail-cheap 的路徑，因為一旦先建了 `jobs/messages` 再被拒絕，就會留下多餘 side effects 與 UI 噪音。

### 錯誤契約

不要只丟自由字串錯誤。要明確使用 `ConvexError`，並統一成穩定的 app-level error shape，至少包含：

- `code`: `RATE_LIMIT_EXCEEDED` 或 `OPERATION_ALREADY_IN_PROGRESS`
- `bucket`
- `retryAfterMs`（若適用）
- `message`

後端範例：

```ts
throw new ConvexError({
  code: 'RATE_LIMIT_EXCEEDED',
  bucket: 'chatRequestsPerOwner',
  retryAfterMs,
  message: 'Too many chat requests. Please retry later.',
});
```

前端需要一個很小的配套調整：

- `src/lib/errors.ts` 先讀 `ConvexError.data.message`
- 讀不到時再 fallback 到 `error.message`

這樣才能讓「structured error contract」不只存在於文件，而是真的能被 UI 穩定消費。

### 營運與調參

所有 limit 都允許用 environment variables 覆蓋，建議集中在 `convex/lib/rateLimit.ts` 讀取，例如：

- `RATE_LIMIT_IMPORT_PER_HOUR`
- `RATE_LIMIT_DEEP_ANALYSIS_PER_HOUR`
- `RATE_LIMIT_CHAT_PER_MINUTE`
- `RATE_LIMIT_CHAT_BURST_CAPACITY`
- `RATE_LIMIT_GLOBAL_CHAT_PER_MINUTE`
- `RATE_LIMIT_GLOBAL_CHAT_BURST_CAPACITY`
- `RATE_LIMIT_DAYTONA_GLOBAL_PER_HOUR`
- `CHAT_JOB_LEASE_MS`
- `DEEP_ANALYSIS_JOB_LEASE_MS`

這份 plan 完成時，**同步更新** `docs/integrations-and-operations.md`，補上：

- 每個 bucket 的預設值
- 適用的 mutation
- override env 名稱
- 被限流時的預期錯誤

## Trade-Off 分析

### 1. 官方 component vs 自刻 DB counter

選官方 component。

原因：

- 更低的 hot-document 風險
- 支援 token bucket 與 sharding
- 維護成本更低

放棄的東西：

- 少量初期依賴安裝成本
- 需要 `convex/convex.config.ts`

Performance / Robustness 判斷：

- 值得，因為它直接降低 contention 與錯誤實作風險。

### 2. 用 lease-based active guard vs 只看 raw status

選 lease-based guard。

原因：

- raw status 在 crash / scheduler miss / deploy interruption 下很容易留下 stale lock
- explicit lease 比隱含時間推論更容易理解、測試與恢復
- stale recovery cron 也有明確掃描條件

放棄的東西：

- 需要在 `jobs` schema 加一個欄位與一個 index
- 需要多一條 recovery cron

Performance / Robustness 判斷：

- 值得，因為這是 single-flight guard 真正可長期運作的前提。

### 3. Chat 用 token bucket vs fixed window

選 token bucket。

原因：

- 對真實使用者更平滑
- 對突發流量與濫用流量更穩定
- 避免 fixed-window boundary spike

放棄的東西：

- 參數理解稍微複雜（`rate` + `capacity`）

Performance / Robustness 判斷：

- 值得，因為 chat 是最敏感的高頻入口。

### 4. 加 global limiter vs 只做 per-owner limiter

選兩者都做。

原因：

- 單帳號限制無法保護 provider quota
- 全域 backstop 可防止多帳號或自動化流量打爆 OpenAI / job queue

放棄的東西：

- 多一層 limiter consume
- 需要定義 shards 與營運參數

Performance / Robustness 判斷：

- 值得，因為這是成本與可用性的最後一道保險。

### 5. 為什麼用單一 shared `daytona` global bucket，而不是一開始就做 weighted budget

第一版先用單一 shared bucket。

原因：

- Daytona 共享容量是真風險，但我們目前還沒有足夠的實測數據來合理定義 weighted cost
- 單一 coarse backstop 已能顯著提升 robustness
- 營運上也更容易先調參

放棄的東西：

- 無法在第一版精細區分 import 與 deep analysis 的實際資源重量

Performance / Robustness 判斷：

- 值得，因為它在保持簡單的前提下，先把 shared resource 的大洞補起來。

### 6. 是否為 deep-analysis / chat guard 新增專用 index

現階段不新增。

原因：

- 先重用現有 index，避免所有 write path 增加額外 index 維護成本
- 這些 guard 目前仍屬低頻、低讀量

放棄的東西：

- guard 查詢不是最完美的 storage shape

Performance / Robustness 判斷：

- 先不加 index 才是較好的預設，因為寫入成本是長期且全域的；只有量測證明 guard 成為熱點，才值得升級。

### 7. 為什麼不現在就做 token-cost-based limiter

先不做。

原因：

- `sendMessage` 真正送到 OpenAI 的 prompt 是在後段 action 組裝
- 沒有準確 usage / cost 訊號前，估算容易誤殺正常請求或放過昂貴請求

放棄的東西：

- 暫時無法直接以 token 成本做準確保護

Performance / Robustness 判斷：

- 先上 request limiter + global limiter + single-flight guard，能以較低複雜度擋掉大部分濫用；等 Plan 08 把 usage 資料補齊後，再疊 token-budget guard。

## 實作步驟

1. 安裝 `@convex-dev/rate-limiter`
2. 新增 `convex/convex.config.ts` 並 `app.use(rateLimiter)`
3. 更新 `convex/schema.ts`
  - `jobs.leaseExpiresAt`
  - `jobs.by_status_and_leaseExpiresAt`
4. 新增 `convex/lib/rateLimit.ts`
  - 集中 limiter config
  - 加入 `daytonaRequestsGlobal`
  - 集中 `ConvexError` helper
5. 更新 `convex/repositories.ts`
  - 在 active-import guard 後加入 import rate limit consume
  - 再加入 `daytonaRequestsGlobal`
6. 更新 `convex/analysis.ts`
  - 新增 deep-analysis single-flight guard（看 active lease）
  - job 建立與 running transition 都要寫入 / refresh lease
  - complete / fail 時清掉 `leaseExpiresAt`
  - 再加入 deep-analysis owner limiter 與 `daytonaRequestsGlobal`
7. 更新 `convex/chat.ts`
  - 改用 `jobs` 做 thread single-flight guard
  - job 建立與 running transition 都要寫入 / refresh lease
  - complete / fail 時清掉 `leaseExpiresAt`
  - 先 consume owner limiter，再 consume global limiter
  - 新增 `recoverStaleChatJob`
8. 更新 `convex/opsNode.ts` / `convex/crons.ts`
  - 新增 `reconcileStaleInteractiveJobs`
9. 更新 `src/lib/errors.ts`
  - 優先讀 `ConvexError.data.message`
10. 新增 / 更新測試
11. 更新 `docs/integrations-and-operations.md`

## 驗證

### 自動測試

新增 `convex/rateLimit.test.ts`，至少覆蓋：

1. `import` bucket：第 `limit + 1` 次被拒絕
2. `deep_analysis` bucket：不同 owner 彼此獨立
3. `chat` token bucket：短 burst 可通過，但持續超量會被拒絕
4. `chat` global limiter：多個 owner 合計超量時會被拒絕
5. `daytonaRequestsGlobal`：import / sync / deep analysis 合計超量時會被拒絕
6. `requestDeepAnalysis`：同 repository 已有 active deep-analysis lease 時，新的請求被拒絕
7. `sendMessage`：同 thread 已有 active chat lease 時，新的請求被拒絕
8. stale chat job lease 過期後，recovery 會把 job / assistant message 一起標成 failed
9. stale deep-analysis job lease 過期後，recovery 會把 job 標成 failed
10. `ConvexError` payload 能被 `src/lib/errors.ts` 正確轉成使用者訊息
11. **關鍵**：被拒絕時沒有留下多餘 `jobs` / `messages` side effects

### 手動驗證

1. UI 中快速連點 send：
  - 小 burst 仍可送出
  - 持續連發時會顯示 rate-limit 錯誤
2. 同一 thread 在 assistant 還在 active lease 內時再次送出：
  - 應直接被拒絕
3. 同一 repository 連續觸發 deep analysis：
  - 第一個進入 active lease 後，第二個應直接被拒絕
4. 人工把 chat / deep-analysis job 停在 active 狀態直到 lease 過期：
  - cron 應能把它們自動恢復成 failed，不再永久卡住
5. import / sync 在超過每小時上限時：
  - 應阻止新 workflow 被建立

## Out of Scope

- IP / edge / WAF 型 rate limit
- GitHub callback / webhook rate limit
- 依 token usage 或成本做精準預算控制
- 針對 limiter 建管理 UI

