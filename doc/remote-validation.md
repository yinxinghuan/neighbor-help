# 《邻里互助》真实权威验证记录

## 环境

- UUID 测试站：`https://game.aiwaves.tech/00c8cbf4-9fba-44b6-b895-03361f71ba34/`
- Worker：Cloudflare Durable Object + SQLite
- 状态：未上架测试环境；不在 `games.json`，未创建 Pages 镜像
- 身份：`unverified-production-beta`，仅验证一致性，不宣称认证安全
- 真实入口复验：2026-08-19 通过 Telegram Mini App 开发调试工具启动；记录中不保存 Telegram 用户标识、签名、令牌或带查询参数的入口 URL
- Telegram 调试入口：Aigram 首页 → 底部钻石页 → 连点余额旁黑色钻石图标 5 次 → 选择第三个“游戏专用调试工具” → 输入公开测试地址；禁止把页面上的令牌、用户标识或带签名参数复制进仓库、日志或截图证据

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
14. 一个真实 Telegram Mini App 会话进入共享大厅并领取最后一把雨伞；界面进入前往公交站的后续叙事，Worker snapshot 同步变为 version `2` / cursor `1`，雨伞 custody 为 `player`，且事件流只有一条 `request_claimed`。这证明该入口的一次真实用户操作确实落到 Durable Object + SQLite，而不是仅在前端假推进。
15. 同一真实 Telegram 账号关闭并重进后，恢复提示正确出现；继续游戏能回到公交站/雨伞回合，共享公告仍为 version `2`，个人共享物品镜像显示 `1` 件、回执状态为 `idle`。快乐路径上的故事存档、公共 cursor 与私有回执镜像联合恢复通过；这不等于失败注入通过。
16. 真机点击共享公告的“完成”后，后端原子推进到 version `3` / cursor `2`，请求为 `completed`，雨伞为 `returned`，事件流依次为 `request_claimed`、`request_completed`；私有回执状态为 `saved`，公共物品持有数归零。权威事务与 add/remove 回执快乐路径完整通过。
17. 新源码部署后另建隔离临时 UUID，不重置原世界；两个独立浏览器同时领取时恰好一胜一冲突，胜者继续送达并完成。最终 snapshot 为 version `3` / cursor `2`，事件恰好为一次 `request_claimed` 和一次 `request_completed`，雨伞为 `returned`；完成正文没有进入通用失败，完成动作没有再次出现，完成卡片与归还状态一致。外部浏览器没有平台存档 bridge，因此此项不宣称个人云回执 ack 通过。

18. 2026-08-20 使用真实 Telegram Mini App 开发入口重新进入已完成世界并继续旧存档。新版在载入后补写确定性的完成态纠正文案；历史正文仍保留，但“把雨伞送到公交站并完成委托”不再是可点击动作。共享公告显示请求已完成、雨伞已归还、回执已同步；旅途手册使用“个人物品”分区，共享雨伞没有进入该分区。只读核对前后 Worker 均为 version `3` / cursor `2`，事件仍只有一次 `request_claimed` 与一次 `request_completed`，证明重进校正没有产生公共写入。
19. 同一真实 Telegram Mini App 会话随后用新版领取一条全新的送药委托。领取只把 Worker 从 version `3` / cursor `2` 推到 `4/3`，请求为 `claimed`、药品袋为 `player`，正文明确只记录领取与前往，没有越级宣称送达。关闭并重进后仍恢复到该领取阶段，Worker 仍为 `4/3`，没有重复事件；公告出现独立“完成”动作。点击完成后 Worker 原子推进到 `5/4`，请求为 `completed`、药品袋为 `returned`，事件流只追加一条 `request_completed`。完成正文由 committed outcome 确定性渲染，没有进入通用失败，也没有再次推荐完成。至此新版真实容器的 `claim → reentry → complete` 快乐路径通过。

## 测试中发现并修复

- 浏览器测试最初在异步结果出现前读取页面，产生假阴性；改为等待成功/冲突终态并额外断言一个 HTTP 409。
- 公共媒体最初只有“一次附着”而没有不合格图撤回路径；新增不可变 `dialogue_media_rejected` 事件和“一张活动附件”解析规则。
- `PUBLIC_BETA` 曾允许客户端选择任意 `world_key`；改为仅 `LAB_MODE` 可选测试世界，其他模式强制 `main`。
- 水粉/手绘风格即使明确 no signature 仍两次产生签名样符号；最终改用干净的满版编辑数字插画并坚持像素验收。

## 真机发现的问题与当前源码修复状态

- 真机历史版本曾把 `request_claimed` 写成已经到站并完成送伞。当前源码已把开局动作拆成“领取并拿起雨伞”与后续“送到公交站”两笔事务；领取结果由确定性桥接层渲染，保持在共享大厅，不再调用模型决定权威结果。
- 真机历史版本在 `request_completed` 已成功后进入通用失败恢复并再次推荐完成。当前源码已改为提交后的 `HelpRequest` 快照驱动确定性完成正文，并按 `shared:<request_id>` 阶段标记清除旧领取、交接和完成选项。
- 共享公告的完成者标签已随请求状态显示“已经完成/Completed”；回执状态已本地化；共享物品与“个人物品”抽屉已明确分区。
- 中英文 transition anchor 已拆到各自 cartridge，避免中文回合读取英文固定短语。
- 子游戏入口只收到原始 Telegram 用户编号与平台 API origin，没有收到可由游戏 Worker 验证的签名身份或短期服务令牌。因此这次真机写入扩大了运行环境证据，但没有关闭认证门禁。

上述源码修复已通过 `_qa/shared-story-authority.ts` 的中英文阶段测试、全部 11 项本地非浏览器门禁、生产构建和双客户端 Playwright 流程。浏览器流程覆盖领取不越级、另一玩家陈旧冲突、完成后不进入通用失败、完成按钮消失、完成者状态正确、雨伞归还和个人持有数归零。

提交 `7e61155` 已更新到同一 UUID 测试站。线上 bundle 含阶段化领取与陈旧动作清除标记，health 仍报告 Durable Object + SQLite 与 `unverified-production-beta`。在不重置现有完成世界的只读浏览器复验中，新客户端进入后自动清除了旧领取/完成动作，公告显示完成、公共雨伞显示归还，且网络断言确认没有调用 `/api/world/action`、回执 ack 或实验重置。随后使用独立临时 UUID 完成一次新的远端双客户端 `claim → conflict → complete` 事务并通过；原 Telegram UUID 没有被重置。2026-08-20 又在真实 Telegram 容器完成同一旧存档的重新进入核对，并用新版完成一笔全新的送药 `claim → reentry → complete`；界面阶段、确定性正文、陈旧动作清除和后端事件数量同时一致。

## 尚需真人或平台支持

- 两个真实 AlterU 登录账号之间的后端可验证身份。当前客户端 ID 仍由 beta 边界提供，无法证明防冒用。
- 第二个真实登录账号或物理设备与第一个账号并发争抢；现有两个隔离 Chromium context 仍不是两个经过平台认证的真人客户端。
- 真实个人云存档写入失败、读回延迟和 ack 失败注入；本轮只通过正常关闭重进，不覆盖失败路径。
- 新玩家能否复述目标、循环和失败恢复；自动化不能替代理解度访谈。
