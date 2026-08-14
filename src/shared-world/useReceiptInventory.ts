import { useCallback, useEffect, useRef, useState } from 'react'
import { useGameSave } from '../shared/save/useGameSave'
import { callAigramAPI, isInAigram, telegramId, type AigramResponse } from '../shared/runtime/bridge'
import { getGameUuid } from '../shared/runtime/game-id'
import type { SharedWorldGateway } from './gateway'
import { applyPendingReceipts, emptyPlayerSave, normalizePlayerSave } from './playerInventory'
import type { NeighborPlayerSave } from './types'

interface SaveRow { user_id: string; resource_data: string }
type SyncStatus = 'unavailable' | 'idle' | 'syncing' | 'saved' | 'pending' | 'error'
const namespace = 'neighbor-help-shared-player'
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

function hasReceipts(input: unknown, receiptIds: string[]) {
  if (!input || typeof input !== 'object') return false
  const root = input as { __alteruSaveEnvelope?: number; namespaces?: Record<string, unknown>; appliedReceiptIds?: string[] }
  const data = root.__alteruSaveEnvelope === 1 ? root.namespaces?.[namespace] : root
  const applied = Array.isArray((data as NeighborPlayerSave | undefined)?.appliedReceiptIds) ? (data as NeighborPlayerSave).appliedReceiptIds : []
  return receiptIds.every((id) => applied.includes(id))
}

async function cloudContains(receiptIds: string[]) {
  const sessionId = getGameUuid()
  if (!isInAigram || !sessionId || !telegramId) return false
  try {
    const response = await callAigramAPI<AigramResponse<SaveRow[]>>(`/note/aigram/ai/game/get/data/list?session_id=${encodeURIComponent(sessionId)}`)
    const mine = (Array.isArray(response?.data) ? response.data : []).find((row) => String(row.user_id) === String(telegramId))
    return mine?.resource_data ? hasReceipts(JSON.parse(mine.resource_data), receiptIds) : false
  } catch { return false }
}

export function useReceiptInventory(gateway: SharedWorldGateway, userId: string, worldCursor: number) {
  const { savedData, persist } = useGameSave<NeighborPlayerSave>(namespace)
  const [mirror, setMirror] = useState<NeighborPlayerSave | undefined>(undefined)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const syncing = useRef(false)

  useEffect(() => {
    if (mirror === undefined && savedData !== undefined) setMirror(normalizePlayerSave(savedData ?? emptyPlayerSave()))
  }, [mirror, savedData])

  const reconcile = useCallback(async () => {
    if (!userId || mirror === undefined || syncing.current) return
    if (gateway.mode === 'remote' && (!isInAigram || String(telegramId) !== String(userId))) {
      setStatus('unavailable')
      return
    }
    syncing.current = true
    try {
      const receipts = await gateway.listPendingReceipts(userId)
      if (!receipts.length) { setStatus((current) => current === 'saved' ? current : 'idle'); return }
      const next = applyPendingReceipts(mirror, receipts)
      if (next.appliedReceiptIds.length !== mirror.appliedReceiptIds.length) {
        next.lastSeenCursor = Math.max(next.lastSeenCursor, worldCursor)
        setMirror(next)
        persist(next)
      }
      setStatus('syncing')
      const ids = receipts.map((entry) => entry.receiptId)
      let verified = gateway.mode === 'local'
        ? hasReceipts(JSON.parse(alteruLocalStorage.getItem(`${namespace}-save`) || 'null'), ids)
        : await cloudContains(ids)
      if (gateway.mode === 'remote') {
        for (const delay of [1400, 2500, 5000]) {
          if (verified) break
          await wait(delay)
          verified = await cloudContains(ids)
        }
      }
      if (!verified) { setStatus('pending'); return }
      await Promise.all(ids.map((id) => gateway.acknowledgeReceipt(id, userId)))
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      syncing.current = false
    }
  }, [gateway, mirror, persist, userId, worldCursor])

  useEffect(() => { reconcile().catch(() => {}) }, [reconcile, worldCursor])

  return { save: mirror, heldItems: mirror?.heldItems ?? [], status, reconcile }
}
