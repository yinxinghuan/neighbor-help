import { generateImageMedia } from '../src/shared/runtime/media'

const requestId = String(process.env.REQUEST_ID || '')
if (!requestId) throw new Error('REQUEST_ID is required and must remain stable across ambiguous retries')

const task = await generateImageMedia({
  sessionId: '00c8cbf4-9fba-44b6-b895-03361f71ba34',
  requestId,
  mode: 'text',
  referenceUrls: [],
  size: { width: 768, height: 576 },
  prompt: 'Clean full-bleed contemporary editorial digital illustration for an international story app, with warm restrained colors and natural soft rain light. At a simple sheltered bus stop beside a small rain garden, one ordinary resident hands the community umbrella to another resident, whose face is clearly relieved and grateful. Eye-level medium shot, culturally neutral apartment neighborhood, diverse everyday clothing, believable object scale. Exactly one umbrella. This is clean production key art, not a signed painting or sketch. Keep every corner as plain environment artwork. No border, no artist mark, no signature, no monogram, no handwritten stroke, no text, no letters, no symbols, no logos, no signs, no labels, no noticeboards, no speech bubbles, no flags, no country-specific architecture.',
}, { timeoutMs: 12 * 60_000, pollIntervalMs: 10_000 })

console.log(JSON.stringify({ taskId: task.task_id, requestId: task.request_id, mediaUrl: task.media.url }))
