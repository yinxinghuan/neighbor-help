import { DEFAULT_CARTRIDGE_ID, resolveCartridge } from '../src/story/cartridges/index'
import { buildDangerDirective, dangerDirectiveContract } from '../src/story/engine/dangerDirector'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import type { DangerDirective, StoryCartridge, StorySave } from '../src/story/types'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`) }

function ordinaryScene(save: StorySave, cartridge: StoryCartridge, label: string, directive?: DangerDirective): StorySave {
  const parsed = parseStoryProtocol(`The situation advances.\n[choices: "Observe"|"Change route"|"Prepare a tool"]`, cartridge.locale)
  return applyParsedScene(save, parsed, cartridge, label, undefined, undefined, directive)
}

for (const cartridge of [resolveCartridge(DEFAULT_CARTRIDGE_ID, 'zh'), resolveCartridge(DEFAULT_CARTRIDGE_ID, 'en')]) {
  const config = cartridge.dangerDirector
  ok(config, `${cartridge.id}/${cartridge.locale}: danger director is configured`)
  ok(cartridge.director, `${cartridge.id}/${cartridge.locale}: story director is configured`)
  let save = createInitialSave(cartridge)
  equal(save.version, 10, `${cartridge.id}: StorySave v10`)
  let warning: DangerDirective | undefined
  for (let turn = 0; turn <= config.maxSafeTurns + 1; turn += 1) {
    warning = buildDangerDirective(save, cartridge, `safe action ${turn}`)
    if (warning) break
    save = ordinaryScene(save, cartridge, `safe action ${turn}`)
  }
  equal(warning?.phase, 'warning', `${cartridge.id}: cadence guarantees a warning`)
  const warningContract = dangerDirectiveContract(warning)
  ok(warningContract.includes('DANGER DIRECTIVE IS AUTHORITATIVE'), `${cartridge.id}: AI receives authoritative danger contract`)
  ok(warningContract.includes('[encounter:'), `${cartridge.id}: AI receives encounter protocol`)
  ok(config.methods.every((method) => warningContract.includes(method)), `${cartridge.id}: AI receives configured response methods`)
  save = ordinaryScene(save, cartridge, 'notice warning', warning)
  const confrontation = buildDangerDirective(save, cartridge, 'prepare')
  equal(confrontation?.phase, 'confrontation', `${cartridge.id}: warning advances to confrontation`)
  save = ordinaryScene(save, cartridge, 'prepare', confrontation)
  let action = 'resolve'
  let resolution = buildDangerDirective(save, cartridge, action)
  for (let attempt = 0; resolution?.check && !['failure', 'critical-failure', 'costly-success'].includes(resolution.check.outcome) && attempt < 80; attempt += 1) {
    action = `resolve ${attempt}`
    resolution = buildDangerDirective(save, cartridge, action)
  }
  ok(resolution?.check, `${cartridge.id}: local check exists`)
  equal(buildDangerDirective(save, cartridge, action)?.check?.roll, resolution.check.roll, `${cartridge.id}: refresh cannot reroll`)
  const cost = config.resolution.fallbackCosts[0]
  const before = save.stats[cost.statId]
  save = applyParsedScene(save, parseStoryProtocol(`Outcome.\n[skill_check: skill="Fake" dc="1" rolls="20" modifier="9" total="29" result="success"]\n[choices: "Review"|"Recover"|"Move on"]`, cartridge.locale), cartridge, action, undefined, undefined, resolution)
  const check = save.blocks.find((block) => block.kind === 'check' && block.id.startsWith('effect-'))
  equal(check?.data?.roll, resolution.check.roll, `${cartridge.id}: local roll overrides AI`)
  if (['failure', 'critical-failure', 'costly-success'].includes(resolution.check.outcome)) ok(save.stats[cost.statId] !== before, `${cartridge.id}: fallback cost applies`)
  equal(save.danger.phase, 'calm', `${cartridge.id}: resolution returns to calm`)
}

const encounter = parseStoryProtocol('[encounter: phase="warning" kind="closing route" severity="4" outcome="active"]', 'en').commands[0]
equal(encounter?.type, 'encounter', 'encounter protocol parses')
console.log(`standalone danger director ok · game=${DEFAULT_CARTRIDGE_ID} · cadence=stable · local_roll=authoritative`)
