# 《邻里互助》真实权威验证记录

## 环境

- UUID 测试站：`https://game.aiwaves.tech/00c8cbf4-9fba-44b6-b895-03361f71ba34/`
- Worker：Cloudflare Durable Object + SQLite
- 状态：未上架测试环境；不在 `games.json`，未创建 Pages 镜像
- 身份：`unverified-production-beta`，仅验证一致性，不宣称认证安全

## 已通过

1. 两个完全隔离的 Chromium context 同时领取最后一把雨伞：一个成功、一个 HTTP 409；世界只有一个 `request_claimed`。
2. 成功 action 用相同 ID 和错误版本重放：返回缓存结果，版本与事件不重复增加。
3. 失败 action 用相同 ID 在新版本重试：返回 `REQUEST_UNAVAILABLE`，不会变成故事成功。
4. 从旧 cursor 补读：按序获得一次提交事件。
5. 错误用户 ack 回执：接口调用不删除正确用户的 pending receipt；正确用户 ack 后归零。
6. 交接：旧持有人收到 remove，新持有人收到同一实例 add；完成后新持有人收到 remove。
7. 错误行动者不能附着媒体；非 AlterU CDN URL 被拒；同一活动附件不能重复创建。
8. 真实 AlterU Media Service task 成功后附着到已提交完成事件。
9. 像素检查发现伪签名后，原附件追加 rejected 审计事件；干净替代图附着成功；从旧 cursor 补读到两条事件。
10. 公开 snapshot 不含 relationship、affection、privateDialogue 或 freeInput。
11. 同一用户重复举报同一实体只计一次。
12. 非 LAB 模式强制 `world_key=main`，生产重置接口关闭。
13. 外部访客栏状态保持入口可操作；reduced-motion 将动画/transition 收束到 1ms 内；入口与自由输入发送按钮支持键盘 Enter。

## 测试中发现并修复

- 浏览器测试最初在异步结果出现前读取页面，产生假阴性；改为等待成功/冲突终态并额外断言一个 HTTP 409。
- 公共媒体最初只有“一次附着”而没有不合格图撤回路径；新增不可变 `dialogue_media_rejected` 事件和“一张活动附件”解析规则。
- `PUBLIC_BETA` 曾允许客户端选择任意 `world_key`；改为仅 `LAB_MODE` 可选测试世界，其他模式强制 `main`。
- 水粉/手绘风格即使明确 no signature 仍两次产生签名样符号；最终改用干净的满版编辑数字插画并坚持像素验收。

## 尚需真人或平台支持

- 两个真实 AlterU 登录账号之间的后端可验证身份。当前客户端 ID 仍由 beta 边界提供，无法证明防冒用。
- 新玩家能否复述目标、循环和失败恢复；自动化不能替代理解度访谈。
