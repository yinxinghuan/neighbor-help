import type {
  CommitResult,
  HelpRequest,
  ItemReceipt,
  SharedItem,
  WorldAction,
  WorldArchive,
  WorldEvent,
  WorldView,
} from './types'
import { WorldRuleError } from './types'

function cleanActor(action: WorldAction) {
  return {
    id: action.actor.id.trim().slice(0, 100),
    name: action.actor.name.trim().slice(0, 40) || 'Resident',
    ...(action.actor.avatarUrl ? { avatarUrl: action.actor.avatarUrl.trim().slice(0, 500) } : {}),
  }
}

export function createWorld(now = Date.now()): WorldArchive {
  return {
    schemaVersion: 1,
    worldId: 'neighbor-help-main',
    rulesetId: 'neighbor-help-v1',
    version: 1,
    cursor: 0,
    requests: [
      { id: 'req-umbrella-bus-stop', titleKey: 'umbrellaBusStop', locationId: 'lobby', destinationId: 'bus-stop', requiredItemId: 'item-umbrella-last', status: 'open', version: 1, createdAt: now },
      { id: 'req-medicine-corner', titleKey: 'medicinePickup', locationId: 'corner-shop', destinationId: 'apartment-2b', requiredItemId: 'item-medicine-bag', status: 'open', version: 1, createdAt: now },
      { id: 'req-pet-courtyard', titleKey: 'petCare', locationId: 'courtyard', destinationId: 'courtyard', status: 'open', version: 1, createdAt: now },
    ],
    items: [
      { id: 'item-umbrella-last', kind: 'umbrella', custody: 'community', locationId: 'lobby', version: 1 },
      { id: 'item-medicine-bag', kind: 'medicine_bag', custody: 'community', locationId: 'corner-shop', version: 1 },
      { id: 'item-spare-key', kind: 'spare_key', custody: 'community', locationId: 'lobby', version: 1 },
    ],
    events: [],
    processedActions: [],
  }
}

export function rebuildArchive(input: unknown): WorldArchive {
  if (!input || typeof input !== 'object') return createWorld()
  const candidate = input as Partial<WorldArchive>
  if (candidate.schemaVersion !== 1 || candidate.rulesetId !== 'neighbor-help-v1') return createWorld()
  return {
    schemaVersion: 1,
    worldId: 'neighbor-help-main',
    rulesetId: 'neighbor-help-v1',
    version: Math.max(1, Number(candidate.version) || 1),
    cursor: Math.max(0, Number(candidate.cursor) || 0),
    requests: Array.isArray(candidate.requests) ? candidate.requests : createWorld().requests,
    items: Array.isArray(candidate.items) ? candidate.items : createWorld().items,
    events: Array.isArray(candidate.events) ? candidate.events : [],
    processedActions: Array.isArray(candidate.processedActions) ? candidate.processedActions.slice(-800) : [],
  }
}

export function readWorld(archive: WorldArchive): WorldView {
  return {
    version: archive.version,
    cursor: archive.cursor,
    requests: archive.requests.map((request) => ({ ...request })),
    items: archive.items.map((item) => ({ ...item })),
    recentEvents: archive.events.slice(-20),
    openRequestCount: archive.requests.filter((request) => request.status === 'open' || request.status === 'handed_off').length,
  }
}

function event(archive: WorldArchive, action: WorldAction, type: WorldEvent['type'], details: Pick<WorldEvent, 'requestId' | 'itemId'> & { payload?: Record<string, unknown> }): WorldEvent {
  return {
    id: crypto.randomUUID(),
    seq: archive.cursor + 1,
    worldVersion: archive.version + 1,
    actionId: action.actionId,
    actor: cleanActor(action),
    type,
    ...(details.requestId ? { requestId: details.requestId } : {}),
    ...(details.itemId ? { itemId: details.itemId } : {}),
    payload: details.payload ?? {},
    createdAt: action.createdAt,
  }
}

function receipt(action: WorldAction, sourceEntityId: string, item: SharedItem, operation: ItemReceipt['operation'], userId = action.actor.id): ItemReceipt {
  return {
    id: crypto.randomUUID(),
    userId,
    sourceEntityId,
    actionId: action.actionId,
    operation,
    item: { kind: item.kind, quantity: 1, instanceId: item.id },
    createdAt: action.createdAt,
  }
}

function validate(archive: WorldArchive, action: WorldAction) {
  const previous = archive.processedActions.find((entry) => entry.id === action.actionId)
  if (previous) return previous
  if (!action.actionId.trim() || !action.actor.id.trim()) throw new WorldRuleError('INVALID_ACTION', 'Missing action or actor identity')
  if (action.expectedVersion !== archive.version) throw new WorldRuleError('VERSION_CONFLICT', `Expected v${action.expectedVersion}; current v${archive.version}`)
  return null
}

function commit(archive: WorldArchive, action: WorldAction, requests: HelpRequest[], items: SharedItem[], committedEvents: WorldEvent[], receipts: ItemReceipt[]): CommitResult {
  const next: WorldArchive = {
    ...archive,
    version: archive.version + 1,
    cursor: archive.cursor + committedEvents.length,
    requests,
    items,
    events: [...archive.events, ...committedEvents],
    processedActions: [...archive.processedActions, { id: action.actionId, eventIds: committedEvents.map((entry) => entry.id) }].slice(-800),
  }
  return { accepted: true, duplicate: false, code: 'COMMITTED', archive: next, committedEvents, receipts }
}

export function commitWorldAction(archive: WorldArchive, action: WorldAction): CommitResult {
  const previous = validate(archive, action)
  if (previous) {
    const committedEvents = archive.events.filter((entry) => previous.eventIds.includes(entry.id))
    return { accepted: true, duplicate: true, code: 'DUPLICATE_ACTION', archive, committedEvents, receipts: [] }
  }

  const requests = archive.requests.map((request) => ({ ...request }))
  const items = archive.items.map((item) => ({ ...item }))
  const requestFor = (id: string) => {
    const request = requests.find((entry) => entry.id === id)
    if (!request) throw new WorldRuleError('ENTITY_NOT_FOUND', 'Request not found')
    return request
  }
  const itemFor = (id: string) => {
    const item = items.find((entry) => entry.id === id)
    if (!item) throw new WorldRuleError('ENTITY_NOT_FOUND', 'Item not found')
    return item
  }

  if (action.type === 'claim_request') {
    const request = requestFor(action.payload.requestId)
    if (request.status !== 'open') throw new WorldRuleError('REQUEST_UNAVAILABLE', 'Request is no longer open')
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : undefined
    if (item && item.custody !== 'community' && item.custody !== 'returned') throw new WorldRuleError('ITEM_UNAVAILABLE', 'Required item is no longer available')
    request.status = 'claimed'
    request.claimantUserId = action.actor.id
    request.claimantName = cleanActor(action).name
    request.handoffFromUserId = undefined
    request.version += 1
    const receipts: ItemReceipt[] = []
    if (item) {
      item.custody = 'player'
      item.holderUserId = action.actor.id
      item.requestId = request.id
      item.version += 1
      receipts.push(receipt(action, request.id, item, 'add'))
    }
    const committed = event(archive, action, 'request_claimed', { requestId: request.id, itemId: item?.id, payload: { destinationId: request.destinationId } })
    return commit(archive, action, requests, items, [committed], receipts)
  }

  if (action.type === 'handoff_request') {
    const request = requestFor(action.payload.requestId)
    if (request.status !== 'claimed') throw new WorldRuleError('REQUEST_UNAVAILABLE', 'Request cannot be handed off now')
    if (request.claimantUserId !== action.actor.id) throw new WorldRuleError('NOT_REQUEST_OWNER', 'Only the current helper may hand off this request')
    request.status = 'handed_off'
    request.handoffFromUserId = action.actor.id
    request.claimantUserId = undefined
    request.claimantName = undefined
    request.version += 1
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : undefined
    if (item) { item.custody = 'handoff'; item.version += 1 }
    const committed = event(archive, action, 'request_handed_off', { requestId: request.id, itemId: item?.id })
    return commit(archive, action, requests, items, [committed], [])
  }

  if (action.type === 'claim_handoff') {
    const request = requestFor(action.payload.requestId)
    if (request.status !== 'handed_off') throw new WorldRuleError('REQUEST_UNAVAILABLE', 'Handoff is no longer available')
    if (request.handoffFromUserId === action.actor.id) throw new WorldRuleError('INVALID_ACTION', 'The same helper cannot reclaim their own handoff')
    const previousUserId = request.handoffFromUserId
    request.status = 'claimed'
    request.claimantUserId = action.actor.id
    request.claimantName = cleanActor(action).name
    request.handoffFromUserId = undefined
    request.version += 1
    const receipts: ItemReceipt[] = []
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : undefined
    if (item) {
      if (item.custody !== 'handoff') throw new WorldRuleError('ITEM_UNAVAILABLE', 'The shared item is not ready for handoff')
      if (previousUserId) receipts.push(receipt(action, request.id, item, 'remove', previousUserId))
      receipts.push(receipt(action, request.id, item, 'add'))
      item.custody = 'player'
      item.holderUserId = action.actor.id
      item.version += 1
    }
    const committed = event(archive, action, 'handoff_claimed', { requestId: request.id, itemId: item?.id, payload: { previousUserId } })
    return commit(archive, action, requests, items, [committed], receipts)
  }

  if (action.type === 'complete_request') {
    const request = requestFor(action.payload.requestId)
    if (request.status !== 'claimed') throw new WorldRuleError('REQUEST_UNAVAILABLE', 'Request is not active')
    if (request.claimantUserId !== action.actor.id) throw new WorldRuleError('NOT_REQUEST_OWNER', 'Only the current helper may complete this request')
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : undefined
    if (item && item.holderUserId !== action.actor.id) throw new WorldRuleError('ITEM_UNAVAILABLE', 'Required item is not held by this helper')
    request.status = 'completed'
    request.version += 1
    const receipts: ItemReceipt[] = []
    if (item) {
      receipts.push(receipt(action, request.id, item, 'remove'))
      item.custody = 'returned'
      item.locationId = request.destinationId
      item.holderUserId = undefined
      item.requestId = undefined
      item.version += 1
    }
    const committed = event(archive, action, 'request_completed', { requestId: request.id, itemId: item?.id, payload: { destinationId: request.destinationId } })
    return commit(archive, action, requests, items, [committed], receipts)
  }

  if (action.type === 'return_item') {
    const item = itemFor(action.payload.itemId)
    if (item.holderUserId !== action.actor.id) throw new WorldRuleError('ITEM_UNAVAILABLE', 'Item is not held by this helper')
    const linkedRequest = item.requestId ? requestFor(item.requestId) : undefined
    if (linkedRequest?.status === 'claimed') {
      linkedRequest.status = 'open'
      linkedRequest.claimantUserId = undefined
      linkedRequest.claimantName = undefined
      linkedRequest.version += 1
    }
    const receipts = [receipt(action, linkedRequest?.id ?? item.id, item, 'remove')]
    item.custody = 'community'
    item.locationId = linkedRequest?.locationId ?? item.locationId
    item.holderUserId = undefined
    item.requestId = undefined
    item.version += 1
    const committed = event(archive, action, 'item_returned', { requestId: linkedRequest?.id, itemId: item.id })
    return commit(archive, action, requests, items, [committed], receipts)
  }

  if (action.type === 'attach_dialogue_media') {
    const source = archive.events.find((entry) => entry.id === action.payload.eventId)
    if (!source) throw new WorldRuleError('ENTITY_NOT_FOUND', 'Dialogue event not found')
    if (source.actor.id !== action.actor.id) throw new WorldRuleError('AUTH_REQUIRED', 'Only the event actor may attach its dialogue media')
    const rejectedIds = new Set(archive.events.filter((entry) => entry.type === 'dialogue_media_rejected').map((entry) => String(entry.payload.attachmentEventId)))
    const existing = archive.events.find((entry) => entry.type === 'dialogue_media_attached' && entry.payload.sourceEventId === source.id && !rejectedIds.has(entry.id))
    if (existing) throw new WorldRuleError('MEDIA_ALREADY_ATTACHED', 'Dialogue event already has media')
    const mediaUrl = action.payload.mediaUrl.trim()
    if (!/^https:\/\/cdn\.aiwaves\.tech\//.test(mediaUrl)) throw new WorldRuleError('INVALID_ACTION', 'Media URL must use the AlterU media CDN')
    const committed = event(archive, action, 'dialogue_media_attached', { requestId: source.requestId, payload: { sourceEventId: source.id, mediaUrl: mediaUrl.slice(0, 800) } })
    return commit(archive, action, requests, items, [committed], [])
  }

  if (action.type === 'reject_dialogue_media') {
    const attachment = archive.events.find((entry) => entry.id === action.payload.attachmentEventId && entry.type === 'dialogue_media_attached')
    if (!attachment) throw new WorldRuleError('ENTITY_NOT_FOUND', 'Dialogue media attachment not found')
    if (attachment.actor.id !== action.actor.id) throw new WorldRuleError('AUTH_REQUIRED', 'Only the event actor may reject its dialogue media')
    const alreadyRejected = archive.events.some((entry) => entry.type === 'dialogue_media_rejected' && entry.payload.attachmentEventId === attachment.id)
    if (alreadyRejected) throw new WorldRuleError('MEDIA_ALREADY_REJECTED', 'Dialogue media attachment is already rejected')
    const reasons = new Set(['pseudotext', 'identity', 'location', 'object_count', 'other'])
    if (!reasons.has(action.payload.reason)) throw new WorldRuleError('INVALID_ACTION', 'Unsupported media rejection reason')
    const committed = event(archive, action, 'dialogue_media_rejected', {
      requestId: attachment.requestId,
      payload: { sourceEventId: attachment.payload.sourceEventId, attachmentEventId: attachment.id, reason: action.payload.reason },
    })
    return commit(archive, action, requests, items, [committed], [])
  }

  throw new WorldRuleError('INVALID_ACTION', 'Unsupported action')
}
