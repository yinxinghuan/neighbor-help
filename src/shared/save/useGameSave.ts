import { useCallback, useEffect, useState } from 'react'
import { callAigramAPI, isInAigram, postAigramAPI, telegramId, type AigramResponse } from '../runtime/bridge'
import { getGameUuid } from '../runtime/game-id'
import { createSaveEnvelope, readSaveNamespace, removeSaveNamespace, writeSaveNamespace, type SaveEnvelope } from './saveEnvelope'

interface SaveRow { user_id: string; resource_data: string }

const cloudCache = new Map<string, SaveEnvelope>()
const cloudTimers = new Map<string, ReturnType<typeof setTimeout>>()

function seedEnvelope(sessionId: string, raw: unknown, primaryNamespace: string) {
  const cached = cloudCache.get(sessionId)
  if (cached) return cached
  const envelope = createSaveEnvelope(raw, primaryNamespace)
  cloudCache.set(sessionId, envelope)
  return envelope
}

function scheduleCloudWrite(sessionId: string) {
  const existing = cloudTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    cloudTimers.delete(sessionId)
    const envelope = cloudCache.get(sessionId)
    if (!envelope) return
    postAigramAPI('/note/aigram/ai/game/save/data', { session_id: sessionId, resource_data: JSON.stringify({ ...envelope, _lastActive: Date.now() }) })
  }, 1000)
  cloudTimers.set(sessionId, timer)
}

export function useGameSave<T>(gameId: string) {
  const [savedData, setSavedData] = useState<T | null | undefined>(undefined)
  const key = `${gameId}-save`
  const sessionId = getGameUuid()
  const canSync = isInAigram && Boolean(sessionId && telegramId)
  const primaryNamespace = 'neighbor-help'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (canSync && sessionId && telegramId) {
        try {
          const response = await callAigramAPI<AigramResponse<SaveRow[]>>(`/note/aigram/ai/game/get/data/list?session_id=${encodeURIComponent(sessionId)}`)
          const mine = (Array.isArray(response?.data) ? response.data : []).find((row) => row.user_id === telegramId)
          const raw = mine?.resource_data ? JSON.parse(mine.resource_data) : null
          const envelope = seedEnvelope(sessionId, raw, primaryNamespace)
          const namespaced = readSaveNamespace<T>(envelope, gameId)
          if (!cancelled && namespaced !== undefined) { setSavedData(namespaced); return }
        } catch { /* use local */ }
      }
      try {
        const local = alteruLocalStorage.getItem(key)
        if (local) { if (!cancelled) setSavedData(JSON.parse(local) as T); return }
      } catch { /* empty */ }
      if (!cancelled) setSavedData(null)
    })()
    return () => { cancelled = true }
  }, [canSync, gameId, key, sessionId])

  const persist = useCallback((value: T) => {
    const stamped = { ...(value as object), _lastActive: Date.now() } as T
    try { alteruLocalStorage.setItem(key, JSON.stringify(stamped)) } catch { /* quota */ }
    if (canSync && sessionId) {
      const envelope = writeSaveNamespace(seedEnvelope(sessionId, null, primaryNamespace), gameId, stamped)
      cloudCache.set(sessionId, envelope)
      scheduleCloudWrite(sessionId)
    }
  }, [canSync, gameId, key, sessionId])

  const clear = useCallback(async () => {
    try { alteruLocalStorage.removeItem(key) } catch { /* ignore */ }
    if (canSync && sessionId) {
      const envelope = removeSaveNamespace(seedEnvelope(sessionId, null, primaryNamespace), gameId)
      cloudCache.set(sessionId, envelope)
      scheduleCloudWrite(sessionId)
    }
    setSavedData(null)
  }, [canSync, gameId, key, sessionId])

  return { savedData, loaded: savedData !== undefined, hasSave: savedData != null, persist, clear }
}
