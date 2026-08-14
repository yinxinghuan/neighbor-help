import { useCallback, useRef, useState } from 'react'
import { getGameUuid } from './game-id'
import { createMediaRequestId, generateImageMedia, MediaServiceError } from './media'

function requestKey(prompt: string, refUrl?: string) {
  return `${refUrl || 'text'}\n${prompt}`
}

export function useGenImage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const requestIds = useRef(new Map<string, string>())

  const generate = useCallback(async ({ prompt, ref_url }: { prompt: string; ref_url?: string }) => {
    const sessionId = getGameUuid()
    if (!sessionId) throw new MediaServiceError('INVALID_REQUEST', 'Permanent game UUID is missing', 0, false)
    if (ref_url && !/^https:\/\//i.test(ref_url)) throw new MediaServiceError('REFERENCE_UNAVAILABLE', 'Player reference must be public HTTPS', 0, false)
    const key = requestKey(prompt, ref_url)
    const requestId = requestIds.current.get(key) ?? createMediaRequestId()
    requestIds.current.set(key, requestId)
    setLoading(true)
    setError(null)
    try {
      const square = /inventory artifact plate|still life|object only|square composition/i.test(prompt)
      const referenceMode = 'edit' as const
      const task = await generateImageMedia({
        sessionId,
        requestId,
        mode: ref_url ? referenceMode : 'text',
        prompt,
        referenceUrls: ref_url ? [ref_url] : [],
        size: square ? { width: 640, height: 640 } : { width: 768, height: 576 },
      })
      requestIds.current.delete(key)
      return task.media.url
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error(String(cause))
      setError(next)
      throw next
    } finally {
      setLoading(false)
    }
  }, [])

  const beginNewIntent = useCallback(() => { requestIds.current.clear(); setError(null) }, [])
  return { generate, beginNewIntent, loading, error }
}
