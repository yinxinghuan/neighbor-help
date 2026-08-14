# 《邻里互助》共享世界权威合同

## 1. 边界

共享权威只保存所有玩家必须达成一致的事实：委托状态、唯一公共物品归属、提交版本、事件游标、公开互助记录与重要对话媒体附件状态。个人精力、耐心、熟悉度、人物关系、私密对白、自由输入和私人剧情只进入个人存档。

若平台尚未向游戏后端提供可验证身份，本实验必须标记为 `unverified-production-beta`，只验证一致性，不宣称能抵御身份冒用。

## 2. 实体

### HelpRequest

`id`、`title_key`、`location_id`、`destination_id`、`required_item_id?`、`status`、`claimant_user_id?`、`version`、`created_at`、`expires_at?`。

状态：`open | claimed | handed_off | completed | cancelled`。

### SharedItem

`id` 为稳定实例 ID；`kind` 为 `umbrella | spare_key | parcel | pet_food | medicine_bag`；另含 `custody`、`holder_user_id?`、`request_id?`、`version`。

归属：`community | player | handoff | returned`。同一实例不得同时属于两个玩家。“个人回执尚未确认”属于玩家私有同步状态，不进入公共物品状态机。

### WorldEvent

`cursor` 单调递增；另含 `event_id`、`action_id`、`actor_public_profile`、`type`、`entity_ids`、`public_payload`、`committed_at`、`media_status?`。事件流不得携带私人关系或自由输入全文。

## 3. 写入合同

所有写入经 `POST /api/world/action`，最少包含：

```json
{
  "action_id": "stable-client-generated-id",
  "expected_version": 12,
  "type": "claim_request",
  "request_id": "req-umbrella-gate",
  "item_id": "item-umbrella-last"
}
```

支持动作：`claim_request`、`claim_item`、`handoff_request`、`claim_handoff`、`complete_request`、`return_item`。需要同时领取委托和物品时必须在一个权威事务中完成，禁止先成功一半。

- 相同 `action_id` 重试返回同一结果，不重复改变世界。
- `expected_version` 过期返回 `VERSION_CONFLICT`。
- 委托或物品已不可用分别返回 `REQUEST_UNAVAILABLE`、`ITEM_UNAVAILABLE`。
- 客户端最多以同一 `action_id` 自动重试 3 次；不得换 ID 冒充新动作。

## 4. 收据恰好一次

权威提交涉及个人物品时生成 `grant_receipt`。客户端流程固定为：拉取未确认收据 → 按 `receipt_id` 幂等合并进个人镜像 → 调用平台存档 → 读回并验证同一 `receipt_id` → `POST /api/world/grant/ack`。未读回前不得确认；重复拉取不得重复增加物品。同一个平台 `session_id` 只有一行云存档时，故事、关系和共享物品镜像必须写入同一个带命名空间的 envelope，禁止多个 hook 各自覆盖整行。

## 5. 游标与恢复

个人存档保存 `last_seen_cursor`。重连使用 `GET /api/world/state?after=<cursor>` 按序补拉；同一 `event_id` 只应用一次。若游标过旧，服务返回完整快照和新基线游标。

竞争失败必须先显示可感知原因，例如“这把伞刚被另一位居民借走了”，再刷新公告。原行动仍可实现时放在恢复选择第一项；已不可能时给出同意图的替代方案。禁止无解释跳回无关路线。

## 6. 重要对话图片

只有权威行动成功提交后才创建重要对话事件。媒体请求键由 `event_id` 派生，服务端只允许一个活动附件；超时重试返回已有附件状态，不重复生成。图片提示词使用结构化人物、表情、当前地点和无文字约束；协议标签不得进入正文。

task 成功不等于图片合格。若像素验收发现伪文字、签名、身份漂移、地点错误或物品数量错误，原行动者提交 `reject_dialogue_media`，产生不可变的 `dialogue_media_rejected` 审计事件；随后才允许同一源事件附着一张替代图。被拒附件保留在历史中但不再是活动附件。不同玩家不能拒绝或替换该事件的媒体。

## 7. 路由与部署

- `POST /api/world/ensure`
- `GET /api/world/state`
- `POST /api/world/action`
- `GET /api/world/grants`
- `POST /api/world/grant/ack`
- `GET /api/world/history`
- `POST /api/world/report`
- `POST /api/world/event/media`
- `GET /api/health`

前端默认 `API_BASE = "/" + GAME_ID`。`?api_base=` 只用于明确 QA 覆盖，`?local=1` 只用于明确本地模拟。Pages 镜像不连接源游戏数据库，也不冒充第二个可写世界。

## 8. 必测并发场景

1. 两个客户端同时领取最后一把雨伞：只能一个成功。
2. 成功端断网后用同一 `action_id` 重试：世界只变化一次。
3. 失败端持有旧选择：获得明确冲突原因与新有效选项。
4. 领取成功但个人存档第一次写入失败：收据保持待确认，重连后只合并一次。
5. 委托交接后另一客户端领取：历史顺序和当前归属一致。
6. 重要对话媒体请求超时重试：同一事件只有一张活动图片。
7. 共享事件被个人叙事引用：公开流中不存在私人关系数值和私密对白。
8. 媒体 task 成功但出现伪签名：旧附件被标记 rejected，干净替代图成为唯一活动附件，游标按序补读两条审计事件。
