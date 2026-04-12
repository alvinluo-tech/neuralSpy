# 谁是卧底 Web 项目执行说明（当前版）

## 当前架构

- 技术栈：Next.js 16 + React 19 + TypeScript + Supabase。
- 页面路由：
	- `/`：入口页（创建/加入房间）
	- `/room/[id]`：房间状态中转
	- `/room/[id]/lobby`：大厅
	- `/room/[id]/play`：进行中/投票中
	- `/room/[id]/result`：结算页
- 逻辑分层：
	- `src/hooks/useRoomData.ts`：房间数据与实时订阅
	- `src/hooks/useRoomLogic.ts`：核心业务逻辑（开局、投票、结算、踢人等）
	- `src/hooks/useCategorySearch.ts`：类别搜索与推荐
	- `src/components/RoomGame.tsx`：房间页共享 UI
- 埋点：Umami 手动上报，动态房间路由做 canonical 归一化。

## 迭代目标（持续）

1. 稳定性
- 确保实时订阅生命周期正确清理。
- 避免按钮忙碌状态卡死、重复跳转和定时器泄漏。

2. 可维护性
- 保持“页面薄、Hook 厚”的结构。
- 新增功能优先进入对应 Hook，不回流到页面组件。

3. 可观测性
- 关键行为统一事件命名，确保 Umami 报表可读。
- 新增重要流程时，补充埋点与结果验证说明。

4. 体验优化
- 按流程优化创建/加入、房间切换、异常提示。
- 仅在必要处增加动画和视觉强调，避免干扰操作。

## 每次迭代执行清单

1. 变更前
- 明确本次目标（最多 1-2 个重点）。
- 评估影响面（入口页、房间页、Hook、API）。

2. 开发中
- 优先做小步可回滚改动。
- 改动后立即做类型/问题检查（至少 Problems 面板无新增错误）。

3. 收尾
- 更新 `progress.md`（记录重大修改、风险、验证结论）。
- 若有行为变化，补充 README 或步骤说明。

## 环境变量

- `GROK_API_KEY`：Grok API 密钥（服务端使用）
- `GROK_API_URL`：可选，自定义 API 地址
- `GROK_MODEL`：可选，默认 `grok-2-latest`

## 最低验收标准

- 无阻塞错误：入口创建/加入、房间切页、投票流程可跑通。
- `progress.md` 有本次迭代记录。
- 关键文件保持分层清晰，无明显重复逻辑回流。
