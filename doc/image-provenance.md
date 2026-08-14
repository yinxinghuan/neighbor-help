# 《邻里互助》图片来源与生成规则

## 结论

本项目没有使用 Codex/Imagine 生成的图片作为游戏资产。静态封面、入口插画与运行时剧情图片统一走 AlterU Media Service，以避免原型图片与后续媒体服务质量、风格和约束脱节。中文只影响 UI 与故事文本，不触发中国场景；英文也不应自动触发美国场景。

## 已采用素材

### 封面与共享大厅

- Media task：`mt_c9d4efd7bff0864df55f756f6909c097`
- Request ID：`788542cd-bc2e-4d51-8879-6bb40de00ba3`
- 源 URL：`https://cdn.aiwaves.tech/prod/telegram/avatar/2762780906/1786699484558690.png`
- 本地用途：`src/story/img/worlds/neighbor-help-cover.png`、`public/poster.png`
- 人工验收：地域中性现代公寓共享大厅；空架上只有一把雨伞；无可读文字、Logo、制服门岗或明显国家标识。

### 入口场景

- 原始 task：`mt_95c667eca1c4123b0e1da372e96feaef`
- 原始 Request ID：`e770f8cc-67ed-4d22-b803-c293f31f766d`
- 修正 task：`mt_722b81428f4f743d1b73df33ff9c0799`
- 修正 Request ID：`d53617ee-d8a9-4725-8ebe-3a3cf65dbb95`
- 最终源 URL：`https://cdn.aiwaves.tech/prod/telegram/avatar/2762780906/1786699578267435.png`
- 本地用途：`src/story/img/worlds/neighbor-help-entry.png`
- 修正原因：原图的公交站牌产生伪文字；编辑版移除了文字承载物并保持地点连续。

## 被拒绝结果

- `mt_a1841b504655d81d855c53aaad67b57b`：出现伪签名。
- `mt_05b0e44f401d0be1da411706627d4658`：虽无文字，但消防梯等线索过度指向北美。
- `mt_4c5fe6d738181d9615ac602d139a3cc6`：生成了两把雨伞，破坏“最后一把”的共享规则。
- `mt_7f46deb792ff60640933b9f38e285dd8`：编辑时把两把伞全部删掉，仍不满足精确数量。
- `mt_95c667eca1c4123b0e1da372e96feaef` 原图：公交站牌出现伪文字，未经编辑不能采用。

## 固化规则

1. 世界描述先写成文化中性约束：当代普通社区、多样但不标签化的人群、无国家专属设施、无国旗、无特定制服、无本地化招牌。
2. 语言与视觉地域解耦。中文提示词不等于中国环境，英文提示词不等于美国环境。
3. “no text”不足以处理站牌、公告板、门牌、标签等天然承载文字的物体；必要时直接移除文字承载物，或改成不含文字的环境对象。
4. 唯一公共物品必须在画面中精确计数。数量是世界规则，不是装饰建议；生成后必须查看像素，失败则编辑并再次验收。
5. HTTP 200、task success 或 URL 可访问只表示服务完成，不代表素材通过。必须检查伪文字、Logo、签名、国家线索、人物身份、地点和物品数量。
6. 运行时人物参考使用明确 `edit` 模式和完整视觉身份合同；不得为无脸、无皮肤或非人角色擅自补出人脸、头发、手脚。
7. 公共重要对话图片以已提交 `event_id` 作为附件幂等依据，同一事件最多一个活动附件，并只接受 AlterU CDN URL。

## 当前验证边界

静态素材已经通过实际像素检查；运行时 Media Service 集成已通过静态校验、浏览器 mock 和真实权威端到端测试。

### 真实重要对话媒体实验

- 初始 task：`mt_4ee28673dab8aa57971e88f946d706ab`
- Request ID：`72d1bc53-3636-4d78-a4ff-5f177ff90ec2`
- 结果：人物、地点和一把雨伞正确，但右下角出现伪签名；拒绝。
- 编辑 task：`mt_1c536b67848326d98b28ad74fd9c957e`
- Request ID：`c27737d1-14ef-46c5-bfa1-82e5df5a1e4c`
- 结果：要求移除签名后仍重新生成签名样符号；拒绝。
- 干净重生成 task：`mt_fe749708fc97b69d5c102e073f71d18a`
- Request ID：`bb2ac209-fadf-4a5e-b8f0-a8a2b3d5ecab`
- 最终 URL：`https://cdn.aiwaves.tech/prod/telegram/avatar/2762780906/1786702471966354.png`
- 结果：无伪文字、签名、Logo 或国家标识；人物表情、公交候车亭、雨天和一把雨伞正确；接受。

初始坏图已经通过 `dialogue_media_rejected(reason=pseudotext)` 保留审计但退出活动状态，干净图成为同一源事件唯一活动附件；第二客户端从旧 cursor 补读到拒绝和替代两个事件。仍未验证的是平台签名身份，因为当前平台没有向自有 Worker 提供可验证证明。
