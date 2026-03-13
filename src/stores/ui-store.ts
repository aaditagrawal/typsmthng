import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'

interface UIState {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  cursorLine: number
  cursorCol: number
  commandSearchOpen: boolean
  imagePreviewPath: string | null
  setTheme: (theme: Theme) => void
  setCursorPosition: (line: number, col: number) => void
  setCommandSearchOpen: (open: boolean) => void
  setImagePreviewPath: (path: string | null) => void
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme
}

function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

// Guard against duplicate listener registration during HMR
let mediaListenerRegistered = false

export const useUIStore = create<UIState>((set) => {
  const initial: Theme = 'dark'
  const resolved = resolveTheme(initial)
  applyTheme(resolved)

  // Listen for system theme changes (guarded for HMR)
  if (!mediaListenerRegistered) {
    mediaListenerRegistered = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      set((state) => {
        if (state.theme !== 'system') return state
        const newResolved = getSystemTheme()
        applyTheme(newResolved)
        return { resolvedTheme: newResolved }
      })
    })
  }

  return {
    theme: initial,
    resolvedTheme: resolved,
    cursorLine: 1,
    cursorCol: 1,
    commandSearchOpen: false,
    imagePreviewPath: null,
    setTheme: (theme) => set(() => {
      const resolved = resolveTheme(theme)
      applyTheme(resolved)
      return { theme, resolvedTheme: resolved }
    }),
    setCursorPosition: (line, col) => set((state) => {
      if (state.cursorLine === line && state.cursorCol === col) return state
      return { cursorLine: line, cursorCol: col }
    }),
    setCommandSearchOpen: (open) => set({ commandSearchOpen: open }),
    setImagePreviewPath: (path) => set({ imagePreviewPath: path }),
  }
})
