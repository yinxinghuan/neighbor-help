import assert from 'node:assert/strict'
import { LocalSharedWorldGateway, RemoteSharedWorldGateway } from '../src/shared-world/gateway'
import { commitWorldAction, createWorld } from '../src/shared-world/engine'
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

const remoteAction: WorldAction = {
  ...action,
  actionId: 'remote-response-loss-id',
  actor: { id: 'remote-alex', name: 'Remote Alex' },
}
const remoteCommitted = commitWorldAction(createWorld(), remoteAction)
const postedIds: string[] = []
let actionAttempts = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input, init) => {
  const url = String(input)
  if (!url.endsWith('/api/world/action')) throw new Error(`unexpected URL ${url}`)
  postedIds.push(String(JSON.parse(String(init?.body)).action_id))
  actionAttempts += 1
  if (actionAttempts === 1) throw new TypeError('response lost after commit')
  return new Response(JSON.stringify({
    duplicate: true,
    code: 'DUPLICATE_ACTION',
    committed_events: remoteCommitted.committedEvents,
    grant_receipts: remoteCommitted.receipts,
    snapshot: remoteCommitted.archive,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  const remote = new RemoteSharedWorldGateway('https://example.invalid/game')
  const recovered = await remote.commit(remoteAction)
  assert.equal(recovered.accepted, true)
  assert.equal(recovered.duplicate, true)
  assert.deepEqual(postedIds, [remoteAction.actionId, remoteAction.actionId], 'transport retry must preserve action id')
  assert.equal(recovered.archive.version, remoteCommitted.archive.version)
} finally {
  globalThis.fetch = originalFetch
}

const reconciledAction: WorldAction = { ...remoteAction, actionId: 'remote-two-responses-lost-id' }
const reconciledCommitted = commitWorldAction(createWorld(), reconciledAction)
const reconciliationPosts: string[] = []
globalThis.fetch = (async (input, init) => {
  const url = String(input)
  if (url.endsWith('/api/world/action')) {
    reconciliationPosts.push(String(JSON.parse(String(init?.body)).action_id))
    throw new TypeError('response lost after commit')
  }
  if (url.endsWith('/api/world/ensure')) return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('/api/world/state?')) return new Response(JSON.stringify({
    snapshot: reconciledCommitted.archive,
    events: reconciledCommitted.committedEvents,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  throw new Error(`unexpected URL ${url}`)
}) as typeof fetch
try {
  const remote = new RemoteSharedWorldGateway('https://example.invalid/game')
  const reconciled = await remote.commit(reconciledAction)
  assert.equal(reconciled.accepted, true)
  assert.equal(reconciled.duplicate, true)
  assert.equal(reconciled.committedEvents[0].actionId, reconciledAction.actionId)
  assert.deepEqual(reconciliationPosts, [reconciledAction.actionId, reconciledAction.actionId])
} finally {
  globalThis.fetch = originalFetch
}

console.log('neighbor-help gateway cursor, stable-id and response-loss recovery: ok')
