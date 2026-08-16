import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock idb-keyval before importing the store (same pattern as project-store tests).
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => {
      store.set(key, val)
    }),
    __store: store,
  }
})

import { useAiStore, getAiConfig } from '@/stores/ai-store'
import * as idbKeyval from 'idb-keyval'

const mockIdb = idbKeyval as typeof idbKeyval & { __store: Map<string, unknown> }

const initialState = { ...useAiStore.getState() }

beforeEach(() => {
  useAiStore.setState({ ...initialState })
  mockIdb.__store.clear()
  vi.mocked(idbKeyval.set).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AI store', () => {
  it('initializes disabled with openai defaults', () => {
    const state = useAiStore.getState()
    expect(state.enabled).toBe(false)
    expect(state.protocol).toBe('openai')
    expect(state.baseUrl).toBe('')
    expect(state.apiKey).toBe('')
    expect(state.model).toBe('')
    expect(state.maxTokens).toBe(4096)
  })

  it('updates fields via setters', () => {
    const store = useAiStore.getState()
    store.setEnabled(true)
    store.setProtocol('anthropic')
    store.setBaseUrl('https://api.anthropic.com')
    store.setApiKey('sk-test')
    store.setModel('claude-opus-5')
    store.setMaxTokens(2048)
    const state = useAiStore.getState()
    expect(state.enabled).toBe(true)
    expect(state.protocol).toBe('anthropic')
    expect(state.baseUrl).toBe('https://api.anthropic.com')
    expect(state.apiKey).toBe('sk-test')
    expect(state.model).toBe('claude-opus-5')
    expect(state.maxTokens).toBe(2048)
  })

  it('clamps max tokens to a non-negative integer', () => {
    useAiStore.getState().setMaxTokens(-5)
    expect(useAiStore.getState().maxTokens).toBe(0)
    useAiStore.getState().setMaxTokens(100.7)
    expect(useAiStore.getState().maxTokens).toBe(100)
  })

  it('persists settings to idb after the debounce window', async () => {
    vi.useFakeTimers()
    useAiStore.getState().setModel('llama3')
    expect(vi.mocked(idbKeyval.set)).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(350)
    expect(vi.mocked(idbKeyval.set)).toHaveBeenCalledTimes(1)
    const [key, value] = vi.mocked(idbKeyval.set).mock.calls[0]
    expect(key).toBe('ai-settings')
    expect(value).toMatchObject({ model: 'llama3', enabled: false, protocol: 'openai' })
  })

  it('hydrates persisted settings and fills gaps with defaults', async () => {
    mockIdb.__store.set('ai-settings', {
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'http://localhost:4000',
      apiKey: 'k',
      // model and maxTokens intentionally missing
    })
    await useAiStore.getState().loadAiSettings()
    const state = useAiStore.getState()
    expect(state.enabled).toBe(true)
    expect(state.protocol).toBe('anthropic')
    expect(state.baseUrl).toBe('http://localhost:4000')
    expect(state.apiKey).toBe('k')
    expect(state.model).toBe('')
    expect(state.maxTokens).toBe(4096)
  })

  it('exposes a request config snapshot', () => {
    useAiStore.getState().setBaseUrl('http://localhost:11434/v1')
    useAiStore.getState().setModel('llama3')
    expect(getAiConfig()).toEqual({
      protocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'llama3',
      maxTokens: 4096,
    })
  })
})
