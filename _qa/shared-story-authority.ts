import assert from 'node:assert/strict'
import { commitWorldAction, createWorld } from '../src/shared-world/engine'
import {
  buildSharedCommittedOutcome,
  buildSharedStatusCorrection,
  choicesContainStaleSharedAction,
  classifySharedStoryAction,
  resolveSharedStoryTarget,
  sharedPhaseMarker,
} from '../src/shared-world/storyBridge'
import type { HelpRequest, WorldAction, WorldArchive } from '../src/shared-world/types'
import { neighborHelp, neighborHelpEn } from '../src/story/cartridges/neighborHelp'
import { applyParsedScene, createInitialSave } from '../src/story/engine/reducer'
import { parseStoryProtocol } from '../src/story/engine/protocol'
import type { StoryCartridge, StorySave } from '../src/story/types'

const at = 1_800_000_000_000
const actor = { id: 'resident-alex', name: 'Alex' }

function action(archive: WorldArchive, actionId: string, type: 'claim_request' | 'complete_request'): WorldAction {
  return {
    actionId,
    actor,
    expectedVersion: archive.version,
    createdAt: at,
    type,
    payload: { requestId: 'req-umbrella-bus-stop' },
  }
}

function requestFrom(archive: WorldArchive): HelpRequest {
  const request = archive.requests.find((entry) => entry.id === 'req-umbrella-bus-stop')
  assert.ok(request, 'umbrella request exists')
  return request
}

function visibleTurn(save: StorySave, previousBlockCount: number): string {
  return save.blocks.slice(previousBlockCount)
    .filter((block) => block.kind === 'narration' || block.kind === 'dialogue')
    .map((block) => block.text)
    .join('\n')
}

function applyOutcome(save: StorySave, cartridge: StoryCartridge, outcome: ReturnType<typeof buildSharedCommittedOutcome>): StorySave {
  const next = applyParsedScene(save, parseStoryProtocol(outcome.content, cartridge.locale), cartridge, outcome.actionLabel)
  return { ...next, facts: { ...next.facts, [outcome.marker.key]: outcome.marker.value } }
}

const initialWorld = createWorld(at)
const claimedCommit = commitWorldAction(initialWorld, action(initialWorld, 'claim-umbrella', 'claim_request'))
const claimedRequest = requestFrom(claimedCommit.archive)
assert.equal(sharedPhaseMarker(claimedRequest, actor.id), 'claimed:mine')
assert.equal(resolveSharedStoryTarget('Give it to the waiting resident at the bus stop', 'en', claimedCommit.archive.requests, actor.id)?.intent, 'complete')
assert.equal(resolveSharedStoryTarget('把它送给公交站等车的人', 'zh', claimedCommit.archive.requests, actor.id)?.intent, 'complete')
assert.equal(resolveSharedStoryTarget("I'll take the umbrella", 'en', initialWorld.requests, actor.id)?.request.id, 'req-umbrella-bus-stop')
assert.equal(resolveSharedStoryTarget('我来拿这把伞', 'zh', initialWorld.requests, actor.id)?.request.id, 'req-umbrella-bus-stop')
assert.equal(resolveSharedStoryTarget('I can help', 'en', initialWorld.requests, actor.id), null, 'ambiguous free input remains open narrative instead of guessing a request')

const medicineClaim = commitWorldAction(initialWorld, {
  actionId: 'claim-medicine', actor, expectedVersion: initialWorld.version, createdAt: at,
  type: 'claim_request', payload: { requestId: 'req-medicine-corner' },
})
const medicineTarget = resolveSharedStoryTarget(
  'Hand this request to another resident',
  'en',
  medicineClaim.archive.requests,
  actor.id,
  { 'shared:req-medicine-corner': 'claimed:mine' },
)
assert.equal(medicineTarget?.request.id, 'req-medicine-corner', 'generic follow-up resolves to the active request instead of the umbrella fixture')
assert.equal(medicineTarget?.intent, 'handoff')

for (const cartridge of [neighborHelp, neighborHelpEn]) {
  const openingClaim = cartridge.opening.choices[0].label
  assert.equal(classifySharedStoryAction(openingClaim, cartridge.locale), 'claim', `${cartridge.locale} opening choice is a claim only`)

  const initialStory = createInitialSave(cartridge)
  const claimOutcome = buildSharedCommittedOutcome(cartridge.locale, claimedRequest, 'claim')
  const claimedStory = applyOutcome(initialStory, cartridge, claimOutcome)
  const claimNarrative = visibleTurn(claimedStory, initialStory.blocks.length)

  assert.equal(claimedStory.location, initialStory.location, `${cartridge.locale} claim does not teleport to delivery destination`)
  assert.equal(claimedStory.facts[claimOutcome.marker.key], 'claimed:mine')
  assert.equal(claimedStory.stats.energy, 72, `${cartridge.locale} deterministic claim preserves the authored energy cost`)
  assert.equal(claimedStory.stats.familiarity, 2, `${cartridge.locale} deterministic claim preserves personal progress`)
  assert.equal(/已经完成|已经送达|request is complete|has been delivered/i.test(claimNarrative), false, `${cartridge.locale} claim prose cannot announce completion`)
  assert.equal(claimedStory.choices.some((choice) => classifySharedStoryAction(choice.label, cartridge.locale) === 'claim'), false, `${cartridge.locale} claim option is removed after claim`)
  assert.equal(claimedStory.choices.some((choice) => classifySharedStoryAction(choice.label, cartridge.locale) === 'complete'), true, `${cartridge.locale} delivery remains available after claim`)
  assert.equal(choicesContainStaleSharedAction(claimedStory.choices, claimedRequest, cartridge.locale, actor.id), false)

  const completedCommit = commitWorldAction(claimedCommit.archive, action(claimedCommit.archive, 'complete-umbrella', 'complete_request'))
  const completedRequest = requestFrom(completedCommit.archive)
  const completedOutcome = buildSharedCommittedOutcome(cartridge.locale, completedRequest, 'complete')
  const completedStory = applyOutcome(claimedStory, cartridge, completedOutcome)
  const completeNarrative = visibleTurn(completedStory, claimedStory.blocks.length)

  assert.equal(sharedPhaseMarker(completedRequest, actor.id), 'completed')
  assert.equal(completedCommit.archive.items.find((item) => item.id === 'item-umbrella-last')?.custody, 'returned')
  assert.equal(completedStory.location, cartridge.locale === 'zh' ? '街角公交站' : 'Corner Bus Stop')
  assert.equal(completedStory.stats.energy, 67, `${cartridge.locale} deterministic completion preserves the authored delivery cost`)
  assert.equal(completedStory.stats.familiarity, 3, `${cartridge.locale} deterministic completion preserves personal progress`)
  assert.equal(/已经完成|已经送达|confirms that the request is complete|umbrella arrived/i.test(completeNarrative), true, `${cartridge.locale} completion prose confirms the committed result`)
  assert.equal(completedStory.choices.some((choice) => classifySharedStoryAction(choice.label, cartridge.locale) === 'complete'), false, `${cartridge.locale} completed action is not offered again`)
  assert.equal(choicesContainStaleSharedAction(completedStory.choices, completedRequest, cartridge.locale, actor.id), false)

  const correction = buildSharedStatusCorrection(cartridge.locale, completedRequest, actor.id)
  assert.ok(correction)
  const correctedStory = applyOutcome(claimedStory, cartridge, correction)
  const correctionNarrative = visibleTurn(correctedStory, claimedStory.blocks.length)
  assert.equal(/did not take effect|was not applied|没有生效|没有提交/i.test(correctionNarrative), false, `${cartridge.locale} post-commit correction cannot deny the committed action`)
  assert.equal(choicesContainStaleSharedAction(correctedStory.choices, completedRequest, cartridge.locale, actor.id), false)
}

assert.equal(neighborHelp.transitionAnchor?.includes('shared lobby'), false, 'Chinese cartridge does not leak an English transition anchor')
assert.equal(neighborHelpEn.transitionAnchor?.includes('共享大厅'), false, 'English cartridge does not leak a Chinese transition anchor')

console.log('neighbor-help shared story authority bridge: ok')
