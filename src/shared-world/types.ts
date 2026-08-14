export type Locale = 'zh' | 'en'
export type RequestStatus = 'open' | 'claimed' | 'handed_off' | 'completed' | 'cancelled'
export type ItemCustody = 'community' | 'player' | 'handoff' | 'returned'
export type ReceiptOperation = 'add' | 'remove'

export interface PublicActor {
  id: string
  name: string
  avatarUrl?: string
}

export interface HelpRequest {
  id: string
  titleKey: string
  locationId: string
  destinationId: string
  requiredItemId?: string
  status: RequestStatus
  claimantUserId?: string
  claimantName?: string
  handoffFromUserId?: string
  version: number
  createdAt: number
  expiresAt?: number
}

export interface SharedItem {
  id: string
  kind: 'umbrella' | 'spare_key' | 'parcel' | 'pet_food' | 'medicine_bag'
  custody: ItemCustody
  locationId: string
  holderUserId?: string
  requestId?: string
  version: number
}

export type WorldEventType =
  | 'request_claimed'
  | 'request_handed_off'
  | 'handoff_claimed'
  | 'request_completed'
  | 'item_returned'
  | 'dialogue_media_attached'
  | 'dialogue_media_rejected'

export interface WorldEvent<T = Record<string, unknown>> {
  id: string
  seq: number
  worldVersion: number
  actionId: string
  actor: PublicActor
  type: WorldEventType
  requestId?: string
  itemId?: string
  payload: T
  createdAt: number
}

export interface ProcessedAction {
  id: string
  eventIds: string[]
}

export interface WorldArchive {
  schemaVersion: 1
  worldId: 'neighbor-help-main'
  rulesetId: 'neighbor-help-v1'
  version: number
  cursor: number
  requests: HelpRequest[]
  items: SharedItem[]
  events: WorldEvent[]
  processedActions: ProcessedAction[]
}

export interface ItemReceipt {
  id: string
  userId: string
  sourceEntityId: string
  actionId: string
  operation: ReceiptOperation
  item: { kind: SharedItem['kind']; quantity: 1; instanceId: string }
  createdAt: number
}

export interface PendingItemReceipt {
  receiptId: string
  sourceEntityId: string
  operation: ReceiptOperation
  item: ItemReceipt['item']
  createdAt: number
}

export interface PrivateHeldItem {
  instanceId: string
  kind: SharedItem['kind']
  receiptIds: string[]
  lastChangedAt: number
}

export interface NeighborPlayerSave {
  schemaVersion: 1
  heldItems: PrivateHeldItem[]
  appliedReceiptIds: string[]
  lastSeenCursor: number
  _lastActive?: number
}

export interface WorldView {
  version: number
  cursor: number
  requests: HelpRequest[]
  items: SharedItem[]
  recentEvents: WorldEvent[]
  openRequestCount: number
}

export interface BaseAction {
  actionId: string
  actor: PublicActor
  expectedVersion: number
  createdAt: number
}

export type WorldAction =
  | (BaseAction & { type: 'claim_request'; payload: { requestId: string } })
  | (BaseAction & { type: 'handoff_request'; payload: { requestId: string } })
  | (BaseAction & { type: 'claim_handoff'; payload: { requestId: string } })
  | (BaseAction & { type: 'complete_request'; payload: { requestId: string } })
  | (BaseAction & { type: 'return_item'; payload: { itemId: string } })
  | (BaseAction & { type: 'attach_dialogue_media'; payload: { eventId: string; mediaUrl: string } })
  | (BaseAction & { type: 'reject_dialogue_media'; payload: { attachmentEventId: string; reason: 'pseudotext' | 'identity' | 'location' | 'object_count' | 'other' } })

export type CommitCode =
  | 'COMMITTED'
  | 'DUPLICATE_ACTION'
  | 'VERSION_CONFLICT'
  | 'INVALID_ACTION'
  | 'REQUEST_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE'
  | 'NOT_REQUEST_OWNER'
  | 'ENTITY_NOT_FOUND'
  | 'MEDIA_ALREADY_ATTACHED'
  | 'MEDIA_ALREADY_REJECTED'
  | 'AUTH_REQUIRED'
  | 'RULESET_MISMATCH'

export interface CommitResult {
  accepted: boolean
  duplicate: boolean
  code: CommitCode
  archive: WorldArchive
  committedEvents: WorldEvent[]
  receipts: ItemReceipt[]
}

export class WorldRuleError extends Error {
  constructor(public code: Exclude<CommitCode, 'COMMITTED' | 'DUPLICATE_ACTION'>, message: string) {
    super(message)
    this.name = 'WorldRuleError'
  }
}
