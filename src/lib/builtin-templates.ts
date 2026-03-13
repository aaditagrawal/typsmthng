import type { ProjectScaffold, ProjectScaffoldFile, ProjectTemplateMeta } from '@/stores/project-store'

export interface BuiltInTemplate {
  id: 'research-starter'
  label: string
  description: string
  suggestedProjectName: string
}

const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'research-starter',
    label: 'Research Starter (Built-in)',
    description: 'A clean paper skeleton with section prompts and a bibliography file.',
    suggestedProjectName: 'Research Starter',
  },
]

function buildTemplateMeta(templateId: BuiltInTemplate['id'], entrypoint: string): ProjectTemplateMeta {
  return {
    source: 'built-in',
    resolvedSpec: `built-in/${templateId}`,
    templateEntrypoint: entrypoint.replace(/^\//, ''),
    layoutLocked: false,
    createdAt: Date.now(),
  }
}

function buildMetadataFile(templateMeta: ProjectTemplateMeta): ProjectScaffoldFile {
  return {
    path: '/.typsmthng/template.json',
    content: `${JSON.stringify(templateMeta, null, 2)}\n`,
    isBinary: false,
  }
}

function createResearchStarterScaffold(): ProjectScaffold {
  const templateMeta = buildTemplateMeta('research-starter', '/main.typ')

  const files: ProjectScaffoldFile[] = [
    {
      path: '/main.typ',
      isBinary: false,
      content: `= Research Starter

This built-in scaffold gives you a practical structure for a paper draft.

== Abstract
Summarize your contribution, methods, and key findings.

== Introduction
Describe the context, problem, and why the work matters.

== Method
Explain your approach, assumptions, and data.

== Results
Report your most relevant outcomes.

== Discussion
Interpret results, limits, and future work.

== References
#bibliography("refs.bib")
`,
    },
    {
      path: '/refs.bib',
      isBinary: false,
      content: `@article{sample2026,
  title = {Replace with your first citation},
  author = {Doe, Jane},
  journal = {Journal Name},
  year = {2026}
}
`,
    },
    buildMetadataFile(templateMeta),
  ]

  return {
    files,
    mainFile: '/main.typ',
    templateMeta,
  }
}

export function listBuiltInTemplates(): BuiltInTemplate[] {
  return BUILT_IN_TEMPLATES
}

export function getBuiltInTemplate(templateId: string): BuiltInTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((entry) => entry.id === templateId)
}

export function createBuiltInTemplateScaffold(templateId: string): ProjectScaffold {
  if (templateId === 'research-starter') {
    return createResearchStarterScaffold()
  }
  throw new Error(`unknown built-in template: ${templateId}`)
}
