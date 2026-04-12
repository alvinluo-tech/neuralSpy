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

### 3.1 page_view

- 调用位置：src/app/page.tsx:66
- 触发时机：首页 sessionId 初始化完成后
- 上报字段：
  - page: home

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

## 4. 埋点工具函数清单

- trackPageView：src/lib/umami.ts:43
- trackEvent：src/lib/umami.ts:64
- identifySession：src/lib/umami.ts:82

说明：
- identifySession 当前仅定义，尚未在业务代码中调用。

## 5. 当前事件名清单

- page_view
- room_created
- room_joined
- room_status_change
