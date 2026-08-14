import assert from 'node:assert/strict'
import { applyPendingReceipts, emptyPlayerSave } from '../src/shared-world/playerInventory'
import type { PendingItemReceipt } from '../src/shared-world/types'

const add: PendingItemReceipt = { receiptId: 'r-add', sourceEntityId: 'req-1', operation: 'add', item: { kind: 'umbrella', quantity: 1, instanceId: 'umbrella-1' }, createdAt: 10 }
const remove: PendingItemReceipt = { receiptId: 'r-remove', sourceEntityId: 'req-1', operation: 'remove', item: { kind: 'umbrella', quantity: 1, instanceId: 'umbrella-1' }, createdAt: 20 }

const once = applyPendingReceipts(emptyPlayerSave(), [add])
assert.equal(once.heldItems.length, 1)
const duplicate = applyPendingReceipts(once, [add])
assert.equal(duplicate.heldItems.length, 1)
assert.equal(duplicate.appliedReceiptIds.length, 1)
const removed = applyPendingReceipts(duplicate, [remove])
assert.equal(removed.heldItems.length, 0)
assert.equal(applyPendingReceipts(removed, [remove]).appliedReceiptIds.length, 2)

console.log('neighbor-help receipt reconciliation: ok')
