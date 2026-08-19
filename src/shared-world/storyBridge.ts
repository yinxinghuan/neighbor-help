import type { HelpRequest, Locale, RequestStatus } from './types'

export type SharedStoryAction = 'claim' | 'handoff' | 'complete'

export interface SharedStoryOutcome {
  actionLabel: string
  content: string
  marker: { key: string; value: string }
}

const requestNames = {
  zh: {
    umbrellaBusStop: '把最后一把共享雨伞送到公交站',
    medicinePickup: '从街角店代取一袋药品',
    petCare: '在小花园临时照看宠物',
  },
  en: {
    umbrellaBusStop: 'take the last shared umbrella to the bus stop',
    medicinePickup: 'collect a medicine bag from the corner shop',
    petCare: 'look after a pet in the small garden',
  },
} as const

const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`
const choicesTag = (choices: string[]) => `[choices: ${choices.map(quote).join('|')}]`
const stateTag = (objective: string) => `[state: value=${quote(objective)}]`

export function requestName(locale: Locale, request: HelpRequest): string {
  return requestNames[locale][request.titleKey as keyof typeof requestNames.zh] || request.titleKey
}

export function sharedPhaseMarker(request: HelpRequest, actorId: string): string {
  if (request.status === 'claimed') return request.claimantUserId === actorId ? 'claimed:mine' : 'claimed:other'
  if (request.status === 'handed_off') return request.handoffFromUserId === actorId ? 'handed_off:mine' : 'handed_off:other'
  return request.status
}

export function classifySharedStoryAction(action: string, locale: Locale, request?: HelpRequest): SharedStoryAction | 'board' | null {
  const value = action.trim()
  if (!value) return null
  if (locale === 'zh') {
    if (/共享公告|公告板/.test(value) && /打开|查看|刷新|返回/.test(value)) return 'board'
    if (/交接|转交|交给另一位居民/.test(value) && /委托|雨伞|公共物品/.test(value)) return 'handoff'
    if (/送达|完成委托|交给等待|交给住户|前往.*公交站/.test(value) && /雨伞|送伞|委托/.test(value)) return 'complete'
    if (/领取|拿起|取下/.test(value) && /雨伞|送伞委托/.test(value)) return 'claim'
    if (request?.status === 'claimed') {
      if (/交给.*(?:别人|其他居民)|让.*接手|找人接手|我做不了|转给/.test(value)) return 'handoff'
      if (/(?:送|带|拿).*(?:公交站|等待|住户)|交给.*(?:住户|等车|等待)|完成(?:这件事|它)/.test(value)) return 'complete'
    }
    if ((request?.status === 'open' || request?.status === 'handed_off') && /我来|我领取|我接下|接下这件事|拿(?:这|那)?把伞|取伞/.test(value)) return 'claim'
    return null
  }
  if (/shared board|notice board/i.test(value) && /open|read|check|refresh|return/i.test(value)) return 'board'
  if (/hand(?: off)? .*another resident|handoff|pass .*another resident/i.test(value) && /request|umbrella|shared item/i.test(value)) return 'handoff'
  if (/claim|pick up|take the last/i.test(value) && /umbrella|request/i.test(value)) return 'claim'
  if (/deliver|complete|give .*waiting|take .*bus stop/i.test(value) && /umbrella|request/i.test(value)) return 'complete'
  if (request?.status === 'claimed') {
    if (/give .*another resident|let .*take over|find .*take over|cannot do it|can't do it|pass it on/i.test(value)) return 'handoff'
    if (/(?:deliver|bring|take|give).*(?:bus stop|waiting resident|waiting person)|give it to (?:them|the resident)|finish (?:this|it)/i.test(value)) return 'complete'
  }
  if ((request?.status === 'open' || request?.status === 'handed_off') && /i(?:'ll| will| can) (?:take|help|do it)|i claim|pick up (?:this|the) umbrella|take this request/i.test(value)) return 'claim'
  return null
}

function actionMatchesRequest(action: string, request: HelpRequest, locale: Locale): boolean {
  if (request.id === 'req-umbrella-bus-stop') return locale === 'zh' ? /伞|公交站|等车/.test(action) : /umbrella|bus stop|waiting resident|waiting person/i.test(action)
  if (request.id === 'req-medicine-corner') return locale === 'zh' ? /药|街角店|代取/.test(action) : /medicine|corner shop|pickup/i.test(action)
  if (request.id === 'req-pet-courtyard') return locale === 'zh' ? /宠物|小花园|照看/.test(action) : /pet|small garden|look after/i.test(action)
  return action.includes(requestName(locale, request)) || action.includes(request.titleKey)
}

function requestCanReceive(request: HelpRequest, intent: SharedStoryAction, actorId: string): boolean {
  if (intent === 'claim') return request.status === 'open' || request.status === 'handed_off' || request.status === 'claimed' || request.status === 'completed'
  if (intent === 'handoff') return request.status !== 'open' && (request.claimantUserId === actorId || request.handoffFromUserId === actorId || request.status === 'completed')
  return request.status === 'claimed' || request.status === 'completed'
}

export function resolveSharedStoryTarget(
  action: string,
  locale: Locale,
  requests: HelpRequest[],
  actorId: string,
  facts: Record<string, unknown> = {},
): { intent: SharedStoryAction; request: HelpRequest } | null {
  const baseIntent = classifySharedStoryAction(action, locale)
  if (baseIntent === 'board' || baseIntent === null) {
    const contextual = requests
      .map((request) => ({ request, intent: classifySharedStoryAction(action, locale, request) }))
      .filter((entry): entry is { request: HelpRequest; intent: SharedStoryAction } => entry.intent === 'claim' || entry.intent === 'handoff' || entry.intent === 'complete')
    if (!contextual.length) return null
    const explicit = contextual.filter((entry) => actionMatchesRequest(action, entry.request, locale))
    if (explicit.length === 1) return explicit[0]
    const marked = contextual.filter((entry) => facts[`shared:${entry.request.id}`] === sharedPhaseMarker(entry.request, actorId))
    return marked.length === 1 ? marked[0] : contextual.length === 1 ? contextual[0] : null
  }

  const eligible = requests.filter((request) => requestCanReceive(request, baseIntent, actorId))
  const explicit = eligible.filter((request) => actionMatchesRequest(action, request, locale))
  if (explicit.length === 1) return { intent: baseIntent, request: explicit[0] }
  const marked = eligible.filter((request) => facts[`shared:${request.id}`] === sharedPhaseMarker(request, actorId))
  if (marked.length === 1) return { intent: baseIntent, request: marked[0] }
  const mine = eligible.filter((request) => request.claimantUserId === actorId || request.handoffFromUserId === actorId)
  if (mine.length === 1) return { intent: baseIntent, request: mine[0] }
  return eligible.length === 1 ? { intent: baseIntent, request: eligible[0] } : null
}

function umbrellaOutcome(locale: Locale, action: SharedStoryAction, request: HelpRequest): SharedStoryOutcome {
  const key = `shared:${request.id}`
  if (locale === 'zh') {
    if (action === 'claim') {
      const choices = ['拿着雨伞前往街角公交站并交给等待的住户', '把送伞委托交接给另一位居民', '打开共享公告查看其他委托']
      return {
        actionLabel: '领取送伞委托，拿起最后一把共享雨伞',
        marker: { key, value: 'claimed:mine' },
        content: `你在共享公告上确认领取送伞委托。伞架旁的状态随即改为由你保管，其他居民不能再领取同一把伞。Mara 指出街角公交站的方向；你仍在共享大厅，下一步需要亲自把伞带给等待的住户。\n[widget: energy, remove: 6]\n[widget: familiarity, add: 1]\n${stateTag('把共享雨伞带给街角公交站等待的住户')}\n${choicesTag(choices)}`,
      }
    }
    if (action === 'handoff') {
      const choices = ['打开共享公告确认谁可以接手送伞委托', '请 Mara 留意送伞委托的新进展', '查看另一项仍开放的邻里委托']
      return {
        actionLabel: '把送伞委托交接给另一位居民',
        marker: { key, value: 'handed_off:mine' },
        content: `你把送伞委托和雨伞一起交回共享公告的接手队列。公告明确记录这件事正在等待另一位居民接手；在对方确认前，没有人会被写成已经完成送达。\n${stateTag('等待另一位居民接手送伞委托')}\n${choicesTag(choices)}`,
      }
    }
    const choices = ['打开共享公告查看仍开放的委托', '回共享大厅告诉 Mara 公告已经更新', '询问公交站的住户是否还需要别的帮助']
    return {
      actionLabel: '把雨伞交给公交站等待的住户并完成委托',
      marker: { key, value: 'completed' },
      content: `你抵达街角公交站，把深绿色雨伞交给正在等待的住户。共享公告随后确认送伞委托已经完成，并把这把公共雨伞标记为已归还；它不再由你持有。\n[map_update: new_location="街角公交站" connected_to="共享大厅"]\n[widget: energy, remove: 5]\n[widget: familiarity, add: 1]\n${stateTag('查看仍开放的邻里委托')}\n${choicesTag(choices)}`,
    }
  }
  if (action === 'claim') {
    const choices = ['Take the umbrella to the corner bus stop and give it to the waiting resident', 'Hand the umbrella request to another resident', 'Open the shared board and inspect other requests']
    return {
      actionLabel: 'Claim the delivery request and pick up the last shared umbrella',
      marker: { key, value: 'claimed:mine' },
      content: `You claim the umbrella request on the shared board. Its status changes to show that you hold the last umbrella, so nobody else can claim the same object. Mara points toward the corner bus stop; you are still in the shared lobby, and delivery remains the next step.\n[widget: energy, remove: 6]\n[widget: familiarity, add: 1]\n${stateTag('Take the shared umbrella to the resident waiting at the corner bus stop')}\n${choicesTag(choices)}`,
    }
  }
  if (action === 'handoff') {
    const choices = ['Open the shared board and see who can take over', 'Ask Mara to watch for an update on the umbrella request', 'Inspect another request that is still open']
    return {
      actionLabel: 'Hand the umbrella request to another resident',
      marker: { key, value: 'handed_off:mine' },
      content: `You return the umbrella request and its item to the board's handoff queue. The board clearly shows that another resident must claim it before delivery can continue; nobody is described as having completed it yet.\n${stateTag('Wait for another resident to take over the umbrella request')}\n${choicesTag(choices)}`,
    }
  }
  const choices = ['Open the shared board and inspect the remaining requests', 'Return to the lobby and tell Mara the board has updated', 'Ask the resident at the bus stop whether anything else is needed']
  return {
    actionLabel: 'Give the umbrella to the waiting resident and complete the request',
    marker: { key, value: 'completed' },
    content: `You reach the corner bus stop and give the dark green umbrella to the waiting resident. The shared board then confirms that the request is complete and marks the public umbrella as returned; you no longer hold it.\n[map_update: new_location="Corner Bus Stop" connected_to="Shared Lobby"]\n[widget: energy, remove: 5]\n[widget: familiarity, add: 1]\n${stateTag('Inspect the neighborhood requests that remain open')}\n${choicesTag(choices)}`,
  }
}

function genericOutcome(locale: Locale, action: SharedStoryAction, request: HelpRequest): SharedStoryOutcome {
  const name = requestName(locale, request)
  const key = `shared:${request.id}`
  if (locale === 'zh') {
    const actionLabel = action === 'claim' ? `领取委托：${name}` : action === 'handoff' ? `交接委托：${name}` : `完成委托：${name}`
    const narrative = action === 'claim'
      ? `你已经在共享公告上领取“${name}”。公告只记录这一步已经提交；后续处理和完成仍需要分别确认。`
      : action === 'handoff'
        ? `你已经把“${name}”交回接手队列。公告正在等待另一位居民确认接手。`
        : `共享公告已经确认“${name}”完成，并结清了与这项委托绑定的公共物品。`
    const objective = action === 'complete' ? '查看仍开放的邻里委托' : action === 'handoff' ? '等待或查看另一项开放委托' : `继续处理“${name}”`
    const choices = action === 'complete'
      ? ['打开共享公告查看仍开放的委托', '询问 Mara 是否有新的邻里消息']
      : ['打开共享公告查看这项委托的当前状态', '把这项委托交接给另一位居民', '询问 Mara 是否需要协调']
    return { actionLabel, marker: { key, value: action === 'claim' ? 'claimed:mine' : action === 'handoff' ? 'handed_off:mine' : 'completed' }, content: `${narrative}\n${stateTag(objective)}\n${choicesTag(choices)}` }
  }
  const actionLabel = action === 'claim' ? `Claim request: ${name}` : action === 'handoff' ? `Hand off request: ${name}` : `Complete request: ${name}`
  const narrative = action === 'claim'
    ? `You claim “${name}” on the shared board. Only that stage is committed; carrying out and completing the request still require their own confirmation.`
    : action === 'handoff'
      ? `You place “${name}” in the handoff queue. The board is waiting for another resident to take it over.`
      : `The shared board confirms that “${name}” is complete and settles the public item attached to it.`
  const objective = action === 'complete' ? 'Inspect the neighborhood requests that remain open' : action === 'handoff' ? 'Wait or inspect another open request' : `Continue “${name}”`
  const choices = action === 'complete'
    ? ['Open the shared board and inspect the remaining requests', 'Ask Mara whether there is another neighborhood update']
    : ['Open the shared board and check the request status', 'Hand this request to another resident', 'Ask Mara whether coordination is needed']
  return { actionLabel, marker: { key, value: action === 'claim' ? 'claimed:mine' : action === 'handoff' ? 'handed_off:mine' : 'completed' }, content: `${narrative}\n${stateTag(objective)}\n${choicesTag(choices)}` }
}

export function buildSharedCommittedOutcome(locale: Locale, request: HelpRequest, action: SharedStoryAction): SharedStoryOutcome {
  return request.id === 'req-umbrella-bus-stop' ? umbrellaOutcome(locale, action, request) : genericOutcome(locale, action, request)
}

export function buildSharedStatusCorrection(locale: Locale, request: HelpRequest, actorId: string): SharedStoryOutcome | null {
  if (request.status === 'open') return null
  if (request.status === 'completed') {
    const outcome = buildSharedCommittedOutcome(locale, request, 'complete')
    const name = requestName(locale, request)
    const umbrella = request.id === 'req-umbrella-bus-stop'
    const content = locale === 'zh'
      ? `共享公告已经确认“${name}”完成${umbrella ? '，雨伞也已归还' : ''}。之前仍显示的领取、交接或完成选项已经失效。\n${stateTag('查看仍开放的邻里委托')}\n${choicesTag(['打开共享公告查看仍开放的委托', '询问 Mara 是否有新的邻里消息'])}`
      : `The shared board confirms that “${name}” is complete${umbrella ? ' and the umbrella has been returned' : ''}. Any older claim, handoff, or completion choice is now invalid.\n${stateTag('Inspect the neighborhood requests that remain open')}\n${choicesTag(['Open the shared board and inspect the remaining requests', 'Ask Mara whether there is another neighborhood update'])}`
    return { ...outcome, actionLabel: locale === 'zh' ? '同步共享公告的最新状态' : 'Sync the latest shared-board state', content }
  }
  if (request.status === 'claimed' && request.claimantUserId === actorId) return buildSharedCommittedOutcome(locale, request, 'claim')
  if (request.status === 'handed_off' && request.handoffFromUserId === actorId) return buildSharedCommittedOutcome(locale, request, 'handoff')
  const name = requestName(locale, request)
  const content = locale === 'zh'
    ? `共享公告显示“${name}”已经由另一位居民处理，原来的领取选项不再成立。\n${stateTag('查看仍开放的邻里委托')}\n${choicesTag(['打开共享公告查看仍开放的委托', '询问 Mara 是否有新的邻里消息'])}`
    : `The shared board shows that another resident is already handling “${name}”, so the older claim choice is no longer valid.\n${stateTag('Inspect the neighborhood requests that remain open')}\n${choicesTag(['Open the shared board and inspect the remaining requests', 'Ask Mara whether there is another neighborhood update'])}`
  return { actionLabel: locale === 'zh' ? '同步共享公告的最新状态' : 'Sync the latest shared-board state', content, marker: { key: `shared:${request.id}`, value: sharedPhaseMarker(request, actorId) } }
}

export function choicesContainStaleSharedAction(choices: Array<{ label: string }>, request: HelpRequest, locale: Locale, actorId: string): boolean {
  const phase = sharedPhaseMarker(request, actorId)
  return choices.some(({ label }) => {
    const intent = classifySharedStoryAction(label, locale)
    if (request.status === 'completed' || request.status === 'cancelled') return intent === 'claim' || intent === 'complete' || intent === 'handoff'
    if (phase.endsWith(':other')) return intent === 'claim' || intent === 'complete' || intent === 'handoff'
    if (phase === 'claimed:mine') return intent === 'claim'
    if (phase === 'handed_off:mine') return intent === 'handoff' || intent === 'complete'
    return false
  })
}
