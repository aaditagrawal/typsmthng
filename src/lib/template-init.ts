import { useProjectStore } from '@/stores/project-store'
import { parseInitCommand } from './universe-spec'
import { fetchTemplateScaffold, resolveSpec, withInitCommandInScaffold } from './universe-registry'

export interface InitCommandResult {
  projectName: string
  resolvedSpec: string
}

export async function runInitCommand(command: string): Promise<InitCommandResult> {
  const parsed = parseInitCommand(command)
  const resolved = await resolveSpec(`@${parsed.spec.namespace}/${parsed.spec.name}${parsed.spec.version ? `:${parsed.spec.version}` : ''}`)
  const scaffold = await fetchTemplateScaffold(resolved)
  const enrichedScaffold = withInitCommandInScaffold(scaffold, command.trim())

  const projectName = parsed.dir ?? parsed.spec.name
  await useProjectStore.getState().createProject(projectName, enrichedScaffold)

  return {
    projectName,
    resolvedSpec: `@${resolved.namespace}/${resolved.name}:${resolved.version}`,
  }
}
