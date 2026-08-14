import type { JobContract, ParsedCommand, ParsedScene, StoryCartridge, StorySave } from '../types'

type JobCommand = Extract<ParsedCommand, { type: 'job' }>
type WidgetCommand = Extract<ParsedCommand, { type: 'widget' }>

function chineseInteger(value: string): number | undefined {
  if (/^\d{1,3}$/.test(value)) return Number(value)
  const digits: Record<string, number> = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  if (!/^[零〇一二两三四五六七八九十百]+$/.test(value)) return undefined
  let total = 0
  let current = 0
  for (const character of value) {
    if (character === '十' || character === '百') {
      const unit = character === '十' ? 10 : 100
      total += (current || 1) * unit
      current = 0
    } else current = digits[character]
  }
  return total + current
}

export function exactCoinAmount(text: string, locale: StoryCartridge['locale']): number | undefined {
  const match = locale === 'zh'
    ? text.match(/(\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})\s*(?:枚|个)?\s*(?:钱币|铜板|铜币|硬币|金币|银币)/)
    : text.match(/(\d{1,3})\s+(?:coins?|coppers?|crowns?|tokens?)/i)
  if (!match) return undefined
  const amount = locale === 'zh' ? chineseInteger(match[1]) : Number(match[1])
  return amount && amount > 0 ? Math.min(30, amount) : undefined
}

function commandDelta(command: WidgetCommand): number {
  const value = Number(command.value)
  if (!Number.isFinite(value)) return 0
  return command.operation === 'remove' ? -Math.abs(value) : command.operation === 'add' ? Math.abs(value) : 0
}

function jobForCommand(save: StorySave, offers: JobCommand[], command: JobCommand): JobContract | undefined {
  const persisted = save.jobs.find((job) => job.id === command.id)
  if (persisted) return persisted
  const offered = offers.find((offer) => offer.id === command.id && offer.action === 'offer' && offer.wage)
  return offered?.wage ? {
    id: offered.id, label: offered.label ?? offered.id, employer: offered.employer,
    wage: offered.wage, status: 'offered', offeredAtScene: save.scene + 1,
  } : undefined
}

function stableJobId(save: StorySave, action: string): string {
  let hash = 2166136261
  for (const character of `${save.scene + 1}:${action}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `story-job-${save.scene + 1}-${(hash >>> 0).toString(36)}`
}

/** Add deterministic transaction commands only when the exact transfer is
 * already explicit in visible prose. Promises never credit money. */
export function canonicalizePaymentMetadata(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  action: string,
): ParsedScene {
  if (!cartridge.statDefinitions.some((definition) => definition.id === 'coin')) return parsed
  const prose = parsed.blocks.filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => block.text).join('\n')
  const sentences = prose.split(/(?<=[。！？.!?])|\n+/).map((sentence) => sentence.trim()).filter(Boolean)
  const currency = /(?:钱币|铜板|铜币|硬币|金币|银币|coins?|coppers?|crowns?|tokens?)/i
  const received = cartridge.locale === 'zh'
    ? /(?:递给你|交给你|付给你|支付给你|给了你|数给你|塞给你|当场结清|已经结清|收到了?)/
    : /(?:paid you|handed you|gave you|passed you|counted out|you received|payment (?:was|is) settled)/i
  const spent = cartridge.locale === 'zh'
    ? /(?:你(?:当场)?(?:支付|付了|交了|付清|结清)|从你[^。！？]{0,16}扣除)/
    : /(?:you paid|you handed over|was deducted from you)/i
  const promise = cartridge.locale === 'zh'
    ? /(?:如果|等你?|(?:完成|做完|搬完|送完|修完)[^。！？]{0,12}(?:(?:之后|以后)|后(?=[，,\s我你她他会将再])|再)|再?帮(?:我|忙)?)[^。！？]{0,48}(?:会|将|给你|付你|报酬|工钱)/
    : /(?:(?:if|when|after).{0,64}(?:will pay|pay you|wage|payment)|help.{0,64}(?:i(?:'ll| will) pay|pay you))/i
  const completedTransfer = /(?:工作|任务|整理|搬运|装箱|修理|运送)[^。！？]{0,12}(?:完成|做完|搬完|送完|修完)后[，,][^。！？]{0,36}(?:递给你|交给你|付给你|给了你|塞给你|结清|收到)/
  const workContext = /(?:工作|短工|帮忙|干活|这份活|任务|报酬|工钱|搬|修|送|封好|装箱|work|job|shift|help|task|wage|repair|carry|deliver|pack)/i.test(prose)
  const receivedSentence = sentences.find((sentence) => currency.test(sentence) && received.test(sentence)
    && (!promise.test(sentence) || (completedTransfer.test(sentence) && !/(?:等你|如果|会|将)/.test(sentence))))
  const spentSentence = sentences.find((sentence) => currency.test(sentence) && spent.test(sentence) && !promise.test(sentence))
  const promisedSentence = sentences.find((sentence) => currency.test(sentence) && promise.test(sentence) && !received.test(sentence))
  let commands = parsed.commands
  const jobs = () => commands.filter((command): command is JobCommand => command.type === 'job')
  const widgets = () => commands.filter((command): command is WidgetCommand => command.type === 'widget' && command.id === 'coin')
  const label = action.trim().slice(0, 80) || (cartridge.locale === 'zh' ? '本次工作' : 'Current work')
  const employer = [...parsed.blocks].reverse().find((block) => block.kind === 'dialogue' && block.speaker)?.speaker
  const addOffer = (amount: number): JobCommand => ({
    type: 'job', action: 'offer', id: stableJobId(save, action), label,
    employer: employer || (cartridge.locale === 'zh' ? '当前雇主' : 'Current employer'), wage: amount,
  })

  if (promisedSentence) {
    const amount = exactCoinAmount(promisedSentence, cartridge.locale)
    const active = amount ? save.jobs.find((job) => job.wage === amount && (job.status === 'offered' || job.status === 'accepted')) : undefined
    if (amount && !active && !jobs().some((command) => command.action === 'offer')) commands = [...commands, addOffer(amount)]
    commands = commands.filter((command) => command.type !== 'widget' || command.id !== 'coin' || commandDelta(command) <= 0)
  }

  if (receivedSentence) {
    const amount = exactCoinAmount(receivedSentence, cartridge.locale)
    if (amount && workContext && !jobs().some((command) => command.action === 'settle')) {
      const active = save.jobs.find((job) => job.wage === amount && (job.status === 'offered' || job.status === 'accepted'))
      if (active) commands = [...commands, { type: 'job', action: 'settle', id: active.id }]
      else {
        const offer = addOffer(amount)
        commands = [...commands, offer, { type: 'job', action: 'settle', id: offer.id }]
      }
    } else if (amount && !workContext && !jobs().some((command) => command.action === 'settle') && !widgets().some((command) => commandDelta(command) === amount)) {
      commands = [...commands, { type: 'widget', id: 'coin', operation: 'add', value: amount }]
    }
  }

  if (spentSentence) {
    const amount = exactCoinAmount(spentSentence, cartridge.locale)
    if (amount && !widgets().some((command) => commandDelta(command) === -amount)) commands = [...commands, { type: 'widget', id: 'coin', operation: 'remove', value: amount }]
  }

  if (jobs().some((command) => command.action === 'settle')) {
    commands = commands.filter((command) => command.type !== 'widget' || command.id !== 'coin' || commandDelta(command) <= 0)
  }
  return commands === parsed.commands ? parsed : { ...parsed, commands }
}

export function validatePaymentConsistency(save: StorySave, parsed: ParsedScene, cartridge: StoryCartridge): string[] {
  if (!cartridge.statDefinitions.some((definition) => definition.id === 'coin')) return []
  const violations = new Set<string>()
  const prose = parsed.blocks.filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => block.text).join('\n')
  const sentences = prose.split(/(?<=[。！？.!?])|\n+/).map((sentence) => sentence.trim()).filter(Boolean)
  const currency = /(?:钱币|铜板|铜币|硬币|金币|银币|coins?|coppers?|crowns?|tokens?)/i
  const received = cartridge.locale === 'zh' ? /(?:递给你|交给你|付给你|支付给你|给了你|数给你|塞给你|当场结清|已经结清|收到了?)/ : /(?:paid you|handed you|gave you|passed you|counted out|you received|payment (?:was|is) settled)/i
  const spent = cartridge.locale === 'zh' ? /(?:你(?:当场)?(?:支付|付了|交了|付清|结清)|从你[^。！？]{0,16}扣除)/ : /(?:you paid|you handed over|was deducted from you)/i
  const promise = cartridge.locale === 'zh' ? /(?:如果|等你?|(?:完成|做完|搬完|送完|修完)[^。！？]{0,12}(?:(?:之后|以后)|后(?=[，,\s我你她他会将再])|再)|再?帮(?:我|忙)?)[^。！？]{0,48}(?:会|将|给你|付你|报酬|工钱)/ : /(?:(?:if|when|after).{0,64}(?:will pay|pay you|wage|payment)|help.{0,64}(?:i(?:'ll| will) pay|pay you))/i
  const completedTransfer = /(?:工作|任务|整理|搬运|装箱|修理|运送)[^。！？]{0,12}(?:完成|做完|搬完|送完|修完)后[，,][^。！？]{0,36}(?:递给你|交给你|付给你|给了你|塞给你|结清|收到)/
  const workContext = /(?:工作|短工|帮忙|干活|这份活|任务|报酬|工钱|搬|修|送|封好|装箱|work|job|shift|help|task|wage|repair|carry|deliver|pack)/i.test(prose)
  const receivedSentence = sentences.find((sentence) => currency.test(sentence) && received.test(sentence)
    && (!promise.test(sentence) || (completedTransfer.test(sentence) && !/(?:等你|如果|会|将)/.test(sentence))))
  const spentSentence = sentences.find((sentence) => currency.test(sentence) && spent.test(sentence) && !promise.test(sentence))
  const promisedSentence = sentences.find((sentence) => currency.test(sentence) && promise.test(sentence) && !received.test(sentence))
  const widgets = parsed.commands.filter((command): command is WidgetCommand => command.type === 'widget' && command.id === 'coin')
  const additions = widgets.filter((command) => commandDelta(command) > 0)
  const removals = widgets.filter((command) => commandDelta(command) < 0)
  const jobs = parsed.commands.filter((command): command is JobCommand => command.type === 'job')
  const offers = jobs.filter((command) => command.action === 'offer')
  const settlements = jobs.filter((command) => command.action === 'settle')

  offers.forEach((offer) => {
    if (!offer.wage || !offer.label) violations.add('job.offer_requires_id_label_and_wage')
    const persisted = save.jobs.find((job) => job.id === offer.id)
    if (persisted && (persisted.wage !== offer.wage || persisted.label !== offer.label || persisted.status === 'settled' || persisted.status === 'cancelled')) violations.add('job.offer_cannot_rewrite_contract')
    const visibleAmount = promisedSentence ? exactCoinAmount(promisedSentence, cartridge.locale) : receivedSentence ? exactCoinAmount(receivedSentence, cartridge.locale) : undefined
    if (!visibleAmount || visibleAmount !== offer.wage) violations.add('job.offer_wage_must_be_visible_and_exact')
  })
  const promisedAmount = promisedSentence ? exactCoinAmount(promisedSentence, cartridge.locale) : undefined
  const matchingActiveContract = promisedAmount
    ? save.jobs.some((job) => job.wage === promisedAmount && (job.status === 'offered' || job.status === 'accepted'))
    : false
  if (promisedSentence && offers.length === 0 && !matchingActiveContract) violations.add('job.visible_offer_requires_contract')
  if (promisedSentence && additions.length) violations.add('payment.promise_must_not_credit_coin')
  if (receivedSentence) {
    const visibleAmount = exactCoinAmount(receivedSentence, cartridge.locale)
    if (!visibleAmount) violations.add('payment.completed_payment_requires_exact_amount')
    if (workContext && settlements.length === 0) violations.add('job.completed_work_requires_settlement')
    if (!workContext && settlements.length === 0 && (!visibleAmount || !additions.some((command) => commandDelta(command) === visibleAmount))) violations.add('payment.receipt_requires_matching_coin_add')
  } else if (settlements.length) violations.add('job.settlement_must_be_visible')
  settlements.forEach((settlement) => {
    const contract = jobForCommand(save, offers, settlement)
    if (!contract) violations.add('job.settlement_requires_contract')
    if (contract?.status === 'settled' || contract?.status === 'cancelled') violations.add('job.settlement_cannot_repeat')
    const visibleAmount = receivedSentence ? exactCoinAmount(receivedSentence, cartridge.locale) : undefined
    if (contract && visibleAmount !== contract.wage) violations.add('job.settlement_amount_must_match_contract')
  })
  if (settlements.length && additions.length) violations.add('job.settlement_must_not_duplicate_widget_credit')
  if (spentSentence) {
    const visibleAmount = exactCoinAmount(spentSentence, cartridge.locale)
    if (!visibleAmount) violations.add('payment.completed_purchase_requires_exact_amount')
    if (!visibleAmount || !removals.some((command) => commandDelta(command) === -visibleAmount)) violations.add('payment.purchase_requires_matching_coin_remove')
  }
  return [...violations]
}
