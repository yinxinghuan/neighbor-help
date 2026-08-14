import assert from 'node:assert/strict'
import { commitWorldAction, createWorld, readWorld } from '../src/shared-world/engine'
import { WorldRuleError, type WorldAction, type WorldArchive } from '../src/shared-world/types'

const at = 1_800_000_000_000
const base = (archive: WorldArchive, actionId: string, userId: string, name: string) => ({
  actionId,
  actor: { id: userId, name },
  expectedVersion: archive.version,
  createdAt: at,
})

const initial = createWorld(at)
const actionA: WorldAction = { ...base(initial, 'action-a', 'resident-a', 'Alex'), type: 'claim_request', payload: { requestId: 'req-umbrella-bus-stop' } }
const actionB: WorldAction = { ...base(initial, 'action-b', 'resident-b', 'Sam'), type: 'claim_request', payload: { requestId: 'req-umbrella-bus-stop' } }
const claimed = commitWorldAction(initial, actionA)

assert.equal(claimed.accepted, true)
assert.equal(claimed.receipts.length, 1)
assert.equal(claimed.archive.requests.find((entry) => entry.id === 'req-umbrella-bus-stop')?.claimantUserId, 'resident-a')
assert.equal(claimed.archive.items.find((entry) => entry.id === 'item-umbrella-last')?.holderUserId, 'resident-a')
assert.equal(claimed.archive.items.find((entry) => entry.id === 'item-umbrella-last')?.custody, 'player')

assert.throws(() => commitWorldAction(claimed.archive, actionB), (error) => error instanceof WorldRuleError && error.code === 'VERSION_CONFLICT')

const refreshedB: WorldAction = { ...actionB, expectedVersion: claimed.archive.version }
assert.throws(() => commitWorldAction(claimed.archive, refreshedB), (error) => error instanceof WorldRuleError && error.code === 'REQUEST_UNAVAILABLE')

const duplicate = commitWorldAction(claimed.archive, { ...actionA, expectedVersion: 0 })
assert.equal(duplicate.duplicate, true)
assert.equal(duplicate.archive.version, claimed.archive.version)
assert.equal(duplicate.committedEvents[0]?.id, claimed.committedEvents[0]?.id)

const handoffAction: WorldAction = { ...base(claimed.archive, 'action-handoff', 'resident-a', 'Alex'), type: 'handoff_request', payload: { requestId: 'req-umbrella-bus-stop' } }
const handed = commitWorldAction(claimed.archive, handoffAction)
assert.equal(handed.archive.requests[0].status, 'handed_off')
assert.equal(handed.archive.items[0].custody, 'handoff')

const claimHandoff: WorldAction = { ...base(handed.archive, 'action-claim-handoff', 'resident-b', 'Sam'), type: 'claim_handoff', payload: { requestId: 'req-umbrella-bus-stop' } }
const transferred = commitWorldAction(handed.archive, claimHandoff)
assert.equal(transferred.archive.requests[0].claimantUserId, 'resident-b')
assert.deepEqual(transferred.receipts.map((entry) => [entry.userId, entry.operation]), [['resident-a', 'remove'], ['resident-b', 'add']])

const completeAction: WorldAction = { ...base(transferred.archive, 'action-complete', 'resident-b', 'Sam'), type: 'complete_request', payload: { requestId: 'req-umbrella-bus-stop' } }
const completed = commitWorldAction(transferred.archive, completeAction)
assert.equal(completed.archive.requests[0].status, 'completed')
assert.equal(completed.archive.items[0].custody, 'returned')
assert.equal(completed.archive.items[0].locationId, 'bus-stop')
assert.equal(completed.receipts[0].operation, 'remove')

const wrongCdn: WorldAction = {
  ...base(completed.archive, 'action-media-wrong-cdn', 'resident-b', 'Sam'),
  type: 'attach_dialogue_media',
  payload: { eventId: completed.committedEvents[0].id, mediaUrl: 'https://example.com/dialogue.png' },
}
assert.throws(() => commitWorldAction(completed.archive, wrongCdn), (error) => error instanceof WorldRuleError && error.code === 'INVALID_ACTION')

const wrongActor: WorldAction = {
  ...base(completed.archive, 'action-media-wrong-actor', 'resident-a', 'Alex'),
  type: 'attach_dialogue_media',
  payload: { eventId: completed.committedEvents[0].id, mediaUrl: 'https://cdn.aiwaves.tech/prod/dialogue.png' },
}
assert.throws(() => commitWorldAction(completed.archive, wrongActor), (error) => error instanceof WorldRuleError && error.code === 'AUTH_REQUIRED')

const attachMedia: WorldAction = {
  ...base(completed.archive, 'action-media', 'resident-b', 'Sam'),
  type: 'attach_dialogue_media',
  payload: { eventId: completed.committedEvents[0].id, mediaUrl: 'https://cdn.aiwaves.tech/prod/dialogue.png' },
}
const attached = commitWorldAction(completed.archive, attachMedia)
assert.equal(attached.committedEvents[0].type, 'dialogue_media_attached')
const secondMedia: WorldAction = { ...attachMedia, actionId: 'action-media-2', expectedVersion: attached.archive.version }
assert.throws(() => commitWorldAction(attached.archive, secondMedia), (error) => error instanceof WorldRuleError && error.code === 'MEDIA_ALREADY_ATTACHED')

const publicArchive = JSON.stringify(attached.archive)
for (const privateField of ['relationship', 'affection', 'privateDialogue', 'freeInput']) {
  assert.equal(publicArchive.includes(privateField), false, `public archive leaked ${privateField}`)
}

const view = readWorld(attached.archive)
assert.equal(view.cursor, attached.archive.events.length)
assert.equal(new Set(view.recentEvents.map((entry) => entry.id)).size, view.recentEvents.length)
assert.equal(view.requests.some((entry) => entry.status === 'completed'), true)

console.log('neighbor-help shared world engine: ok')
