import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Prec, type Extension } from '@codemirror/state'

const lightHighlighting = HighlightStyle.define([
  // Keywords (all keyword subtypes used by codemirror-lang-typst)
  { tag: tags.keyword, color: '#0000FF' },
  { tag: tags.controlKeyword, color: '#AF00DB' },
  { tag: tags.definitionKeyword, color: '#0000FF' },
  { tag: tags.moduleKeyword, color: '#AF00DB' },
  { tag: tags.operatorKeyword, color: '#0000FF' },
  // Comments
  { tag: tags.comment, color: '#008000', fontStyle: 'italic' },
  // Strings and literals
  { tag: tags.string, color: '#A31515' },
  { tag: tags.special(tags.string), color: '#A31515' },
  { tag: tags.escape, color: '#EE0000' },
  { tag: tags.quote, color: '#A31515' },
  { tag: tags.literal, color: '#0000FF', fontWeight: 'bold' },
  // Numbers
  { tag: tags.number, color: '#098658' },
  { tag: tags.integer, color: '#098658' },
  { tag: tags.float, color: '#098658' },
  // Functions
  { tag: tags.function(tags.variableName), color: '#795E26' },
  // Operators (all operator subtypes)
  { tag: tags.operator, color: '#000000' },
  { tag: tags.arithmeticOperator, color: '#000000' },
  { tag: tags.compareOperator, color: '#000000' },
  { tag: tags.updateOperator, color: '#000000' },
  { tag: tags.controlOperator, color: '#AF00DB' },
  { tag: tags.definitionOperator, color: '#000000' },
  // Types
  { tag: tags.typeName, color: '#267F99' },
  // Headings
  { tag: tags.heading, color: '#0000FF', fontWeight: 'bold' },
  // Markup
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.content, color: '#000000' },
  { tag: tags.contentSeparator, color: '#666666' },
  { tag: tags.special(tags.contentSeparator), color: '#AF00DB' },
  { tag: tags.monospace, fontFamily: 'monospace' },
  { tag: tags.annotation, color: '#267F99' },
  { tag: tags.list, color: '#0000FF' },
  // Links and labels
  { tag: tags.url, color: '#FF4D00' },
  { tag: tags.link, color: '#FF4D00', textDecoration: 'underline' },
  { tag: tags.labelName, color: '#267F99' },
  // Meta and macros
  { tag: tags.meta, color: '#0000FF' },
  { tag: tags.macroName, color: '#0000FF' },
  { tag: tags.documentMeta, color: '#008000' },
  // Brackets and punctuation
  { tag: tags.bracket, color: '#000000' },
  { tag: tags.brace, color: '#000000' },
  { tag: tags.paren, color: '#000000' },
  { tag: tags.punctuation, color: '#000000' },
  { tag: tags.separator, color: '#000000' },
  // Variables
  { tag: tags.propertyName, color: '#001080' },
  { tag: tags.variableName, color: '#001080' },
  { tag: tags.special(tags.variableName), color: '#001080' },
  { tag: tags.bool, color: '#0000FF' },
  // Errors
  { tag: tags.invalid, color: '#FF0000', textDecoration: 'underline wavy' },
])

const darkHighlighting = HighlightStyle.define([
  // Keywords — bright cyan/electric blue
  { tag: tags.keyword, color: '#4FC1FF' },
  { tag: tags.controlKeyword, color: '#4FC1FF' },
  { tag: tags.definitionKeyword, color: '#4FC1FF' },
  { tag: tags.moduleKeyword, color: '#4FC1FF' },
  { tag: tags.operatorKeyword, color: '#4FC1FF' },
  // Comments — muted green
  { tag: tags.comment, color: '#6A9955', fontStyle: 'italic' },
  // Strings and literals — warm amber
  { tag: tags.string, color: '#FFB86C' },
  { tag: tags.special(tags.string), color: '#FFB86C' },
  { tag: tags.escape, color: '#FF6D2D' },
  { tag: tags.quote, color: '#FFB86C' },
  { tag: tags.literal, color: '#4FC1FF', fontWeight: 'bold' },
  // Numbers — soft green
  { tag: tags.number, color: '#B5CEA8' },
  { tag: tags.integer, color: '#B5CEA8' },
  { tag: tags.float, color: '#B5CEA8' },
  // Functions — bright yellow
  { tag: tags.function(tags.variableName), color: '#FFD700' },
  // Operators — white/bright
  { tag: tags.operator, color: '#E5E5E5' },
  { tag: tags.arithmeticOperator, color: '#E5E5E5' },
  { tag: tags.compareOperator, color: '#E5E5E5' },
  { tag: tags.updateOperator, color: '#E5E5E5' },
  { tag: tags.controlOperator, color: '#4FC1FF' },
  { tag: tags.definitionOperator, color: '#E5E5E5' },
  // Types — teal
  { tag: tags.typeName, color: '#4EC9B0' },
  // Headings — BOLD accent orange
  { tag: tags.heading, color: '#FF6D2D', fontWeight: 'bold' },
  // Markup
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.content, color: '#E5E5E5' },
  { tag: tags.contentSeparator, color: '#808080' },
  { tag: tags.special(tags.contentSeparator), color: '#4FC1FF' },
  { tag: tags.monospace, fontFamily: 'monospace', color: '#CE9178' },
  { tag: tags.annotation, color: '#4EC9B0' },
  { tag: tags.list, color: '#FF6D2D' },
  // Links — accent
  { tag: tags.url, color: '#FF4D00' },
  { tag: tags.link, color: '#FF4D00', textDecoration: 'underline' },
  { tag: tags.labelName, color: '#4EC9B0' },
  // Meta/macros — bright blue
  { tag: tags.meta, color: '#569CD6' },
  { tag: tags.macroName, color: '#569CD6' },
  { tag: tags.documentMeta, color: '#6A9955' },
  // Brackets and punctuation
  { tag: tags.bracket, color: '#D4D4D4' },
  { tag: tags.brace, color: '#D4D4D4' },
  { tag: tags.paren, color: '#D4D4D4' },
  { tag: tags.punctuation, color: '#D4D4D4' },
  { tag: tags.separator, color: '#D4D4D4' },
  // Variables — light blue
  { tag: tags.propertyName, color: '#9CDCFE' },
  { tag: tags.variableName, color: '#9CDCFE' },
  { tag: tags.special(tags.variableName), color: '#9CDCFE' },
  { tag: tags.bool, color: '#4FC1FF' },
  // Errors
  { tag: tags.invalid, color: '#F44747', textDecoration: 'underline wavy' },
])

function buildEditorTheme(theme: 'light' | 'dark'): Extension {
  const isDark = theme === 'dark'
  const baseTheme = EditorView.theme({
    '&': {
      color: isDark ? '#FAFAFA' : '#0A0A0A',
      backgroundColor: isDark ? '#141414' : '#ffffff',
    },
    '.cm-content': {
      caretColor: '#FF4D00',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#FF4D00',
      borderLeftWidth: '2px',
    },
    '.cm-gutters': {
      backgroundColor: isDark ? '#141414' : '#ffffff',
      color: isDark ? '#525252' : '#a3a3a3',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: isDark ? '#a3a3a3' : '#525252',
    },
    '.cm-activeLine': {
      backgroundColor: isDark ? 'rgba(255, 77, 0, 0.08)' : 'rgba(255, 77, 0, 0.06)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: isDark ? 'rgba(255, 77, 0, 0.15)' : 'rgba(255, 77, 0, 0.12)',
    },
    '.cm-matchingBracket': {
      backgroundColor: isDark ? 'rgba(255, 77, 0, 0.12)' : 'rgba(255, 77, 0, 0.1)',
      outline: '1px solid rgba(255, 77, 0, 0.4)',
      borderRadius: '2px',
    },
    '.cm-source-highlight': {
      backgroundColor: isDark ? 'rgba(255, 77, 0, 0.18)' : 'rgba(255, 77, 0, 0.14)',
      transition: 'background-color 0.3s ease',
    },
    '.cm-diagnostic-error': {
      textDecoration: 'underline wavy',
      textDecorationColor: isDark ? '#F44747' : '#E51400',
      backgroundColor: isDark ? 'rgba(244, 71, 71, 0.1)' : 'rgba(229, 20, 0, 0.08)',
      textUnderlineOffset: '3px',
    },
    '.cm-diagnostic-warning': {
      textDecoration: 'underline wavy',
      textDecorationColor: isDark ? '#CCA700' : '#BF8803',
      backgroundColor: isDark ? 'rgba(204, 167, 0, 0.1)' : 'rgba(191, 136, 3, 0.08)',
      textUnderlineOffset: '3px',
    },
    // Constrain indent markers to the first visual line so they
    // don't bleed through wrapped text that reflows to the left edge.
    '.cm-indent-markers::before': {
      bottom: 'auto !important',
      height: '1lh',
    },
  }, { dark: isDark })

  return [
    baseTheme,
    // Prec.highest overrides codemirror-lang-typst's built-in style which hardcodes heading to "black"
    Prec.highest(syntaxHighlighting(isDark ? darkHighlighting : lightHighlighting)),
  ]
}

const editorThemes: Record<'light' | 'dark', Extension> = {
  light: buildEditorTheme('light'),
  dark: buildEditorTheme('dark'),
}

export function createEditorTheme(theme: 'light' | 'dark'): Extension {
  return editorThemes[theme]
}
