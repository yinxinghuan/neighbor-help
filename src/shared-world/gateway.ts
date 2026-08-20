import { commitWorldAction, createWorld, readWorld, rebuildArchive } from './engine'
import type { CommitResult, ItemReceipt, PendingItemReceipt, WorldAction, WorldArchive, WorldEvent, WorldView } from './types'

export interface SharedWorldGateway {
  readonly mode: 'local' | 'remote'
  load(afterCursor?: number): Promise<{ archive: WorldArchive; view: WorldView; events: WorldEvent[] }>
  commit(action: WorldAction): Promise<CommitResult>
  listPendingReceipts(userId: string): Promise<PendingItemReceipt[]>
  acknowledgeReceipt(receiptId: string, userId: string): Promise<void>
  reset(): Promise<WorldArchive>
}

type LocalReceipt = ItemReceipt & { acknowledgedAt?: number }

export class LocalSharedWorldGateway implements SharedWorldGateway {
  readonly mode = 'local' as const
  constructor(private archiveKey = 'neighbor-help-shared-world-v1', private receiptKey = 'neighbor-help-shared-receipts-v1') {}

  private readArchive() {
    try {
      const raw = alteruLocalStorage.getItem(this.archiveKey)
      if (raw) return rebuildArchive(JSON.parse(raw))
    } catch { /* use fresh */ }
    const archive = createWorld()
    this.writeArchive(archive)
    return archive
  }

  private writeArchive(archive: WorldArchive) {
    alteruLocalStorage.setItem(this.archiveKey, JSON.stringify(archive))
  }

  private readReceipts(): LocalReceipt[] {
    try {
      const raw = alteruLocalStorage.getItem(this.receiptKey)
      return raw ? JSON.parse(raw) as LocalReceipt[] : []
    } catch { return [] }
  }

  private writeReceipts(receipts: LocalReceipt[]) {
    alteruLocalStorage.setItem(this.receiptKey, JSON.stringify(receipts.slice(-800)))
  }

  async load(afterCursor = 0) {
    const archive = this.readArchive()
    return { archive, view: readWorld(archive), events: archive.events.filter((event) => event.seq > afterCursor) }
  }

  async commit(action: WorldAction) {
    const current = this.readArchive()
    const result = commitWorldAction(current, action)
    if (!result.duplicate) {
      this.writeArchive(result.archive)
      const existing = this.readReceipts()
      const ids = new Set(existing.map((entry) => entry.id))
      this.writeReceipts([...existing, ...result.receipts.filter((entry) => !ids.has(entry.id))])
    }
    return result
  }

  async listPendingReceipts(userId: string): Promise<PendingItemReceipt[]> {
    return this.readReceipts().filter((entry) => entry.userId === userId && !entry.acknowledgedAt).map((entry) => ({
      receiptId: entry.id,
      sourceEntityId: entry.sourceEntityId,
      operation: entry.operation,
      item: entry.item,
      createdAt: entry.createdAt,
    }))
  }

  async acknowledgeReceipt(receiptId: string, userId: string) {
    this.writeReceipts(this.readReceipts().map((entry) => entry.id === receiptId && entry.userId === userId ? { ...entry, acknowledgedAt: Date.now() } : entry))
  }

  async reset() {
    const archive = createWorld()
    this.writeArchive(archive)
    this.writeReceipts([])
    return archive
  }
}

export class RemoteSharedWorldGateway implements SharedWorldGateway {
  readonly mode = 'remote' as const
  constructor(private apiBase: string, private allowLabControls = false, private worldKey = 'main') {
    this.apiBase = apiBase.replace(/\/+$/, '')
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    const payload = await response.json().catch(() => ({ code: 'INVALID_ACTION' })) as T & { code?: string }
    if (!response.ok) {
      const error = new Error(payload.code || `HTTP_${response.status}`) as Error & { code: string; payload?: unknown }
      error.code = payload.code || 'INVALID_ACTION'
      error.payload = payload
      throw error
    }
    return payload
  }

  async load(afterCursor = 0) {
    await this.api('/api/world/ensure', { method: 'POST', body: JSON.stringify({ world_key: this.worldKey, ruleset_id: 'neighbor-help-v1' }) })
    const state = await this.api<{ snapshot: unknown; events?: WorldEvent[] }>(`/api/world/state?world_key=${encodeURIComponent(this.worldKey)}&after_cursor=${Math.max(0, afterCursor)}&event_limit=100`)
    const archive = rebuildArchive(state.snapshot)
    return { archive, view: readWorld(archive), events: state.events ?? archive.events.filter((event) => event.seq > afterCursor) }
  }

  async commit(action: WorldAction): Promise<CommitResult> {
    type ActionResponse = { duplicate: boolean; code: string; committed_events?: WorldEvent[]; grant_receipts?: ItemReceipt[]; snapshot: unknown }
    const request: RequestInit = {
      method: 'POST',
      body: JSON.stringify({
        world_key: this.worldKey,
        action_id: action.actionId,
        user_id: action.actor.id,
        telegram_id: action.actor.id,
        actor_profile: { name: action.actor.name, avatar_url: action.actor.avatarUrl },
        expected_version: action.expectedVersion,
        ruleset_version: 1,
        type: action.type,
        payload: action.payload,
      }),
    }
    const submit = () => this.api<ActionResponse>('/api/world/action', request)
    let response: ActionResponse
    try {
      response = await submit()
    } catch (firstError) {
      // An API error is an authoritative rejection. A transport error is an
      // unknown outcome: retry the exact same action id so the worker can
      // return its cached result without executing the action twice.
      if (typeof firstError === 'object' && firstError && 'code' in firstError) throw firstError
      try {
        response = await submit()
      } catch (retryError) {
        if (typeof retryError === 'object' && retryError && 'code' in retryError) throw retryError
        // If both responses were lost, reconcile against the authoritative
        // event log before reporting failure. Receipts remain recoverable via
        // listPendingReceipts and must not be acknowledged here.
        const latest = await this.load(0).catch(() => null)
        const committedEvents = latest?.events.filter((event) => event.actionId === action.actionId) ?? []
        if (!latest || committedEvents.length === 0) throw firstError
        return {
          accepted: true,
          duplicate: true,
          code: 'DUPLICATE_ACTION',
          archive: latest.archive,
          committedEvents,
          receipts: [],
        }
      }
    }
    const archive = rebuildArchive(response.snapshot)
    return {
      accepted: true,
      duplicate: Boolean(response.duplicate),
      code: response.duplicate ? 'DUPLICATE_ACTION' : 'COMMITTED',
      archive,
      committedEvents: response.committed_events ?? [],
      receipts: response.grant_receipts ?? [],
    }
  }

  async listPendingReceipts(userId: string): Promise<PendingItemReceipt[]> {
    const response = await this.api<{ receipts?: Array<{ receipt_id: string; source_entity_id: string; operation: 'add' | 'remove'; item: PendingItemReceipt['item']; created_at: number }> }>(`/api/world/grants?world_key=${encodeURIComponent(this.worldKey)}&user_id=${encodeURIComponent(userId)}&status=pending`)
    return (response.receipts ?? []).map((entry) => ({ receiptId: entry.receipt_id, sourceEntityId: entry.source_entity_id, operation: entry.operation, item: entry.item, createdAt: entry.created_at }))
  }

  async acknowledgeReceipt(receiptId: string, userId: string) {
    await this.api('/api/world/grant/ack', { method: 'POST', body: JSON.stringify({ world_key: this.worldKey, receipt_id: receiptId, user_id: userId, telegram_id: userId }) })
  }

  async reset() {
    if (!this.allowLabControls) {
      const error = new Error('INVALID_ACTION') as Error & { code: string }
      error.code = 'INVALID_ACTION'
      throw error
    }
    const response = await this.api<{ snapshot: unknown }>('/api/world/lab/reset', { method: 'POST', body: JSON.stringify({ world_key: this.worldKey }) })
    return rebuildArchive(response.snapshot)
  }
}
