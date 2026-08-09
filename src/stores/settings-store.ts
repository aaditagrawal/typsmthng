import { create } from 'zustand'
import { get as idbGet, set as idbSet, createStore } from 'idb-keyval'
import { useUIStore } from './ui-store'

const settingsDb = createStore('typsmthng-settings', 'settings')
const SETTINGS_KEY = 'user-settings'

type Theme = 'light' | 'dark' | 'system'

export type PageSize = 'a3' | 'a4' | 'a5' | 'a6' | 'us-letter' | 'us-legal' | 'iso-b5' | 'presentation-16-9' | 'auto'

export const PAGE_SIZE_OPTIONS: { label: string; value: PageSize }[] = [
  { label: 'Auto (default)', value: 'auto' },
  { label: 'A3', value: 'a3' },
  { label: 'A4', value: 'a4' },
  { label: 'A5', value: 'a5' },
  { label: 'A6', value: 'a6' },
  { label: 'US Letter', value: 'us-letter' },
  { label: 'US Legal', value: 'us-legal' },
  { label: 'ISO B5', value: 'iso-b5' },
  { label: 'Presentation 16:9', value: 'presentation-16-9' },
]

interface Settings {
  fontSize: number
  autoCompile: boolean
  compileDelay: number
  lineWrapping: boolean
  lineNumbers: boolean
  theme: Theme
  vimMode: boolean
  pageSize: PageSize
  systemFontsEnabled: boolean
  googleFontsEnabled: boolean
}

interface SettingsState extends Settings {
  settingsOpen: boolean
  setFontSize: (size: number) => void
  setAutoCompile: (enabled: boolean) => void
  setCompileDelay: (ms: number) => void
  setLineWrapping: (enabled: boolean) => void
  setLineNumbers: (enabled: boolean) => void
  setTheme: (theme: Theme) => void
  setVimMode: (enabled: boolean) => void
  setPageSize: (size: PageSize) => void
  setSystemFontsEnabled: (enabled: boolean) => void
  setGoogleFontsEnabled: (enabled: boolean) => void
  setSettingsOpen: (open: boolean) => void
  loadSettings: () => Promise<void>
}

const defaults: Settings = {
  fontSize: 15,
  autoCompile: true,
  compileDelay: 100,
  lineWrapping: true,
  lineNumbers: true,
  theme: 'dark',
  vimMode: false,
  pageSize: 'auto',
  systemFontsEnabled: true,
  googleFontsEnabled: true,
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 300

function persistSettings(settings: Settings) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      idbSet(SETTINGS_KEY, settings, settingsDb).catch((err) => {
        console.warn('Failed to persist settings to IDB:', err)
      })
    } catch (err) {
      console.warn('Failed to persist settings to IDB:', err)
    }
  }, PERSIST_DEBOUNCE_MS)
}

function getPersistedFields(state: SettingsState): Settings {
  return {
    fontSize: state.fontSize,
    autoCompile: state.autoCompile,
    compileDelay: state.compileDelay,
    lineWrapping: state.lineWrapping,
    lineNumbers: state.lineNumbers,
    theme: state.theme,
    vimMode: state.vimMode,
    pageSize: state.pageSize,
    systemFontsEnabled: state.systemFontsEnabled,
    googleFontsEnabled: state.googleFontsEnabled,
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  settingsOpen: false,

  setFontSize: (fontSize) => {
    const clamped = Math.min(24, Math.max(12, fontSize))
    set({ fontSize: clamped })
    persistSettings(getPersistedFields({ ...get(), fontSize: clamped }))
  },

  setAutoCompile: (autoCompile) => {
    set({ autoCompile })
    persistSettings(getPersistedFields({ ...get(), autoCompile }))
  },

  setCompileDelay: (compileDelay) => {
    const clamped = Math.min(2000, Math.max(50, compileDelay))
    set({ compileDelay: clamped })
    persistSettings(getPersistedFields({ ...get(), compileDelay: clamped }))
  },

  setLineWrapping: (lineWrapping) => {
    set({ lineWrapping })
    persistSettings(getPersistedFields({ ...get(), lineWrapping }))
  },

  setLineNumbers: (lineNumbers) => {
    set({ lineNumbers })
    persistSettings(getPersistedFields({ ...get(), lineNumbers }))
  },

  setTheme: (theme) => {
    set({ theme })
    useUIStore.getState().setTheme(theme)
    persistSettings(getPersistedFields({ ...get(), theme }))
  },

  setVimMode: (vimMode) => {
    set({ vimMode })
    persistSettings(getPersistedFields({ ...get(), vimMode }))
  },

  setPageSize: (pageSize) => {
    set({ pageSize })
    persistSettings(getPersistedFields({ ...get(), pageSize }))
  },

  setSystemFontsEnabled: (systemFontsEnabled) => {
    set({ systemFontsEnabled })
    persistSettings(getPersistedFields({ ...get(), systemFontsEnabled }))
  },

  setGoogleFontsEnabled: (googleFontsEnabled) => {
    set({ googleFontsEnabled })
    persistSettings(getPersistedFields({ ...get(), googleFontsEnabled }))
  },

  setSettingsOpen: (settingsOpen) => {
    set({ settingsOpen })
    if (settingsOpen) useUIStore.getState().setCommandSearchOpen(false)
  },

  loadSettings: async () => {
    try {
      const saved = await idbGet<Settings>(SETTINGS_KEY, settingsDb)
      if (saved) {
        set({
          fontSize: saved.fontSize ?? defaults.fontSize,
          autoCompile: saved.autoCompile ?? defaults.autoCompile,
          compileDelay: saved.compileDelay ?? defaults.compileDelay,
          lineWrapping: saved.lineWrapping ?? defaults.lineWrapping,
          lineNumbers: saved.lineNumbers ?? defaults.lineNumbers,
          theme: saved.theme ?? defaults.theme,
          vimMode: saved.vimMode ?? defaults.vimMode,
          pageSize: saved.pageSize ?? defaults.pageSize,
          systemFontsEnabled: saved.systemFontsEnabled ?? defaults.systemFontsEnabled,
          googleFontsEnabled: saved.googleFontsEnabled ?? defaults.googleFontsEnabled,
        })
        useUIStore.getState().setTheme(saved.theme ?? defaults.theme)
      }
    } catch (err) {
      console.warn('Failed to load settings from IDB, using defaults:', err)
    }
  },
}))
