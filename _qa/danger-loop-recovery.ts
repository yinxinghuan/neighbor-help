import assert from 'node:assert/strict'
import { neighborHelp } from '../src/story/cartridges/neighborHelp'
import { repairLegacyDangerLoopChoices } from '../src/story/engine/dangerDirector'
import { decodeChoiceRecord } from '../src/story/engine/choiceInput'
import { applyConsistencyRecovery, createChoiceRecordBlock, createInitialSave } from '../src/story/engine/reducer'

const threat = '路口红灯一直不变，车流挡住了送伞路线'
const attempted = '等红灯变绿后继续把雨伞送到公交站'
const active = createInitialSave(neighborHelp)
active.scene = 8
active.danger = { phase: 'confrontation', safeTurns: 0, cycle: 1, cooldownTurns: 0, severity: 3, currentThreat: threat, lastOutcome: 'none' }

const recovery = applyConsistencyRecovery(active, neighborHelp, attempted)
assert.equal(recovery.choices.length, 3)
assert(!recovery.choices.some((choice) => choice.label === attempted), 'failed action must be quarantined from the tray')
assert.equal(recovery.danger.phase, 'confrontation')
assert(recovery.choices.every((choice) => choice.label.includes('红灯') || choice.label.includes('车流')), 'every surviving recommendation names the active threat')

const legacyChoices = [
  { id: 'recovery-8-0', label: attempted },
  { id: 'recovery-8-1', label: '先在共享大厅确认与这一步有关的路线和线索' },
  { id: 'recovery-8-2', label: '暂缓这一步，留在共享大厅观察局势' },
]
const legacy = {
  ...active,
  choices: legacyChoices,
  blocks: [...active.blocks, createChoiceRecordBlock(active.scene, legacyChoices)],
}
const migrated = repairLegacyDangerLoopChoices(legacy, neighborHelp)
assert(migrated.choices.every((choice) => choice.label.includes('红灯') || choice.label.includes('车流')))
assert.deepEqual(decodeChoiceRecord(migrated.blocks.find((block) => block.id === `choices-${migrated.scene}`)!.text), migrated.choices.map((choice) => choice.label))
assert.deepEqual(repairLegacyDangerLoopChoices(migrated, neighborHelp), migrated, 'migration is idempotent')

console.log(JSON.stringify({ ok: true, checks: ['failed-action-quarantined', 'threat-specific-options', 'legacy-save-migration'] }))
