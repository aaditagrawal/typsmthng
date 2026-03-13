let workspaceShellPromise: Promise<unknown> | null = null

export function preloadWorkspaceShell(): Promise<unknown> {
  if (!workspaceShellPromise) {
    workspaceShellPromise = import('./workspace-shell')
  }
  return workspaceShellPromise
}
