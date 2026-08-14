import type { Choice, StoryBlock, StoryCartridge, StorySave } from '../types'

function clean(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’()（）\-—_/]+/g, '')
}

export function authoredDecisionContext(value: string, visibleTurnText: string, locale: StoryCartridge['locale']): string {
  const normalized = value.replace(/[\n\r\t]+/g, ' ').replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, '').replace(/\s+/g, ' ').trim()
  const maxLength = locale === 'zh' ? 28 : 96
  if (!normalized || normalized.length > maxLength) return ''
  if (/请(?:做出|作出)?选择|接下来(?:怎么|如何)做|what (?:will|do) you do|make (?:a|your) choice/i.test(normalized)) return ''
  if (clean(visibleTurnText).includes(clean(normalized))) return ''
  return normalized
}

export function createTransitionBlock(
  save: Pick<StorySave, 'scene' | 'location'>,
  destination: string | undefined,
  cartridge: StoryCartridge,
): StoryBlock | undefined {
  const anchor = cartridge.transitionAnchor?.trim()
  if (!anchor || !destination || clean(destination) === clean(save.location)) return undefined
  const text = cartridge.locale === 'zh'
    ? `前往${destination}之前，你先借${anchor}回望${save.location}留下的行动与线索。确认上一段路已经结束后，你才继续，随后抵达${destination}。`
    : `Before heading to ${destination}, you use ${anchor} to review the actions and clues left at ${save.location}. Only after closing that leg do you continue and arrive at ${destination}.`
  return { id: `transition-${save.scene + 1}`, kind: 'narration', text, data: { transitionAnchor: anchor, destination } }
}

function chineseTerms(value: string): string[] {
  const stripped = value
    .replace(/^(?:先|暂时|独自|去|走|前往|沿着?|循着?|跟随|返回|回到|留下|等待|观察|查看|检查|调查|搜索|询问|告诉|帮助|拒绝|接受|进入|使用|带着?|把|让|与|继续|尝试|绕到?|登上|走向|停下|休息|决定|选择)+/u, '')
    .replace(/(?:一下|一遍|下一步|当前|现在|这里|那里|周围|情况|局面|方式|事情|行动|线索|变化|继续|再说|商量)/gu, '')
  const terms = new Set<string>()
  for (const chunk of stripped.match(/[\u3400-\u9fff]{2,}/gu) ?? []) {
    if (chunk.length <= 6) terms.add(chunk)
    for (let index = 0; index < chunk.length - 1; index += 1) terms.add(chunk.slice(index, index + 2))
  }
  return [...terms]
}

function englishTerms(value: string): string[] {
  const generic = new Set(['with', 'from', 'into', 'about', 'around', 'again', 'next', 'current', 'situation', 'continue', 'inspect', 'observe', 'check', 'ask', 'tell', 'help', 'return', 'follow', 'leave', 'wait', 'take', 'make', 'try', 'use', 'look', 'move', 'alone'])
  return [...new Set(value.toLocaleLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((term) => !generic.has(term))
}

function choiceIsGrounded(choice: Choice, source: string, locale: StoryCartridge['locale']): boolean {
  const terms = locale === 'zh' ? chineseTerms(choice.label) : englishTerms(choice.label)
  if (!terms.length) return true
  const normalizedSource = clean(source)
  return terms.some((term) => normalizedSource.includes(clean(term)))
}

export function choicesAreGrounded(choices: Choice[], save: StorySave, cartridge: StoryCartridge): boolean {
  const visibleHistory = save.blocks
    .filter((block) => block.kind !== 'image' && !block.id.startsWith('action-'))
    .map((block) => `${block.speaker ?? ''} ${block.text}`)
  const knownPeople = save.characters.filter((character) => character.status !== 'departed').map((character) => character.name)
  const knownPlaces = save.map.filter((node) => node.visited || node.current).map((node) => node.label)
  const knownItems = save.inventory.map((item) => item.label)
  const priorChoices = save.choices.map((choice) => choice.label)
  const source = [...visibleHistory, ...priorChoices, save.location, save.objective, ...knownPeople, ...knownPlaces, ...knownItems].join(' ')
  return choices.every((choice) => choiceIsGrounded(choice, source, cartridge.locale))
}
