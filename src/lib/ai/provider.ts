/**
 * Protocol-neutral streaming client for OpenAI- and Anthropic-compatible
 * chat completion servers. Uses plain fetch + SSE parsing; no dependencies.
 */

export interface AiConfig {
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
}

export class AiRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
  }
}

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096

/** Trim whitespace and trailing slashes from a user-entered base URL. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** Compute the request endpoint, avoiding a doubled `/v1` path segment. */
export function buildEndpoint(config: Pick<AiConfig, 'protocol' | 'baseUrl'>): string {
  const base = normalizeBaseUrl(config.baseUrl)
  if (config.protocol === 'anthropic') {
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  }
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

export interface SseLine {
  kind: 'event' | 'data'
  value: string
}

/** Parse a single SSE line into an event-name or data payload line. */
export function parseSseLine(line: string): SseLine | null {
  if (line.startsWith('event:')) {
    return { kind: 'event', value: line.slice('event:'.length).trim() }
  }
  if (line.startsWith('data:')) {
    return { kind: 'data', value: line.slice('data:'.length).trim() }
  }
  return null
}

export interface SseEvent {
  /** Event name from the preceding `event:` line, if any. */
  event: string | null
  /** Raw data payload (JSON text or `[DONE]`). */
  data: string
}

/**
 * Read an SSE byte stream to completion, invoking `onEvent` per `data:` line.
 * Returns early if `onEvent` returns `false` (stream is cancelled).
 */
export async function consumeSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: SseEvent) => boolean | void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent: string | null = null

  const handleLine = (rawLine: string): boolean => {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') {
      currentEvent = null
      return true
    }
    const parsed = parseSseLine(line)
    if (!parsed) return true
    if (parsed.kind === 'event') {
      currentEvent = parsed.value
      return true
    }
    return onEvent({ event: currentEvent, data: parsed.value }) !== false
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        if (!handleLine(line)) {
          await reader.cancel().catch(() => {})
          return
        }
        newlineIndex = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) handleLine(buffer)
  } finally {
    reader.releaseLock()
  }
}

interface ErrorBody {
  error?: { message?: string; type?: string } | string
  message?: string
}

function extractErrorMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as ErrorBody
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.error === 'object' && parsed.error && typeof parsed.error.message === 'string') {
        return parsed.error.message
      }
      if (typeof parsed.error === 'string') return parsed.error
      if (typeof parsed.message === 'string') return parsed.message
    }
  } catch {
    // Not JSON — fall through to raw text.
  }
  const trimmed = bodyText.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null
}

function buildHeaders(config: AiConfig): Record<string, string> {
  if (config.protocol === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
  }
}

function buildRequestBody(
  config: AiConfig,
  system: string,
  userPrompt: string,
  options: { stream: boolean; maxTokensOverride?: number },
): Record<string, unknown> {
  const maxTokens = options.maxTokensOverride ?? config.maxTokens
  if (config.protocol === 'anthropic') {
    return {
      model: config.model,
      max_tokens: maxTokens > 0 ? maxTokens : DEFAULT_ANTHROPIC_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userPrompt }],
      stream: options.stream,
    }
  }
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    stream: options.stream,
  }
  if (maxTokens > 0) body.max_tokens = maxTokens
  return body
}

async function postCompletion(
  config: AiConfig,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const endpoint = buildEndpoint(config)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new AiRequestError(
      0,
      `Could not reach ${endpoint}. Check the base URL, your network, and that the server allows browser (CORS) requests.`,
    )
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    const message = extractErrorMessage(bodyText) ?? response.statusText
    throw new AiRequestError(response.status, `HTTP ${response.status}: ${message}`)
  }
  return response
}

interface AnthropicStreamEvent {
  type?: string
  delta?: { type?: string; text?: string }
  error?: { type?: string; message?: string }
}

interface OpenAiStreamChunk {
  choices?: { delta?: { content?: string | null } }[]
  error?: { message?: string }
}

/**
 * Stream a completion from the configured server, invoking `onDelta` for each
 * text fragment. Resolves with the full accumulated text.
 */
export async function streamCompletion(opts: {
  config: AiConfig
  system: string
  userPrompt: string
  signal: AbortSignal
  onDelta: (text: string) => void
}): Promise<string> {
  const { config, system, userPrompt, signal, onDelta } = opts
  const body = buildRequestBody(config, system, userPrompt, { stream: true })
  const response = await postCompletion(config, body, signal)
  if (!response.body) {
    throw new AiRequestError(0, 'Server returned no response body.')
  }

  let accumulated = ''
  let streamError: AiRequestError | null = null
  const reader = response.body.getReader()

  await consumeSseStream(reader, ({ event, data }) => {
    if (config.protocol === 'openai') {
      if (data === '[DONE]') return false
      let chunk: OpenAiStreamChunk
      try {
        chunk = JSON.parse(data) as OpenAiStreamChunk
      } catch {
        return true
      }
      if (chunk.error?.message) {
        streamError = new AiRequestError(0, chunk.error.message)
        return false
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? ''
      if (delta) {
        accumulated += delta
        onDelta(delta)
      }
      return true
    }

    // Anthropic protocol
    let parsed: AnthropicStreamEvent
    try {
      parsed = JSON.parse(data) as AnthropicStreamEvent
    } catch {
      return true
    }
    const type = parsed.type ?? event
    if (type === 'error' || event === 'error') {
      streamError = new AiRequestError(0, parsed.error?.message ?? 'Server reported a stream error.')
      return false
    }
    if (type === 'message_stop') return false
    if (type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      const delta = parsed.delta.text ?? ''
      if (delta) {
        accumulated += delta
        onDelta(delta)
      }
    }
    // thinking_delta and other block types are intentionally ignored.
    return true
  })

  if (streamError) throw streamError
  if (signal.aborted) {
    throw new DOMException('The request was aborted.', 'AbortError')
  }
  return accumulated
}

interface AnthropicMessageResponse {
  content?: { type?: string; text?: string }[]
}

interface OpenAiChatResponse {
  choices?: { message?: { content?: string | null } }[]
}

/**
 * Send a tiny non-streaming request to validate the configuration.
 * Never throws — reports the outcome for the settings UI.
 */
export async function testConnection(config: AiConfig): Promise<{ ok: boolean; message: string }> {
  if (!normalizeBaseUrl(config.baseUrl)) return { ok: false, message: 'Enter a base URL first.' }
  if (!config.model.trim()) return { ok: false, message: 'Enter a model name first.' }
  try {
    const body = buildRequestBody(config, 'You are a connectivity check. Reply with the single word OK.', 'Say OK', {
      stream: false,
      maxTokensOverride: 8,
    })
    const response = await postCompletion(config, body, AbortSignal.timeout(20000))
    const json: unknown = await response.json()
    let reply = ''
    if (config.protocol === 'anthropic') {
      const parsed = json as AnthropicMessageResponse
      reply = (parsed.content ?? [])
        .map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join('')
    } else {
      const parsed = json as OpenAiChatResponse
      reply = parsed.choices?.[0]?.message?.content ?? ''
    }
    reply = reply.trim()
    return {
      ok: true,
      message: reply ? `Connected — model replied: ${reply.slice(0, 80)}` : 'Connected.',
    }
  } catch (err) {
    if (err instanceof AiRequestError) return { ok: false, message: err.message }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, message: 'Connection timed out after 20s.' }
    }
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed.' }
  }
}
