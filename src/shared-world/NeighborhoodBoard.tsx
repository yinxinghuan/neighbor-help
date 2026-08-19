import { Icon } from '../story/Icons'
import type { Locale } from '../story/types'
import type { useNeighborhoodWorld } from './useNeighborhoodWorld'
import type { HelpRequest } from './types'

type World = ReturnType<typeof useNeighborhoodWorld>

const copy = {
  zh: {
    eyebrow: '共享公告', title: '邻里互助', close: '关闭共享公告', refreshed: '公告已更新',
    local: '本地双人实验', remote: '共享世界', receipt: '物品确认', noItem: '未持有公共物品', heldItem: '件公共物品',
    receiptUnavailable: '不可用', receiptIdle: '已同步', receiptSyncing: '正在保存', receiptSaved: '已保存', receiptPending: '等待云端确认', receiptError: '同步失败',
    claim: '领取', takeOver: '接手', handoffAction: '交接', complete: '完成', refresh: '刷新', reset: '重置实验',
    open: '等待帮助', claimed: '正在处理', handed_off: '等待接手', completed: '已经完成', cancelled: '已取消',
    umbrellaBusStop: '把最后一把共享雨伞送到公交站', medicinePickup: '从街角店代取一袋药品', petCare: '在小花园临时照看宠物',
    lobby: '共享大厅', 'corner-shop': '街角店', courtyard: '小花园', 'bus-stop': '公交站', 'apartment-2b': '住户门口',
    umbrella: '雨伞', medicine_bag: '药品袋', spare_key: '备用钥匙', parcel: '包裹', pet_food: '宠物用品', community: '公共位置', player: '居民持有', handoff: '交接中', returned: '已归还',
    conflict: '刚刚有另一位居民更新了这件事。公告已经刷新，请从仍然有效的行动继续。',
    itemConflict: '这件事需要的公共物品刚被另一位居民拿走了。公告已经刷新。',
    unavailable: '这项委托现在已经不能领取。公告已经刷新。',
    auth: '当前身份只能查看共享世界，不能提交公共行动。',
  },
  en: {
    eyebrow: 'SHARED BOARD', title: 'Neighborly Help', close: 'Close shared board', refreshed: 'Board updated',
    local: 'Local two-player lab', remote: 'Shared world', receipt: 'Item sync', noItem: 'No shared item held', heldItem: 'shared item',
    receiptUnavailable: 'Unavailable', receiptIdle: 'Synced', receiptSyncing: 'Saving', receiptSaved: 'Saved', receiptPending: 'Awaiting cloud confirmation', receiptError: 'Sync failed',
    claim: 'Claim', takeOver: 'Take over', handoffAction: 'Hand off', complete: 'Complete', refresh: 'Refresh', reset: 'Reset lab',
    open: 'Needs help', claimed: 'In progress', handed_off: 'Ready for handoff', completed: 'Completed', cancelled: 'Cancelled',
    umbrellaBusStop: 'Take the last shared umbrella to the bus stop', medicinePickup: 'Collect a medicine bag from the corner shop', petCare: 'Look after a pet in the small garden',
    lobby: 'Shared Lobby', 'corner-shop': 'Corner Shop', courtyard: 'Small Garden', 'bus-stop': 'Bus Stop', 'apartment-2b': 'Resident Door',
    umbrella: 'Umbrella', medicine_bag: 'Medicine bag', spare_key: 'Spare key', parcel: 'Parcel', pet_food: 'Pet supplies', community: 'Shared shelf', player: 'Held by resident', handoff: 'In handoff', returned: 'Returned',
    conflict: 'Another resident just changed this request. The board is refreshed; continue from an action that is still available.',
    itemConflict: 'Another resident just took the shared item needed for this request. The board is refreshed.',
    unavailable: 'This request can no longer be claimed. The board is refreshed.',
    auth: 'This identity can view the shared world but cannot submit public actions.',
  },
} as const

function conflictText(locale: Locale, code?: string) {
  const text = copy[locale]
  if (code === 'ITEM_UNAVAILABLE') return text.itemConflict
  if (code === 'REQUEST_UNAVAILABLE') return text.unavailable
  if (code === 'AUTH_REQUIRED') return text.auth
  return text.conflict
}

export function sharedConflictNarrative(locale: Locale, code?: string) {
  return conflictText(locale, code)
}

export function sharedRecoveryChoices(locale: Locale): [string, string, string] {
  return locale === 'zh'
    ? ['查看刚更新的公告板', '请 Mara 确认还有谁需要帮助', '先处理另一件仍开放的小事']
    : ['Read the newly updated board', 'Ask Mara who still needs help', 'Choose another request that remains open']
}

export function NeighborhoodBoard({ world, locale, close, onWorldAction }: {
  world: World
  locale: Locale
  close: () => void
  onWorldAction: (request: HelpRequest, action: 'claim' | 'handoff' | 'complete', committedRequest: HelpRequest | null) => void
}) {
  const text = copy[locale]
  const receiptStatusText = {
    unavailable: text.receiptUnavailable,
    idle: text.receiptIdle,
    syncing: text.receiptSyncing,
    saved: text.receiptSaved,
    pending: text.receiptPending,
    error: text.receiptError,
  }[world.receiptStatus]
  const requestText = (request: HelpRequest) => text[request.titleKey as keyof typeof text] || request.titleKey
  const locationText = (id: string) => text[id as keyof typeof text] || id
  const perform = async (request: HelpRequest, action: 'claim' | 'handoff' | 'complete') => {
    const result = action === 'claim' ? await world.claim(request) : action === 'handoff' ? await world.handoff(request.id) : await world.complete(request.id)
    const committedRequest = result?.archive.requests.find((entry) => entry.id === request.id) ?? null
    onWorldAction(request, action, committedRequest)
  }
  return <div className="nh-board" role="dialog" aria-modal="true" aria-labelledby="nh-board-title">
    <button className="nh-board__scrim" onClick={close} aria-label={text.close} />
    <section>
      <header>
        <div><small>{text.eyebrow}</small><h2 id="nh-board-title">{text.title}</h2></div>
        <button onClick={close} aria-label={text.close}><Icon name="close" /></button>
      </header>
      <div className="nh-board__meta">
        <span><i />{world.gatewayMode === 'local' ? text.local : text.remote}</span>
        <span>{text.receipt}: {receiptStatusText}</span>
      </div>
      {world.notice?.kind === 'error' && <aside className="nh-board__notice" role="status">{conflictText(locale, world.notice.code)}</aside>}
      <div className="nh-board__list">
        {(world.view?.requests ?? []).map((request) => {
          const mine = request.claimantUserId === world.actor.id || request.handoffFromUserId === world.actor.id
          const item = request.requiredItemId ? world.view?.items.find((entry) => entry.id === request.requiredItemId) : undefined
          return <article className={`nh-request is-${request.status}`} key={request.id}>
            <div className="nh-request__top"><small>{text[request.status]}</small><span>v{request.version}</span></div>
            <h3>{requestText(request)}</h3>
            <p>{locationText(request.locationId)} <Icon name="arrow" /> {locationText(request.destinationId)}</p>
            {request.claimantName && <div className="nh-request__holder">{request.claimantName} · {text[request.status]}</div>}
            {item && <div className="nh-request__item"><Icon name="bag" /><span>{text[item.kind]}</span><b>{text[item.custody]}</b></div>}
            <div className="nh-request__actions">
              {(request.status === 'open' || (request.status === 'handed_off' && !mine)) && <button disabled={world.busy} onClick={() => void perform(request, 'claim')}>{request.status === 'handed_off' ? text.takeOver : text.claim}<Icon name="arrow" /></button>}
              {request.status === 'claimed' && mine && <><button disabled={world.busy} onClick={() => void perform(request, 'handoff')}>{text.handoffAction}</button><button disabled={world.busy} onClick={() => void perform(request, 'complete')}>{text.complete}<Icon name="arrow" /></button></>}
            </div>
          </article>
        })}
      </div>
      <footer>
        <button onClick={() => void world.refresh()} disabled={world.busy}><Icon name="refresh" />{text.refresh}</button>
        {world.gatewayMode === 'local' && <button onClick={() => void world.reset()} disabled={world.busy}>{text.reset}</button>}
        <span>{world.heldItems.length ? `${world.heldItems.length} ${text.heldItem}` : text.noItem}</span>
      </footer>
    </section>
  </div>
}
