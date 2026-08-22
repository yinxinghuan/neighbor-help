import assert from 'node:assert/strict'
import { neighborHelp as cartridge } from '../src/story/cartridges/neighborHelp'
import { applyConsistencyRecovery, createChoiceRecordBlock, createInitialSave, shouldRestoreGenericChoices } from '../src/story/engine/reducer'
import { semanticallyRepeatsCurrentAction } from '../src/story/engine/turnConsistency'

const base = createInitialSave(cartridge)
base.entered = true
base.choices = ['检查楼道漏水点', '询问邻居维修时间', '整理住户提交的照片'].map((label, index) => ({ id: `seed-${index}`, label }))
base.blocks = [...base.blocks.filter((block) => block.id !== `choices-${base.scene}`), createChoiceRecordBlock(base.scene, base.choices)]

const first = applyConsistencyRecovery(base, cartridge, base.choices[0].label)
assert.deepEqual(first.choices.map((choice) => choice.label), base.choices.slice(1).map((choice) => choice.label))
const second = applyConsistencyRecovery(first, cartridge, first.choices[0].label)
assert.equal(second.choices.length, 1)
assert.notDeepEqual(second.choices.map((choice) => choice.label), first.choices.map((choice) => choice.label))

const soleLabel = '检查并不存在的维修编号'
const sole = applyConsistencyRecovery({ ...base, choices: [{ id: 'sole', label: soleLabel }] }, cartridge, soleLabel)
assert.equal(sole.choices.length, 0)
assert.equal(shouldRestoreGenericChoices(sole), false)
assert.equal(semanticallyRepeatsCurrentAction('触摸水表边缘的裂纹', '检查水表的裂纹', 'zh'), true)

console.log(JSON.stringify({ ok: true, checks: ['siblings-preserved', 'strictly-shrinking', 'empty-tray-reload-safe', 'semantic-retry', 'personal-save-only'] }))
