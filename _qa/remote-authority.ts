import assert from 'node:assert/strict'
import { generateImageMedia } from '../src/shared/runtime/media'

const base = String(process.env.BASE_URL || '').replace(/\/+$/, '')
if (!/^https:\/\//.test(base)) throw new Error('BASE_URL must be the deployed HTTPS game URL')
const worldKey = process.env.WORLD_KEY || 'main'
const rulesetVersion = 1

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => null) as any
  return { response, body }
}

async function post(path: string, body: unknown) {
  return request(path, { method: 'POST', body: JSON.stringify(body) })
}

function action(actionId: string, userId: string, expectedVersion: number, type: string, payload: unknown) {
  return post('/api/world/action', {
    world_key: worldKey,
    action_id: actionId,
    user_id: userId,
    telegram_id: userId,
    actor_profile: { name: userId === 'authority-alex' ? 'Alex' : 'Sam' },
    expected_version: expectedVersion,
    ruleset_version: rulesetVersion,
    type,
    payload,
  })
}

const health = await request('/api/health')
assert.equal(health.response.status, 200)
assert.equal(health.body.storage, 'durable-object-sqlite')

if (health.body.lab_mode) {
  const reset = await post('/api/world/lab/reset', { world_key: worldKey })
  assert.equal(reset.response.status, 200)
}

const ensure = await post('/api/world/ensure', { world_key: worldKey, ruleset_id: 'neighbor-help-v1' })
assert.equal(ensure.response.status, 200)
const initialVersion = ensure.body.version
const initialCursor = ensure.body.cursor

const [raceA, raceB] = await Promise.all([
  action('authority-race-a', 'authority-alex', initialVersion, 'claim_request', { requestId: 'req-umbrella-bus-stop' }),
  action('authority-race-b', 'authority-sam', initialVersion, 'claim_request', { requestId: 'req-umbrella-bus-stop' }),
])
assert.deepEqual([raceA.response.status, raceB.response.status].sort(), [200, 409])
const winnerResult = raceA.response.ok ? raceA : raceB
const loserResult = raceA.response.ok ? raceB : raceA
const winnerId = raceA.response.ok ? 'authority-alex' : 'authority-sam'
const loserId = raceA.response.ok ? 'authority-sam' : 'authority-alex'
const winnerActionId = raceA.response.ok ? 'authority-race-a' : 'authority-race-b'
const loserActionId = raceA.response.ok ? 'authority-race-b' : 'authority-race-a'
assert.equal(loserResult.body.code, 'VERSION_CONFLICT')
assert.equal(winnerResult.body.committed_events.length, 1)

const duplicate = await action(winnerActionId, winnerId, 0, 'claim_request', { requestId: 'req-umbrella-bus-stop' })
assert.equal(duplicate.response.status, 200)
assert.equal(duplicate.body.duplicate, true)
assert.equal(duplicate.body.committed_events[0].id, winnerResult.body.committed_events[0].id)

const unavailable = await action(loserActionId, loserId, winnerResult.body.version, 'claim_request', { requestId: 'req-umbrella-bus-stop' })
assert.equal(unavailable.response.status, 409)
assert.equal(unavailable.body.code, 'REQUEST_UNAVAILABLE')

const afterRace = await request(`/api/world/state?world_key=${encodeURIComponent(worldKey)}&after_cursor=${initialCursor}`)
assert.equal(afterRace.body.events.length, 1)
assert.equal(afterRace.body.snapshot.items.find((entry: any) => entry.id === 'item-umbrella-last').holderUserId, winnerId)

const grantsFor = (userId: string) => request(`/api/world/grants?world_key=${encodeURIComponent(worldKey)}&user_id=${encodeURIComponent(userId)}&status=pending`)
let winnerGrants = await grantsFor(winnerId)
assert.equal(winnerGrants.body.receipts.length, 1)
assert.equal(winnerGrants.body.receipts[0].operation, 'add')
const firstReceiptId = winnerGrants.body.receipts[0].receipt_id

const wrongAck = await post('/api/world/grant/ack', { world_key: worldKey, receipt_id: firstReceiptId, user_id: loserId, telegram_id: loserId })
assert.equal(wrongAck.response.status, 200)
winnerGrants = await grantsFor(winnerId)
assert.equal(winnerGrants.body.receipts.length, 1)
await post('/api/world/grant/ack', { world_key: worldKey, receipt_id: firstReceiptId, user_id: winnerId, telegram_id: winnerId })
assert.equal((await grantsFor(winnerId)).body.receipts.length, 0)

const handoff = await action('authority-handoff', winnerId, afterRace.body.snapshot.version, 'handoff_request', { requestId: 'req-umbrella-bus-stop' })
assert.equal(handoff.response.status, 200)
const takeOver = await action('authority-takeover', loserId, handoff.body.version, 'claim_handoff', { requestId: 'req-umbrella-bus-stop' })
assert.equal(takeOver.response.status, 200)
assert.deepEqual(takeOver.body.grant_receipts.map((entry: any) => `${entry.userId}:${entry.operation}`).sort(), [`${loserId}:add`, `${winnerId}:remove`].sort())

for (const userId of [winnerId, loserId]) {
  const pending = await grantsFor(userId)
  assert.equal(pending.body.receipts.length, 1)
  await post('/api/world/grant/ack', { world_key: worldKey, receipt_id: pending.body.receipts[0].receipt_id, user_id: userId, telegram_id: userId })
}

const completed = await action('authority-complete', loserId, takeOver.body.version, 'complete_request', { requestId: 'req-umbrella-bus-stop' })
assert.equal(completed.response.status, 200)
assert.equal(completed.body.snapshot.items.find((entry: any) => entry.id === 'item-umbrella-last').custody, 'returned')
const completionEventId = completed.body.committed_events[0].id
const completionReceipt = (await grantsFor(loserId)).body.receipts[0]
assert.equal(completionReceipt.operation, 'remove')
await post('/api/world/grant/ack', { world_key: worldKey, receipt_id: completionReceipt.receipt_id, user_id: loserId, telegram_id: loserId })

const realMedia = await generateImageMedia({
  sessionId: '00c8cbf4-9fba-44b6-b895-03361f71ba34',
  requestId: '72d1bc53-3636-4d78-a4ff-5f177ff90ec2',
  mode: 'text',
  prompt: 'Region-neutral contemporary apartment-community story illustration. At a sheltered bus stop beside a small rain garden, one resident receives the returned shared umbrella from another resident and answers with a relieved, grateful expression. Diverse ordinary clothing, warm editorial gouache, eye-level medium shot. No signs, no noticeboards, no speech bubbles, no text-bearing objects, no letters, no logos, no signature, no national flags, no country-specific architecture. Exactly one umbrella visible.',
  referenceUrls: [],
  size: { width: 768, height: 576 },
}, { timeoutMs: 12 * 60_000, pollIntervalMs: 10_000 })
assert.equal(realMedia.media.type, 'image')
assert.match(realMedia.media.url, /^https:\/\/cdn\.aiwaves\.tech\//)

const wrongActorMedia = await action('authority-media-wrong-actor', winnerId, completed.body.version, 'attach_dialogue_media', { eventId: completionEventId, mediaUrl: realMedia.media.url })
assert.equal(wrongActorMedia.response.status, 401)
assert.equal(wrongActorMedia.body.code, 'AUTH_REQUIRED')
const wrongCdnMedia = await action('authority-media-wrong-cdn', loserId, completed.body.version, 'attach_dialogue_media', { eventId: completionEventId, mediaUrl: 'https://example.com/fake.png' })
assert.equal(wrongCdnMedia.response.status, 400)
assert.equal(wrongCdnMedia.body.code, 'INVALID_ACTION')
const attached = await action('authority-media-attach', loserId, completed.body.version, 'attach_dialogue_media', { eventId: completionEventId, mediaUrl: realMedia.media.url })
assert.equal(attached.response.status, 200)
assert.equal(attached.body.committed_events[0].payload.mediaUrl, realMedia.media.url)
const secondAttachment = await action('authority-media-second', loserId, attached.body.version, 'attach_dialogue_media', { eventId: completionEventId, mediaUrl: realMedia.media.url })
assert.equal(secondAttachment.response.status, 409)
assert.equal(secondAttachment.body.code, 'MEDIA_ALREADY_ATTACHED')
const replayAttachment = await action('authority-media-attach', loserId, 0, 'attach_dialogue_media', { eventId: completionEventId, mediaUrl: realMedia.media.url })
assert.equal(replayAttachment.response.status, 200)
assert.equal(replayAttachment.body.duplicate, true)

const finalState = await request(`/api/world/state?world_key=${encodeURIComponent(worldKey)}&after_cursor=0`)
assert.equal(finalState.body.snapshot.events.filter((entry: any) => entry.type === 'dialogue_media_attached' && entry.payload.sourceEventId === completionEventId).length, 1)
const publicJson = JSON.stringify(finalState.body.snapshot)
for (const privateField of ['relationship', 'affection', 'privateDialogue', 'freeInput']) assert.equal(publicJson.includes(privateField), false)

const reportA = await post('/api/world/report', { world_key: worldKey, user_id: winnerId, entity_id: completionEventId, reason: 'qa duplicate report check' })
const reportB = await post('/api/world/report', { world_key: worldKey, user_id: winnerId, entity_id: completionEventId, reason: 'qa duplicate report check' })
assert.equal(reportA.response.status, 200)
assert.equal(reportB.body.duplicate, true)

console.log(JSON.stringify({
  ok: true,
  identityMode: health.body.identity_mode,
  winnerId,
  finalVersion: finalState.body.snapshot.version,
  finalCursor: finalState.body.snapshot.cursor,
  mediaTaskId: realMedia.task_id,
  mediaUrl: realMedia.media.url,
}))
