# 《邻里互助》视觉 QA

## 验收环境

- 主视口：390×844，平台内布局；生产 `guest-shell.js` 保留，QA harness 仅隐藏外部访客栏。
- 小视口：320×568，平台内布局。
- 双客户端：同一浏览器上下文中的 Alex 与 Sam，共享本地权威模拟。
- 媒体：浏览器测试用已验收本地图片模拟 AlterU Media Service 响应，不调用 Imagine。

## 证据

- `_qa/ui/neighbor-help-entry-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-opening-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-board-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-claim-success-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-stale-choice-recovery-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-after-conflict-board-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-entry-platform-layout-320x568.png`
- `_qa/ui/neighbor-help-remote-conflict-platform-layout-390x844.png`
- `_qa/ui/neighbor-help-external-guest-390x844.png`
- `_qa/ui/neighbor-help-reduced-motion-platform-layout-390x844.png`
- `_qa/media/neighbor-help-important-dialogue-real-media.png`（拒绝：右下角伪签名）
- `_qa/media/neighbor-help-important-dialogue-clean-candidate.png`（拒绝：编辑后仍有签名样符号）
- `_qa/media/neighbor-help-important-dialogue-clean-candidate-2.png`（接受）

## 已通过

- 入口、开场、公告板、领取成功和旧选择冲突恢复可在 390×844 使用。
- 320×568 入口无横向溢出，首个动作仍可见且可操作。
- Alex 领取最后一把雨伞后，Sam 的旧选择不会跳入无关路线；页面先显示原因，再给出有效恢复选择。
- Sam 刷新公告后看到 `Alex · In progress`，公共归属与故事解释一致。
- 顶部公告板图标已改为透明 44px 线性 SVG 按钮，与文字、语音和关系笔记本图标对齐。
- DOM 机械检查确认 `scrollWidth <= viewport`，领取后标题区域宽度不少于 70px。
- 地点、正文、选择和当前图片来自同一状态；协议标签不进入正文。
- 静态插画没有采用中国小区或美国郊区的默认视觉，图内无可读公告文字。
- 真实 Worker 下两个隔离浏览器会话同时争抢最后一把雨伞，只有一个 HTTP 200，另一个收到 HTTP 409 并进入可理解恢复。
- 真实 Media Service 的首张重要对话图因伪签名被拒；第二次编辑仍失败；第三张干净数字插画通过并替换为唯一活动附件。
- 外部访客栏可见时入口标题、主图、承诺和主按钮仍可用；生产源码没有为访客栏永久下移平台内构图。
- `prefers-reduced-motion: reduce` 下动画与 transition 均收束到不超过 1ms；入口和自由输入发送按钮可用键盘 Enter 激活。

## 已修复问题

- P1：公告板按钮最初继承浏览器白色按钮背景，破坏顶部一级 UI 的统一性。已补全透明背景、尺寸、边框和焦点样式，并在同状态截图复验。
- P1：生成图曾出现伪签名、伪站牌文字、北美消防梯和错误雨伞数量。均未进入最终资产；通过编辑与像素检查选出合格版本。

## 尚未验证

- `comprehension unverified`：自动化只能证明流程可执行，尚无新玩家复述“目标、重复动作、进展/失败”的真人证据。
- 真实 Durable Object 和线上 Media Service 附件链路已验证；真正两台物理设备与平台签名身份尚未验证。

## 发布门禁

在正式发布前必须补齐真实权威双客户端竞争、断网同 action ID 重试、回执写回失败恢复、公共重要对话媒体只生成一次、external-guest 和 reduced-motion 证据。任何一项失败都应先修复并回灌共享模板，不把本地模拟通过表述为正式多人验收通过。
