# Plan 07 — Streaming Assistant Reply 寫入優化

- **Priority**: P2
- **Scope**: `chat.ts` 的串流寫入路徑。
- **Conflicts**:
  - `convex/chat.ts`：與 Plans 02 / 05 / 08 衝突。
  - `convex/schema.ts`（若採選項 B）：與 Plans 02 / 04 / 06 / 08 衝突。
  - `src/components/chat-panel.tsx`（若採選項 B）：單獨修改，無衝突。
- **Dependencies**: 無。

## 背景

`convex/chat.ts` 的 `appendAssistantDelta`：

```ts
const message = await ctx.db.get(args.assistantMessageId);
if (!message) return;
await ctx.db.patch(args.assistantMessageId, {
  content: `${message.content}${args.delta}`,
  status: 'streaming',
});
```

- 每次 flush：`get` → concat → `patch` 整段 content。
- 對長回答（例如 8–16KB），每次都重寫整段，O(n²) 寫入量。
- 每次 patch 都會推送完整訊息到所有訂閱 `listMessages` 的 client，流量跟著放大。

`STREAM_FLUSH_THRESHOLD` 目前是 240 字元，較小，也放大了寫入頻率。

## 目標

降低串流期間的寫入量與前端推送量，維持串流體感。

這份 Plan 提供兩條路徑，**擇一執行**：

- **選項 A**：最小改動，只調整 threshold（快速見效）。
- **選項 B**：schema 層支援 chunk-append（較完整，避免 O(n²)）。

## 選項 A — 調整 threshold（推薦先做）

### 做法

1. `convex/lib/constants.ts` 的 `STREAM_FLUSH_THRESHOLD` 從 `240` 改為 `512`（視實測決定）。
2. 如果想再細緻，加一個「flush 間隔下限」：`generateAssistantReply` 迴圈內多記一個 `lastFlushAt`，至少間隔 200ms 才 flush，避免密集 delta 連發。
3. `completeAssistantReply` 目前會 append 剩餘內容並 mark completed，不動。

### 驗證

- 讓 OpenAI 回一段 10KB 左右的文字，觀察 Convex dashboard 的 `appendAssistantDelta` 呼叫次數與 total bytes written，應明顯下降。
- 前端串流感受仍可接受（不會「一整段一次吐」）。

## 選項 B — 改 schema 用 chunks 陣列

### 做法

1. `convex/schema.ts` `messages` 新增：

```ts
contentChunks: v.optional(v.array(v.string())),
```

2. `convex/chat.ts` `appendAssistantDelta`：

```ts
const message = await ctx.db.get(args.assistantMessageId);
if (!message) return;
await ctx.db.patch(args.assistantMessageId, {
  contentChunks: [...(message.contentChunks ?? []), args.delta],
  status: 'streaming',
});
```

> 這裡每次仍需讀整個 `contentChunks` 陣列再 push（Convex 不支援 array append 原子 op），但陣列是引用數組，比重寫整段文字的 bytes 少。如果 Convex 有支援 patch push，改用 push。

3. `completeAssistantReply`：

```ts
const joined = (message.contentChunks ?? []).join('') + args.content;
await ctx.db.patch(args.assistantMessageId, {
  content: joined,
  contentChunks: undefined,
  status: 'completed',
});
```

4. `src/components/chat-panel.tsx`（以及任何呈現 assistant message 的元件）：
   - 顯示時 `const display = message.contentChunks?.length ? message.contentChunks.join('') : message.content;`
   - `status === 'streaming'` 時用 `display`，其他狀態直接用 `content`。

### 驗證

- 長回答（16KB+）的串流期間，Convex dashboard 顯示 `appendAssistantDelta` 每次 payload 是單一 delta 大小而非整段 content。
- UI 顯示跟選項 A 的行為一致。

## 選擇建議

先上選項 A，上線後監 1 週；如果寫入量仍然明顯影響 Convex bandwidth / cost，再做選項 B。

## Out of Scope

- 不改 OpenAI prompt / model 選擇邏輯。
- 不改 `generateAssistantReply` 的錯誤處理與 heuristic fallback。
- 不改 `MAX_VISIBLE_MESSAGES` / `MAX_CONTEXT_MESSAGES`。
