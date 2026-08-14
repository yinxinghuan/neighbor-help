import { generateImageMedia } from '../src/shared/runtime/media'

const referenceUrl = String(process.env.REFERENCE_URL || '')
const requestId = String(process.env.REQUEST_ID || '')
if (!/^https:\/\/cdn\.aiwaves\.tech\//.test(referenceUrl)) throw new Error('REFERENCE_URL must be an AlterU CDN image')
if (!requestId) throw new Error('REQUEST_ID is required and must remain stable across ambiguous retries')

const task = await generateImageMedia({
  sessionId: '00c8cbf4-9fba-44b6-b895-03361f71ba34',
  requestId,
  mode: 'edit',
  referenceUrls: [referenceUrl],
  size: { width: 768, height: 576 },
  prompt: 'Edit the supplied image, preserving the same composition, people, expressions, bus shelter, rain garden, palette, lighting, and exactly one umbrella. Remove the small signature-like mark in the lower-right corner completely and fill that area with matching unmarked paper and garden texture. Do not add any writing, letters, symbols, signatures, logos, signs, labels, noticeboards, speech bubbles, flags, or extra umbrellas. Region-neutral contemporary apartment community.',
}, { timeoutMs: 12 * 60_000, pollIntervalMs: 10_000 })

console.log(JSON.stringify({ taskId: task.task_id, requestId: task.request_id, mediaUrl: task.media.url }))
