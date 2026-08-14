import assert from 'node:assert/strict'
import { LocalSharedWorldGateway } from '../src/shared-world/gateway'
import type { WorldAction } from '../src/shared-world/types'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

Object.assign(globalThis, { alteruLocalStorage: new MemoryStorage() })

const alex = new LocalSharedWorldGateway('qa-world', 'qa-receipts')
const sam = new LocalSharedWorldGateway('qa-world', 'qa-receipts')
const first = await alex.load()
const action: WorldAction = {
  actionId: 'stable-action-id',
  actor: { id: 'alex', name: 'Alex' },
  expectedVersion: first.archive.version,
  createdAt: 1_800_000_000_000,
  type: 'claim_request',
  payload: { requestId: 'req-umbrella-bus-stop' },
}
const committed = await alex.commit(action)
const duplicate = await alex.commit({ ...action, expectedVersion: 0 })
assert.equal(duplicate.duplicate, true)
assert.equal(duplicate.archive.version, committed.archive.version)

const reconnected = await sam.load(first.view.cursor)
assert.equal(reconnected.events.length, 1)
assert.equal(reconnected.events[0].actionId, action.actionId)
assert.equal(reconnected.view.requests.find((entry) => entry.id === action.payload.requestId)?.claimantUserId, 'alex')

await alex.acknowledgeReceipt(committed.receipts[0].id, 'alex')
assert.equal((await sam.listPendingReceipts('alex')).length, 0)

console.log('neighbor-help gateway cursor and retry recovery: ok')
