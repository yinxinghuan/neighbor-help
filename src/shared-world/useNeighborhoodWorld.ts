import { useCallback, useEffect, useMemo, useState } from 'react'
import { telegramId } from '../shared/runtime/bridge'
import { getGameApiBase } from '../shared/runtime/game-api-base'
import type { PlayerProfile } from '../story/usePlayerProfile'
import { LocalSharedWorldGateway, RemoteSharedWorldGateway } from './gateway'
import { readWorld } from './engine'
import { useReceiptInventory } from './useReceiptInventory'
import type { CommitCode, HelpRequest, WorldAction, WorldArchive, WorldView } from './types'

export interface WorldNotice {
  kind: 'success' | 'error' | 'info'
  code: CommitCode | 'LOADED' | 'RESET'
  requestId?: string
}

export function useNeighborhoodWorld(profile: PlayerProfile) {
  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const localMode = query.get('local') === '1'
  const labMode = query.get('lab') === '1'
  const apiBase = query.get('api_base') || (localMode ? '' : getGameApiBase())
  const gateway = useMemo(() => apiBase ? new RemoteSharedWorldGateway(apiBase, labMode) : new LocalSharedWorldGateway(), [apiBase, labMode])
  const localActor = query.get('actor') === 'sam' ? { id: 'resident-sam', name: 'Sam' } : { id: 'resident-alex', name: 'Alex' }
  const actor = gateway.mode === 'local'
    ? { ...localActor, ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}) }
    : { id: String(telegramId || '__alteru_guest__'), name: profile.name || 'Resident', ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}) }
  const [archive, setArchive] = useState<WorldArchive | null>(null)
  const [view, setView] = useState<WorldView | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<WorldNotice | null>(null)
  const receiptInventory = useReceiptInventory(gateway, actor.id, view?.cursor ?? 0)

  const refresh = useCallback(async () => {
    const next = await gateway.load(receiptInventory.save?.lastSeenCursor ?? 0)
    setArchive(next.archive)
    setView(next.view)
    setNotice((current) => current?.kind === 'error' ? current : { kind: 'info', code: 'LOADED' })
    return next
  }, [gateway, receiptInventory.save?.lastSeenCursor])

  useEffect(() => { refresh().catch(() => setNotice({ kind: 'error', code: 'INVALID_ACTION' })) }, [refresh])
  useEffect(() => {
    if (gateway.mode !== 'remote') return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && !busy) refresh().catch(() => {}) }, 15_000)
    const visible = () => { if (document.visibilityState === 'visible') refresh().catch(() => {}) }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [busy, gateway.mode, refresh])

  const commit = useCallback(async (type: WorldAction['type'], payload: WorldAction['payload'], requestId?: string) => {
    if (!archive || busy) return null
    setBusy(true)
    const action = {
      actionId: crypto.randomUUID(), actor, expectedVersion: archive.version, createdAt: Date.now(), type, payload,
    } as WorldAction
    try {
      const result = await gateway.commit(action)
      setArchive(result.archive)
      setView(readWorld(result.archive))
      setNotice({ kind: result.duplicate ? 'info' : 'success', code: result.code, requestId })
      return result
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) as CommitCode : 'INVALID_ACTION'
      const latest = await gateway.load(receiptInventory.save?.lastSeenCursor ?? 0).catch(() => null)
      if (latest) { setArchive(latest.archive); setView(latest.view) }
      setNotice({ kind: 'error', code, requestId })
      return null
    } finally {
      setBusy(false)
    }
  }, [actor, archive, busy, gateway, receiptInventory.save?.lastSeenCursor])

  const claim = useCallback((request: HelpRequest) => commit(request.status === 'handed_off' ? 'claim_handoff' : 'claim_request', { requestId: request.id }, request.id), [commit])
  const handoff = useCallback((requestId: string) => commit('handoff_request', { requestId }, requestId), [commit])
  const complete = useCallback((requestId: string) => commit('complete_request', { requestId }, requestId), [commit])
  const reset = useCallback(async () => {
    const next = await gateway.reset()
    setArchive(next); setView(readWorld(next)); setNotice({ kind: 'info', code: 'RESET' })
  }, [gateway])

  return {
    archive, view, busy, notice, setNotice, gatewayMode: gateway.mode, actor,
    heldItems: receiptInventory.heldItems, receiptStatus: receiptInventory.status,
    refresh, claim, handoff, complete, reset,
  }
}
