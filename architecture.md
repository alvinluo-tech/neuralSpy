# NeuralSpy 当前架构说明（重构前快照）

本文档用于在重构前，对当前项目的架构现状做一次完整快照，便于后续做结构优化与迁移设计。

## 1. 项目目标与边界

NeuralSpy 是一个多人实时「谁是卧底」Web 应用，核心能力包括：

- 房间创建/加入（邀请码）
- 实时房间同步（房间状态、玩家、投票）
- 每局 AI 生成词对并分发（当前代码仅支持 Groq provider）
- 多轮投票（含弃票、平票加赛）
- 服务端权威结算（不依赖房主在线）
- Umami 手动埋点（页面与事件）

## 2. 技术栈

- 前端框架：Next.js 16 + React 19 + App Router
- 语言：TypeScript
- 数据与实时：Supabase（Postgres + Realtime）
- 样式：Tailwind CSS v4 + 自定义 CSS（globals.css）
- UI 组件：Radix AlertDialog（轻量封装）
- 分析：Umami（手动 track）

## 3. 运行时高层架构

```mermaid
flowchart LR
  U[Browser Client]\n  A[Next.js App Router]\n  C[Client Supabase JS]\n  R[(Supabase Postgres)]\n  RT[Supabase Realtime]\n  API1[/api/categories]\n  API2[/api/grok/words]\n  API3[/api/rooms/:roomId/settle-vote]\n  G[Groq Chat Completions API]\n  UM[Umami]

  U --> A
  A --> C
  C <--> R
  RT --> C

  U --> API1
  API1 --> R

  U --> API2
  API2 --> G
  API2 --> UM

  U --> API3
  API3 --> R

  U --> UM
```

### 3.1 前后端边界

- 客户端直接访问 Supabase（房间、玩家、投票的 CRUD）
- Next API 负责：
  - 分类读取代理（/api/categories）
  - AI 词生成（/api/grok/words）
  - 投票结算（/api/rooms/:roomId/settle-vote，使用 service role）

### 3.2 数据一致性策略

- 实时层：订阅 rooms/players/votes 的 Postgres changes
- 兜底层：2 秒可见页轮询 refresh
- 结算层：服务端幂等化条件更新（status + round + vote_round）

## 4. 目录与职责分层（当前）

- src/app
  - 页面路由、App Layout、API Routes
- src/components
  - RoomGame 主业务组件 + 通用 UI 组件
- src/hooks
  - 房间数据订阅（useRoomData）
  - 房间业务动作（useRoomLogic）
  - 分类搜索（useCategorySearch）
  - 页面埋点（useTrackPage）
- src/lib
  - Supabase 客户端、Umami 工具、通用工具
  - server/supabaseAdmin.ts（服务端高权限客户端）

## 5. 核心页面流

### 5.1 入口流（首页）

- 页面：/（src/app/page.tsx）
- 关键动作：
  - 本地生成并持久化 sessionId
  - 创建房间：插入 rooms，再插入房主 player
  - 加入房间：按 code 查房间，昵称冲突校验，补 player
  - 跳转到 /room/:id/lobby

### 5.2 房间流（动态路由）

- /room/:id：根据 rooms.status 重定向
  - lobby -> /lobby
  - playing/voting -> /play
  - finished -> /result
- /room/:id/lobby|play|result：统一渲染 RoomGame（以 pageType 区分）

### 5.3 RoomGame 的职责

RoomGame 是当前前端业务聚合点，负责：

- 展示房间状态、玩家列表、当前词条、投票 UI
- 房主操作（开局、开投票、结算、踢人、改类别、改投票时长）
- 自动结算触发（全员投票或超时）
- 强制移出房间后的跳转处理
- 局内提示、同步 toast、确认弹窗、AI 生成遮罩

## 6. 核心业务状态机

### 6.1 房间状态

```text
lobby -> playing -> voting -> playing -> ... -> finished
```

- 开局：lobby/playing -> playing（重置回合与投票态）
- 开投票：playing -> voting
- 结算后：
  - 平票/无人有效票 -> playing（vote_round + 1）
  - 淘汰且未分胜负 -> playing（下一轮）
  - 满足胜负条件 -> finished

### 6.2 胜负判定

- 卧底存活数 = 0 -> 平民胜
- 卧底存活数 >= 平民存活数 -> 卧底胜
- 其余 -> 游戏继续

## 7. AI 词生成链路

### 7.1 触发链路

- 房主在 RoomGame 点击开局
- useRoomLogic.startRound 调用 /api/grok/words
- 服务端调用 Groq Chat Completions，返回 pair

### 7.2 去重策略

- 房间内 + 类别内，基于 pair_key 去重
- 去重数据写入 room_word_history（唯一键约束）
- 最多尝试 6 次，避免重复词组

### 7.3 可观测性

- 客户端：Attempt/Failure/RejectedDuplicate（按模型事件）
- 服务端：Success（基础事件 + 按模型事件）
- 事件名已考虑 Umami 50 字符限制（截断 + hash）

## 8. 投票与结算链路

### 8.1 客户端投票

- votes 表 upsert（按 room_id + round_number + vote_round + voter_player_id 唯一）
- 支持弃票：target_player_id = null

### 8.2 服务端结算

- API：POST /api/rooms/:roomId/settle-vote
- 权威客户端：SUPABASE_SERVICE_ROLE_KEY
- 核心处理：
  - 计算有效投票与参与投票
  - 支持平票候选人隔离加赛（仅非平票玩家可投）
  - 更新淘汰结果与房间状态
  - 并发下通过条件更新防止重复结算

## 9. 数据模型（关键表）

- rooms：房间主状态（status、round、vote 配置、summary）
- players：玩家与身份（is_undercover、is_alive、current_word）
- votes：每轮投票记录（允许弃票）
- room_word_history：词组历史（按 room+category 去重）
- categories/category_subcategories：类别与子类词库

## 10. 横切关注点

### 10.1 实时同步

- useRoomData 同时使用：
  - Realtime 订阅
  - 可见时轮询
- 目标：降低丢事件或前台恢复后的状态漂移风险

### 10.2 分析埋点

- 手动 pageview（useTrackPage）
- 自定义事件（房间生命周期、AI、结果）
- 动态路由做了 canonical 归一化，避免房间 ID 打散统计

### 10.3 权限模型

- 当前业务操作大量在客户端直连 Supabase
- 结算等关键逻辑已迁到服务端高权限执行

## 11. 当前架构的主要问题（重构视角）

### 11.1 业务逻辑集中度过高

- RoomGame + useRoomLogic 体量较大，承担 UI、状态编排、业务流程、部分一致性控制
- 可维护性风险：改动容易产生联动回归

### 11.2 类型与能力分散

- Room/Player/Vote 类型在多个文件重复定义（如 useRoomData 与 roomContext）
- roomContext 当前基本未承载真正上下文能力（更像占位）

### 11.3 前端直连数据库比例偏高

- 大部分关键动作（建房、入房、踢人、开投票等）仍在客户端直接执行
- 与“服务端统一业务规则”目标存在一定张力

### 11.4 Realtime + 轮询并行带来的复杂性

- 稳定性更好，但增加了状态抖动与重复刷新控制成本
- syncing/loading 控制逻辑变复杂

### 11.5 路由命名与能力语义存在历史包袱

- /api/grok/words 路由名包含 grok，但当前实现以 groq 为主
- 对后续多 provider 扩展和语义清晰度不利

### 11.6 测试与契约沉淀不足

- 当前仓库缺少明显的单元/集成测试结构
- 关键状态机与结算规则主要靠运行时验证

## 12. 建议的重构方向（可分阶段）

### 阶段 A：先做“可维护”

- 抽离 domain types 到统一模块（rooms/players/votes/category）
- 按 feature 拆分 RoomGame（RoomHeader、HostPanel、VotePanel、PlayerList 等）
- 将 useRoomLogic 拆成 useRoundActions/useVoteActions/useMemberActions

### 阶段 B：再做“边界收敛”

- 将关键写操作逐步收口到 API 层（客户端尽量只读 + 触发命令）
- 引入明确的 DTO 与返回协议（success/error/action/reason）

### 阶段 C：最后做“状态与一致性治理”

- 明确单一实时策略（Realtime 为主，轮询降频为补偿）
- 为关键状态机补最小测试集：
  - 投票平票加赛
  - 全员弃票
  - 并发结算
  - 踢人后胜负判断

## 13. 建议的目标目录草图（参考）

```text
src/
  app/
    (routes + api)
  features/
    room/
      components/
      hooks/
      services/
      state/
      types/
    category/
    analytics/
  shared/
    lib/
    ui/
    types/
```

## 14. 重构前建议先确认的决策

- 是否继续保留“客户端直连 Supabase”模式，还是转向“API 命令化”
- 房间状态机是否扩展（如 paused/archived）
- AI provider 是否正式多供应商化（路由命名、配置、回退策略）
- 是否引入测试基线（至少覆盖结算核心链路）

## 15. 事实来源映射（可核查）

以下条目均来自仓库真实代码，便于你逐条回溯验证：

- 技术栈版本：
  [package.json](package.json#L12), [package.json](package.json#L14), [package.json](package.json#L17), [package.json](package.json#L19)
- Umami 手动埋点（关闭 auto-track）：
  [src/app/layout.tsx](src/app/layout.tsx#L29), [src/app/layout.tsx](src/app/layout.tsx#L31), [src/app/layout.tsx](src/app/layout.tsx#L33)
- 首页会话与关键事件（session start / room create / room join）：
  [src/app/page.tsx](src/app/page.tsx#L56), [src/app/page.tsx](src/app/page.tsx#L75), [src/app/page.tsx](src/app/page.tsx#L82), [src/app/page.tsx](src/app/page.tsx#L149), [src/app/page.tsx](src/app/page.tsx#L240)
- 房间状态重定向与页面分发：
  [src/app/room/[id]/page.tsx](src/app/room/[id]/page.tsx#L19), [src/app/room/[id]/page.tsx](src/app/room/[id]/page.tsx#L51), [src/app/room/[id]/lobby/page.tsx](src/app/room/[id]/lobby/page.tsx#L13), [src/app/room/[id]/play/page.tsx](src/app/room/[id]/play/page.tsx#L13), [src/app/room/[id]/result/page.tsx](src/app/room/[id]/result/page.tsx#L13)
- 房间实时同步 + 轮询兜底：
  [src/hooks/useRoomData.ts](src/hooks/useRoomData.ts#L149), [src/hooks/useRoomData.ts](src/hooks/useRoomData.ts#L156), [src/hooks/useRoomData.ts](src/hooks/useRoomData.ts#L161), [src/hooks/useRoomData.ts](src/hooks/useRoomData.ts#L166), [src/hooks/useRoomData.ts](src/hooks/useRoomData.ts#L185)
- 客户端 Supabase 直连（anon key）：
  [src/lib/supabase.ts](src/lib/supabase.ts#L3), [src/lib/supabase.ts](src/lib/supabase.ts#L4), [src/lib/supabase.ts](src/lib/supabase.ts#L6)
- AI 词生成 API 与 provider 约束（当前仅 groq）：
  [src/app/api/grok/words/route.ts](src/app/api/grok/words/route.ts#L31), [src/app/api/grok/words/route.ts](src/app/api/grok/words/route.ts#L186), [src/app/api/grok/words/route.ts](src/app/api/grok/words/route.ts#L206), [src/app/api/grok/words/route.ts](src/app/api/grok/words/route.ts#L218)
- 开局流程调用 AI + 词库历史去重写入：
  [src/hooks/useRoomLogic.ts](src/hooks/useRoomLogic.ts#L257), [src/hooks/useRoomLogic.ts](src/hooks/useRoomLogic.ts#L330), [src/hooks/useRoomLogic.ts](src/hooks/useRoomLogic.ts#L412)
- 投票支持弃票 + upsert：
  [src/hooks/useRoomLogic.ts](src/hooks/useRoomLogic.ts#L9), [src/hooks/useRoomLogic.ts](src/hooks/useRoomLogic.ts#L597), [src/hooks/useRoomLogic.ts](src/hooks/useRoomLogic.ts#L617)
- 服务端结算（Service Role）与平票/淘汰分支：
  [src/app/api/rooms/[roomId]/settle-vote/route.ts](src/app/api/rooms/[roomId]/settle-vote/route.ts#L37), [src/app/api/rooms/[roomId]/settle-vote/route.ts](src/app/api/rooms/[roomId]/settle-vote/route.ts#L42), [src/app/api/rooms/[roomId]/settle-vote/route.ts](src/app/api/rooms/[roomId]/settle-vote/route.ts#L145), [src/app/api/rooms/[roomId]/settle-vote/route.ts](src/app/api/rooms/[roomId]/settle-vote/route.ts#L189), [src/app/api/rooms/[roomId]/settle-vote/route.ts](src/app/api/rooms/[roomId]/settle-vote/route.ts#L210)
- 服务端 Supabase Admin 依赖环境变量：
  [src/lib/server/supabaseAdmin.ts](src/lib/server/supabaseAdmin.ts#L4), [src/lib/server/supabaseAdmin.ts](src/lib/server/supabaseAdmin.ts#L5), [src/lib/server/supabaseAdmin.ts](src/lib/server/supabaseAdmin.ts#L13)
- 分类 API 来自 categories/category_subcategories：
  [src/app/api/categories/route.ts](src/app/api/categories/route.ts#L10), [src/app/api/categories/route.ts](src/app/api/categories/route.ts#L11), [src/app/api/categories/route.ts](src/app/api/categories/route.ts#L18), [src/app/api/categories/route.ts](src/app/api/categories/route.ts#L41)

---

这份文档描述的是“当前可运行架构”，不是理想架构。后续你可以基于本文件直接做：

- 目标架构差异分析（As-Is vs To-Be）
- 分阶段迁移计划（每阶段可发布）
- 回归测试清单与埋点对齐清单
