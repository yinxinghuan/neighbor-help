import type { StoryCartridge, StoryDangerDirector, StoryDirector, StoryImageDirector } from '../types'

const coverImage = new URL('../img/worlds/neighbor-help-cover.png', import.meta.url).href
const entryImage = new URL('../img/worlds/neighbor-help-entry.png', import.meta.url).href
const audioThemeUrl = new URL('../audio/assets/theme.mp3', import.meta.url).href
const audioAmbienceUrl = new URL('../audio/assets/ambience.mp3', import.meta.url).href

function storyDirector(locale: 'zh' | 'en'): StoryDirector {
  const zh = locale === 'zh'
  return {
    mode: 'open-world',
    fixedWorldRules: zh ? [
      '这是一个地域中性的当代公寓社区。语言只改变界面文字，不决定国家、族裔、建筑或公共空间样式。',
      '每个公共委托和唯一物品只有一个共享权威状态；雨伞、钥匙和包裹不能同时被两个人持有。',
      '人物关系、私密对白和个人故事属于当前玩家，不能写入共享事件流或被其他玩家继承。',
      '人物只知道亲历或被告知的事情；尚未在正文中出现的人物不能进入关系页、选项或队伍。',
    ] : [
      'This is a culturally neutral contemporary apartment community. Interface language never determines country, ethnicity, architecture, or public-space design.',
      'Every public request and unique item has one shared authoritative state; an umbrella, key, or parcel cannot be held by two people at once.',
      'Relationships, private dialogue, and personal story belong to the current player and never enter the shared event stream.',
      'People know only what they witnessed or were told; anyone not yet introduced in visible prose cannot appear in relationships, choices, or the party.',
    ],
    generationRules: zh ? [
      '每轮推进玩家刚刚选择的委托，或改变一个明确的关系、地点、物品归属、时间或共享事实。',
      '冲突先用生活化正文解释，再刷新有效选项；原行动仍能实现时，恢复选项优先保留原意。',
      '图片必须匹配当前地点和重要对话人物表情，禁止生成招牌、文字、对话框、Logo 或协议标签。',
    ] : [
      'Every turn advances the request the player just chose or changes one clear relationship, place, item custody, time, or shared fact.',
      'Conflicts are first explained in everyday prose, then valid choices refresh; preserve the attempted intent first when it remains possible.',
      'Images must match the current place and the expression in an important dialogue; never generate signs, text, speech bubbles, logos, or protocol tags.',
    ],
    choiceIntents: zh
      ? ['查看或领取一个仍有效的委托', '携带、归还或交接一个公共物品', '询问居民、求助或澄清刚发生的变化']
      : ['inspect or claim an available request', 'carry, return, or hand off a shared item', 'ask a resident for help or clarify what changed'],
    maxActiveThreads: 3,
  }
}

function dangerDirector(locale: 'zh' | 'en'): StoryDangerDirector {
  const zh = locale === 'zh'
  return {
    minSafeTurns: 3,
    maxSafeTurns: 5,
    cooldownTurns: 2,
    graceScenes: 6,
    escalationStats: ['energy', 'patience'],
    threatPalette: zh ? [
      '电梯停运时仍有一个较重的包裹需要送达',
      '雨水开始漫进共享大厅，而雨伞尚未归还',
      '一项送药委托突然变得紧迫',
      '一只托管中的宠物从半开的门溜了出去',
      '同一把备用钥匙同时被两个委托需要',
    ] : [
      'the lift stops while a heavy parcel still needs delivery',
      'rain begins entering the shared lobby before the umbrella returns',
      'a medicine pickup suddenly becomes urgent',
      'a pet in temporary care slips through a half-open door',
      'two open requests need the same spare key at once',
    ],
    threatLocations: zh ? {
      '电梯停运时仍有一个较重的包裹需要送达': ['lobby'],
      '雨水开始漫进共享大厅，而雨伞尚未归还': ['lobby'],
      '一项送药委托突然变得紧迫': ['lobby', 'bus-stop'],
      '一只托管中的宠物从半开的门溜了出去': ['lobby', 'courtyard'],
      '同一把备用钥匙同时被两个委托需要': ['lobby'],
    } : {
      'the lift stops while a heavy parcel still needs delivery': ['lobby'],
      'rain begins entering the shared lobby before the umbrella returns': ['lobby'],
      'a medicine pickup suddenly becomes urgent': ['lobby', 'bus-stop'],
      'a pet in temporary care slips through a half-open door': ['lobby', 'courtyard'],
      'two open requests need the same spare key at once': ['lobby'],
    },
    methods: zh
      ? ['请另一位居民分担任务', '归还或交接手里的公共物品', '暂停并换一条更安全的实际路线']
      : ['ask another resident to share the task', 'return or hand off the shared item', 'pause and choose a safer practical route'],
    physicalCombat: 'none',
    resolution: {
      skill: zh ? '邻里协调' : 'Neighbor coordination',
      modifier: 2,
      dcBySeverity: [8, 10, 12, 14, 16],
      fallbackCosts: [{ statId: 'energy', operation: 'remove', amount: 12 }],
    },
  }
}

const shared = {
  schemaVersion: 1 as const,
  id: 'neighbor-help',
  coverImage,
  entryImage,
  theme: {
    outer: '#111715', surface: '#172421', paper: '#f3ebdd', ink: '#24312f', muted: '#7d8982',
    accent: '#537a68', danger: '#b7664d', gold: '#d7a84b', material: 'apartment' as const,
  },
  itemImageDirection: 'warm editorial gouache still life of one ordinary shared object on pale wood or cream paper, culturally neutral, object only, no people, no signs, no labels, no letters, no logos, no readable text',
  sceneImageDirection: 'warm editorial gouache in a culturally neutral contemporary apartment community, diverse ordinary residents, grounded anatomy, practical action, soft overcast or evening light, no national signage, no uniforms, no UI, no readable text',
  sceneImageAvoid: 'Chinese gated-compound guard desks, boom barriers, security uniforms, Chinese signs, American suburban houses, national flags, readable notices, logos, or the placeholder composition',
  imageDirector: {
    maxQuietTurns: 4,
    softCooldownTurns: 2,
    guaranteedTriggers: ['new-location', 'rare-item', 'party-change', 'chapter-checkpoint', 'character-expression'],
    softTriggers: ['relationship-change', 'objective-change', 'skill-outcome'],
  } satisfies StoryImageDirector,
  audioTheme: {
    recorded: { music: { src: audioThemeUrl, gain: .2 }, ambience: { src: audioAmbienceUrl, gain: .3 } },
    material: 'apartment' as const,
    bpm: 66,
    rootHz: 146.83,
    scale: [0, 2, 5, 7, 9],
    levels: { music: .09, ambient: .07, sfx: .15, master: .22 },
    tension: [
      { statId: 'energy', direction: 'low' as const, weight: .55 },
      { statId: 'patience', direction: 'low' as const, weight: .45 },
    ],
  },
}

export const neighborHelp: StoryCartridge = {
  ...shared,
  locale: 'zh',
  transitionAnchor: '每位居民都会经过的共享大厅公告板与伞架',
  copy: {
    title: '邻里互助', subtitle: '一件小事，很多人的同一个社区',
    promise: '别人做过的事会留下来，你的关系仍然属于你。',
    enter: '走进共享大厅', continue: '继续这件小事', customAction: '也可以写下你想怎么帮忙',
    itemImagingTitle: '个人物品正在归档', itemImagingBody: '这里展示个人物品；领取中的共享物品请到“共享公告”查看。生成不会阻塞委托，失败时仍保留文字与重试入口。',
  },
  director: storyDirector('zh'),
  dangerDirector: dangerDirector('zh'),
  statDefinitions: [
    { id: 'energy', label: '精力', min: 0, max: 100, initial: 78, inverse: true, display: 'bar', warningAt: 25, dangerAt: 8, maxDelta: 18 },
    { id: 'patience', label: '耐心', min: 0, max: 100, initial: 72, inverse: true, display: 'bar', warningAt: 25, dangerAt: 8, maxDelta: 16 },
    { id: 'familiarity', label: '熟悉度', min: 0, max: 20, initial: 1, inverse: true, display: 'number', warningAt: 0, dangerAt: 0, maxDelta: 3 },
  ],
  drawerLabels: { party: '居民', map: '地点', inventory: '个人物品', log: '关系簿' },
  opening: {
    location: '共享大厅 · 伞架', time: '周五 17:40', objective: '确认是否领取最后一把共享雨伞',
    imagePrompt: 'culturally neutral contemporary apartment lobby in light rain, shared umbrella rack with one folded dark green umbrella remaining, parcel shelf and courtyard beyond glass, warm editorial gouache on paper, ordinary international residents, no national markers, no signs, no letters, no numbers, no logos, no UI, 4:3',
    blocks: [
      { id: 'a0', kind: 'narration', text: '玻璃门外刚落下第一阵雨，回家的脚步都快了起来。' },
      { id: 'a1', kind: 'narration', text: '共享伞架上只剩一把折好的深绿色雨伞。' },
      { id: 'a2', kind: 'event', text: '公告板刚更新：有人在街角公交站等雨伞，暂时无法走回公寓。' },
      { id: 'a3', kind: 'narration', text: '一位穿浅色雨衣、把湿发别到耳后的年轻住户正核对公交站的位置。大家叫她 Mara。' },
      { id: 'a4', kind: 'dialogue', speaker: 'Mara', tone: '认真', text: '如果你拿伞，我可以先去确认对方还在不在。或者我们把这件事留给更近的人。' },
    ],
    choices: [
      { id: 'claim-umbrella', label: '领取送伞委托，拿起最后一把共享雨伞' },
      { id: 'coordinate-mara', label: '请 Mara 先确认位置，自己留在大厅' },
      { id: 'inspect-board', label: '先查看公告板上还有哪些邻里小事' },
    ],
  },
  characters: [
    { id: 'mara', name: 'Mara', role: '同楼住户', vitality: 8, stress: 3, detail: '穿浅色雨衣，遇到混乱会先核对地点和谁已经在处理。', lore: '她常在晚饭前经过共享大厅，知道哪些物品刚被借走。', skills: [{ id: 'coordinate', label: '协调', value: 4 }, { id: 'notice', label: '留意', value: 3 }] },
    { id: 'noah', name: 'Noah', role: '街角店员', vitality: 7, stress: 4, detail: '说话简短，记得每个常客通常从哪条路回家。', lore: '他偶尔代收居民急用的药品和钥匙。', hiddenUntilIntroduced: true, skills: [{ id: 'notice', label: '留意', value: 4 }, { id: 'carry', label: '搬运', value: 2 }] },
    { id: 'leila', name: 'Leila', role: '新搬来的住户', vitality: 6, stress: 5, detail: '总把需要归还的东西仔细包好，却还不熟悉每扇门。', lore: '她第一次请求帮助与一串找不到主人的备用钥匙有关。', hiddenUntilIntroduced: true, skills: [{ id: 'listen', label: '倾听', value: 3 }, { id: 'organize', label: '整理', value: 3 }] },
  ],
  initialMap: [
    { id: 'lobby', label: '共享大厅', current: true, detail: '一处地域中性的公寓公共空间，有伞架、包裹架和通向小花园的玻璃门。', lore: '公告板上的状态由居民共同更新，但不会展示任何人的私人关系。', facts: ['伞架只剩一把共享雨伞', '雨刚开始下'] },
    { id: 'bus-stop', label: '街角公交站', connectedTo: '共享大厅', detail: '从公寓步行几分钟可到的普通公交站，旁边有一间街角店。', lore: '这里是居民互相交接小件物品时最容易说明的位置。', facts: ['有人正在这里等雨伞'] },
    { id: 'courtyard', label: '小花园', connectedTo: '共享大厅', detail: '几张长椅、耐雨植物和通往各栋入口的小路。', lore: '天气好的时候，居民会在这里交换宠物照看和代取物品的请求。', facts: ['雨水让石板路开始变滑'] },
  ],
  initialInventory: [
    { id: 'key-pouch', label: '布质钥匙袋', count: 1, detail: '一只没有文字标签的结实棉布袋，可清楚保管一件借用中的公共物品。', effect: '一次只能保管一件共享钥匙或小物；归还或交接后才能领取下一件。', lore: '它一直放在大厅的共享架上，居民用它避免把私人钥匙和公共钥匙混在一起。', metrics: [{ label: '可保管', value: '1 件' }, { label: '当前', value: '空' }], imagePrompt: 'single sturdy unbranded cotton key pouch on pale wood, culturally neutral editorial gouache still life, no tag text, no letters, no logo, object only, square' },
  ],
  demoTurns: [
    { match: ['雨伞', '公交站', '领取'], content: `你在公告板上确认领取，伞架旁的状态线随即改为由你保管。Mara 把公交站的位置指给你；你仍在共享大厅，送达需要下一步单独确认。
[widget: energy, remove: 6]
[widget: familiarity, add: 1]
[choices: "拿着雨伞前往街角公交站并交给等待的住户"|"把送伞委托交接给另一位居民"|"打开共享公告查看其他委托"]`, imagePrompt: 'culturally neutral apartment lobby in light rain, one resident taking a folded dark green umbrella while Mara in a pale raincoat points toward the street corner, warm editorial gouache, grounded natural gesture, no signs, no text, no UI, 4:3', imageSubject: 'others' },
    { match: ['Mara', '确认', '位置'], content: `Mara 站到玻璃门边，先发出一条简短确认。片刻后，她抬起头，神情从专注变成放心。
[Mara] [main] [松了一口气]: "人还在公交站，而且已经有人陪着。我们只要把伞送到就好。"
[dialogue_focus: speaker="Mara" expression="松了一口气但仍认真核对位置"]
[reputation: npc="Mara" action="trusted"]
[widget: familiarity, add: 1]
[choices: "领取雨伞并前往公交站"|"请 Mara 负责送伞，自己查看另一项委托"|"把最新情况补到公告板"]`, imagePrompt: 'important dialogue portrait of Mara, a young apartment resident in a pale raincoat beside the lobby glass door, wet hair tucked behind one ear, relieved but still attentive expression after confirming a neighbor is safe, culturally neutral contemporary apartment, warm editorial gouache, no signs, no text, no UI, 4:3', imageSubject: 'others' },
    { match: ['公告板', '其他', '查看'], content: `你没有先动那把雨伞，而是把公告板按距离重新看了一遍。除了公交站，还有一个代取药品的请求和一只需要临时照看的宠物。
[choices: "领取送伞委托"|"查看代取药品的具体位置"|"看看谁能临时照看宠物"]` },
    { match: ['送到', '前往', '带回', '交接'], content: `你沿着湿亮的人行道走到街角。雨伞被顺利交到等待的人手里，这件小事在公告板上留下完成记录。
[inventory: remove item="共享雨伞" count="1"]
[widget: energy, remove: 5]
[widget: familiarity, add: 1]
[session_end: reason="雨伞委托已经完成，可以在这里停下，也可以下次继续另一件邻里小事"]` },
  ],
}

export const neighborHelpEn: StoryCartridge = {
  ...shared,
  locale: 'en',
  transitionAnchor: 'the shared lobby notice board and umbrella rack that every resident passes',
  copy: {
    title: 'Neighborly Help', subtitle: 'One small task in a place everyone shares',
    promise: 'What others do remains in the world. Your relationships remain yours.',
    enter: 'Step into the shared lobby', continue: 'Continue this small task', customAction: 'Or write how you want to help',
    itemImagingTitle: 'Personal items are being archived', itemImagingBody: 'This drawer shows personal items; open the shared board for items attached to active requests. Generation never blocks a request; text and retry remain available if it fails.',
  },
  director: storyDirector('en'),
  dangerDirector: dangerDirector('en'),
  statDefinitions: [
    { id: 'energy', label: 'Energy', min: 0, max: 100, initial: 78, inverse: true, display: 'bar', warningAt: 25, dangerAt: 8, maxDelta: 18 },
    { id: 'patience', label: 'Patience', min: 0, max: 100, initial: 72, inverse: true, display: 'bar', warningAt: 25, dangerAt: 8, maxDelta: 16 },
    { id: 'familiarity', label: 'Familiarity', min: 0, max: 20, initial: 1, inverse: true, display: 'number', warningAt: 0, dangerAt: 0, maxDelta: 3 },
  ],
  drawerLabels: { party: 'Residents', map: 'Places', inventory: 'Personal items', log: 'Relationships' },
  opening: {
    location: 'Shared Lobby · Umbrella Rack', time: 'Friday 17:40', objective: 'Decide whether to claim the last shared umbrella',
    imagePrompt: 'culturally neutral contemporary apartment lobby in light rain, shared umbrella rack with one folded dark green umbrella remaining, parcel shelf and courtyard beyond glass, warm editorial gouache on paper, ordinary international residents, no national markers, no signs, no letters, no numbers, no logos, no UI, 4:3',
    blocks: [
      { id: 'a0', kind: 'narration', text: 'The first rain lands beyond the glass doors, and everyone walking home quickens their pace.' },
      { id: 'a1', kind: 'narration', text: 'Only one folded dark green umbrella remains on the shared rack.' },
      { id: 'a2', kind: 'event', text: 'The notice board has just changed: someone at the corner bus stop cannot make it back through the rain.' },
      { id: 'a3', kind: 'narration', text: 'A young resident in a pale raincoat tucks wet hair behind one ear while checking the stop. Everyone calls her Mara.' },
      { id: 'a4', kind: 'dialogue', speaker: 'Mara', tone: 'focused', text: 'If you take the umbrella, I can confirm they are still there. Or we can leave it for someone closer.' },
    ],
    choices: [
      { id: 'claim-umbrella', label: 'Claim the delivery request and pick up the last shared umbrella' },
      { id: 'coordinate-mara', label: 'Ask Mara to confirm the location while you stay in the lobby' },
      { id: 'inspect-board', label: 'Check what other neighborhood requests are open first' },
    ],
  },
  characters: [
    { id: 'mara', name: 'Mara', role: 'Resident', vitality: 8, stress: 3, detail: 'Wears a pale raincoat and checks places and ownership before acting in a rush.', lore: 'She often passes the lobby before dinner and notices which shared objects have just moved.', skills: [{ id: 'coordinate', label: 'Coordinate', value: 4 }, { id: 'notice', label: 'Notice', value: 3 }] },
    { id: 'noah', name: 'Noah', role: 'Corner shop clerk', vitality: 7, stress: 4, detail: 'Speaks briefly and remembers which route each regular usually takes home.', lore: 'He sometimes holds urgent medicine or keys for residents.', hiddenUntilIntroduced: true, skills: [{ id: 'notice', label: 'Notice', value: 4 }, { id: 'carry', label: 'Carry', value: 2 }] },
    { id: 'leila', name: 'Leila', role: 'New resident', vitality: 6, stress: 5, detail: 'Wraps anything due for return with care, but still confuses the apartment doors.', lore: 'Her first help request concerns a set of spare keys with no known owner.', hiddenUntilIntroduced: true, skills: [{ id: 'listen', label: 'Listen', value: 3 }, { id: 'organize', label: 'Organize', value: 3 }] },
  ],
  initialMap: [
    { id: 'lobby', label: 'Shared Lobby', current: true, detail: 'A culturally neutral apartment common area with an umbrella rack, parcel shelf, and glass doors to a small garden.', lore: 'Residents maintain the public status board together, but it never exposes private relationships.', facts: ['Only one shared umbrella remains', 'The rain has just started'] },
    { id: 'bus-stop', label: 'Corner Bus Stop', connectedTo: 'Shared Lobby', detail: 'An ordinary bus stop a few minutes from the apartment, beside a small corner shop.', lore: 'Its clear location makes it a common handoff point for residents.', facts: ['Someone is waiting here for an umbrella'] },
    { id: 'courtyard', label: 'Small Garden', connectedTo: 'Shared Lobby', detail: 'A few benches, rain-tolerant plants, and paths to the apartment entrances.', lore: 'In dry weather residents exchange pet-care and pickup requests here.', facts: ['The paving stones are becoming slippery'] },
  ],
  initialInventory: [
    { id: 'key-pouch', label: 'Cloth key pouch', count: 1, detail: 'A sturdy unlabelled cotton pouch that clearly holds one borrowed shared object.', effect: 'Carries one shared key or small object at a time; return or hand it off before claiming another.', lore: 'It stays on the lobby shelf so residents do not mix shared keys with personal ones.', metrics: [{ label: 'Capacity', value: '1 item' }, { label: 'Current', value: 'Empty' }], imagePrompt: 'single sturdy unbranded cotton key pouch on pale wood, culturally neutral editorial gouache still life, no tag text, no letters, no logo, object only, square' },
  ],
  demoTurns: [
    { match: ['umbrella', 'bus stop', 'claim'], content: `You confirm the claim on the board, and the status line changes to show that you hold the umbrella. Mara points out the bus stop; you are still in the shared lobby, and delivery requires its own next action.
[widget: energy, remove: 6]
[widget: familiarity, add: 1]
[choices: "Take the umbrella to the corner bus stop and give it to the waiting resident"|"Hand the umbrella request to another resident"|"Open the shared board and inspect other requests"]`, imagePrompt: 'culturally neutral apartment lobby in light rain, one resident taking a folded dark green umbrella while Mara in a pale raincoat points toward the street corner, warm editorial gouache, grounded natural gesture, no signs, no text, no UI, 4:3', imageSubject: 'others' },
    { match: ['Mara', 'confirm', 'location'], content: `Mara steps to the glass door and sends a short confirmation. A moment later she looks up, her focus easing into relief.
[Mara] [main] [relieved]: "They're still at the bus stop, and someone is waiting with them. We only need to get the umbrella there."
[dialogue_focus: speaker="Mara" expression="relieved while still carefully confirming the location"]
[reputation: npc="Mara" action="trusted"]
[widget: familiarity, add: 1]
[choices: "Claim the umbrella and head to the bus stop"|"Ask Mara to deliver it while you inspect another request"|"Add the confirmed details to the notice board"]`, imagePrompt: 'important dialogue portrait of Mara, a young apartment resident in a pale raincoat beside the lobby glass door, wet hair tucked behind one ear, relieved but still attentive expression after confirming a neighbor is safe, culturally neutral contemporary apartment, warm editorial gouache, no signs, no text, no UI, 4:3', imageSubject: 'others' },
    { match: ['board', 'other', 'inspect', 'check'], content: `You leave the umbrella in place and sort the board by distance. Beyond the bus-stop request, someone needs medicine collected and a pet needs brief care.
[choices: "Claim the umbrella request"|"Check the medicine pickup location"|"See who can briefly care for the pet"]` },
    { match: ['take', 'deliver', 'return', 'handoff'], content: `You follow the wet pavement to the corner. The umbrella reaches the waiting neighbor, and the small task leaves a completed mark on the shared board.
[inventory: remove item="Shared umbrella" count="1"]
[widget: energy, remove: 5]
[widget: familiarity, add: 1]
[session_end: reason="The umbrella request is complete. Stop here or return another time for a different neighborhood task."]` },
  ],
}
