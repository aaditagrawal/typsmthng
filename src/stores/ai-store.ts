import { create } from 'zustand'
import { get as idbGet, set as idbSet, createStore } from 'idb-keyval'
import type { AiConfig } from '@/lib/ai/provider'

const aiDb = createStore('typsmthng-ai', 'ai')
const AI_SETTINGS_KEY = 'ai-settings'

export type AiProtocol = 'openai' | 'anthropic'

interface AiSettings {
  enabled: boolean
  protocol: AiProtocol
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
}

interface AiState extends AiSettings {
  setEnabled: (enabled: boolean) => void
  setProtocol: (protocol: AiProtocol) => void
  setBaseUrl: (baseUrl: string) => void
  setApiKey: (apiKey: string) => void
  setModel: (model: string) => void
  setMaxTokens: (maxTokens: number) => void
  loadAiSettings: () => Promise<void>
}

const defaults: AiSettings = {
  enabled: false,
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  maxTokens: 4096,
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 300

function persistAiSettings(settings: AiSettings) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      idbSet(AI_SETTINGS_KEY, settings, aiDb).catch((err) => {
        console.warn('Failed to persist AI settings to IDB:', err)
      })
    } catch (err) {
      console.warn('Failed to persist AI settings to IDB:', err)
    }
  }, PERSIST_DEBOUNCE_MS)
}

function getPersistedFields(state: AiState): AiSettings {
  return {
    enabled: state.enabled,
    protocol: state.protocol,
    baseUrl: state.baseUrl,
    apiKey: state.apiKey,
    model: state.model,
    maxTokens: state.maxTokens,
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  ...defaults,

  setEnabled: (enabled) => {
    set({ enabled })
    persistAiSettings(getPersistedFields({ ...get(), enabled }))
  },

  setProtocol: (protocol) => {
    set({ protocol })
    persistAiSettings(getPersistedFields({ ...get(), protocol }))
  },

  setBaseUrl: (baseUrl) => {
    set({ baseUrl })
    persistAiSettings(getPersistedFields({ ...get(), baseUrl }))
  },

  setApiKey: (apiKey) => {
    set({ apiKey })
    persistAiSettings(getPersistedFields({ ...get(), apiKey }))
  },

  setModel: (model) => {
    set({ model })
    persistAiSettings(getPersistedFields({ ...get(), model }))
  },

  setMaxTokens: (maxTokens) => {
    const clamped = Math.min(1_000_000, Math.max(0, Math.floor(maxTokens) || 0))
    set({ maxTokens: clamped })
    persistAiSettings(getPersistedFields({ ...get(), maxTokens: clamped }))
  },

  loadAiSettings: async () => {
    try {
      const saved = await idbGet<AiSettings>(AI_SETTINGS_KEY, aiDb)
      if (saved) {
        set({
          enabled: saved.enabled ?? defaults.enabled,
          protocol: saved.protocol ?? defaults.protocol,
          baseUrl: saved.baseUrl ?? defaults.baseUrl,
          apiKey: saved.apiKey ?? defaults.apiKey,
          model: saved.model ?? defaults.model,
          maxTokens: saved.maxTokens ?? defaults.maxTokens,
        })
      }
    } catch (err) {
      console.warn('Failed to load AI settings from IDB, using defaults:', err)
    }
  },
}))

/** Snapshot the current store as a request config for the provider client. */
export function getAiConfig(): AiConfig {
  const { protocol, baseUrl, apiKey, model, maxTokens } = useAiStore.getState()
  return { protocol, baseUrl, apiKey, model, maxTokens }
}
