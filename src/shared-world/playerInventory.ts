import type { NeighborPlayerSave, PendingItemReceipt, PrivateHeldItem } from './types'

export function emptyPlayerSave(): NeighborPlayerSave {
  return { schemaVersion: 1, heldItems: [], appliedReceiptIds: [], lastSeenCursor: 0 }
}

export function normalizePlayerSave(input: unknown): NeighborPlayerSave {
  if (!input || typeof input !== 'object') return emptyPlayerSave()
  const candidate = input as Partial<NeighborPlayerSave>
  if (candidate.schemaVersion !== 1) return emptyPlayerSave()
  return {
    schemaVersion: 1,
    heldItems: Array.isArray(candidate.heldItems) ? candidate.heldItems : [],
    appliedReceiptIds: Array.isArray(candidate.appliedReceiptIds) ? candidate.appliedReceiptIds : [],
    lastSeenCursor: Math.max(0, Number(candidate.lastSeenCursor) || 0),
    ...(candidate._lastActive ? { _lastActive: candidate._lastActive } : {}),
  }
}

export function applyPendingReceipts(save: NeighborPlayerSave, receipts: PendingItemReceipt[]): NeighborPlayerSave {
  const applied = new Set(save.appliedReceiptIds)
  const held = new Map<string, PrivateHeldItem>(save.heldItems.map((item) => [item.instanceId, { ...item, receiptIds: [...item.receiptIds] }]))
  for (const receipt of [...receipts].sort((a, b) => a.createdAt - b.createdAt)) {
    if (applied.has(receipt.receiptId)) continue
    const current = held.get(receipt.item.instanceId)
    if (receipt.operation === 'add') {
      held.set(receipt.item.instanceId, {
        instanceId: receipt.item.instanceId,
        kind: receipt.item.kind,
        receiptIds: [...(current?.receiptIds ?? []), receipt.receiptId],
        lastChangedAt: receipt.createdAt,
      })
    } else {
      held.delete(receipt.item.instanceId)
    }
    applied.add(receipt.receiptId)
  }
  return { ...save, heldItems: [...held.values()], appliedReceiptIds: [...applied].slice(-800) }
}
