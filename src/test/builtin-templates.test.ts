import { describe, expect, it } from 'vitest'
import {
  createBuiltInTemplateScaffold,
  getBuiltInTemplate,
  listBuiltInTemplates,
} from '@/lib/builtin-templates'

describe('built-in templates', () => {
  it('lists bundled starter templates', () => {
    const templates = listBuiltInTemplates()
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.some((entry) => entry.id === 'research-starter')).toBe(true)
  })

  it('builds research starter scaffold with metadata and entrypoint', () => {
    const scaffold = createBuiltInTemplateScaffold('research-starter')

    expect(scaffold.mainFile).toBe('/main.typ')
    expect(scaffold.templateMeta?.source).toBe('built-in')
    expect(scaffold.templateMeta?.resolvedSpec).toBe('built-in/research-starter')

    const paths = scaffold.files.map((file) => file.path)
    expect(paths).toContain('/main.typ')
    expect(paths).toContain('/refs.bib')
    expect(paths).toContain('/.typsmthng/template.json')
  })

  it('returns built-in template metadata by id', () => {
    const template = getBuiltInTemplate('research-starter')
    expect(template?.suggestedProjectName).toBe('Research Starter')
  })
})
