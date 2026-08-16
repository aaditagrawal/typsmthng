import { create } from 'zustand'
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, createStore } from 'idb-keyval'
import { SAMPLE_DOCUMENT } from '@/lib/sample-document'
import { useCompileStore } from './compile-store'
import { useEditorStore } from './editor-store'

const projectsStore = createStore('typsmthng-projects', 'projects')
// Legacy second store name — older builds tried to open a `home` object store on
// the same DB, but idb-keyval never upgrades, so it never exists. Keep reading
// from it as a fallback; all new home-meta writes go to `projectsStore`.
const legacyHomeStore = createStore('typsmthng-projects', 'home')
const HOME_META_KEY = 'home-meta'
const RECOVERY_JOURNAL_KEY = 'typsmthng-recovery-journal'

interface RecoveryJournal {
  projectId: string
  path: string
  content: string
}

function readRecoveryJournal(): RecoveryJournal | null {
  try {
    const raw = localStorage.getItem(RECOVERY_JOURNAL_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const { projectId, path, content } = value as Partial<RecoveryJournal>
    return typeof projectId === 'string' && typeof path === 'string' && typeof content === 'string'
      ? { projectId, path, content }
      : null
  } catch {
    return null
  }
}

function writeRecoveryJournal(journal: RecoveryJournal): void {
  try {
    localStorage.setItem(RECOVERY_JOURNAL_KEY, JSON.stringify(journal))
  } catch {
    // IndexedDB autosave remains the fallback when synchronous storage is unavailable.
  }
}

function clearRecoveryJournal(): void {
  try {
    localStorage.removeItem(RECOVERY_JOURNAL_KEY)
  } catch {
    // Ignore unavailable synchronous storage.
  }
}

// Debounced auto-save for file content changes.
// Bound to a project id so switching projects cannot save the wrong one
// or drop the previous project's pending edits.
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSaveProjectId: string | null = null
const AUTO_SAVE_MS = 2000

/** Bumped on delete so in-flight idbSet cannot resurrect a removed project. */
const projectPersistEpoch = new Map<string, number>()

/** Serialize IDB writes per project so an older in-flight save cannot clobber a newer one. */
const projectSaveChains = new Map<string, Promise<void>>()

/** Serialize home-meta writes; always re-read live state at write time. */
let homeMetaWriteChain: Promise<void> = Promise.resolve()

function getProjectEpoch(projectId: string): number {
  return projectPersistEpoch.get(projectId) ?? 0
}

function bumpProjectEpoch(projectId: string): number {
  const next = getProjectEpoch(projectId) + 1
  projectPersistEpoch.set(projectId, next)
  return next
}

function clearAutoSaveTimer() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

function scheduleAutoSave(projectId: string, persist: (id: string) => Promise<void>) {
  // If a different project was pending, flush it before debouncing the new one.
  if (autoSaveProjectId && autoSaveProjectId !== projectId) {
    const previousId = autoSaveProjectId
    clearAutoSaveTimer()
    autoSaveProjectId = null
    void persist(previousId)
  }

  clearAutoSaveTimer()
  autoSaveProjectId = projectId
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null
    const id = autoSaveProjectId
    autoSaveProjectId = null
    if (id) void persist(id)
  }, AUTO_SAVE_MS)
}

function flushScheduledAutoSave(persist: (id: string) => Promise<void>): Promise<void> {
  const id = autoSaveProjectId
  clearAutoSaveTimer()
  autoSaveProjectId = null
  if (!id) return Promise.resolve()
  return persist(id)
}

function cancelScheduledAutoSave(projectId?: string) {
  if (projectId && autoSaveProjectId !== projectId) return
  clearAutoSaveTimer()
  autoSaveProjectId = null
}

function enqueueProjectSave(projectId: string, work: () => Promise<void>): Promise<void> {
  const previous = projectSaveChains.get(projectId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(work)
  projectSaveChains.set(projectId, next)
  return next
}

/** Test-only: clear debounce timers and persist epochs between cases. */
export function resetProjectPersistStateForTests(): void {
  clearAutoSaveTimer()
  autoSaveProjectId = null
  projectPersistEpoch.clear()
  projectSaveChains.clear()
  homeMetaWriteChain = Promise.resolve()
  clearRecoveryJournal()
}

export interface CreateProjectOptions {
  /** When false, create without selecting / mounting the workspace (bulk import). Default true. */
  select?: boolean
}

export interface ProjectFile {
  path: string
  content: string
  isBinary: boolean
  binaryData?: Uint8Array
  lastModified: number
}

export interface ProjectTemplateMeta {
  source: 'typst-universe' | 'built-in'
  resolvedSpec: string
  templateEntrypoint: string
  layoutLocked: boolean
  createdAt: number
  initCommand?: string
}

export interface ProjectScaffoldFile {
  path: string
  content: string
  isBinary: boolean
  binaryData?: Uint8Array
}

export interface ProjectScaffold {
  files: ProjectScaffoldFile[]
  mainFile: string
  templateMeta?: ProjectTemplateMeta
}

export interface Project {
  id: string
  name: string
  files: ProjectFile[]
  mainFile: string
  templateMeta?: ProjectTemplateMeta
  createdAt: number
  updatedAt: number
}

export interface HomeWorkspace {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface HomeMeta {
  workspaces: HomeWorkspace[]
  projectWorkspaceAssignments: Record<string, string>
  selectedHomeWorkspaceId: string | null
}

interface ProjectState {
  projects: Project[]
  homeWorkspaces: HomeWorkspace[]
  projectWorkspaceAssignments: Record<string, string>
  selectedHomeWorkspaceId: string | null
  currentProjectId: string | null
  currentFilePath: string | null
  sidebarOpen: boolean
  loading: boolean
  hasSelectedProject: boolean
  loadProjects: () => Promise<void>
  createProject: (name: string, scaffold?: ProjectScaffold, options?: CreateProjectOptions) => Promise<string>
  deleteProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  createHomeWorkspace: (name: string, projectIds?: string[]) => Promise<string>
  renameHomeWorkspace: (id: string, name: string) => Promise<void>
  deleteHomeWorkspace: (id: string) => Promise<void>
  assignProjectsToHomeWorkspace: (projectIds: string[], workspaceId: string | null) => Promise<void>
  setSelectedHomeWorkspace: (id: string | null) => Promise<void>
  selectProject: (id: string) => void
  goHome: () => void
  selectFile: (path: string) => void
  createFile: (path: string, content?: string) => Promise<void>
  createFilesBatch: (entries: Array<{ path: string; content: string }>) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  updateFileContent: (path: string, content: string) => void
  updateProjectFileContent: (projectId: string, path: string, content: string) => void
  addBinaryFile: (path: string, data: Uint8Array) => Promise<void>
  addBinaryFilesBatch: (entries: Array<{ path: string; data: Uint8Array }>) => Promise<void>
  createFolder: (path: string) => Promise<void>
  deleteFolder: (path: string) => Promise<void>
  moveFile: (oldPath: string, newPath: string) => Promise<void>
  renameFolder: (oldPath: string, newPath: string) => Promise<void>
  setSidebarOpen: (open: boolean) => void
  saveProject: (id: string) => Promise<void>
  saveCurrentProject: () => Promise<void>
  getCurrentProject: () => Project | undefined
}

function isMissingObjectStoreError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'NotFoundError'
  }
  if (err instanceof Error) {
    return err.name === 'NotFoundError' || err.message.includes('object stores was not found')
  }
  return false
}

async function loadHomeMeta(): Promise<HomeMeta | undefined> {
  const fromProjects = await idbGet<HomeMeta>(HOME_META_KEY, projectsStore)
  if (fromProjects) return fromProjects

  try {
    return await idbGet<HomeMeta>(HOME_META_KEY, legacyHomeStore) ?? undefined
  } catch (err) {
    if (!isMissingObjectStoreError(err)) throw err
    return undefined
  }
}

function persistHomeMeta(getState: () => ProjectState): Promise<void> {
  // Queue writes and snapshot state at write time so assign+select cannot
  // finish out of order and restore a stale selectedHomeWorkspaceId.
  homeMetaWriteChain = homeMetaWriteChain.catch(() => {}).then(async () => {
    const state = getState()
    const homeMeta = {
      workspaces: state.homeWorkspaces,
      projectWorkspaceAssignments: state.projectWorkspaceAssignments,
      selectedHomeWorkspaceId: state.selectedHomeWorkspaceId,
    } satisfies HomeMeta

    try {
      await idbSet(HOME_META_KEY, homeMeta, projectsStore)
    } catch (err) {
      console.warn('Failed to persist home metadata to IDB:', err)
    }
  })
  return homeMetaWriteChain
}

function createDefaultProject(): Project {
  return {
    id: 'default',
    name: 'My Document',
    files: [{
      path: '/main.typ',
      content: SAMPLE_DOCUMENT,
      isBinary: false,
      lastModified: Date.now(),
    }],
    mainFile: '/main.typ',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  homeWorkspaces: [],
  projectWorkspaceAssignments: {},
  selectedHomeWorkspaceId: null,
  currentProjectId: null,
  currentFilePath: null,
  sidebarOpen: false,
  loading: true,
  hasSelectedProject: false,

  loadProjects: async () => {
    const projects: Project[] = []
    let homeMeta: HomeMeta | undefined
    try {
      const allKeys = await idbKeys(projectsStore)
      const loaded = await Promise.all(
        allKeys.map((key) => idbGet<Project>(key as string, projectsStore)),
      )
      for (const project of loaded) {
        if (project && Array.isArray(project.files) && typeof project.mainFile === 'string') {
          projects.push(project)
        }
      }
    } catch (err) {
      console.warn('Failed to load projects from IDB:', err)
    }

    try {
      homeMeta = await loadHomeMeta()
    } catch (err) {
      console.warn('Failed to load home metadata from IDB:', err)
    }

    if (projects.length === 0) {
      const defaultProject = createDefaultProject()
      // Invalidate any in-flight persist that still holds a deleted `default`.
      bumpProjectEpoch(defaultProject.id)
      try {
        await idbSet(defaultProject.id, defaultProject, projectsStore)
      } catch (err) {
        console.warn('Failed to save default project to IDB:', err)
      }
      projects.push(defaultProject)
    }

    const recoveryJournal = readRecoveryJournal()
    if (recoveryJournal) {
      const project = projects.find((item) => item.id === recoveryJournal.projectId)
      const file = project?.files.find((item) => (
        item.path === recoveryJournal.path && !item.isBinary
      ))
      if (project && file) {
        const recoveredAt = Date.now()
        file.content = recoveryJournal.content
        file.lastModified = recoveredAt
        project.updatedAt = recoveredAt
        try {
          await idbSet(project.id, project, projectsStore)
          clearRecoveryJournal()
        } catch (err) {
          console.warn('Failed to persist recovered editor content to IDB:', err)
        }
      } else {
        clearRecoveryJournal()
      }
    }

    // Migrate the legacy seeded `default` project when its main file was stored
    // empty. Do not rewrite intentional empty mains on user projects.
    for (const project of projects) {
      if (project.id !== 'default') continue
      const mainFile = project.files.find((f) => f.path === project.mainFile)
      if (!mainFile || mainFile.isBinary || mainFile.content !== '') continue
      mainFile.content = SAMPLE_DOCUMENT
      mainFile.lastModified = Date.now()
      project.updatedAt = Date.now()
      try {
        await idbSet(project.id, project, projectsStore)
      } catch (err) {
        console.warn('Failed to save migrated project to IDB:', err)
      }
    }

    const validProjectIds = new Set(projects.map((project) => project.id))
    const workspaces = (homeMeta?.workspaces ?? []).filter((workspace) => workspace.name.trim())
    const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id))
    const projectWorkspaceAssignments = Object.fromEntries(
      Object.entries(homeMeta?.projectWorkspaceAssignments ?? {}).filter(
        ([projectId, workspaceId]) => validProjectIds.has(projectId) && validWorkspaceIds.has(workspaceId),
      ),
    )
    const selectedHomeWorkspaceId = homeMeta?.selectedHomeWorkspaceId && validWorkspaceIds.has(homeMeta.selectedHomeWorkspaceId)
      ? homeMeta.selectedHomeWorkspaceId
      : null

    set({
      projects,
      homeWorkspaces: workspaces,
      projectWorkspaceAssignments,
      selectedHomeWorkspaceId,
      currentProjectId: null,
      currentFilePath: null,
      loading: false,
      hasSelectedProject: false,
    })
  },

  createProject: async (name, scaffold, options) => {
    const select = options?.select !== false
    // Flush pending edits on the previous project before switching selection.
    if (select) {
      await flushScheduledAutoSave((projectId) => get().saveProject(projectId))
    }

    const now = Date.now()
    const id = `project-${crypto.randomUUID()}`
    const scaffoldFiles = (scaffold?.files ?? []).map((file) => ({
      path: file.path,
      content: file.content,
      isBinary: file.isBinary,
      binaryData: file.binaryData,
      lastModified: now,
    }))

    const defaultFile: ProjectFile = {
      path: '/main.typ',
      content: `// ${name}\n\n= ${name}\n\nStart writing here.\n`,
      isBinary: false,
      lastModified: now,
    }

    const files = scaffoldFiles.length > 0 ? scaffoldFiles : [defaultFile]
    const mainFile =
      scaffold?.mainFile && files.some((file) => file.path === scaffold.mainFile)
        ? scaffold.mainFile
        : files.find((file) => file.path === '/main.typ')?.path ?? files[0]?.path ?? '/main.typ'

    const project: Project = {
      id,
      name,
      files,
      mainFile,
      templateMeta: scaffold?.templateMeta,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await idbSet(id, project, projectsStore)
    } catch (err) {
      console.warn('Failed to save new project to IDB:', err)
    }

    const selectedWorkspaceId = get().selectedHomeWorkspaceId
    set((s) => ({
      projects: [...s.projects, project],
      ...(select
        ? {
            currentProjectId: id,
            currentFilePath: mainFile,
            hasSelectedProject: true,
          }
        : {}),
      ...(selectedWorkspaceId
        ? {
            projectWorkspaceAssignments: {
              ...s.projectWorkspaceAssignments,
              [id]: selectedWorkspaceId,
            },
          }
        : {}),
    }))
    useCompileStore.getState().clearPreview()
    if (selectedWorkspaceId) {
      await persistHomeMeta(get)
    }
    return id
  },

  deleteProject: async (id) => {
    // Invalidate in-flight/queued persists before removing from IDB/memory.
    bumpProjectEpoch(id)
    cancelScheduledAutoSave(id)

    try {
      await idbDel(id, projectsStore)
    } catch (err) {
      console.warn('Failed to delete project from IDB:', err)
    }
    let nextState: ProjectState | null = null
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id)
      const projectWorkspaceAssignments = { ...s.projectWorkspaceAssignments }
      delete projectWorkspaceAssignments[id]
      // If we deleted the currently selected project, clear selection
      if (s.currentProjectId === id) {
        nextState = {
          ...s,
          projects,
          projectWorkspaceAssignments,
          currentProjectId: null,
          currentFilePath: null,
          hasSelectedProject: false,
        }
        return nextState
      }
      nextState = { ...s, projects, projectWorkspaceAssignments }
      return nextState
    })
    if (nextState) {
      await persistHomeMeta(get)
    }
  },

  renameProject: async (id, name) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
      ),
    }))
    // Persist the renamed project by id — it may not be the current selection.
    await get().saveProject(id)
  },

  createHomeWorkspace: async (name, projectIds = []) => {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('Workspace name cannot be empty.')
    }

    const now = Date.now()
    const workspaceId = `workspace-${crypto.randomUUID()}`
    set((s) => ({
      homeWorkspaces: [...s.homeWorkspaces, {
        id: workspaceId,
        name: trimmed,
        createdAt: now,
        updatedAt: now,
      }],
      projectWorkspaceAssignments: {
        ...s.projectWorkspaceAssignments,
        ...Object.fromEntries(projectIds.map((projectId) => [projectId, workspaceId])),
      },
      selectedHomeWorkspaceId: workspaceId,
    }))
    await persistHomeMeta(get)
    return workspaceId
  },

  renameHomeWorkspace: async (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return

    set((s) => ({
      homeWorkspaces: s.homeWorkspaces.map((workspace) =>
        workspace.id === id
          ? { ...workspace, name: trimmed, updatedAt: Date.now() }
          : workspace,
      ),
    }))
    await persistHomeMeta(get)
  },

  deleteHomeWorkspace: async (id) => {
    set((s) => ({
      homeWorkspaces: s.homeWorkspaces.filter((workspace) => workspace.id !== id),
      projectWorkspaceAssignments: Object.fromEntries(
        Object.entries(s.projectWorkspaceAssignments).filter(([, workspaceId]) => workspaceId !== id),
      ),
      selectedHomeWorkspaceId: s.selectedHomeWorkspaceId === id ? null : s.selectedHomeWorkspaceId,
    }))
    await persistHomeMeta(get)
  },

  assignProjectsToHomeWorkspace: async (projectIds, workspaceId) => {
    set((s) => {
      const nextAssignments = { ...s.projectWorkspaceAssignments }
      for (const projectId of projectIds) {
        if (!workspaceId) {
          delete nextAssignments[projectId]
          continue
        }
        nextAssignments[projectId] = workspaceId
      }

      return {
        projectWorkspaceAssignments: nextAssignments,
        // Selecting a workspace while assigning is one atomic home-meta write.
        ...(workspaceId ? { selectedHomeWorkspaceId: workspaceId } : {}),
        homeWorkspaces: workspaceId
          ? s.homeWorkspaces.map((workspace) =>
              workspace.id === workspaceId
                ? { ...workspace, updatedAt: Date.now() }
                : workspace,
            )
          : s.homeWorkspaces,
      }
    })
    await persistHomeMeta(get)
  },

  setSelectedHomeWorkspace: async (selectedHomeWorkspaceId) => {
    set({ selectedHomeWorkspaceId })
    await persistHomeMeta(get)
  },

  selectProject: (id) => {
    const previousId = get().currentProjectId
    const previousPath = get().currentFilePath
    if (previousId && previousId !== id) {
      // Apply a dirty editor buffer to the project we are leaving *before*
      // changing currentProjectId — otherwise a deferred editor sync can land
      // on the newly selected project. Skip when the editor is clean so
      // in-memory project edits (autosave path) are not overwritten.
      const editor = useEditorStore.getState()
      if (previousPath && editor.isDirty) {
        get().updateProjectFileContent(previousId, previousPath, editor.source)
      }
      cancelScheduledAutoSave(previousId)
      void get().saveProject(previousId)
    }
    const project = get().projects.find((p) => p.id === id)
    set({
      currentProjectId: id,
      currentFilePath: project?.mainFile ?? null,
      hasSelectedProject: true,
    })
    if (previousId !== id) {
      useCompileStore.getState().clearPreview()
    }
  },

  goHome: () => {
    const previousId = get().currentProjectId
    const previousPath = get().currentFilePath
    const editor = useEditorStore.getState()
    if (previousId && previousPath && editor.isDirty) {
      get().updateProjectFileContent(previousId, previousPath, editor.source)
    }
    void flushScheduledAutoSave((projectId) => get().saveProject(projectId))
    void get().saveCurrentProject()
    set({ hasSelectedProject: false })
    useCompileStore.getState().clearPreview()
  },

  selectFile: (path) => set({ currentFilePath: path }),

  createFile: async (path, content = '') => {
    await get().createFilesBatch([{ path, content }])
  },

  createFilesBatch: async (entries) => {
    if (entries.length === 0) return

    let changed = false
    const deduped = new Map<string, string>()
    for (const entry of entries) {
      deduped.set(entry.path, entry.content)
    }

    const normalized = [...deduped.entries()].map(([path, content]) => ({ path, content }))
    const lastPath = normalized[normalized.length - 1]?.path ?? null

    set((s) => {
      const projectIndex = s.projects.findIndex((p) => p.id === s.currentProjectId)
      if (projectIndex < 0) return s

      const project = s.projects[projectIndex]
      const nextFiles = project.files.slice()
      const now = Date.now()

      for (const entry of normalized) {
        const existingIndex = nextFiles.findIndex((file) => file.path === entry.path)
        if (existingIndex >= 0) {
          const existing = nextFiles[existingIndex]
          if (!existing.isBinary && existing.content === entry.content) continue
          nextFiles[existingIndex] = {
            path: entry.path,
            content: entry.content,
            isBinary: false,
            lastModified: now,
          }
          changed = true
          continue
        }

        nextFiles.push({
          path: entry.path,
          content: entry.content,
          isBinary: false,
          lastModified: now,
        })
        changed = true
      }

      if (!changed && s.currentFilePath === lastPath) return s

      const nextProjects = s.projects.slice()
      nextProjects[projectIndex] = changed
        ? { ...project, files: nextFiles, updatedAt: now }
        : project

      return {
        projects: nextProjects,
        currentFilePath: lastPath ?? s.currentFilePath,
      }
    })

    if (changed) {
      const projectId = get().currentProjectId
      if (projectId) scheduleAutoSave(projectId, (id) => get().saveProject(id))
    }
  },

  deleteFile: async (path) => {
    set((s) => {
      const project = s.projects.find((p) => p.id === s.currentProjectId)
      if (!project) return s

      const nextFiles = project.files.filter((f) => f.path !== path)
      let nextMainFile = project.mainFile
      if (nextMainFile === path) {
        nextMainFile = nextFiles.find((f) => !f.isBinary)?.path
          ?? nextFiles[0]?.path
          ?? '/main.typ'
      }

      let nextCurrentPath = s.currentFilePath
      if (nextCurrentPath === path) {
        nextCurrentPath = nextFiles.some((f) => f.path === nextMainFile)
          ? nextMainFile
          : (nextFiles[0]?.path ?? null)
      }

      return {
        projects: s.projects.map((p) =>
          p.id === s.currentProjectId
            ? { ...p, files: nextFiles, mainFile: nextMainFile, updatedAt: Date.now() }
            : p
        ),
        currentFilePath: nextCurrentPath,
      }
    })
    await get().saveCurrentProject()
  },

  renameFile: async (oldPath, newPath) => {
    const project = get().projects.find((p) => p.id === get().currentProjectId)
    if (oldPath !== newPath && project?.files.some((f) => f.path === newPath)) {
      throw new Error(`Cannot rename file: "${newPath}" already exists.`)
    }

    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === s.currentProjectId
          ? {
              ...p,
              files: p.files.map((f) =>
                f.path === oldPath ? { ...f, path: newPath, lastModified: Date.now() } : f
              ),
              mainFile: p.mainFile === oldPath ? newPath : p.mainFile,
              updatedAt: Date.now(),
            }
          : p
      ),
      currentFilePath: s.currentFilePath === oldPath ? newPath : s.currentFilePath,
    }))
    await get().saveCurrentProject()
  },

  updateProjectFileContent: (projectId, path, content) => {
    let changed = false
    set((s) => {
      const projectIndex = s.projects.findIndex((p) => p.id === projectId)
      if (projectIndex < 0) return s

      const project = s.projects[projectIndex]
      const fileIndex = project.files.findIndex((f) => f.path === path && !f.isBinary)
      if (fileIndex < 0) return s

      const currentFile = project.files[fileIndex]
      if (currentFile.content === content) return s

      changed = true
      const now = Date.now()
      const nextFiles = project.files.slice()
      nextFiles[fileIndex] = {
        ...currentFile,
        content,
        lastModified: now,
      }

      const nextProjects = s.projects.slice()
      nextProjects[projectIndex] = {
        ...project,
        files: nextFiles,
        updatedAt: now,
      }

      return { projects: nextProjects }
    })
    if (!changed) return
    writeRecoveryJournal({ projectId, path, content })
    scheduleAutoSave(projectId, (id) => get().saveProject(id))
  },

  updateFileContent: (path, content) => {
    const projectId = get().currentProjectId
    if (!projectId) return
    get().updateProjectFileContent(projectId, path, content)
  },

  addBinaryFile: async (path, data) => {
    await get().addBinaryFilesBatch([{ path, data }])
  },

  addBinaryFilesBatch: async (entries) => {
    if (entries.length === 0) return

    let changed = false
    const deduped = new Map<string, Uint8Array>()
    for (const entry of entries) {
      deduped.set(entry.path, entry.data)
    }
    const normalized = [...deduped.entries()].map(([path, data]) => ({ path, data }))

    set((s) => {
      const projectIndex = s.projects.findIndex((p) => p.id === s.currentProjectId)
      if (projectIndex < 0) return s

      const project = s.projects[projectIndex]
      const nextFiles = project.files.slice()
      const now = Date.now()

      for (const entry of normalized) {
        const existingIndex = nextFiles.findIndex((file) => file.path === entry.path)
        if (existingIndex >= 0) {
          const existing = nextFiles[existingIndex]
          if (
            existing.isBinary
            && existing.binaryData
            && existing.binaryData.length === entry.data.length
          ) {
            let same = true
            for (let i = 0; i < existing.binaryData.length; i++) {
              if (existing.binaryData[i] !== entry.data[i]) {
                same = false
                break
              }
            }
            if (same) continue
          }

          nextFiles[existingIndex] = {
            path: entry.path,
            content: '',
            isBinary: true,
            binaryData: entry.data,
            lastModified: now,
          }
          changed = true
          continue
        }

        nextFiles.push({
          path: entry.path,
          content: '',
          isBinary: true,
          binaryData: entry.data,
          lastModified: now,
        })
        changed = true
      }

      if (!changed) return s

      const nextProjects = s.projects.slice()
      nextProjects[projectIndex] = { ...project, files: nextFiles, updatedAt: now }
      return { projects: nextProjects }
    })

    if (changed) {
      const projectId = get().currentProjectId
      if (projectId) scheduleAutoSave(projectId, (id) => get().saveProject(id))
    }
  },

  createFolder: async (path) => {
    // Create a placeholder file so the folder persists even when empty
    const placeholderPath = `${path}/.folder`
    set((s) => {
      const project = s.projects.find((p) => p.id === s.currentProjectId)
      if (!project) return s
      // Don't create if placeholder already exists
      if (project.files.some((f) => f.path === placeholderPath)) return s
      const newFile: ProjectFile = {
        path: placeholderPath,
        content: '',
        isBinary: false,
        lastModified: Date.now(),
      }
      return {
        projects: s.projects.map((p) =>
          p.id === s.currentProjectId
            ? { ...p, files: [...p.files, newFile], updatedAt: Date.now() }
            : p
        ),
      }
    })
    await get().saveCurrentProject()
  },

  deleteFolder: async (path) => {
    // Normalize: ensure path ends without trailing slash for prefix matching
    const prefix = path.endsWith('/') ? path : `${path}/`
    set((s) => {
      const project = s.projects.find((p) => p.id === s.currentProjectId)
      if (!project) return s
      const remainingFiles = project.files.filter((f) => !f.path.startsWith(prefix))
      const fallbackFile = remainingFiles.find((f) => !f.isBinary) ?? remainingFiles[0]
      const mainWasRemoved = project.mainFile.startsWith(prefix)
      const nextMainFile = mainWasRemoved
        ? (fallbackFile?.path ?? '')
        : project.mainFile
      const newCurrentFile = s.currentFilePath && s.currentFilePath.startsWith(prefix)
        ? (fallbackFile?.path ?? null)
        : s.currentFilePath
      return {
        projects: s.projects.map((p) =>
          p.id === s.currentProjectId
            ? { ...p, files: remainingFiles, mainFile: nextMainFile, updatedAt: Date.now() }
            : p
        ),
        currentFilePath: newCurrentFile,
      }
    })
    await get().saveCurrentProject()
  },

  moveFile: async (oldPath, newPath) => {
    await get().renameFile(oldPath, newPath)
  },

  renameFolder: async (oldPath, newPath) => {
    const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`
    const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`
    if (oldPrefix === newPrefix) return

    if (newPrefix.startsWith(oldPrefix)) {
      throw new Error('Cannot rename a folder into one of its descendants.')
    }

    const project = get().projects.find((p) => p.id === get().currentProjectId)
    if (project) {
      const unaffectedPaths = new Set(
        project.files.filter((f) => !f.path.startsWith(oldPrefix)).map((f) => f.path),
      )
      const collision = project.files
        .filter((f) => f.path.startsWith(oldPrefix))
        .map((f) => `${newPrefix}${f.path.slice(oldPrefix.length)}`)
        .find((targetPath) => unaffectedPaths.has(targetPath))

      if (collision) {
        throw new Error(`Cannot rename folder: "${collision}" already exists.`)
      }
    }

    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === s.currentProjectId
          ? {
              ...p,
              files: p.files.map((f) =>
                f.path.startsWith(oldPrefix)
                  ? { ...f, path: `${newPrefix}${f.path.slice(oldPrefix.length)}`, lastModified: Date.now() }
                  : f
              ),
              mainFile: p.mainFile.startsWith(oldPrefix)
                ? `${newPrefix}${p.mainFile.slice(oldPrefix.length)}`
                : p.mainFile,
              updatedAt: Date.now(),
            }
          : p
      ),
      currentFilePath: s.currentFilePath?.startsWith(oldPrefix)
        ? `${newPrefix}${s.currentFilePath.slice(oldPrefix.length)}`
        : s.currentFilePath,
    }))
    await get().saveCurrentProject()
  },

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  saveProject: async (id) => {
    await enqueueProjectSave(id, async () => {
      const epoch = getProjectEpoch(id)
      if (!get().projects.some((p) => p.id === id)) return

      if (get().currentProjectId === id) {
        useEditorStore.setState({ saveStatus: 'saving' })
      }

      try {
        // Re-check immediately before the write so a delete that landed after we
        // entered this function cannot be overwritten / resurrected.
        if (getProjectEpoch(id) !== epoch) return
        const latest = get().projects.find((p) => p.id === id)
        if (!latest) return

        await idbSet(id, latest, projectsStore)

        const recoveryJournal = readRecoveryJournal()
        const persistedRecoveryFile = recoveryJournal?.projectId === id
          ? latest.files.find((file) => file.path === recoveryJournal.path && !file.isBinary)
          : undefined
        if (recoveryJournal && persistedRecoveryFile?.content === recoveryJournal.content) {
          clearRecoveryJournal()
        }

        // Reconcile races that landed during idbSet:
        // - deleted and still gone → remove any resurrected IDB row
        // - deleted then recreated (same id) → write the live snapshot
        if (getProjectEpoch(id) !== epoch) {
          const live = get().projects.find((p) => p.id === id)
          if (!live) {
            try {
              await idbDel(id, projectsStore)
            } catch (err) {
              console.warn('Failed to roll back resurrected project in IDB:', err)
            }
          } else {
            try {
              await idbSet(id, live, projectsStore)
            } catch (err) {
              console.warn('Failed to re-save live project after stale write:', err)
            }
          }
          return
        }

        if (get().currentProjectId === id && get().projects.some((p) => p.id === id)) {
          useEditorStore.setState({ isDirty: false, saveStatus: 'saved' })
        }
      } catch (err) {
        console.warn('Failed to save project to IDB:', err)
        if (get().currentProjectId === id) {
          useEditorStore.setState({ saveStatus: 'unsaved', isDirty: true })
        }
      }
    })
  },

  saveCurrentProject: async () => {
    const { currentProjectId } = get()
    if (!currentProjectId) return
    await get().saveProject(currentProjectId)
  },

  getCurrentProject: () => {
    const { currentProjectId, projects } = get()
    return projects.find((p) => p.id === currentProjectId)
  },
}))
