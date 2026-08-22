import type { DangerDirective, ParsedCommand, ParsedScene, StoryCartridge, StorySave } from '../types'
import { dangerDirectiveEstablished, dangerTextGrounded } from './dangerDirector'

function clean(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’()（）\-—_/]+/g, '')
}

function effectiveLocation(save: StorySave, parsed: ParsedScene): string {
  const update = [...parsed.commands].reverse().find((command) => command.type === 'map_update')
  return update?.type === 'map_update' ? update.location : save.location
}

function visibleProse(parsed: ParsedScene): string {
  return parsed.blocks.filter((block) => block.kind === 'narration' || block.kind === 'dialogue').map((block) => block.text).join('\n')
}

function threadGrounded(thread: string, text: string, locale: StoryCartridge['locale']): boolean {
  return dangerTextGrounded(thread, text, locale) || dangerTextGrounded(text, thread, locale)
}

function newTaskCue(locale: StoryCartridge['locale']): RegExp {
  return locale === 'zh'
    ? /你(?:现在)?(?:的)?(?:新|下一项|接下来(?:的)?)任务(?:是|为|：|:)|(?:接受|接下|领取|承担|受命执行|开始执行)[^。！？\n]{0,18}(?:任务|委托)|(?:交给|委托给|安排给)你[^。！？\n]{0,18}(?:任务|委托)/
    : /your (?:new|next) (?:task|assignment) (?:is|:)|(?:accept|take on|receive|begin executing).{0,48}(?:task|assignment)|(?:assign|entrust).{0,32}(?:task|assignment).{0,24}you/i
}

function inferredObjective(parsed: ParsedScene, cartridge: StoryCartridge): string | undefined {
  const cue = newTaskCue(cartridge.locale)
  const sentence = visibleProse(parsed).split(/(?<=[。！？.!?])|\n+/).map((value) => value.trim()).find((value) => cue.test(value))
  return sentence ? sentence.replace(/^[“”"']+|[“”"']+$/g, '').slice(0, 120) : undefined
}

/** Repair metadata only when the authoritative value is already known. */
export function canonicalizeTurnMetadata(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  imagePrompt?: string,
  action?: string,
): { parsed: ParsedScene; imagePrompt?: string; discardedImage: boolean } {
  const location = effectiveLocation(save, parsed)
  const sceneLocations = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')
  const imageLocations = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'image_location' }> => command.type === 'image_location')
  let commands = parsed.commands

  if (sceneLocations.length === 0) commands = [...commands, { type: 'scene_location', location }]
  else if (sceneLocations.length > 1 && sceneLocations.every((command) => clean(command.location) === clean(sceneLocations[0].location))) {
    let retained = false
    commands = commands.filter((command) => command.type !== 'scene_location' || (!retained && (retained = true)))
  }
  if (!commands.some((command) => command.type === 'state')) {
    const objective = inferredObjective(parsed, cartridge)
    if (objective) commands = [...commands, { type: 'state', value: objective }]
  }

  let safeImagePrompt = imagePrompt
  let discardedImage = false
  if (imagePrompt && imageLocations.length === 0) {
    safeImagePrompt = undefined
    discardedImage = true
  } else if (!imagePrompt && imageLocations.length) {
    commands = commands.filter((command) => command.type !== 'image_location')
  } else if (imagePrompt && imageLocations.length > 1 && imageLocations.every((command) => clean(command.location) === clean(imageLocations[0].location))) {
    let retained = false
    commands = commands.filter((command) => command.type !== 'image_location' || (!retained && (retained = true)))
  }
  const choiceIndex = commands.map((command) => command.type).lastIndexOf('choices')
  const trackableProgress = commands.some((entry) => (
    entry.type === 'widget' || entry.type === 'skill_check' || entry.type === 'state' || entry.type === 'clock'
    || entry.type === 'map_update' || entry.type === 'inventory' || entry.type === 'job'
    || entry.type === 'reputation' || entry.type === 'character_update' || entry.type === 'party_change'
    || entry.type === 'encounter' || entry.type === 'session_end'
  ))
  if (choiceIndex >= 0 && !trackableProgress) {
    const command = commands[choiceIndex]
    if (command.type === 'choices') {
      const choices = command.choices.filter((choice) => !semanticallyRepeatsCurrentAction(choice, action, cartridge.locale))
      if (choices.length !== command.choices.length) commands = commands.map((entry, index) => index === choiceIndex ? { type: 'choices' as const, choices } : entry)
    }
  }
  return { parsed: commands === parsed.commands ? parsed : { ...parsed, commands }, imagePrompt: safeImagePrompt, discardedImage }
}

function validChoices(parsed: ParsedScene): string[] {
  const command = [...parsed.commands].reverse().find((entry) => entry.type === 'choices')
  if (command?.type !== 'choices') return []
  const labels = command.choices.map((label) => label.trim()).filter((label) => label.length >= 2 && label.length <= 96)
  return labels.length >= 1 && labels.length <= 5 && new Set(labels).size === labels.length ? labels : []
}

function semanticActionCore(value: string, locale: StoryCartridge['locale']): string {
  if (locale === 'zh') return clean(value).replace(/(?:仔细|继续|进一步|再次|重新|仍然|接着|先|立即|尝试|沿着|沿|围绕)/gu, '').replace(/(?:查看|检查|观察|触摸|核对|比对|确认|调查|追查|寻找|研究|看看)/gu, '')
  const stop = new Set(['a', 'an', 'the', 'again', 'carefully', 'continue', 'further', 'keep', 'more', 'once', 'recheck', 'check', 'compare', 'confirm', 'examine', 'follow', 'inspect', 'investigate', 'look', 'review', 'study', 'touch'])
  return value.toLocaleLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).filter((word) => !stop.has(word)).join('')
}

function bigramOverlap(left: string, right: string): number {
  const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)))
  const a = grams(left); const b = grams(right)
  if (!a.size || !b.size) return 0
  let shared = 0; a.forEach((gram) => { if (b.has(gram)) shared += 1 })
  return shared / Math.min(a.size, b.size)
}

export function semanticallyRepeatsCurrentAction(label: string, action: string | undefined, locale: StoryCartridge['locale']): boolean {
  if (!action?.trim()) return false
  const candidate = semanticActionCore(label, locale); const current = semanticActionCore(action, locale)
  if (candidate.length < 4 || current.length < 4) return false
  if (candidate.includes(current) || current.includes(candidate)) return true
  return bigramOverlap(candidate, current) >= .67
}

function stalePlaceChoice(choice: string, location: string, save: StorySave): boolean {
  const destinationVerb = /(?:前往|去往|去|返回|回到|搭乘|乘坐|买票|离开|赶往|travel|go to|head to|return|ride|take .* to|leave for)/i
  const mapChanged = clean(location) !== clean(save.location)
  return save.map.some((node) => (mapChanged || !node.current)
    && clean(node.label) !== clean(location)
    && !clean(location).includes(clean(node.label))
    && clean(choice).includes(clean(node.label))
    && !destinationVerb.test(choice))
}

export function validateTurnConsistency(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  imagePrompt?: string,
  dangerDirective?: DangerDirective,
): string[] {
  const violations = new Set<string>()
  const location = effectiveLocation(save, parsed)
  const sceneLocations = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'scene_location' }> => command.type === 'scene_location')
  const imageLocations = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'image_location' }> => command.type === 'image_location')
  const mapUpdates = parsed.commands.filter((command) => command.type === 'map_update')
  const choices = validChoices(parsed)
  const prose = visibleProse(parsed)
  const encounters = parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'encounter' }> => command.type === 'encounter')

  if (sceneLocations.length !== 1) violations.add('turn.requires_one_scene_location')
  else if (clean(sceneLocations[0].location) !== clean(location)) violations.add('turn.scene_location_must_match_state')
  if (mapUpdates.length > 1) violations.add('turn.allows_one_map_update')

  if (imagePrompt) {
    if (imageLocations.length !== 1) violations.add('image.requires_one_image_location')
    else if (clean(imageLocations[0].location) !== clean(location)) violations.add('image.location_must_match_scene')
  } else if (imageLocations.length) violations.add('image.location_without_image')

  if (!parsed.commands.some((command) => command.type === 'session_end') && !choices.length) violations.add('turn.requires_actionable_choices')
  if (choices.some((choice) => stalePlaceChoice(choice, location, save))) violations.add('choices.cannot_act_in_stale_location')

  if (encounters.some((encounter) => encounter.phase !== 'resolution'
    && (!encounter.kind || !threadGrounded(encounter.kind, prose, cartridge.locale)))) {
    violations.add('turn.encounter_must_match_visible_threat')
  }
  if (save.danger.phase !== 'calm') {
    const activeThreat = save.danger.currentThreat ?? ''
    if (!encounters.length) violations.add('turn.active_threat_requires_continuation')
    else {
      const sameThread = Boolean(activeThreat) && encounters.some((encounter) => Boolean(encounter.kind)
        && threadGrounded(activeThreat, encounter.kind ?? '', cartridge.locale))
      if (!sameThread || !threadGrounded(activeThreat, prose, cartridge.locale)) violations.add('turn.active_threat_cannot_disappear')
    }
  }
  if (dangerDirective) {
    if (!dangerDirectiveEstablished(parsed, dangerDirective, cartridge.locale)) {
      violations.add('turn.scheduled_threat_requires_visible_establishment')
    }
    if (dangerDirective.phase !== 'resolution'
      && choices.length
      && choices.some((choice) => !dangerTextGrounded(dangerDirective.threat, choice, cartridge.locale))) {
      violations.add('turn.scheduled_threat_choices_must_address_threat')
    }
  }

  if (newTaskCue(cartridge.locale).test(prose) && !parsed.commands.some((command) => command.type === 'state')) violations.add('turn.new_task_requires_objective_state')

  const arrivedAtOtherKnownPlace = save.map.some((node) => !node.current
    && clean(node.label) !== clean(save.location)
    && !clean(save.location).includes(clean(node.label))
    && prose.split(/(?<=[。！？.!?])|\n+/).some((sentence) => clean(sentence).includes(clean(node.label))
      && /(?:抵达|到达|来到|走进|进入|已经在|身处|下车|arriv|reach|enter|step into|now in|get off)/i.test(sentence)))
  if (arrivedAtOtherKnownPlace && !mapUpdates.length) violations.add('turn.visible_arrival_requires_map_update')

  return [...violations]
}
