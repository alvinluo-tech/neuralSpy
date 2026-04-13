# 埋点总览

本文件汇总当前代码中所有已生效的埋点点位与上报方式。

## 1. Umami 基础配置

- 脚本注入位置：src/app/layout.tsx
- Website ID：f3bea32c-328c-4bf2-86f1-6d89fab43cd2
- 自动埋点：关闭（data-auto-track="false"）
- 结论：当前项目仅使用手动埋点。

## 2. 页面浏览埋点

页面浏览通过 useTrackPage 统一触发，最终调用 src/lib/umami.ts 中的 trackPageView。

| 页面 | 调用位置 | 上报 URL | 上报标题 | 触发条件 |
|---|---|---|---|---|
| 首页 | src/app/page.tsx:49 | / | Home - Entry | sessionId 就绪后（enabled = !!sessionId） |
| 房间大厅 | src/app/room/[id]/lobby/page.tsx:11 | /room/lobby | Room Lobby | 页面加载 |
| 房间进行中 | src/app/room/[id]/play/page.tsx:11 | /room/play | Room Play | 页面加载 |
| 房间结算页 | src/app/room/[id]/result/page.tsx:11 | /room/result | Room Result | 页面加载 |

补充：
- useTrackPage 实现位置：src/hooks/useTrackPage.ts:7
- 实际上报函数：src/lib/umami.ts:43
- 动态路由归一化规则：/room/{任意ID}/{子页} 会被归一化为 /room/{子页}（见 src/lib/umami.ts）

## 3. 事件埋点

### 3.1 player_session_started

- 调用位置：src/app/page.tsx（session 初始化 effect）
- 触发时机：sessionId 就绪后，且每个 sessionId 仅上报一次
- 上报字段：
  - page: home

说明：
- 该事件用于替代冗余的手动 page_view，避免与 useTrackPage 页面浏览统计重叠。

### 3.2 room_created

- 调用位置：src/app/page.tsx:130
- 触发时机：创建房间成功后，跳转前
- 上报字段：
  - roomCode: createdRoom.code

### 3.3 room_joined

- 调用位置：src/app/page.tsx:221
- 触发时机：加入房间成功后，跳转前
- 上报字段：
  - roomCode: code

### 3.4 room_status_change

- 调用位置：src/components/RoomGame.tsx:83
- 触发时机：房间状态或相关依赖变更时（room.status、room.category、pageType 等）
- 上报字段：
  - roomId
  - fromPageType
  - status
  - category

### 3.5 AI_Word_Generation_Attempt（含按模型命名）

- 调用位置：src/hooks/useRoomLogic.ts（startRound -> 每次请求返回后）
- 触发时机：每次 AI 请求尝试时（无论后续成功或失败）
- 上报字段：
  - room_id
  - round_number
  - category
  - attempt
  - is_random_all_mode
  - provider
  - model

事件名：

- 按模型事件：`AIWG_Attempt_{provider}_{model}`

说明：
- model 字段优先使用服务端返回的最终模型（即实际调用模型）。
- 当前前端在未手选模型时会显式使用 `qwen/qwen3-32b` 发起请求，避免出现默认占位后缀。
- 若未能解析到模型名，不会发送按模型 attempt 事件，避免占位后缀污染统计。
- 用于分析各模型请求量、重试分布与每次 attempt 的趋势。

### 3.6 AI_Word_Generation_Success（含按模型命名）

- 调用位置：src/hooks/useRoomLogic.ts（startRound -> 调用 /api/grok/words 成功后）
- 触发时机：每次 AI 接口返回成功且拿到词对时
- 上报字段：
  - room_id
  - round_number
  - category
  - attempt
  - is_random_all_mode
  - provider
  - model

事件名：

- 通用事件：`AI_Word_Generation_Success`
- 按模型事件：`AIWG_Success_{provider}_{model}`

示例：

- `AIWG_Success_groq_llama_3_1_8b_instant`

说明：
- 当前逻辑会按成功调用次数上报，可用于对比不同模型的成功率与稳定性。
- 由于 Umami 事件名长度限制，极长的 `provider + model` 组合仍可能被归一化为“截断前缀 + 哈希后缀”。

### 3.7 AI_Word_Generation_Failure（含按模型命名）

- 调用位置：src/hooks/useRoomLogic.ts（startRound -> 调用 /api/grok/words 失败后）
- 触发时机：接口失败、或响应缺少可用词对
- 上报字段：
  - room_id
  - round_number
  - category
  - attempt
  - is_random_all_mode
  - provider
  - model
  - failure_stage（network_error / http_error / invalid_payload / history_insert_error / exhausted_pairs）
  - http_status
  - error

事件名：

- 按模型事件：`AIWG_Failure_{provider}_{model}`

### 3.8 AI_Word_Generation_Rejected_Duplicate（含按模型命名）

- 调用位置：src/hooks/useRoomLogic.ts（startRound -> 成功拿到词对但因去重被跳过时）
- 触发时机：词对命中当前局历史（内存命中）或写入历史唯一键冲突
- 上报字段：
  - room_id
  - round_number
  - category
  - attempt
  - is_random_all_mode
  - provider
  - model
  - reason（memory_hit / history_unique_conflict）

事件名：

- 按模型事件：`AIWG_RejDup_{provider}_{model}`

### 3.9 Room_Config

- 调用位置：src/hooks/useRoomLogic.ts（startRound 成功后）
- 触发时机：开局完成并发词后
- 上报字段：
  - players_count
  - has_whiteboard（当前固定为 false）
  - vote_enabled
  - vote_duration_seconds
  - undercover_count
  - category

### 3.10 game_result_detail

- 调用位置：src/components/RoomGame.tsx（结果页逻辑）
- 触发时机：结算页加载且房间状态为 finished 时
- 上报范围：仅房主上报（避免同局被多位玩家重复计数）
- 去重策略：基于 sessionStorage 的单局去重键（roomId + round + winnerRole + spyCount）
- 上报字段：
  - roomId
  - winnerRole（undercover / civilian / unknown）
  - totalRounds
  - spyCount
  - voteEnabled
  - voteDurationSeconds

## 4. 埋点工具函数清单

- trackPageView：src/lib/umami.ts:43
- trackEvent：src/lib/umami.ts:64
- identifySession：src/lib/umami.ts:82

说明：
- identifySession 已在 src/app/page.tsx 启用，会在 sessionId 就绪后上报，并绑定可用昵称。

## 5. 当前事件名清单

- player_session_started
- room_created
- room_joined
- room_status_change
- AIWG_Attempt_{provider}_{model}
- AI_Word_Generation_Success
- AIWG_Success_{provider}_{model}
- AIWG_Failure_{provider}_{model}
- AIWG_RejDup_{provider}_{model}
- Room_Config
- game_result_detail

## 6. 冗余优化结论

- 已删除冗余手动 page_view，改为 player_session_started（一次性事件）。
- 页面访问量统一由 useTrackPage/trackPageView 负责，避免口径重复。
- identifySession 已启用，可串联单个用户会话行为路径。
- room_status_change、Room_Config、game_result_detail 分别用于状态流、配置偏好、平衡性分析，目标不重叠，建议保留。
