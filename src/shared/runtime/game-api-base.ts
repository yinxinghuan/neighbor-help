import { getGameUuid } from './game-id'

/** Resolve the game-owned API under the current Remix-replaceable UUID. */
export function getGameApiBase(): string {
  const gameId = getGameUuid()
  if (!gameId) throw new Error('[runtime] game UUID is required for the game API base')
  return `/${gameId}`
}
