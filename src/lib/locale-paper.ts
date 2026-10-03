export type LocalePaper = 'us-letter' | 'a4'

/** en-US and en-CA use US Letter. Every other locale uses A4. */
export function localePaperFromLanguages(languages: readonly string[]): LocalePaper {
  for (const language of languages) {
    const tag = language.toLowerCase()
    if (
      tag === 'en-us'
      || tag === 'en-ca'
      || tag.startsWith('en-us-')
      || tag.startsWith('en-ca-')
    ) {
      return 'us-letter'
    }
  }
  return 'a4'
}

export function currentLocalePaper(): LocalePaper {
  if (typeof navigator === 'undefined') return 'a4'
  const languages = navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : []
  return localePaperFromLanguages(languages)
}

export function autoPageSizeLabel(paper: LocalePaper = currentLocalePaper()): string {
  return paper === 'us-letter' ? 'Auto (US Letter)' : 'Auto (A4)'
}
