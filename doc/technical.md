# 《邻里互助》技术文档

## 1. 技术栈

前端使用 React 18、TypeScript、Less 与 Vite 5，构建基址固定为 `./`。叙事层使用状态式 RPG reducer、结构化协议解析、电影式开场节拍与 AlterU 平台存档桥接；共享世界层使用独立 TypeScript reducer 与 gateway。正式权威后端设计为 Cloudflare Durable Object + SQLite，并通过同一游戏 UUID 下的 `/api/*` 提供服务。静态插画和运行时剧情图片统一使用 AlterU Media Service；运行时不调用 Imagine，也不调用旧 `gen-image` 接口。

当前项目 UUID 为 `00c8cbf4-9fba-44b6-b895-03361f71ba34`。本地 `?local=1` 使用浏览器内共享模拟；默认生产合同由 `getGameApiBase()` 返回 `/<GAME_ID>`。UUID 自托管测试站已部署并通过两个隔离浏览器会话、真实 Durable Object、回执、游标和 AlterU Media Service 附件验证。它尚未注册到游戏目录或发布 GitHub Pages 镜像；平台后端仍未提供可验证身份，因此身份模式保留为 `unverified-production-beta`。

## 2. 目录结构

- `src/story/`：RPG 界面、角色卡带、叙事 reducer、选择连续性、危险导演、图片导演、语音和平台适配器。
- `src/shared-world/engine.ts`：共享委托、唯一物品、交接、完成、事件和媒体附件的纯权威规则。
- `src/shared-world/gateway.ts`：本地模拟与远程 `/api/*` 的统一客户端接口。
- `src/shared-world/useNeighborhoodWorld.ts`：React 侧加载、提交、冲突刷新与可见性恢复。
- `src/shared-world/playerInventory.ts`、`useReceiptInventory.ts`：物品回执幂等合并、存档读回与确认。
- `src/shared/save/saveEnvelope.ts`、`useGameSave.ts`：同一平台存档行内的命名空间 envelope，隔离主故事与共享物品镜像。
- `src/shared/runtime/media.ts`、`useGenImage.ts`：AlterU Media Service 的请求、轮询、稳定 `request_id` 与终态错误处理。
- `worker/index.js`：Durable Object、SQLite 表、事务提交、回执、游标、媒体附件和实验身份门禁。
- `worker/bindings.json`：Worker 绑定说明，不含部署凭据。
- `_qa/`：纯规则、回执、存档 envelope、断线游标、Worker VM 与双玩家浏览器测试。
- `doc/`：需求、视觉、界面、反馈、共享合同、媒体来源与 QA 证据。

## 3. 核心模块

共享世界以 `WorldArchive.version` 做乐观并发控制，以 `action_id` 做幂等，以单调 `cursor` 做断线补拉。领取委托与领取所需唯一物品在同一个 reducer/SQLite 事务中完成；旧版本写入返回 `VERSION_CONFLICT`，刷新后不可领取则返回 `REQUEST_UNAVAILABLE`。客户端不会把失败选择静默送回无关剧情，而是追加生活化解释与仍然有效的恢复选项。

物品进入个人侧时由权威服务生成回执。客户端按 `receipt_id` 合并一次，写入 `neighbor-help-shared-player` 命名空间，读回确认后才 ack。主故事保存于 `neighbor-help` 命名空间；两个 hook 共享一个 cloud envelope，避免覆盖同一 `session_id` 的另一部分数据。浏览器存储全部经过 `alteruLocalStorage`，在自托管环境按 Remix session UUID 隔离。

公开事件只保存委托、物品、公开演员资料、版本、游标和媒体附件；精力、耐心、熟悉度、关系、自由输入与私密对白只在个人存档。当前 Worker 只能在 `LAB_MODE` 或 `PUBLIC_BETA` 下接受写入，健康状态必须报告 `unverified-production-beta`；在平台提供可验证后端身份之前，不能宣称可抵御身份冒用。

重要对话图片使用 AlterU Media Service。相同生成意图在模糊失败重试时保留同一个 `request_id`；明确重新生成才创建新意图。公共事件的媒体附件由 `event_id` 去重，只允许事件原行动者写入且 URL 必须来自 `https://cdn.aiwaves.tech/`。若像素验收失败，原行动者先追加 `dialogue_media_rejected` 审计事件，系统才允许新的活动附件。真实环境已验证“提交事件 → 真实媒体任务 → CDN 附件 → 伪签名拒绝 → 干净替代 → cursor 补读”。

界面以 390×844 为主并覆盖 320×568。公告列表使用 `onClick` 保留滚动，功能图标为统一线性 SVG，关系入口保持无文字笔记本图标。中英文共享同一地域中性视觉资产；生成图不承担公告文字或地点标签。

## 4. 扩展点

- 改叙事、人物、开场与选项：编辑 `src/story/cartridges/neighborHelp.ts`，并同步 `doc/requirements.md`。
- 改共享委托、物品和规则：同时修改 `src/shared-world/engine.ts` 与 `worker/index.js`，再扩充 `_qa/shared-world-engine.ts` 和 `_qa/worker-rules.mjs`，禁止只改客户端。
- 改回执或个人物品：修改 `playerInventory.ts`、`useReceiptInventory.ts`；新增私人域必须使用新的 envelope namespace，不能新增一个覆盖整行的云存档 hook。
- 改共享接口：保持默认 `API_BASE = "/" + GAME_ID`，Worker 内继续接收平台剥离 UUID 后的 `/api/*`；`?api_base=` 仅供 QA。
- 换视觉素材：静态与运行时都走 AlterU Media Service；保留 `doc/image-provenance.md` 的任务、请求和人工验收记录，不把文字烘焙进图。
- 加正式身份能力：在 Worker 写入、回执查询与 ack 前接入后端可验证身份，并删除仅用于实验的公开 beta 放行；在此之前保持 beta 标签。
- 部署：本项目不携带同事环境的发布流程或凭据。当前工作区已用独立发布 Skill 建立未上架 UUID 测试站；交接包仍只含源码合同。接收方应按自己的平台流程绑定 Durable Object/SQLite，并重复双玩家并发、重连、回执和媒体端到端验收。
