import assert from 'node:assert/strict'
import { resolveCartridge } from '../src/story/cartridges/index'
import { buildDangerDirective, createDangerFallbackScene } from '../src/story/engine/dangerDirector'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import { validateTurnConsistency } from '../src/story/engine/turnConsistency'
import type { DangerDirective } from '../src/story/types'

function visibleTurn(directive: DangerDirective, location: string, locale: 'zh' | 'en') {
  const prose = locale === 'zh'
    ? `你清楚看见新的阻碍：“${directive.threat}”。这件事正在影响眼前的路线。`
    : `You can clearly see the new obstacle: ${directive.threat}. It is affecting the route in front of you.`
  const labels = locale === 'zh'
    ? [`确认${directive.threat}的具体情况`, `立即应对${directive.threat}`]
    : [`Confirm the facts about ${directive.threat}`, `Respond directly to ${directive.threat}`]
  return parseStoryProtocol(`${prose}
[scene_location: location="${location}"]
[encounter: phase="${directive.phase}" kind="${directive.threat}" severity="${directive.severity}" outcome="${directive.check?.outcome ?? 'active'}"]
[choices: "${labels[0]}"|"${labels[1]}"]`, locale)
}

for (const locale of ['zh', 'en'] as const) {
  const cartridge = resolveCartridge('neighbor-help', locale)
  for (const node of cartridge.initialMap) {
    for (let cycle = 0; cycle < 32; cycle += 1) {
      const scoped = createInitialSave(cartridge)
      scoped.scene = 20
      scoped.location = node.label
      scoped.map = scoped.map.map((entry) => ({ ...entry, current: entry.id === node.id }))
      scoped.danger = { ...scoped.danger, safeTurns: 99, cycle }
      const selected = buildDangerDirective(scoped, cartridge, `scope-${node.id}-${cycle}`)?.threat
      assert(selected, `${locale}/${node.id}/${cycle}: a compatible threat is selected`)
      const allowed = cartridge.dangerDirector?.threatLocations?.[selected!]
      assert(!allowed?.length || allowed.includes(node.id), `${locale}/${node.id}/${cycle}: threat is valid at the current node`)
    }
  }
  const save = createInitialSave(cartridge)
  save.scene = 20
  save.danger = { ...save.danger, safeTurns: 99 }
  const directive = buildDangerDirective(save, cartridge, 'inspect')
  assert.equal(directive?.phase, 'warning')

  const hidden = parseStoryProtocol(`${locale === 'zh' ? '你把公告板重新排好，没有发生别的事。' : 'You reorganize the notice board and nothing else happens.'}
[scene_location: location="${save.location}"]
[choices: "${locale === 'zh' ? '查看代取药品委托' : 'Check the medicine request'}"|"${locale === 'zh' ? '看看包裹架' : 'Inspect the parcel shelf'}"]`, locale)
  const hiddenViolations = validateTurnConsistency(save, hidden, cartridge, undefined, directive)
  assert(hiddenViolations.includes('turn.scheduled_threat_requires_visible_establishment'))
  assert(hiddenViolations.includes('turn.scheduled_threat_choices_must_address_threat'))
  const hiddenCommit = applyParsedScene(save, hidden, cartridge, 'inspect', undefined, undefined, directive)
  assert.equal(hiddenCommit.danger.phase, 'calm', `${locale}: hidden danger cannot enter authority`)

  const warning = visibleTurn(directive!, save.location, locale)
  assert.deepEqual(validateTurnConsistency(save, warning, cartridge, undefined, directive), [])
  let advanced = applyParsedScene(save, warning, cartridge, 'inspect', undefined, undefined, directive)
  assert.equal(advanced.danger.phase, 'warning')
  assert.equal(advanced.danger.currentThreat, directive!.threat)

  const confrontation = buildDangerDirective(advanced, cartridge, 'prepare')!
  const dropped = parseStoryProtocol(`${locale === 'zh' ? '你决定去处理另一项委托。' : 'You decide to handle another request instead.'}
[scene_location: location="${advanced.location}"]
[choices: "${locale === 'zh' ? '查看另一项委托' : 'Check another request'}"|"${locale === 'zh' ? '回到公告板' : 'Return to the board'}"]`, locale)
  const droppedViolations = validateTurnConsistency(advanced, dropped, cartridge, undefined, confrontation)
  assert(droppedViolations.includes('turn.active_threat_requires_continuation'))
  assert(droppedViolations.includes('turn.scheduled_threat_requires_visible_establishment'))

  const confronted = visibleTurn(confrontation, advanced.location, locale)
  assert.deepEqual(validateTurnConsistency(advanced, confronted, cartridge, undefined, confrontation), [])
  advanced = applyParsedScene(advanced, confronted, cartridge, 'prepare', undefined, undefined, confrontation)
  assert.equal(advanced.danger.phase, 'confrontation')

  const resolution = buildDangerDirective(advanced, cartridge, 'respond')!
  const resolved = visibleTurn(resolution, advanced.location, locale)
  assert.deepEqual(validateTurnConsistency(advanced, resolved, cartridge, undefined, resolution), [])
  advanced = applyParsedScene(advanced, resolved, cartridge, 'respond', undefined, undefined, resolution)
  assert.equal(advanced.danger.phase, 'calm', `${locale}: visible same-thread resolution exits danger`)

  let fallbackSave = createInitialSave(cartridge)
  fallbackSave.scene = 20
  fallbackSave.danger = { ...fallbackSave.danger, safeTurns: 99 }
  for (const phase of ['warning', 'confrontation', 'resolution'] as const) {
    const fallbackDirective = buildDangerDirective(fallbackSave, cartridge, `fallback-${phase}`)!
    assert.equal(fallbackDirective.phase, phase)
    const fallback = createDangerFallbackScene(fallbackSave, cartridge, fallbackDirective)
    assert.equal(validateTurnConsistency(fallbackSave, fallback, cartridge, undefined, fallbackDirective).length, 0)
    fallbackSave = applyParsedScene(fallbackSave, fallback, cartridge, `fallback-${phase}`, undefined, undefined, fallbackDirective)
  }
  assert.equal(fallbackSave.danger.phase, 'calm', `${locale}: deterministic fallback always exits after resolution`)
  assert(fallbackSave.choices.length >= 2, `${locale}: deterministic resolution remains playable`)
}

console.log(JSON.stringify({ ok: true, checks: ['location-scope-192', 'hidden-danger-rejected', 'grounded-warning', 'active-thread-retained', 'visible-resolution', 'deterministic-fallback', 'zh-en'] }))
