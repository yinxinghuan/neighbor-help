import { listCartridges } from '../src/story/cartridges/index'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import { applyConsistencyRecovery, applyConsistencyRecoverySelection, createInitialSave, repairLegacyConsistencyRecovery, resolveConsistencyRecoverySelection } from '../src/story/engine/reducer'
import { canonicalizeTurnMetadata, validateTurnConsistency } from '../src/story/engine/turnConsistency'
import { decodeChoiceRecord } from '../src/story/engine/choiceInput'

function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string) { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`) }

const cartridge = listCartridges('zh').find((candidate) => candidate.initialMap.length > 1) ?? listCartridges('zh')[0]
const initial = createInitialSave(cartridge)
const current = initial.location
const destination = initial.map.find((node) => !node.current)?.label ?? '新地点'

const bare = parseStoryProtocol(`你准备：
跟随向导开始巡逻
观察周围环境的异常动静
询问同伴如何制定应对计划`, 'zh')
equal((bare.commands.find((command) => command.type === 'choices') as { choices?: string[] } | undefined)?.choices?.length, 3, 'bare choices after a cue recover')
ok(bare.blocks.every((block) => !/你准备|跟随向导|观察周围/.test(block.text)), 'recovered choices do not remain in prose')

const missingScene = parseStoryProtocol(`[choices: "检查${current}"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, missingScene, cartridge).includes('turn.requires_one_scene_location'), 'scene location is mandatory')
const canonicalMissingScene = canonicalizeTurnMetadata(initial, missingScene, cartridge)
ok(!validateTurnConsistency(initial, canonicalMissingScene.parsed, cartridge).includes('turn.requires_one_scene_location'), 'known current location repairs missing scene metadata')

const missingImageLocation = parseStoryProtocol(`[scene_location: location="${current}"]
[choices: "检查${current}"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, missingImageLocation, cartridge, 'current scene image').includes('image.requires_one_image_location'), 'image location is mandatory with a prompt')
const discardedImage = canonicalizeTurnMetadata(initial, missingImageLocation, cartridge, 'current scene image')
equal(discardedImage.imagePrompt, undefined, 'unbound image is discarded without rejecting the story turn')
equal(discardedImage.discardedImage, true, 'discarded image is reported to the caller')

const objectiveMissing = parseStoryProtocol(`你现在的新任务是今晚巡逻。
[scene_location: location="${current}"]
[choices: "检查道路"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, objectiveMissing, cartridge).includes('turn.new_task_requires_objective_state'), 'new task requires objective state')
const repairedObjective = canonicalizeTurnMetadata(initial, objectiveMissing, cartridge)
ok(repairedObjective.parsed.commands.some((command) => command.type === 'state' && command.value.includes('新任务')), 'visible new task becomes authoritative objective metadata')

const ordinaryAction = canonicalizeTurnMetadata(initial, parseStoryProtocol(`你开始检查门锁。
[choices: "继续检查"|"询问守门人"|"先做标记"]`, 'zh'), cartridge)
equal(ordinaryAction.parsed.commands.some((command) => command.type === 'state'), false, 'ordinary player action never overwrites the long-term objective')

const valid = parseStoryProtocol(`你抵达${destination}，并接受了新的巡逻任务。
[map_update: new_location="${destination}" connected_to="${current}"]
[scene_location: location="${destination}"]
[state: value="完成今晚的巡逻任务"]
[choices: "检查${destination}的道路"|"询问向导"|"等待片刻"]
[image_location: location="${destination}"]`, 'zh')
equal(validateTurnConsistency(initial, valid, cartridge, 'night patrol at the destination').length, 0, 'aligned location, objective, choices, and image pass')

const staleChoice = parseStoryProtocol(`[map_update: new_location="${destination}" connected_to="${current}"]
[scene_location: location="${destination}"]
[choices: "检查${current}的新变化"|"询问向导"|"等待片刻"]`, 'zh')
ok(validateTurnConsistency(initial, staleChoice, cartridge).includes('choices.cannot_act_in_stale_location'), 'choice cannot silently act in the previous location')

const action = initial.choices[0].label
const recovery = applyConsistencyRecovery(initial, cartridge, action)
equal(recovery.scene, initial.scene + 1, 'consistency recovery records exactly one attempted turn')
equal(recovery.location, initial.location, 'recovery cannot teleport the player')
equal(recovery.objective, initial.objective, 'recovery cannot replace the objective with the attempted action')
ok(!recovery.choices.some((choice) => choice.label === action), 'failed action is quarantined from executable recovery choices')
equal(recovery.facts.consistency_quarantined_action, action, 'the attempted action remains in authoritative audit facts')
ok(recovery.blocks.some((block) => block.id === `consistency-recovery-${recovery.scene}` && block.text.includes(action)), 'recovery visibly explains why the action paused')
const recoveryRecord = recovery.blocks.find((block) => block.id === `choices-${recovery.scene}`)
equal(recoveryRecord?.kind, 'choices', 'recovery persists its visible choice record')
equal(decodeChoiceRecord(recoveryRecord?.text ?? '')[0], recovery.choices[0]?.label, 'saved recovery choice record matches the safe exit')
const secondFailed = recovery.choices[0]!.label
const narrowedRecovery = applyConsistencyRecovery(recovery, cartridge, secondFailed)
equal(narrowedRecovery.choices.length, recovery.choices.length - 1, 'a second failure strictly shrinks the recommendation set')
ok(!narrowedRecovery.choices.some((choice) => choice.label === action || choice.label === secondFailed), 'neither failed action returns')

const legacy = {
  ...recovery,
  facts: {},
  objective: action,
  choices: recovery.choices.map((choice, index) => ({ ...choice, label: index === 0 ? `观察${initial.location}的新变化` : choice.label })),
  blocks: recovery.blocks.map((block) => block.id === `consistency-recovery-${recovery.scene}`
    ? { ...block, text: `你重新确认了眼前的情况，没有把不确定的消息写进旅途记录。${initial.location}的一切仍在继续。` }
    : block.id === `choices-${recovery.scene}` ? { ...block, text: JSON.stringify(['观察旧地点的新变化', '追查旧路线', '换一种方式']) } : block),
}
const migrated = repairLegacyConsistencyRecovery(legacy, cartridge)
equal(migrated.objective, action, 'legacy migration does not invent a different objective')
ok(!migrated.choices.some((choice) => choice.label === action), 'legacy generic recovery does not restore the quarantined action')
equal(decodeChoiceRecord(migrated.blocks.find((block) => block.id === `choices-${migrated.scene}`)?.text ?? '')[0], migrated.choices[0]?.label, 'legacy saved choice record matches the migrated safe exit')
equal(repairLegacyConsistencyRecovery(migrated, cartridge), migrated, 'legacy migration is idempotent')

console.log(JSON.stringify({ ok: true, checks: ['metadata-canonicalization', 'image-discard', 'objective-grounding', 'stale-place-choice-rejected', 'quarantined-recovery', 'strictly-shrinking-recovery', 'legacy-recovery-migration'] }))
