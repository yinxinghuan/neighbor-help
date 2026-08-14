const DEFAULT_MEDIA_API_BASE = 'https://game.aiwaves.tech/alteru-media/api';

export type MediaTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type MediaImageMode = 'text' | 'edit' | 'avatar';

export interface MediaImage {
  type: 'image';
  url: string;
  width: number;
  height: number;
  format: 'png' | 'webp';
}

export interface MediaVideo {
  type: 'video';
  url: string;
  width: number;
  height: number;
  duration_seconds: number;
  has_audio: boolean;
}

export interface MediaTask {
  task_id: string;
  request_id: string;
  type: 'image' | 'video';
  status: MediaTaskStatus;
  media?: MediaImage | MediaVideo;
  error?: { code: string; message: string; retryable: boolean };
  timing_ms?: number;
  created_at: number;
  updated_at: number;
}

export interface GenerateImageMediaRequest {
  sessionId: string;
  requestId?: string;
  mode: MediaImageMode;
  prompt: string;
  referenceUrls?: string[];
  size: { width: number; height: number };
}

export interface SubmitVideoMediaRequest {
  sessionId: string;
  requestId?: string;
  prompt: string;
  soundPrompt?: string;
  startUrl: string;
  endUrl: string;
  ratio: '9:16';
  durationSeconds: 5;
}

export interface MediaClientOptions {
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface MediaWaitOptions extends MediaClientOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface MediaErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: { retry_after_seconds?: number };
  };
}

export class MediaServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'MediaServiceError';
  }
}

function apiBase(options?: MediaClientOptions): string {
  return (options?.baseUrl ?? DEFAULT_MEDIA_API_BASE).replace(/\/+$/, '');
}

function clientFetch(options?: MediaClientOptions): typeof fetch {
  return options?.fetchImpl ?? ((input, init) => fetch(input, init));
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new MediaServiceError('INVALID_REQUEST', `${label} is required`, 0, false);
  return normalized;
}

export function createMediaRequestId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new MediaServiceError('RUNTIME_UNAVAILABLE', 'crypto.randomUUID is unavailable', 0, false);
  }
  return crypto.randomUUID();
}

export function fitMediaImageSize(
  requested: { width: number; height: number },
): { width: number; height: number } {
  const width = Math.max(1, requested.width);
  const height = Math.max(1, requested.height);
  const targetRatio = width / height;
  const targetArea = Math.min(width * height, 1_572_864);
  let best = { width: 512, height: 512 };
  let bestScore = Number.POSITIVE_INFINITY;
  for (let candidateWidth = 256; candidateWidth <= 1536; candidateWidth += 64) {
    for (let candidateHeight = 256; candidateHeight <= 1536; candidateHeight += 64) {
      const area = candidateWidth * candidateHeight;
      if (area > 1_572_864) continue;
      const ratioScore = Math.abs(Math.log((candidateWidth / candidateHeight) / targetRatio)) * 4;
      const areaScore = Math.abs(Math.log(area / targetArea));
      const score = ratioScore + areaScore;
      if (score < bestScore) {
        bestScore = score;
        best = { width: candidateWidth, height: candidateHeight };
      }
    }
  }
  return best;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function mediaRequest<T>(
  path: string,
  init: RequestInit,
  options?: MediaClientOptions,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await clientFetch(options)(`${apiBase(options)}${path}`, {
    ...init,
    headers,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const envelope = (body ?? {}) as MediaErrorEnvelope;
    throw new MediaServiceError(
      envelope.error?.code ?? 'HTTP_ERROR',
      envelope.error?.message ?? `Media Service failed with HTTP ${response.status}`,
      response.status,
      envelope.error?.retryable ?? response.status >= 500,
      envelope.error?.details?.retry_after_seconds,
    );
  }
  return body as T;
}

function assertTaskSucceeded(task: MediaTask): MediaTask {
  if (task.status === 'failed') {
    throw new MediaServiceError(
      task.error?.code ?? 'GENERATION_FAILED',
      task.error?.message ?? 'Media generation failed',
      200,
      task.error?.retryable ?? false,
    );
  }
  return task;
}

export async function getMediaTask(taskId: string, options?: MediaClientOptions): Promise<MediaTask> {
  const id = requireText(taskId, 'taskId');
  return assertTaskSucceeded(await mediaRequest<MediaTask>(`/v1/tasks/${encodeURIComponent(id)}`, {
    method: 'GET',
  }, options));
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function waitForMediaTask(
  taskOrId: MediaTask | string,
  options?: MediaWaitOptions,
): Promise<MediaTask> {
  const deadline = Date.now() + (options?.timeoutMs ?? 30 * 60_000);
  const interval = Math.max(8_000, options?.pollIntervalMs ?? 10_000);
  let task = typeof taskOrId === 'string' ? await getMediaTask(taskOrId, options) : assertTaskSucceeded(taskOrId);
  while (task.status === 'queued' || task.status === 'running') {
    if (Date.now() >= deadline) {
      throw new MediaServiceError('TIMEOUT', 'Media generation timed out', 0, true);
    }
    await abortableDelay(interval, options?.signal);
    task = await getMediaTask(task.task_id, options);
  }
  return assertTaskSucceeded(task);
}

export async function generateImageMedia(
  request: GenerateImageMediaRequest,
  options?: MediaWaitOptions,
): Promise<MediaTask & { media: MediaImage }> {
  const task = await mediaRequest<MediaTask>('/v1/images/generations', {
    method: 'POST',
    body: JSON.stringify({
      request_id: request.requestId ?? createMediaRequestId(),
      session_id: requireText(request.sessionId, 'sessionId'),
      mode: request.mode,
      prompt: requireText(request.prompt, 'prompt'),
      reference_urls: request.referenceUrls ?? [],
      size: fitMediaImageSize(request.size),
    }),
  }, options);
  const completed = await waitForMediaTask(task, options);
  if (completed.media?.type !== 'image') {
    throw new MediaServiceError('INVALID_RESPONSE', 'Image task completed without image media', 200, false);
  }
  return completed as MediaTask & { media: MediaImage };
}

export async function submitVideoMedia(
  request: SubmitVideoMediaRequest,
  options?: MediaClientOptions,
): Promise<MediaTask> {
  return assertTaskSucceeded(await mediaRequest<MediaTask>('/v1/videos/generations', {
    method: 'POST',
    body: JSON.stringify({
      request_id: request.requestId ?? createMediaRequestId(),
      session_id: requireText(request.sessionId, 'sessionId'),
      prompt: requireText(request.prompt, 'prompt'),
      ...(request.soundPrompt?.trim() ? { sound_prompt: request.soundPrompt.trim() } : {}),
      start_url: requireText(request.startUrl, 'startUrl'),
      end_url: requireText(request.endUrl, 'endUrl'),
      ratio: request.ratio,
      duration_seconds: request.durationSeconds,
    }),
  }, options));
}

export async function generateVideoMedia(
  request: SubmitVideoMediaRequest,
  options?: MediaWaitOptions,
): Promise<MediaTask & { media: MediaVideo }> {
  const completed = await waitForMediaTask(await submitVideoMedia(request, options), options);
  if (completed.media?.type !== 'video') {
    throw new MediaServiceError('INVALID_RESPONSE', 'Video task completed without video media', 200, false);
  }
  return completed as MediaTask & { media: MediaVideo };
}
