import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildEndpoint,
  normalizeBaseUrl,
  parseSseLine,
  consumeSseStream,
  streamCompletion,
  testConnection,
  AiRequestError,
} from '@/lib/ai/provider'
import type { AiConfig, SseEvent } from '@/lib/ai/provider'

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    protocol: 'openai',
    baseUrl: 'https://example.com',
    apiKey: 'test-key',
    model: 'test-model',
    maxTokens: 1024,
    ...overrides,
  }
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://api.example.com//  ')).toBe('https://api.example.com')
    expect(normalizeBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434')
  })
})

describe('buildEndpoint', () => {
  it('builds openai endpoint, adding /v1 when missing', () => {
    expect(buildEndpoint({ protocol: 'openai', baseUrl: 'https://api.openai.com' }))
      .toBe('https://api.openai.com/v1/chat/completions')
  })

  it('does not double /v1 for openai bases ending in /v1', () => {
    expect(buildEndpoint({ protocol: 'openai', baseUrl: 'http://localhost:11434/v1' }))
      .toBe('http://localhost:11434/v1/chat/completions')
    expect(buildEndpoint({ protocol: 'openai', baseUrl: 'http://localhost:11434/v1/' }))
      .toBe('http://localhost:11434/v1/chat/completions')
  })

  it('builds anthropic endpoint, adding /v1 when missing', () => {
    expect(buildEndpoint({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
      .toBe('https://api.anthropic.com/v1/messages')
  })

  it('does not double /v1 for anthropic bases ending in /v1', () => {
    expect(buildEndpoint({ protocol: 'anthropic', baseUrl: 'https://gateway.local/v1/' }))
      .toBe('https://gateway.local/v1/messages')
  })
})

describe('parseSseLine', () => {
  it('parses event and data lines', () => {
    expect(parseSseLine('event: message_stop')).toEqual({ kind: 'event', value: 'message_stop' })
    expect(parseSseLine('data: {"a":1}')).toEqual({ kind: 'data', value: '{"a":1}' })
  })

  it('returns null for comments and unknown lines', () => {
    expect(parseSseLine(': keepalive')).toBeNull()
    expect(parseSseLine('retry: 100')).toBeNull()
  })
})

describe('consumeSseStream', () => {
  it('associates event names with data lines and handles chunk splits', async () => {
    const response = sseResponse([
      'event: content_block_delta\ndata: {"n":1}\n\nevent: mess',
      'age_stop\ndata: {"n":2}\n\n',
    ])
    const events: SseEvent[] = []
    const reader = response.body!.getReader()
    await consumeSseStream(reader, (event) => {
      events.push(event)
    })
    expect(events).toEqual([
      { event: 'content_block_delta', data: '{"n":1}' },
      { event: 'message_stop', data: '{"n":2}' },
    ])
  })
})

describe('streamCompletion — openai protocol', () => {
  it('accumulates deltas and stops at [DONE]', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"IGNORED"}}]}\n\n',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const deltas: string[] = []
    const result = await streamCompletion({
      config: makeConfig(),
      system: 'sys',
      userPrompt: 'user',
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    })

    expect(result).toBe('Hello')
    expect(deltas).toEqual(['Hel', 'lo'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.com/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-key')
    const body = JSON.parse(String(init.body)) as { stream: boolean; max_tokens?: number; messages: { role: string }[] }
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(1024)
    expect(body.messages[0].role).toBe('system')
  })

  it('omits max_tokens when config value is 0', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    await streamCompletion({
      config: makeConfig({ maxTokens: 0 }),
      system: 'sys',
      userPrompt: 'user',
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect('max_tokens' in (JSON.parse(String(init.body)) as Record<string, unknown>)).toBe(false)
  })
})

describe('streamCompletion — anthropic protocol', () => {
  it('accumulates text_delta events, ignores thinking_delta, stops at message_stop', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"= Head"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ing"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await streamCompletion({
      config: makeConfig({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }),
      system: 'sys',
      userPrompt: 'user',
      signal: new AbortController().signal,
      onDelta: () => {},
    })

    expect(result).toBe('= Heading')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = JSON.parse(String(init.body)) as { system: string; max_tokens: number }
    expect(body.system).toBe('sys')
    expect(body.max_tokens).toBe(1024)
  })

  it('throws on an error event frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ])))
    await expect(streamCompletion({
      config: makeConfig({ protocol: 'anthropic' }),
      system: 'sys',
      userPrompt: 'user',
      signal: new AbortController().signal,
      onDelta: () => {},
    })).rejects.toMatchObject({ name: 'AiRequestError', message: 'Overloaded' })
  })
})

describe('streamCompletion — error handling', () => {
  it('throws AiRequestError with status and .error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'invalid x-api-key', type: 'authentication_error' } }),
      { status: 401 },
    )))
    const promise = streamCompletion({
      config: makeConfig(),
      system: 'sys',
      userPrompt: 'user',
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    await expect(promise).rejects.toBeInstanceOf(AiRequestError)
    await promise.catch((err: AiRequestError) => {
      expect(err.status).toBe(401)
      expect(err.message).toContain('invalid x-api-key')
    })
  })

  it('wraps network failures in a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    await expect(streamCompletion({
      config: makeConfig(),
      system: 'sys',
      userPrompt: 'user',
      signal: new AbortController().signal,
      onDelta: () => {},
    })).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Could not reach') })
  })
})

describe('testConnection', () => {
  it('reports success with the model reply (openai)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      { status: 200 },
    )))
    const result = await testConnection(makeConfig())
    expect(result.ok).toBe(true)
    expect(result.message).toContain('OK')
  })

  it('reports failure with the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'model not found' } }),
      { status: 404 },
    )))
    const result = await testConnection(makeConfig())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('model not found')
    expect(result.message).toContain('404')
  })

  it('fails fast without a base URL or model', async () => {
    expect((await testConnection(makeConfig({ baseUrl: ' ' }))).ok).toBe(false)
    expect((await testConnection(makeConfig({ model: '' }))).ok).toBe(false)
  })
})

describe('streamCompletion — stall watchdog', () => {
  it('aborts and reports a stalled stream when the server goes silent', async () => {
    vi.useFakeTimers()
    try {
      const encoder = new TextEncoder()
      const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'))
            // Never closes; error the stream when the request signal aborts,
            // mirroring real fetch behavior.
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('The operation was aborted.', 'AbortError'))
            })
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      })
      vi.stubGlobal('fetch', fetchMock)

      const promise = streamCompletion({
        config: makeConfig(),
        system: 'sys',
        userPrompt: 'user',
        signal: new AbortController().signal,
        onDelta: () => {},
      })
      const assertion = expect(promise).rejects.toThrow(/stalled/)
      await vi.advanceTimersByTimeAsync(120_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
