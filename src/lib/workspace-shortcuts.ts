interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

function isPrimaryShortcut(event: ShortcutEvent, key: string): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === key
}

export function isSettingsShortcut(event: ShortcutEvent): boolean {
  return isPrimaryShortcut(event, ',')
}

export function isSidebarShortcut(event: ShortcutEvent): boolean {
  return isPrimaryShortcut(event, '\\')
}
