import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
source = source
  .replace('import { DurableObject } from "cloudflare:workers";', '')
  .replace('export class WorldRoom', 'class WorldRoom')
  .replace('export async function handleApi', 'async function handleApi')
source += '\nglobalThis.__workerRules = { initialArchive, applyAction, allowedWorldKey };'

const sandbox = {
  crypto: { randomUUID },
  URL,
  Response,
  DurableObject: class {},
  globalThis: {},
}
vm.runInNewContext(source, sandbox)
const { initialArchive, applyAction, allowedWorldKey } = sandbox.globalThis.__workerRules

assert.equal(allowedWorldKey({ LAB_MODE: 'false' }, 'attacker-room'), 'main')
assert.equal(allowedWorldKey({ LAB_MODE: 'true' }, 'qa-room'), 'qa-room')

const initial = initialArchive(1000)
const action = {
  actionId: 'worker-action-a', actor: { id: 'worker-a', name: 'Alex' }, expectedVersion: 1, createdAt: 2000,
  type: 'claim_request', payload: { requestId: 'req-umbrella-bus-stop' },
}
const claimed = applyAction(initial, action)
assert.equal(claimed.archive.requests[0].claimantUserId, 'worker-a')
assert.equal(claimed.archive.items[0].holderUserId, 'worker-a')
assert.equal(claimed.receipts.length, 1)

const mediaAttached = applyAction(claimed.archive, {
  ...action, actionId: 'worker-media-attach', type: 'attach_dialogue_media',
  payload: { eventId: claimed.events[0].id, mediaUrl: 'https://cdn.aiwaves.tech/prod/first.png' },
})
const mediaRejected = applyAction(mediaAttached.archive, {
  ...action, actionId: 'worker-media-reject', type: 'reject_dialogue_media',
  payload: { attachmentEventId: mediaAttached.events[0].id, reason: 'pseudotext' },
})
const mediaReplaced = applyAction(mediaRejected.archive, {
  ...action, actionId: 'worker-media-replace', type: 'attach_dialogue_media',
  payload: { eventId: claimed.events[0].id, mediaUrl: 'https://cdn.aiwaves.tech/prod/clean.png' },
})
assert.equal(mediaReplaced.events[0].payload.mediaUrl, 'https://cdn.aiwaves.tech/prod/clean.png')

assert.throws(() => applyAction(claimed.archive, { ...action, actionId: 'worker-action-b', actor: { id: 'worker-b', name: 'Sam' } }), (error) => error.code === 'REQUEST_UNAVAILABLE')

const handed = applyAction(claimed.archive, { ...action, actionId: 'worker-handoff', type: 'handoff_request', payload: { requestId: 'req-umbrella-bus-stop' } })
const transferred = applyAction(handed.archive, { ...action, actionId: 'worker-takeover', actor: { id: 'worker-b', name: 'Sam' }, type: 'claim_handoff', payload: { requestId: 'req-umbrella-bus-stop' } })
assert.equal(transferred.archive.items[0].holderUserId, 'worker-b')
assert.deepEqual(Array.from(transferred.receipts, (entry) => `${entry.userId}:${entry.operation}`), ['worker-a:remove', 'worker-b:add'])

assert.match(source, /action_result_cache/)
assert.match(source, /expected_version/)
assert.match(source, /unverified-production-beta/)
assert.match(source, /hostname !== "cdn\.aiwaves\.tech"/)

console.log('neighbor-help worker rules: ok')
