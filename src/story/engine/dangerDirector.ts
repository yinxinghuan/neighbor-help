import { t } from '../i18n'
import type { DangerDirective, DangerOutcome, ParsedScene, StoryBlock, StoryCartridge, StoryDangerState, StorySave } from '../types'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createInitialDangerState(): StoryDangerState {
  return { phase: 'calm', safeTurns: 0, cycle: 0, cooldownTurns: 0, severity: 1, lastOutcome: 'none' }
}

export function normalizeDangerState(candidate: Partial<StoryDangerState> | null | undefined): StoryDangerState {
  const initial = createInitialDangerState()
  if (!candidate) return initial
  const phase = candidate.phase === 'warning' || candidate.phase === 'confrontation' ? candidate.phase : 'calm'
  const outcomes: DangerOutcome[] = ['none', 'critical-success', 'success', 'costly-success', 'failure', 'critical-failure']
  return {
    phase,
    safeTurns: Math.max(0, Math.floor(Number(candidate.safeTurns) || 0)),
    cycle: Math.max(0, Math.floor(Number(candidate.cycle) || 0)),
    cooldownTurns: Math.max(0, Math.floor(Number(candidate.cooldownTurns) || 0)),
    severity: clamp(Math.floor(Number(candidate.severity) || 1), 1, 5),
    currentThreat: typeof candidate.currentThreat === 'string' && candidate.currentThreat.trim() ? candidate.currentThreat.trim() : undefined,
    lastOutcome: outcomes.includes(candidate.lastOutcome as DangerOutcome) ? candidate.lastOutcome as DangerOutcome : 'none',
    lastResolvedScene: Number.isFinite(candidate.lastResolvedScene) ? Number(candidate.lastResolvedScene) : undefined,
  }
}

function crossed(value: number, threshold: number | undefined, inverse: boolean | undefined): boolean {
  if (threshold == null) return false
  return inverse ? value <= threshold : value >= threshold
}

function riskSeverity(save: StorySave, cartridge: StoryCartridge): number {
  const ids = new Set(cartridge.dangerDirector?.escalationStats ?? [])
  let severity = 1
  cartridge.statDefinitions.forEach((definition) => {
    if (!ids.has(definition.id)) return
    const value = save.stats[definition.id] ?? definition.initial
    if (crossed(value, definition.dangerAt, definition.inverse)) severity = Math.max(severity, 5)
    else if (crossed(value, definition.warningAt, definition.inverse)) severity = Math.max(severity, 3)
  })
  return severity
}

function scheduledTurn(cartridge: StoryCartridge, cycle: number): number {
  const config = cartridge.dangerDirector!
  const minimum = Math.max(0, Math.floor(config.minSafeTurns))
  const maximum = Math.max(minimum, Math.floor(config.maxSafeTurns))
  return minimum + stableHash(`${cartridge.id}:danger-cycle:${cycle}`) % (maximum - minimum + 1)
}

function selectThreat(cartridge: StoryCartridge, cycle: number): string {
  const threats = cartridge.dangerDirector?.threatPalette ?? []
  return threats[stableHash(`${cartridge.id}:threat:${cycle}`) % Math.max(1, threats.length)] ?? 'an immediate world-appropriate threat'
}

function dangerCheck(save: StorySave, cartridge: StoryCartridge, actionId: string, severity: number) {
  const resolution = cartridge.dangerDirector!.resolution
  const roll = stableHash(`${cartridge.id}:${save.scene + 1}:${save.danger.cycle}:${actionId}:danger-roll`) % 20 + 1
  const risk = riskSeverity(save, cartridge)
  const dc = resolution.dcBySeverity[severity - 1] + (risk === 5 ? resolution.criticalDcBonus ?? 0 : 0)
  const modifier = clamp(Math.round(resolution.modifier), -5, 8)
  const total = roll + modifier
  const outcome: Exclude<DangerOutcome, 'none'> = roll === 20
    ? 'critical-success'
    : roll === 1
      ? 'critical-failure'
      : total < dc
        ? 'failure'
        : total === dc
          ? 'costly-success'
          : 'success'
  return { skill: resolution.skill, dc, roll, modifier, total, outcome }
}

export function buildDangerDirective(save: StorySave, cartridge: StoryCartridge, actionId: string): DangerDirective | undefined {
  const config = cartridge.dangerDirector
  if (!config) return undefined
  const state = normalizeDangerState(save.danger)
  const risk = riskSeverity(save, cartridge)
  const baseSeverity = Math.max(risk, 2 + stableHash(`${cartridge.id}:severity:${state.cycle}`) % 2)
  const severity = clamp(state.severity > 1 ? Math.max(state.severity, risk) : baseSeverity, 1, 5)
  const threat = state.currentThreat ?? selectThreat(cartridge, state.cycle)
  const shared = { severity, threat, methods: config.methods, physicalCombat: config.physicalCombat } as const

  if (state.phase === 'warning') return { phase: 'confrontation', ...shared }
  if (state.phase === 'confrontation') return { phase: 'resolution', ...shared, check: dangerCheck({ ...save, danger: state }, cartridge, actionId, severity) }
  if (state.cooldownTurns > 0) return undefined
  if (risk === 5) return { phase: 'confrontation', ...shared, severity: 5 }
  if (state.safeTurns >= scheduledTurn(cartridge, state.cycle)) return { phase: 'warning', ...shared }
  return undefined
}

export function dangerDirectiveContract(directive: DangerDirective | undefined): string {
  if (!directive) return ''
  const methods = directive.methods.join(' / ')
  const combat = directive.physicalCombat === 'none'
    ? 'Do not turn this into physical combat.'
    : directive.physicalCombat === 'rare'
      ? 'Physical combat is possible only when the current facts and player action genuinely justify it; prefer other methods.'
      : 'Physical combat is one valid method, never the only method.'
  const tag = `[encounter: phase="${directive.phase}" kind="${directive.threat}" severity="${directive.severity}"${directive.check ? ` outcome="${directive.check.outcome}"` : ' outcome="active"'}]`
  if (directive.phase === 'warning') return `
DANGER DIRECTIVE IS AUTHORITATIVE. This turn MUST introduce a readable early warning of this current-world threat: ${directive.threat}. Severity ${directive.severity}/5. Do not resolve or skip it yet. Let the player notice, prepare for, investigate, or avoid it. The three choices must be concrete versions of: ${methods}. ${combat} Emit this exact encounter tag: ${tag}`
  if (directive.phase === 'confrontation') return `
DANGER DIRECTIVE IS AUTHORITATIVE. Escalate the established threat into an immediate obstacle or confrontation now: ${directive.threat}. Severity ${directive.severity}/5. Do not resolve it before the player chooses a response. The three choices must be concrete and materially different versions of: ${methods}. ${combat} Emit this exact encounter tag: ${tag}`
  const check = directive.check!
  return `
DANGER DIRECTIVE IS AUTHORITATIVE. Resolve the player's chosen response to the established threat now: ${directive.threat}. The local engine has already fixed the check and refresh cannot reroll it: skill="${check.skill}", dc=${check.dc}, roll=${check.roll}, modifier=${check.modifier}, total=${check.total}, outcome=${check.outcome}. Narrate exactly that outcome and its immediate aftermath; never replace the roll, soften a failure into success, or invent a second check. Emit [skill_check: skill="${check.skill}" dc="${check.dc}" rolls="${check.roll}" modifier="${check.modifier}" total="${check.total}" result="${check.outcome}"] and this exact encounter tag: ${tag}. End at the next decision after the consequence. ${combat}`
}

function hasMeaningfulCost(before: StorySave, after: StorySave, cartridge: StoryCartridge): boolean {
  const costs = cartridge.dangerDirector?.resolution.fallbackCosts ?? []
  const statCost = costs.some((cost) => {
    const previous = before.stats[cost.statId]
    const current = after.stats[cost.statId]
    return cost.operation === 'remove' ? current < previous : current > previous
  })
  if (statCost) return true
  const inventoryCost = before.inventory.some((item) => (after.inventory.find((entry) => entry.id === item.id || entry.label === item.label)?.count ?? 0) < item.count)
  if (inventoryCost) return true
  return before.characters.some((character) => {
    const current = after.characters.find((entry) => entry.id === character.id)
    return Boolean(current && (current.vitality < character.vitality || current.stress > character.stress))
  })
}

function applyFallbackCost(before: StorySave, after: StorySave, cartridge: StoryCartridge, outcome: DangerOutcome): StoryBlock | undefined {
  if (outcome !== 'costly-success' && outcome !== 'failure' && outcome !== 'critical-failure') return undefined
  if (hasMeaningfulCost(before, after, cartridge)) return undefined
  const cost = cartridge.dangerDirector?.resolution.fallbackCosts[0]
  const definition = cost ? cartridge.statDefinitions.find((entry) => entry.id === cost.statId) : undefined
  if (!cost || !definition) return undefined
  const multiplier = outcome === 'costly-success' ? .5 : outcome === 'critical-failure' ? 2 : 1
  const amount = Math.max(1, Math.ceil(cost.amount * multiplier))
  const previous = after.stats[cost.statId] ?? definition.initial
  const requested = cost.operation === 'remove' ? previous - amount : previous + amount
  const maximum = definition.maxDelta == null ? amount : Math.min(amount, Math.max(0, definition.maxDelta))
  const delta = clamp(requested - previous, -maximum, maximum)
  const current = clamp(previous + delta, definition.min, definition.max)
  after.stats[cost.statId] = current
  const applied = current - previous
  if (!applied) return undefined
  return {
    id: `danger-cost-${after.scene}`,
    kind: 'change',
    text: `${definition.label} ${applied > 0 ? '+' : ''}${applied}`,
    data: { stat: definition.id, delta: applied, dangerFallback: 'true' },
  }
}

export function settleDangerTurn(
  before: StorySave,
  after: StorySave,
  parsed: ParsedScene,
  cartridge: StoryCartridge,
  directive: DangerDirective | undefined,
): StoryBlock[] {
  if (!cartridge.dangerDirector) {
    after.danger = normalizeDangerState(after.danger)
    return []
  }
  const state = normalizeDangerState(before.danger)
  const encounter = [...parsed.commands].reverse().find((command) => command.type === 'encounter')
  const effects: StoryBlock[] = []

  if (directive?.phase === 'warning') {
    after.danger = { ...state, phase: 'warning', safeTurns: 0, severity: directive.severity, currentThreat: directive.threat }
    effects.push({ id: `danger-${after.scene}`, kind: 'event', text: t(cartridge.locale, 'dangerWarning'), data: { dangerPhase: 'warning', severity: directive.severity } })
    return effects
  }
  if (directive?.phase === 'confrontation') {
    after.danger = { ...state, phase: 'confrontation', safeTurns: 0, severity: directive.severity, currentThreat: directive.threat }
    effects.push({ id: `danger-${after.scene}`, kind: 'event', text: t(cartridge.locale, 'dangerConfrontation'), data: { dangerPhase: 'confrontation', severity: directive.severity } })
    return effects
  }
  if (directive?.phase === 'resolution' && directive.check) {
    const outcome = directive.check.outcome
    after.danger = {
      phase: 'calm', safeTurns: 0, cycle: state.cycle + 1, cooldownTurns: cartridge.dangerDirector.cooldownTurns,
      severity: 1, currentThreat: undefined, lastOutcome: outcome, lastResolvedScene: after.scene,
    }
    const cost = applyFallbackCost(before, after, cartridge, outcome)
    if (cost) effects.push(cost)
    effects.push({
      id: `danger-${after.scene}`, kind: 'event',
      text: t(cartridge.locale, outcome === 'critical-success' || outcome === 'success' ? 'dangerResolved' : outcome === 'costly-success' ? 'dangerResolvedCostly' : 'dangerFailed'),
      data: { dangerPhase: 'resolution', outcome, severity: directive.severity },
    })
    return effects
  }

  if (encounter?.type === 'encounter') {
    const severity = clamp(Math.floor(encounter.severity ?? 2), 1, 5)
    if (encounter.phase === 'warning' || encounter.phase === 'confrontation') {
      after.danger = { ...state, phase: encounter.phase, safeTurns: 0, severity, currentThreat: encounter.kind ?? state.currentThreat ?? selectThreat(cartridge, state.cycle) }
      return effects
    }
    after.danger = {
      phase: 'calm', safeTurns: 0, cycle: state.cycle + 1, cooldownTurns: cartridge.dangerDirector.cooldownTurns,
      severity: 1, currentThreat: undefined, lastOutcome: encounter.outcome ?? 'success', lastResolvedScene: after.scene,
    }
    return effects
  }

  after.danger = state.cooldownTurns > 0
    ? { ...state, cooldownTurns: state.cooldownTurns - 1, safeTurns: 0 }
    : { ...state, safeTurns: state.safeTurns + 1 }
  return effects
}
