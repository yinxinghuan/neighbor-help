import { SCENE_IMAGE_PROMPT_VERSION, type CharacterDefinition, type DangerDirective, type DomainActionResolution, type ImageBlockStatus, type ParsedCommand, type ParsedScene, type SceneImageSubject, type StoryBlock, type StoryCartridge, type StoryCharacter, type StorySave } from '../types'
import { t } from '../i18n'
import { chooseSceneImage } from './imageDirector'
import { contextualDangerChoiceLabels, createInitialDangerState, normalizeDangerState, settleDangerTurn } from './dangerDirector'
import { authoredDecisionContext, choicesAreGrounded, createTransitionBlock } from './continuity'
import { applyDomainResolution, domainAllowsModelCommand, syncDomainDerivedState } from './domainRules'
import { decodeChoiceRecord, encodeChoiceRecord } from './choiceInput'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function createInitialSave(cartridge: StoryCartridge, remoteChatId?: string): StorySave {
  const initialPartyMemberIds = cartridge.initialPartyMemberIds ?? cartridge.characters.filter((character) => character.initialStatus === 'companion').map((character) => character.id)
  const initial: StorySave = {
    version: 10, cartridgeId: cartridge.id, locale: cartridge.locale, remoteChatId, entered: false, scene: 0,
    location: cartridge.opening.location, time: cartridge.opening.time, objective: cartridge.opening.objective,
    decisionContext: '',
    stats: Object.fromEntries(cartridge.statDefinitions.map((stat) => [stat.id, stat.initial])),
    facts: { ...(cartridge.initialFacts ?? {}) },
    blocks: [...cartridge.opening.blocks, createImageBlock('image-0', cartridge.opening.location, cartridge.opening.imagePrompt, 'idle'), createChoiceRecordBlock(0, cartridge.opening.choices)],
    choices: cartridge.opening.choices, map: cartridge.initialMap.map((node) => ({ ...node, visited: node.visited ?? Boolean(node.current), facts: node.facts ? [...node.facts] : undefined })),
    inventory: cartridge.initialInventory.map((item) => ({ ...item, metrics: item.metrics?.map((metric) => ({ ...metric })), imageStatus: item.imageUrl ? 'ready' : 'idle' })),
    characters: cartridge.characters.filter((character) => !character.hiddenUntilIntroduced).map((character) => {
      const state = characterFromDefinition(character)
      if (initialPartyMemberIds.includes(state.id)) state.status = 'companion'
      return state
    }),
    partyMemberIds: initialPartyMemberIds,
    relationships: [], jobs: [],
    danger: createInitialDangerState(),
    sessionEnded: false,
  }
  return syncDomainDerivedState(initial, cartridge)
}

type CharacterCommand = Extract<ParsedCommand, { type: 'character_update' | 'party_change' }>

function characterFromDefinition(character: CharacterDefinition): StoryCharacter {
  return {
    ...character,
    skills: character.skills.map((skill) => ({ ...skill })),
    status: character.initialStatus ?? 'known', origin: 'cartridge', updatedAtScene: 0,
  }
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s·•._-]+/g, '')
}

function resolveCharacter(save: StorySave, command: CharacterCommand, index: number, cartridge: StoryCartridge): StoryCharacter {
  const byId = command.characterId ? save.characters.find((character) => character.id === command.characterId) : undefined
  const byName = save.characters.find((character) => normalizedName(character.name) === normalizedName(command.character))
  const existing = byId ?? byName
  if (existing) {
    if (byId) existing.name = command.character
    existing.role = command.role ?? existing.role
    existing.detail = command.detail ?? existing.detail
    existing.lore = command.lore ?? existing.lore
    existing.vitality = command.vitality == null ? existing.vitality : clamp(command.vitality, 0, 100)
    existing.stress = command.stress == null ? existing.stress : clamp(command.stress, 0, 100)
    existing.skills = command.skills?.map((skill) => ({ ...skill })) ?? existing.skills
    existing.lastKnownLocation = save.location
    existing.updatedAtScene = save.scene
    return existing
  }
  const definition = command.characterId ? cartridge.characters.find((character) => character.id === command.characterId) : undefined
  const created: StoryCharacter = {
    ...definition,
    id: command.characterId ?? `npc-${save.scene}-${index}`,
    name: command.character || definition?.name || command.characterId || `NPC ${index + 1}`,
    role: command.role ?? definition?.role ?? t(cartridge.locale, command.type === 'party_change' && command.change === 'add' ? 'companion' : 'knownPerson'),
    vitality: clamp(command.vitality ?? definition?.vitality ?? 100, 0, 100),
    stress: clamp(command.stress ?? definition?.stress ?? 0, 0, 100),
    skills: command.skills?.map((skill) => ({ ...skill })) ?? definition?.skills.map((skill) => ({ ...skill })) ?? [],
    detail: command.detail ?? definition?.detail,
    lore: command.lore ?? definition?.lore,
    status: 'known', origin: definition ? 'cartridge' : 'generated', lastKnownLocation: save.location, updatedAtScene: save.scene,
  }
  save.characters.push(created)
  return created
}

function hasVisibleDeparture(parsed: ParsedScene, characterName: string): boolean {
  const visible = parsed.blocks.map((block) => `${block.speaker ?? ''} ${block.text}`).join('\n')
  if (!visible.includes(characterName)) return false
  return /离开|离队|分开|告别|留下|失踪|死亡|独自前往|leave|depart|separat|farewell|stay behind|missing|died|dead|goes alone/i.test(visible)
}

type LegacyCharacterState = Pick<StorySave, 'blocks' | 'relationships'> & Partial<Pick<StorySave, 'characters' | 'partyMemberIds'>>

export function normalizeCharacterState(candidate: LegacyCharacterState, cartridge: StoryCartridge): Pick<StorySave, 'characters' | 'partyMemberIds' | 'relationships'> {
  const staticById = new Map(cartridge.characters.map((character) => [character.id, character]))
  const inputCharacters = Array.isArray(candidate.characters) ? candidate.characters : []
  const hasVisibleIntroduction = (character: StoryCharacter): boolean => candidate.blocks.some((block) => block.kind !== 'image' && block.kind !== 'choices' && `${block.speaker ?? ''} ${block.text}`.includes(character.name))
  const characters: StoryCharacter[] = inputCharacters.filter((character) => {
    const definition = staticById.get(character.id)
    if (!definition?.hiddenUntilIntroduced) return true
    if (character.status === 'companion' || character.status === 'departed') return true
    if ((character.updatedAtScene ?? 0) > 0) return true
    if (candidate.relationships.some((event) => event.characterId === character.id || event.actor === character.name)) return true
    return hasVisibleIntroduction(character)
  }).map((character) => {
    const definition = staticById.get(character.id)
    return {
      ...definition, ...character,
      name: character.name || definition?.name || character.id,
      role: character.role || definition?.role || t(cartridge.locale, 'knownPerson'),
      vitality: clamp(Number.isFinite(character.vitality) ? character.vitality : definition?.vitality ?? 100, 0, 100),
      stress: clamp(Number.isFinite(character.stress) ? character.stress : definition?.stress ?? 0, 0, 100),
      skills: (character.skills ?? definition?.skills ?? []).map((skill) => ({ ...skill })),
      status: character.status === 'companion' || character.status === 'departed' ? character.status : 'known',
      origin: character.origin === 'generated' ? 'generated' : 'cartridge',
      updatedAtScene: Number.isFinite(character.updatedAtScene) ? character.updatedAtScene : 0,
    }
  })
  cartridge.characters.forEach((definition) => {
    if (!definition.hiddenUntilIntroduced && !characters.some((character) => character.id === definition.id)) characters.push(characterFromDefinition(definition))
  })
  const findOrCreate = (name: string, id?: string): StoryCharacter => {
    const found = (id ? characters.find((character) => character.id === id) : undefined)
      ?? characters.find((character) => normalizedName(character.name) === normalizedName(name))
    if (found) return found
    const created: StoryCharacter = {
      id: id && !characters.some((character) => character.id === id) ? id : `legacy-npc-${characters.length + 1}`,
      name, role: t(cartridge.locale, 'knownPerson'), vitality: 100, stress: 0, skills: [],
      status: 'known', origin: 'generated', updatedAtScene: 0,
    }
    characters.push(created)
    return created
  }
  const explicitParty = new Set(Array.isArray(candidate.partyMemberIds) ? candidate.partyMemberIds.filter((id) => characters.some((character) => character.id === id)) : [])
  if (!candidate.partyMemberIds) {
    const initialPartyIds = cartridge.initialPartyMemberIds ?? cartridge.characters.filter((character) => character.initialStatus === 'companion').map((character) => character.id)
    initialPartyIds.forEach((id) => explicitParty.add(id))
    characters.filter((character) => character.status === 'companion').forEach((character) => explicitParty.add(character.id))
    candidate.blocks.forEach((block) => {
      if (block.kind !== 'event' || !block.id.startsWith('effect-')) return
      const encodedChange = block.data?.partyChange
      const encodedId = typeof block.data?.characterId === 'string' ? block.data.characterId : undefined
      let name = block.text.trim()
      let change: 'add' | 'remove' | undefined = encodedChange === 'add' || encodedChange === 'remove' ? encodedChange : undefined
      const suffixes: Array<[string, 'add' | 'remove']> = [
        ['加入了同行者', 'add'], ['离开了同行者', 'remove'], [' joined the party', 'add'], [' left the party', 'remove'],
      ]
      if (!change) {
        const suffix = suffixes.find(([text]) => name.endsWith(text))
        if (!suffix) return
        name = name.slice(0, -suffix[0].length).trim()
        change = suffix[1]
      } else {
        const suffix = suffixes.find(([text]) => name.endsWith(text))
        if (suffix) name = name.slice(0, -suffix[0].length).trim()
      }
      if (!name && !encodedId) return
      const character = findOrCreate(name || encodedId!, encodedId)
      if (change === 'add') {
        explicitParty.add(character.id)
        character.status = 'companion'
      } else {
        explicitParty.delete(character.id)
        character.status = 'departed'
      }
    })
  }
  const relationships = (candidate.relationships ?? []).map((event) => {
    const character = event.characterId ? characters.find((entry) => entry.id === event.characterId) : findOrCreate(event.actor)
    return { ...event, characterId: character?.id }
  })
  characters.forEach((character) => {
    if (explicitParty.has(character.id)) character.status = 'companion'
    else if (character.status === 'companion') character.status = 'known'
  })
  return { characters, partyMemberIds: [...explicitParty], relationships }
}

export function createImageBlock(id: string, location: string, prompt: string, status: ImageBlockStatus, url = '', metadata?: Record<string, string>): StoryBlock {
  return { id, kind: 'image', text: location, data: { prompt, status, url, ...metadata } }
}

export function createChoiceRecordBlock(scene: number, choices: StorySave['choices']): StoryBlock {
  return { id: `choices-${scene}`, kind: 'choices', text: encodeChoiceRecord(choices) }
}

export function updateImageBlock(save: StorySave, blockId: string, patch: { status?: ImageBlockStatus; url?: string }): StorySave {
  return {
    ...save,
    blocks: save.blocks.map((block) => block.id === blockId && block.kind === 'image'
      ? { ...block, data: { ...block.data, ...patch } }
      : block),
  }
}

export function updateInventoryItemImage(save: StorySave, itemId: string, patch: { status?: ImageBlockStatus; url?: string; styleVersion?: number }): StorySave {
  return {
    ...save,
    inventory: save.inventory.map((item) => item.id === itemId
      ? {
        ...item,
        imageStatus: patch.status ?? item.imageStatus,
        imageUrl: patch.url ?? item.imageUrl,
        imageStyleVersion: patch.styleVersion ?? item.imageStyleVersion,
      }
      : item),
  }
}

export function localizeKnownState(save: StorySave, from: StoryCartridge, to: StoryCartridge): StorySave {
  if (from.locale === to.locale) return save
  const sourceNodeByLabel = new Map(from.initialMap.map((node) => [node.label, node.id]))
  const targetNodeById = new Map(to.initialMap.map((node) => [node.id, node]))
  const map = save.map.map((node) => {
    const target = targetNodeById.get(node.id)
    const connectedId = node.connectedTo ? sourceNodeByLabel.get(node.connectedTo) : undefined
    return target ? {
      ...node, label: target.label, connectedTo: connectedId ? targetNodeById.get(connectedId)?.label : node.connectedTo,
      detail: target.detail ?? node.detail, lore: target.lore ?? node.lore, facts: target.facts ?? node.facts,
    } : node
  })
  const locationId = sourceNodeByLabel.get(save.location)
  const openingLocation = save.location === from.opening.location ? to.opening.location : undefined
  const inventoryById = new Map(to.initialInventory.map((item) => [item.id, item]))
  const charactersById = new Map(to.characters.map((character) => [character.id, character]))
  return {
    ...save,
    locale: to.locale,
    location: openingLocation ?? (locationId ? targetNodeById.get(locationId)?.label ?? save.location : save.location),
    time: save.time === from.opening.time ? to.opening.time : save.time,
    objective: save.objective === from.opening.objective ? to.opening.objective : save.objective,
    map,
    inventory: save.inventory.map((item) => {
      const target = inventoryById.get(item.id)
      return target ? {
        ...item, label: target.label, detail: target.detail ?? item.detail, effect: target.effect ?? item.effect,
        lore: target.lore ?? item.lore, metrics: target.metrics ?? item.metrics, imagePrompt: target.imagePrompt ?? item.imagePrompt,
      } : item
    }),
    characters: save.characters.map((character) => {
      const target = charactersById.get(character.id)
      return target ? { ...character, name: target.name, role: target.role, detail: target.detail ?? character.detail, lore: target.lore ?? character.lore, skills: target.skills.map((skill) => ({ ...skill })) } : character
    }),
  }
}

function changeBlock(id: string, text: string, data?: Record<string, string | number>): StoryBlock {
  return { id, kind: 'change', text, data }
}

function shortChoiceContext(value: string, maxLength: number): string {
  const clean = value.replace(/[\n\r\t]+/g, ' ').replace(/[“”"']/g, '').trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trim()}…` : clean
}

export function createRecoveryChoices(
  save: Pick<StorySave, 'scene' | 'location' | 'objective' | 'partyMemberIds'> & Partial<Pick<StorySave, 'danger'>>,
  cartridge: StoryCartridge,
): StorySave['choices'] {
  const location = shortChoiceContext(save.location, cartridge.locale === 'zh' ? 14 : 24)
  const objective = shortChoiceContext(save.objective, cartridge.locale === 'zh' ? 18 : 32)
  const hasParty = save.partyMemberIds.length > 0
  const activeThreat = save.danger && save.danger.phase !== 'calm'
  const labels = activeThreat && cartridge.dangerDirector
    ? contextualDangerChoiceLabels(save.danger?.currentThreat, cartridge.dangerDirector.methods, cartridge.locale)
    : cartridge.locale === 'zh'
    ? [
        `观察${location || '周围'}的新变化`,
        objective ? `追查“${objective}”的线索` : '检查与刚才行动有关的线索',
        hasParty ? '和同行者商量下一步' : '换一种方式处理当前局面',
      ]
    : [
        `Observe what changed around ${location || 'this place'}`,
        objective ? `Trace a clue about “${objective}”` : 'Inspect clues connected to the last action',
        hasParty ? 'Discuss the next move with your companions' : 'Try another approach to the current situation',
      ]
  return labels.map((label, index) => ({ id: `recovery-${save.scene}-${index}`, label }))
}

function createActionRecoveryChoices(
  save: Pick<StorySave, 'scene' | 'location'>,
  cartridge: StoryCartridge,
): StorySave['choices'] {
  const location = shortChoiceContext(save.location, cartridge.locale === 'zh' ? 14 : 24)
  const labels = cartridge.locale === 'zh'
    ? [
        `查看${location || '原地'}现在能做的事`,
        '放弃原计划，改走别的路',
      ]
    : [
        `See what is actually possible at ${location || 'the current place'}`,
        'Set the original plan aside and take another route',
      ]
  return labels.map((label, index) => ({ id: `recovery-${save.scene}-${index}`, label }))
}

export function shouldRestoreGenericChoices(save: Pick<StorySave, 'sessionEnded' | 'choices' | 'facts'>): boolean {
  return !save.sessionEnded && save.choices.length === 0 && !save.facts.consistency_quarantined_action
}

function isSyntheticConsistencyAction(value: string): boolean {
  return /^(?:查看.+现在能做的事|放弃原计划，改走别的路|See what is actually possible at .+|Set the original plan aside and take another route)$/i.test(value.trim())
}

function quarantinedSiblingChoices(
  choices: StorySave['choices'], failedAction: string, objective: string, scene: number,
): StorySave['choices'] {
  const failed = failedAction.trim()
  const target = objective.trim()
  return choices
    .filter((choice) => choice.label.trim() !== failed)
    .filter((choice) => !target || choice.label.trim() !== target)
    .filter((choice) => !isSyntheticConsistencyAction(choice.label))
    .filter((choice, index, all) => all.findIndex((entry) => entry.label.trim() === choice.label.trim()) === index)
    .slice(0, 5)
    .map((choice, index) => ({ ...choice, id: `quarantine-${scene}-${index}` }))
}

function latestChoiceRecordBefore(save: Pick<StorySave, 'blocks'>, scene: number): StorySave['choices'] {
  const record = [...save.blocks].reverse().find((block) => {
    if (block.kind !== 'choices') return false
    const match = block.id.match(/^choices-(\d+)$/)
    return Boolean(match && Number(match[1]) < scene)
  })
  return record?.kind === 'choices'
    ? decodeChoiceRecord(record.text).map((label, index) => ({ id: `legacy-sibling-${scene}-${index}`, label }))
    : []
}

function consistencyActions(save: Pick<StorySave, 'blocks'>): Map<number, string> {
  const actions = new Map<number, string>()
  save.blocks.forEach((block) => {
    const match = block.kind === 'event' ? block.id.match(/^action-(\d+)$/) : undefined
    if (match) actions.set(Number(match[1]), block.text.trim())
  })
  return actions
}

function rootConsistencyAction(save: Pick<StorySave, 'scene' | 'blocks' | 'lastActionId'>, actionId?: string): string {
  const actions = consistencyActions(save)
  let action = actionId?.trim() || actions.get(save.scene) || save.lastActionId?.trim() || ''
  if (!isSyntheticConsistencyAction(action)) return action
  for (let scene = save.scene; scene >= 0; scene -= 1) {
    if (!save.blocks.some((block) => block.id === `consistency-recovery-${scene}`)) continue
    const previous = actions.get(scene)
    if (previous && !isSyntheticConsistencyAction(previous)) return previous
  }
  return action
}

export function resolveConsistencyRecoverySelection(
  save: Pick<StorySave, 'scene' | 'blocks' | 'choices' | 'lastActionId'>,
  action: string,
): { mode: 'confirm' | 'pause'; originalAction: string } | undefined {
  if (!save.blocks.some((block) => block.id === `consistency-recovery-${save.scene}`)) return undefined
  const index = save.choices.findIndex((choice) => choice.id.startsWith(`recovery-${save.scene}-`) && choice.label === action)
  if (index !== 0 && index !== 1) return undefined
  return { mode: index === 0 ? 'confirm' : 'pause', originalAction: rootConsistencyAction(save) }
}

export function applyConsistencyRecoverySelection(
  save: StorySave,
  cartridge: StoryCartridge,
  selectedAction: string,
  selection: { mode: 'confirm' | 'pause'; originalAction: string },
): StorySave {
  const scene = save.scene + 1
  const previous = latestChoiceRecordBefore(save, save.scene)
  const choices = save.danger.phase !== 'calm' && cartridge.dangerDirector
    ? contextualDangerChoiceLabels(save.danger.currentThreat, cartridge.dangerDirector.methods, cartridge.locale)
      .map((label, index) => ({ id: `danger-recovery-${scene}-${index}`, label }))
    : quarantinedSiblingChoices(previous, selection.originalAction, save.objective, scene)
  return {
    ...save,
    scene,
    locale: cartridge.locale,
    lastActionId: selectedAction,
    sessionEnded: false,
    decisionContext: '',
    choices,
    blocks: [
      ...save.blocks,
      { id: `action-${scene}`, kind: 'event', text: selectedAction },
      {
        id: `consistency-recovery-exit-${scene}`,
        kind: 'narration',
        text: cartridge.locale === 'zh'
          ? selection.mode === 'confirm'
            ? `你先停下来核对“${selection.originalAction || selectedAction}”真正需要的条件，眼前仍有效的行动已经重新列出。`
            : `你没有继续重复“${selection.originalAction || selectedAction}”，而是保留现状，重新查看还能安全进行的行动。`
          : selection.mode === 'confirm'
            ? `You pause to verify what “${selection.originalAction || selectedAction}” actually requires. The actions that remain valid are listed again.`
            : `You do not repeat “${selection.originalAction || selectedAction}”. The current state remains intact while valid actions are listed again.`,
        data: { consistencyRecoveryExit: selection.mode },
      },
      createChoiceRecordBlock(scene, choices),
    ],
  }
}

export function applyConsistencyRecovery(save: StorySave, cartridge: StoryCartridge, actionId: string): StorySave {
  const scene = save.scene + 1
  const originalAction = rootConsistencyAction(save, actionId)
  const choices = save.danger.phase !== 'calm' && cartridge.dangerDirector
    ? contextualDangerChoiceLabels(save.danger.currentThreat, cartridge.dangerDirector.methods, cartridge.locale)
      .map((label, index) => ({ id: `danger-recovery-${scene}-${index}`, label }))
    : quarantinedSiblingChoices(save.choices, originalAction, save.objective, scene)
  return {
    ...save,
    scene,
    locale: cartridge.locale,
    lastActionId: originalAction,
    sessionEnded: false,
    decisionContext: '',
    facts: {
      ...save.facts,
      consistency_quarantined_action: originalAction,
      consistency_quarantined_location: save.location,
      'consistency-quarantine-v2': true,
    },
    choices,
    blocks: [
      ...save.blocks,
      { id: `action-${scene}`, kind: 'event', text: originalAction },
      { id: `consistency-recovery-${scene}`, kind: 'narration', text: t(cartridge.locale, 'consistencyRecovery', { name: save.location, action: originalAction }), data: { consistencyQuarantine: 'true' } },
      createChoiceRecordBlock(scene, choices),
    ],
  }
}

export function repairLegacyConsistencyRecovery<T extends {
  scene: number
  location: string
  objective: string
  partyMemberIds?: StorySave['partyMemberIds']
  blocks: StorySave['blocks']
  choices: StorySave['choices']
  lastActionId?: string
  facts?: StorySave['facts']
}>(candidate: T, cartridge: StoryCartridge): T {
  if (candidate.facts?.['consistency-quarantine-v2'] === true) return candidate
  const actions = new Map<number, string>()
  const recoveryScenes = new Set<number>()
  const recoveryLocations = new Map<number, string>()
  for (const block of candidate.blocks) {
    const actionScene = block.kind === 'event' ? block.id.match(/^action-(\d+)$/) : undefined
    if (actionScene) actions.set(Number(actionScene[1]), block.text)
    const recoveryScene = block.kind === 'narration' ? block.id.match(/^consistency-recovery-(\d+)$/) : undefined
    if (recoveryScene) {
      const scene = Number(recoveryScene[1])
      recoveryScenes.add(scene)
      const location = block.text.match(/。([^。]+)的一切仍在继续。?$/)?.[1]
        ?? block.text.match(/Life at (.+?) continues around you\.?$/i)?.[1]
      if (location) recoveryLocations.set(scene, location)
    }
  }
  if (candidate.lastActionId?.trim() && !actions.has(candidate.scene)) actions.set(candidate.scene, candidate.lastActionId.trim())
  if (!recoveryScenes.size) return candidate

  const actionChoices = (scene: number, _action: string) => createActionRecoveryChoices({
    scene, location: recoveryLocations.get(scene) ?? candidate.location,
  }, cartridge)
  const currentAction = actions.get(candidate.scene)
  const currentLocation = recoveryLocations.get(candidate.scene) ?? candidate.location
  const currentExpected = currentAction ? t(cartridge.locale, 'consistencyRecovery', { name: currentLocation, action: currentAction }) : ''
  const currentRecovery = candidate.blocks.find((block) => block.id === `consistency-recovery-${candidate.scene}` && block.kind === 'narration')
  const currentWasLegacy = Boolean(currentAction && currentRecovery && (
    currentRecovery.text !== currentExpected || candidate.choices[0]?.label !== actionChoices(candidate.scene, currentAction)[0]?.label
  ))
  let changed = false
  const blocks = candidate.blocks.map((block) => {
    const recoveryMatch = block.kind === 'narration' ? block.id.match(/^consistency-recovery-(\d+)$/) : undefined
    if (recoveryMatch) {
      const action = actions.get(Number(recoveryMatch[1]))
      if (!action) return block
      const text = t(cartridge.locale, 'consistencyRecovery', { name: recoveryLocations.get(Number(recoveryMatch[1])) ?? candidate.location, action })
      if (block.text === text) return block
      changed = true
      return { ...block, text }
    }
    const choicesMatch = block.kind === 'choices' ? block.id.match(/^choices-(\d+)$/) : undefined
    if (choicesMatch && recoveryScenes.has(Number(choicesMatch[1]))) {
      const scene = Number(choicesMatch[1])
      const action = actions.get(scene)
      if (!action) return block
      const text = encodeChoiceRecord(actionChoices(scene, action))
      if (block.text === text) return block
      changed = true
      return { ...block, text }
    }
    return block
  })

  let choices = candidate.choices
  if (currentAction && recoveryScenes.has(candidate.scene) && candidate.choices.every((choice) => choice.id.startsWith(`recovery-${candidate.scene}-`))) {
    const aligned = actionChoices(candidate.scene, currentAction)
    if (candidate.choices.some((choice, index) => choice.label !== aligned[index]?.label)) changed = true
    choices = aligned
  }
  const eventTexts = new Set(candidate.blocks.filter((block) => block.kind === 'event' && block.id.startsWith('action-')).map((block) => block.text.trim()))
  const objective = currentWasLegacy && currentAction && eventTexts.has(candidate.objective.trim()) ? currentAction : candidate.objective
  if (objective !== candidate.objective) changed = true
  const aligned = changed ? { ...candidate, objective, choices, blocks } : candidate
  if (!recoveryScenes.has(aligned.scene) || !currentAction) return aligned
  const previous = latestChoiceRecordBefore(aligned as unknown as Pick<StorySave, 'blocks'>, aligned.scene)
  const quarantined = quarantinedSiblingChoices(previous, currentAction, objective, aligned.scene)
  const recordId = `choices-${aligned.scene}`
  const migratedBlocks = aligned.blocks.map((block) => {
    if (block.id === `consistency-recovery-${aligned.scene}` && block.kind === 'narration') {
      return { ...block, text: t(cartridge.locale, 'consistencyRecovery', { name: currentLocation, action: currentAction }), data: { consistencyQuarantine: 'true' } }
    }
    if (block.id === recordId && block.kind === 'choices') return { ...block, text: encodeChoiceRecord(quarantined) }
    return block
  })
  return {
    ...aligned,
    choices: quarantined,
    blocks: migratedBlocks,
    facts: {
      ...(aligned.facts ?? {}),
      consistency_quarantined_action: currentAction,
      consistency_quarantined_location: currentLocation,
      'consistency-quarantine-v2': true,
    },
  } as T
}

function validChoiceLabels(labels: string[]): string[] {
  const clean = labels.map((label) => label.trim()).filter((label) => label.length >= 2 && label.length <= 96)
  return clean.length >= 1 && clean.length <= 5 && new Set(clean).size === clean.length ? clean : []
}

function cleanInferredItemLabel(value: string): string {
  return value
    .replace(/^[\s“”"「」『』]+|[\s“”"「」『』]+$/g, '')
    .replace(/^(?:一|1)\s*(?:个|件|把|枚|份|瓶|块|张|卷|只)\s*/, '')
    .replace(/^(?:the|an?)\s+/i, '')
    .trim()
}

function inferInventoryCommands(parsed: ParsedScene, cartridge: StoryCartridge): Extract<ParsedCommand, { type: 'inventory' }>[] {
  const narration = parsed.blocks.filter((block) => block.kind === 'narration').map((block) => block.text).join('\n')
  if (!narration) return []
  const explicit = new Set(parsed.commands.filter((command): command is Extract<ParsedCommand, { type: 'inventory' }> => command.type === 'inventory').map((command) => `${command.action}:${cleanInferredItemLabel(command.item).toLocaleLowerCase()}`))
  const patterns = cartridge.locale === 'zh'
    ? [
        { action: 'add' as const, expression: /你[^。！!？?\n]{0,28}?(?:获得了|得到了|收下了|捡起了?|拾起了?|取走了?|买下了?)([^，,。；;！!？?\n]{1,36})/g },
        { action: 'add' as const, expression: /你把([^，,。；;！!？?\n]{1,36}?)放(?:进|入)了?(?:行囊|背包)/g },
        { action: 'remove' as const, expression: /你[^。！!？?\n]{0,28}?(?:失去了|交出了|丢弃了|用掉了|消耗了)([^，,。；;！!？?\n]{1,36})/g },
      ]
    : [
        { action: 'add' as const, expression: /\byou [^.!?\n]{0,48}?\b(?:obtained|received|picked up|took|bought|kept)\s+([^.,;!?\n]{1,48})/gi },
        { action: 'add' as const, expression: /\byou put\s+([^.,;!?\n]{1,48}?)\s+in(?:to)? (?:your )?(?:pack|bag|inventory)\b/gi },
        { action: 'remove' as const, expression: /\byou [^.!?\n]{0,48}?\b(?:lost|gave away|discarded|consumed|used up)\s+([^.,;!?\n]{1,48})/gi },
      ]
  const inferred: Extract<ParsedCommand, { type: 'inventory' }>[] = []
  const seen = new Set<string>()
  patterns.forEach(({ action, expression }) => {
    let match: RegExpExecArray | null
    while ((match = expression.exec(narration))) {
      if (/(?:可以|能够|也许|或许|打算|准备|\bcan\b|\bcould\b|\bmay\b|\bmight\b|\bplan(?:ned)? to\b)/i.test(match[0])) continue
      const item = cleanInferredItemLabel(match[1])
      const key = `${action}:${item.toLocaleLowerCase()}`
      if (item.length < 2 || seen.has(key) || explicit.has(key)) continue
      seen.add(key)
      inferred.push({ type: 'inventory', action, item, count: 1 })
    }
  })
  return inferred.slice(0, 3)
}

export function applyParsedScene(
  save: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  actionId: string,
  imagePrompt?: string,
  imageSubject?: SceneImageSubject,
  dangerDirective?: DangerDirective,
  domainResolution?: DomainActionResolution,
): StorySave {
  const commandDestination = parsed.commands.find((command) => command.type === 'map_update')
  const domainMap = domainResolution?.status === 'accepted' ? domainResolution.effects.find((effect) => effect.type === 'map') : undefined
  const domainDestination = domainMap?.type === 'map'
    ? (save.map.find((node) => node.id === domainMap.nodeId)?.label ?? cartridge.initialMap.find((node) => node.id === domainMap.nodeId)?.label)
    : undefined
  const transition = createTransitionBlock(save, commandDestination?.type === 'map_update' ? commandDestination.location : domainDestination, cartridge)
  const next: StorySave = {
    ...save, locale: cartridge.locale, scene: save.scene + 1,
    blocks: [...save.blocks, { id: `action-${save.scene + 1}`, kind: 'event', text: actionId }, ...(transition ? [transition] : []), ...parsed.blocks],
    choices: [], relationships: [...save.relationships], jobs: save.jobs.map((job) => ({ ...job })),
    map: save.map.map((node) => ({ ...node })), inventory: save.inventory.map((item) => ({ ...item })),
    characters: save.characters.map((character) => ({ ...character, skills: character.skills.map((skill) => ({ ...skill })) })),
    partyMemberIds: [...save.partyMemberIds],
    stats: { ...save.stats },
    facts: { ...save.facts },
    danger: normalizeDangerState(save.danger),
    decisionContext: '', sessionEnded: false, lastActionId: actionId,
  }
  const visibleTurnText = parsed.blocks
    .filter((block) => block.kind === 'narration' || block.kind === 'dialogue')
    .map((block) => block.text.trim()).filter(Boolean).join(' ')
  const effects: StoryBlock[] = []
  let dangerCheckAdded = false
  const adjudicatedParsed: ParsedScene = domainResolution ? { ...parsed, commands: [] } : parsed

  const commands = [...parsed.commands, ...inferInventoryCommands(parsed, cartridge)]
    .filter((command) => domainAllowsModelCommand(command, domainResolution))
  const hasJobSettlement = commands.some((command) => command.type === 'job' && command.action === 'settle')
  commands.forEach((command, index) => {
    const effectId = `effect-${next.scene}-${index}`
    if (command.type === 'choices') {
      const labels = validChoiceLabels(command.choices)
      // Ignore malformed late tags instead of letting them erase an earlier
      // valid choice set recovered from prose.
      if (labels.length) next.choices = labels.map((label, choiceIndex) => ({ id: `${next.scene}-${choiceIndex}`, label }))
    }
    if (command.type === 'situation') next.decisionContext = authoredDecisionContext(command.text, visibleTurnText, cartridge.locale)
    if (command.type === 'widget') {
      const definition = cartridge.statDefinitions.find((stat) => stat.id === command.id)
      if (!definition) return
      if (command.id === 'coin' && command.operation === 'add' && hasJobSettlement) return
      const current = next.stats[command.id] ?? definition.initial
      const raw = Number(command.value)
      const requested = command.operation === 'add' ? current + raw : command.operation === 'remove' ? current - raw : raw
      const maxDelta = definition.maxDelta == null ? Number.POSITIVE_INFINITY : Math.max(0, definition.maxDelta)
      const boundedDelta = clamp(requested - current, -maxDelta, maxDelta)
      next.stats[command.id] = clamp(current + boundedDelta, definition.min, definition.max)
      const delta = next.stats[command.id] - current
      effects.push(changeBlock(effectId, `${definition.label} ${delta > 0 ? '+' : ''}${delta}`, { stat: command.id, delta }))
    }
    if (command.type === 'skill_check') {
      const fixed = dangerDirective?.phase === 'resolution' && dangerDirective.check ? dangerDirective.check : undefined
      const check = fixed ?? command
      const succeeded = fixed ? fixed.outcome === 'critical-success' || fixed.outcome === 'success' || fixed.outcome === 'costly-success' : command.result === 'success'
      effects.push({ id: effectId, kind: 'check', text: `${check.skill} · ${succeeded ? t(cartridge.locale, 'checkSuccess') : t(cartridge.locale, 'checkFailure')}`, data: { dc: check.dc, roll: check.roll, modifier: check.modifier, total: check.total, outcome: fixed?.outcome ?? command.result } })
      dangerCheckAdded = Boolean(fixed)
    }
    if (command.type === 'state' && command.value) next.objective = command.value
    if (command.type === 'clock' && command.value) next.time = command.value
    if (command.type === 'map_update') {
      next.map.forEach((node) => { node.current = false })
      const existing = next.map.find((node) => node.label === command.location || node.id === command.location)
      if (existing) {
        existing.current = true
        existing.visited = true
        if (command.connectedTo) existing.connectedTo = command.connectedTo
        if (command.detail) existing.detail = command.detail
        if (command.lore) existing.lore = command.lore
        if (command.facts) existing.facts = command.facts
      } else next.map.push({
        id: `map-${next.scene}-${index}`, label: command.location, connectedTo: command.connectedTo, current: true, visited: true,
        detail: command.detail, lore: command.lore, facts: command.facts,
      })
      next.location = command.location
      effects.push({ id: effectId, kind: 'event', text: t(cartridge.locale, 'arrived', { name: command.location }) })
    }
    if (command.type === 'inventory') {
      const existing = next.inventory.find((item) => item.label === command.item || item.id === command.item)
      let changed = false
      if (existing) {
        const before = existing.count
        existing.count = Math.max(0, existing.count + (command.action === 'add' ? command.count : -command.count))
        changed = existing.count !== before
        if (command.rarity) existing.rarity = command.rarity
        if (command.detail) existing.detail = command.detail
        if (command.effect) existing.effect = command.effect
        if (command.lore) existing.lore = command.lore
        if (command.metrics) existing.metrics = command.metrics
        if (command.imagePrompt) existing.imagePrompt = command.imagePrompt
      } else if (command.action === 'add') {
        next.inventory.push({
          id: `item-${next.scene}-${index}`, label: command.item, count: command.count, rarity: command.rarity,
          detail: command.detail, effect: command.effect, lore: command.lore, metrics: command.metrics, imagePrompt: command.imagePrompt,
          imageStatus: 'idle',
        })
        changed = true
      }
      next.inventory = next.inventory.filter((item) => item.count > 0)
      if (changed) effects.push(changeBlock(effectId, `${command.action === 'add' ? t(cartridge.locale, 'gained') : t(cartridge.locale, 'lost')} ${command.item} ×${command.count}`, command.rarity ? { rarity: command.rarity } : undefined))
    }
    if (command.type === 'job') {
      const existing = next.jobs.find((job) => job.id === command.id)
      if (command.action === 'offer') {
        if (!command.wage || !command.label || existing) return
        next.jobs.push({ id: command.id, label: command.label, employer: command.employer, wage: command.wage, status: 'offered', offeredAtScene: next.scene })
      }
      if (command.action === 'accept' && existing && existing.status === 'offered') existing.status = 'accepted'
      if (command.action === 'cancel' && existing && existing.status !== 'settled') existing.status = 'cancelled'
      const payable = command.action === 'settle' ? next.jobs.find((job) => job.id === command.id) : undefined
      if (payable && (payable.status === 'offered' || payable.status === 'accepted')) {
        const definition = cartridge.statDefinitions.find((stat) => stat.id === 'coin')
        if (!definition) return
        const before = next.stats.coin ?? definition.initial
        const wage = Math.min(payable.wage, definition.maxDelta ?? payable.wage)
        next.stats.coin = clamp(before + wage, definition.min, definition.max)
        const delta = next.stats.coin - before
        payable.status = 'settled'
        payable.settledAtScene = next.scene
        next.facts.jobs_completed = Number(next.facts.jobs_completed ?? 0) + 1
        if (delta) effects.push(changeBlock(effectId, `${definition.label} +${delta}`, { stat: 'coin', delta, jobId: payable.id }))
      }
      next.jobs = next.jobs.slice(-40)
    }
    if (command.type === 'reputation') {
      const delta = /betray|hostile|distrust|拒绝|背叛/i.test(command.action) ? -1 : 1
      const character = resolveCharacter(next, { type: 'character_update', character: command.npc }, index, cartridge)
      next.relationships.push({ id: effectId, actor: character.name, characterId: character.id, axis: command.action, delta, source: actionId })
      effects.push(changeBlock(effectId, `${command.npc} · ${delta > 0 ? t(cartridge.locale, 'warmer') : t(cartridge.locale, 'colder')}`, { delta }))
    }
    if (command.type === 'character_update') resolveCharacter(next, command, index, cartridge)
    if (command.type === 'party_change') {
      const character = resolveCharacter(next, command, index, cartridge)
      if (command.change === 'add') {
        if (!next.partyMemberIds.includes(character.id)) next.partyMemberIds.push(character.id)
        character.status = 'companion'
        character.joinedAtScene ??= next.scene
        character.leftAtScene = undefined
      } else {
        if (!hasVisibleDeparture(parsed, character.name)) return
        next.partyMemberIds = next.partyMemberIds.filter((id) => id !== character.id)
        character.status = 'departed'
        character.leftAtScene = next.scene
      }
      character.updatedAtScene = next.scene
      effects.push({ id: effectId, kind: 'event', text: `${character.name}${t(cartridge.locale, command.change === 'add' ? 'joined' : 'left')}`, data: { characterId: character.id, partyChange: command.change } })
    }
    if (command.type === 'session_end') {
      next.sessionEnded = true
      effects.push({ id: effectId, kind: 'summary', text: command.reason })
    }
  })

  if (dangerDirective?.phase === 'resolution' && dangerDirective.check && !dangerCheckAdded) {
    const check = dangerDirective.check
    const succeeded = check.outcome === 'critical-success' || check.outcome === 'success' || check.outcome === 'costly-success'
    effects.push({
      id: `danger-check-${next.scene}`, kind: 'check', text: `${check.skill} · ${succeeded ? t(cartridge.locale, 'checkSuccess') : t(cartridge.locale, 'checkFailure')}`,
      data: { dc: check.dc, roll: check.roll, modifier: check.modifier, total: check.total, outcome: check.outcome },
    })
  }
  if (domainResolution?.status !== 'rejected') effects.push(...settleDangerTurn(save, next, adjudicatedParsed, cartridge, dangerDirective))
  effects.push(...applyDomainResolution(next, cartridge, domainResolution))

  // Ordinary scenes must remain playable even when an AI response omits or
  // truncates its machine-readable choices. A real checkpoint may still use
  // the dedicated resume action supplied by the Composer.
  if (!domainResolution && !next.sessionEnded && next.choices.length >= 1 && !choicesAreGrounded(next.choices, { ...next, choices: save.choices, blocks: [...next.blocks, ...effects] }, cartridge)) next.choices = []
  if (!next.sessionEnded && next.choices.length === 0) next.choices = quarantinedSiblingChoices(save.choices, actionId, save.objective, next.scene)

  const image = chooseSceneImage(save, next, adjudicatedParsed, cartridge, imagePrompt, imageSubject)
  next.blocks = [
    ...next.blocks,
    ...effects,
    ...(image.prompt ? [createImageBlock(`image-${next.scene}`, next.location, image.prompt, 'queued', '', {
      source: image.source ?? 'director', reason: image.reason ?? 'cadence', promptVersion: String(SCENE_IMAGE_PROMPT_VERSION),
      playerVisible: image.playerVisible ? 'true' : 'false',
    })] : []),
    ...(!next.sessionEnded && next.choices.length ? [createChoiceRecordBlock(next.scene, next.choices)] : []),
  ]
  return syncDomainDerivedState(next, cartridge)
}
