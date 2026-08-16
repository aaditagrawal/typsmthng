import type { EditorView } from '@codemirror/view'

/**
 * Tiny registry decoupling the Mod-i keybinding (lib/keybindings.ts) from the
 * panel component: the mounted AiInlinePanel registers its open handler here.
 */

type AiInlineTriggerHandler = (view: EditorView) => boolean

let handler: AiInlineTriggerHandler | null = null

export function registerAiInlineTrigger(next: AiInlineTriggerHandler | null) {
  handler = next
}

export function triggerAiInline(view: EditorView): boolean {
  return handler ? handler(view) : false
}
