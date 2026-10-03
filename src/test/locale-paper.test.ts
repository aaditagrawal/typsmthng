import { afterEach, describe, expect, it } from 'vitest'
import { applyPagePreamble } from '@/lib/compile-manager'
import { autoPageSizeLabel, localePaperFromLanguages } from '@/lib/locale-paper'
import { useSettingsStore } from '@/stores/settings-store'

describe('locale paper', () => {
  const languages = navigator.languages

  afterEach(() => {
    Object.defineProperty(navigator, 'languages', { value: languages, configurable: true })
    useSettingsStore.setState({ pageSize: 'auto' })
  })

  it('maps en-US and en-CA to US Letter and other locales to A4', () => {
    expect(localePaperFromLanguages(['en-US'])).toBe('us-letter')
    expect(localePaperFromLanguages(['en-CA', 'fr'])).toBe('us-letter')
    expect(localePaperFromLanguages(['en-us-x-private'])).toBe('us-letter')
    expect(localePaperFromLanguages(['en-GB', 'en'])).toBe('a4')
    expect(localePaperFromLanguages(['fr-FR'])).toBe('a4')
    expect(localePaperFromLanguages([])).toBe('a4')
    expect(autoPageSizeLabel('us-letter')).toBe('Auto (US Letter)')
    expect(autoPageSizeLabel('a4')).toBe('Auto (A4)')
  })

  it('injects the resolved paper for auto when the source does not set a page', () => {
    Object.defineProperty(navigator, 'languages', { value: ['en-CA'], configurable: true })
    useSettingsStore.setState({ pageSize: 'auto' })
    expect(applyPagePreamble('= Hello')).toBe('#set page(paper: "us-letter")\n= Hello')

    Object.defineProperty(navigator, 'languages', { value: ['de-DE'], configurable: true })
    expect(applyPagePreamble('= Hello')).toBe('#set page(paper: "a4")\n= Hello')
    expect(applyPagePreamble('#set page(margin: 1cm)\n= Hello')).toBe('#set page(margin: 1cm)\n= Hello')
  })
})
