import assert from 'node:assert/strict'
import { createSaveEnvelope, readSaveNamespace, removeSaveNamespace, writeSaveNamespace } from '../src/shared/save/saveEnvelope'

const legacyStory = { sceneId: 'opening', energy: 78 }
const migrated = createSaveEnvelope(legacyStory, 'neighbor-help')
assert.deepEqual(readSaveNamespace(migrated, 'neighbor-help'), legacyStory)

const receiptMirror = { heldItems: [{ instanceId: 'item-umbrella-last' }], appliedReceiptIds: ['receipt-1'] }
const merged = writeSaveNamespace(migrated, 'neighbor-help-shared-player', receiptMirror)
assert.deepEqual(readSaveNamespace(merged, 'neighbor-help'), legacyStory)
assert.deepEqual(readSaveNamespace(merged, 'neighbor-help-shared-player'), receiptMirror)

const storyUpdated = writeSaveNamespace(merged, 'neighbor-help', { sceneId: 'lobby', energy: 74 })
assert.deepEqual(readSaveNamespace(storyUpdated, 'neighbor-help-shared-player'), receiptMirror)
assert.deepEqual(readSaveNamespace(storyUpdated, 'neighbor-help'), { sceneId: 'lobby', energy: 74 })

const receiptRemoved = removeSaveNamespace(storyUpdated, 'neighbor-help-shared-player')
assert.equal(readSaveNamespace(receiptRemoved, 'neighbor-help-shared-player'), undefined)
assert.deepEqual(readSaveNamespace(receiptRemoved, 'neighbor-help'), { sceneId: 'lobby', energy: 74 })

console.log('neighbor-help cloud save envelope isolation: ok')
