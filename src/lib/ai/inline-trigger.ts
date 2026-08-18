import type { EditorView } from '@codemirror/view'

/**
 * Tiny registry decoupling the Mod-i keybinding (lib/keybindings.ts) from the
 * panel component: the mounted AiInlinePanel registers its open handler here.
 */

export type AiInlineTriggerHandler = (view: EditorView) => boolean

let handler: AiInlineTriggerHandler | null = null

export function registerAiInlineTrigger(next: AiInlineTriggerHandler) {
  handler = next
}

/** Clears only when `current` is still the active handler, so an out-of-order
 * unmount can't remove a newer panel's registration. */
export function unregisterAiInlineTrigger(current: AiInlineTriggerHandler) {
  if (handler === current) handler = null
}

export function triggerAiInline(view: EditorView): boolean {
  return handler ? handler(view) : false
}
