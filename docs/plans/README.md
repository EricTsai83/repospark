# 修正計劃索引

這個資料夾裡的每一份 `NN-*.md` 都是**可獨立執行的修正計劃**，設計成可以在不同 Thread / 不同 agent session 中分開進行。每份檔案自帶：

- 背景 / 目標
- 涉及檔案與不涉及檔案（scope 邊界）
- 具體步驟與驗證方式
- 與其他計劃的依賴 / 衝突提示

## 執行順序建議

依風險由高到低。若要平行跑，請留意「Conflicts」欄位有重疊檔案的計劃不要同時進行。


| 順序  | Plan                                                                                         | Priority | 主要目的                   | 主要檔案                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------- | -------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [02-rate-limiting.md](./02-rate-limiting.md)                                                 | P0       | 擋住濫用與失控成本              | `package.json`, `convex/schema.ts`, `convex/convex.config.ts`（新）, `convex/lib/rateLimit.ts`（新）, `convex/{repositories,analysis,chat,opsNode,crons}.ts`, `src/lib/errors.ts` |
| 2   | [03-daytona-orphan-protection.md](./03-daytona-orphan-protection.md)                         | P1       | 縮小 Daytona 孤兒窗口        | `convex/{importsNode,imports,daytona,opsNode,crons}.ts`                                                                                                                     |
| 3   | [04-persist-import-idempotent-and-batched.md](./04-persist-import-idempotent-and-batched.md) | P1       | import 冪等 + 分批化        | `convex/{imports,importsNode}.ts`, `convex/schema.ts`                                                                                                                       |
| 4   | [09-daytona-webhook-reconciliation.md](./09-daytona-webhook-reconciliation.md)               | P1       | Daytona 事件驅動對帳強化       | `convex/{http,daytona,ops,opsNode}.ts`, `convex/schema.ts`, `docs/{system-overview,integrations-and-operations}.md`                                                         |
| 5   | [06-repo-detail-filecount.md](./06-repo-detail-filecount.md)                                 | P2       | 主畫面 read amplification | `convex/schema.ts`, `convex/imports.ts`, `convex/repositories.ts`                                                                                                           |
| 6   | [01-docs-sync.md](./01-docs-sync.md)                                                         | P2       | 文件與程式碼同步               | `docs/*.md`（不碰 code）                                                                                                                                                        |
| 7   | [07-streaming-reply-optimization.md](./07-streaming-reply-optimization.md)                   | P2       | 串流寫入 / 推送優化            | `convex/chat.ts`, `convex/lib/constants.ts`（可選 schema）                                                                                                                      |
| 8   | [05-chat-context-retrieval.md](./05-chat-context-retrieval.md)                               | P2       | Chat 回答品質              | `convex/chat.ts`, `convex/chat-context.test.ts`                                                                                                                             |
| 9   | [08-misc-deepmode-installations-cost.md](./08-misc-deepmode-installations-cost.md)           | P3       | 三項小改善合併                | `convex/{analysis,analysisNode,github,chat}.ts`, `convex/lib/openaiPricing.ts`（新）                                                                                           |
| 10  | [10-lawn-style-vercel-convex-deployment.md](./10-lawn-style-vercel-convex-deployment.md)    | P2       | 採用 `lawn` 式 Vercel + Convex 部署 | `package.json`, `vercel.json`（新）, `.env.example`, `README.md`, `docs/integrations-and-operations.md`                                                                       |


## 衝突提示（會互相踩到的檔案）

- `convex/schema.ts`：Plans 02、04、06、07、08 都可能改。**建議依上面順序序列化執行。**
- `convex/chat.ts`：Plans 02、05、07、08 都會改。
- `convex/imports.ts`：Plans 03、04、06 都會改。
- `convex/importsNode.ts`：Plans 03、04 都會改。

若真的要平行，安全的組合是：**Plan 01（純文件）** 可以與任何 code plan 平行；**Plan 05** 與 **Plan 03** 不衝突；**Plan 06** 與 **Plan 02** 不衝突。

## 新 Thread 的使用方式

在新 Thread 中，只要貼：

> 請依照 `docs/plans/NN-xxx.md` 執行。完成後跑相關測試並 summarize 改了什麼。

agent 讀檔即可自洽執行，不需要更多上下文。