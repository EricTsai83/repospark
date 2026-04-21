# Plan 02 — Per-Owner Rate Limiting

- **Priority**: P0
- **Scope**: Convex backend only。前端只要能顯示錯誤訊息即可（目前 `setActionError` 已涵蓋）。
- **Conflicts**:
  - `convex/schema.ts`：新增 `rateLimits` table。會和 Plans 04 / 06 / 07 / 08 衝突，建議**先做這份**。
  - `convex/chat.ts`：會和 Plans 05 / 07 / 08 衝突，同樣建議先做。
- **Dependencies**: 無。

## 背景

以下 mutation 目前完全沒有速率限制，任何登入使用者都可以連發：

- `convex/repositories.ts` → `createRepositoryImport`、`syncRepository`（直接開 Daytona sandbox，有 CPU/Memory/Disk 成本）
- `convex/analysis.ts` → `requestDeepAnalysis`（在 sandbox 內跑 Python walk）
- `convex/chat.ts` → `sendMessage`（直接呼叫 OpenAI streaming，燒 API 額度）

這是目前最大的濫用 / 成本風險。

## 目標

對每個 `ownerTokenIdentifier`，依「bucket」分桶做 per-window counter 限流。超過 limit 時 throw 明確的錯誤訊息（前端 `use-repository-actions` 會顯示）。

預設值（可由環境變數覆寫）：

| bucket | limit | window | 適用 mutation |
| --- | --- | --- | --- |
| `import` | 5 | 1 小時 | `createRepositoryImport`, `syncRepository` |
| `deep_analysis` | 10 | 1 小時 | `requestDeepAnalysis` |
| `chat` | 30 | 1 分鐘 | `sendMessage` |

## 做法（採選項 A：in-DB counter）

### 1. Schema

`convex/schema.ts` 新增：

```ts
rateLimits: defineTable({
  ownerTokenIdentifier: v.string(),
  bucket: v.string(),
  windowStart: v.number(),
  count: v.number(),
})
  .index('by_owner_and_bucket', ['ownerTokenIdentifier', 'bucket']),
```

### 2. Helper

新增 `convex/lib/rateLimit.ts`：

```ts
import type { MutationCtx } from '../_generated/server';

export type RateLimitBucket = 'import' | 'deep_analysis' | 'chat';

const LIMITS: Record<RateLimitBucket, { limit: number; windowMs: number }> = {
  import: { limit: 5, windowMs: 60 * 60_000 },
  deep_analysis: { limit: 10, windowMs: 60 * 60_000 },
  chat: { limit: 30, windowMs: 60_000 },
};

export async function enforceRateLimit(
  ctx: MutationCtx,
  ownerTokenIdentifier: string,
  bucket: RateLimitBucket,
) {
  const { limit, windowMs } = LIMITS[bucket];
  const now = Date.now();
  const existing = await ctx.db
    .query('rateLimits')
    .withIndex('by_owner_and_bucket', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('bucket', bucket),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert('rateLimits', {
      ownerTokenIdentifier,
      bucket,
      windowStart: now,
      count: 1,
    });
    return;
  }

  if (now - existing.windowStart >= windowMs) {
    await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    return;
  }

  if (existing.count >= limit) {
    const retryInSec = Math.ceil((existing.windowStart + windowMs - now) / 1000);
    throw new Error(
      `Rate limit exceeded for ${bucket}. Please retry in ${retryInSec}s.`,
    );
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
```

### 3. 套用到 mutation

在下列 mutation 的 `requireViewerIdentity` 之後立刻呼叫 `enforceRateLimit`：

- `convex/repositories.ts` `createRepositoryImport` / `syncRepository` → `'import'`
- `convex/analysis.ts` `requestDeepAnalysis` → `'deep_analysis'`
- `convex/chat.ts` `sendMessage` → `'chat'`

### 4. （選擇性）環境變數覆寫

若要動態覆寫，可用 `process.env.RATE_LIMIT_CHAT_PER_MIN` 等覆蓋 `LIMITS`。若不做，記得在 `docs/integrations-and-operations.md` 補一段說明 bucket 與預設值（**這份 thread 做**，不要留給 Plan 01）。

## 驗證

- 新增 `convex/rateLimit.test.ts`，覆蓋：
  - 單桶連呼 `limit + 1` 次，第 `limit + 1` 次 throw。
  - 跨 window 後 counter 歸零。
  - 不同 owner 彼此獨立。
  - 不同 bucket 彼此獨立。
- 手動：在 UI 快速 send 30 次以上訊息，第 31 次應顯示 "Rate limit exceeded" 錯誤。

## Out of Scope

- 不做 IP-based rate limit。
- 不做 token-cost-based limit（那屬於 Plan 08 的 cost tracking 做完之後的後續動作）。
- 不對 HTTP endpoint（`/api/github/callback`、`/api/github/webhook`）做限流（GitHub 已是可信來源）。
