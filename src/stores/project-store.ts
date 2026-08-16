import { create } from 'zustand'
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, createStore } from 'idb-keyval'
import { SAMPLE_DOCUMENT } from '@/lib/sample-document'
import { isHiddenInternalPath } from '@/lib/file-index'
import { useCompileStore } from './compile-store'
import { useEditorStore } from './editor-store'

const projectsStore = createStore('typsmthng-projects', 'projects')
// Legacy second store name — older builds tried to open a `home` object store on
// the same DB, but idb-keyval never upgrades, so it never exists. Keep reading
// from it as a fallback; all new home-meta writes go to `projectsStore`.
const legacyHomeStore = createStore('typsmthng-projects', 'home')
const HOME_META_KEY = 'home-meta'
const RECOVERY_JOURNAL_KEY = 'typsmthng-recovery-journal'
// Skip journaling pathological single-file edits; localStorage quota is ~5MB.
const RECOVERY_JOURNAL_MAX_ENTRY_CHARS = 2 * 1024 * 1024
const RECOVERY_JOURNAL_MAX_TOTAL_CHARS = 4 * 1024 * 1024

export function isQuotaExceededError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.code === 22
  }
  return err instanceof Error && err.name === 'QuotaExceededError'
}

interface RecoveryJournalEntry {
  projectId: string
  path: string
  content: string
}

let recoveryJournalCache: Map<string, RecoveryJournalEntry> | null = null

function recoveryJournalKey(projectId: string, path: string): string {
  return `${projectId}\u0000${path}`
}

/** Insertion order doubles as recency: entries are re-inserted on every write. */
function readRecoveryJournalMap(): Map<string, RecoveryJournalEntry> {
  if (recoveryJournalCache) return recoveryJournalCache

  const map = new Map<string, RecoveryJournalEntry>()
  try {
    const raw = localStorage.getItem(RECOVERY_JOURNAL_KEY)
    if (raw) {
      const value: unknown = JSON.parse(raw)
      // Older builds stored a single journal object; accept both shapes.
      const items = Array.isArray(value) ? value : [value]
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const { projectId, path, content } = item as Partial<RecoveryJournalEntry>
        if (typeof projectId === 'string' && typeof path === 'string' && typeof content === 'string') {
          map.set(recoveryJournalKey(projectId, path), { projectId, path, content })
        }
      }
    }
  } catch {
    // Corrupt or unavailable synchronous storage; start with an empty journal.
  }
  recoveryJournalCache = map
  return map
}

function persistRecoveryJournal(map: Map<string, RecoveryJournalEntry>): void {
  try {
    if (map.size === 0) {
      localStorage.removeItem(RECOVERY_JOURNAL_KEY)
    } else {
      localStorage.setItem(RECOVERY_JOURNAL_KEY, JSON.stringify([...map.values()]))
    }
  } catch {
    // IndexedDB autosave remains the fallback when synchronous storage is unavailable.
  }
}

function writeRecoveryJournalEntry(entry: RecoveryJournalEntry): void {
  const map = readRecoveryJournalMap()
  const key = recoveryJournalKey(entry.projectId, entry.path)

  if (entry.content.length > RECOVERY_JOURNAL_MAX_ENTRY_CHARS) {
    console.warn(`Skipping recovery journal for ${entry.path}: content exceeds journal size limit.`)
    // Drop any stale smaller snapshot so recovery cannot roll the file back.
    if (map.delete(key)) persistRecoveryJournal(map)
    return
  }

  const existing = map.get(key)
  if (existing?.content === entry.content) return

  // Re-insert so Map iteration order stays oldest-first for eviction.
  map.delete(key)
  map.set(key, entry)

  let total = 0
  for (const item of map.values()) total += item.content.length
  for (const [oldestKey, oldest] of map) {
    if (total <= RECOVERY_JOURNAL_MAX_TOTAL_CHARS || map.size <= 1) break
    map.delete(oldestKey)
    total -= oldest.content.length
  }

  persistRecoveryJournal(map)
}

/** Drop journal entries the given persisted snapshot now covers (or that point at missing files). */
function pruneRecoveryJournalForProject(project: Project): void {
  const map = readRecoveryJournalMap()
  let changed = false
  for (const [key, entry] of map) {
    if (entry.projectId !== project.id) continue
    const file = project.files.find((item) => item.path === entry.path && !item.isBinary)
    if (!file || file.content === entry.content) {
      map.delete(key)
      changed = true
    }
  }
  if (changed) persistRecoveryJournal(map)
}

function clearRecoveryJournal(): void {
  recoveryJournalCache = null
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

// Binary payloads are persisted as separate IDB records (`bin:{projectId}:{path}`)
// so text-only autosaves never re-serialize multi-MB Uint8Arrays. The main
// project record stores binary files without their `binaryData`; payloads are
// stitched back in on load, so the split is invisible outside this module.
// Project ids never contain `:` (they are `default` or `project-<uuid>`).
const BINARY_RECORD_PREFIX = 'bin:'

function binaryRecordKey(projectId: string, path: string): string {
  return `${BINARY_RECORD_PREFIX}${projectId}:${path}`
}

function binaryRecordKeyPrefixForProject(projectId: string): string {
  return `${BINARY_RECORD_PREFIX}${projectId}:`
}

/**
 * Per-project map of path → the exact Uint8Array last persisted to its binary
 * record. Buffer identity doubles as a dirty check: mutating actions always
 * install a fresh Uint8Array, so `tracked.get(path) === file.binaryData` means
 * the record on disk is already current and the payload write can be skipped.
 * Tracked per project (not a global WeakSet) so the same buffer imported into
 * two projects is persisted under both key namespaces.
 */
const persistedBinaryRecords = new Map<string, Map<string, Uint8Array>>()

function trackedBinariesFor(projectId: string): Map<string, Uint8Array> {
  let tracked = persistedBinaryRecords.get(projectId)
  if (!tracked) {
    tracked = new Map()
    persistedBinaryRecords.set(projectId, tracked)
  }
  return tracked
}

/** The stored main-record shape: identical to Project minus binary payloads. */
function stripBinaryPayloads(project: Project): Project {
  if (!project.files.some((file) => file.binaryData)) return project
  return {
    ...project,
    files: project.files.map((file) => (
      file.binaryData
        ? {
            path: file.path,
            content: file.content,
            isBinary: file.isBinary,
            lastModified: file.lastModified,
          }
        : file
    )),
  }
}

/**
 * Persist a project using the split layout: write new/replaced binary payloads
 * first (so the main record never references a missing payload), then the
 * lightweight main record, then best-effort deletion of stale payload records
 * (deleted or renamed binary files). Throws on main-record/payload write
 * failure so callers surface quota errors exactly as before.
 */
async function persistProjectRecord(project: Project): Promise<void> {
  const tracked = trackedBinariesFor(project.id)

  const liveBinaryPaths = new Set<string>()
  for (const file of project.files) {
    if (!file.isBinary) continue
    // Keep paths without in-memory data alive: never delete a record we may
    // simply have failed to stitch or that another flow owns.
    liveBinaryPaths.add(file.path)
    if (!file.binaryData || tracked.get(file.path) === file.binaryData) continue
    await idbSet(binaryRecordKey(project.id, file.path), file.binaryData, projectsStore)
    tracked.set(file.path, file.binaryData)
  }

  await idbSet(project.id, stripBinaryPayloads(project), projectsStore)

  for (const path of [...tracked.keys()]) {
    if (liveBinaryPaths.has(path)) continue
    try {
      await idbDel(binaryRecordKey(project.id, path), projectsStore)
      tracked.delete(path)
    } catch (err) {
      console.warn('Failed to delete stale binary record from IDB:', err)
    }
  }
}

/** Delete every `bin:{projectId}:*` record (delete cascade / rollback). */
async function deleteProjectBinaryRecords(projectId: string): Promise<void> {
  persistedBinaryRecords.delete(projectId)
  const prefix = binaryRecordKeyPrefixForProject(projectId)
  const allKeys = await idbKeys(projectsStore)
  const targets = allKeys.filter(
    (key): key is string => typeof key === 'string' && key.startsWith(prefix),
  )
  await Promise.all(targets.map((key) => idbDel(key, projectsStore)))
}

/**
 * Reattach binary payloads to a loaded main record. Legacy records with inline
 * `binaryData` pass through untouched (and are left untracked, so their next
 * save migrates them to the split layout). Binary files whose payload record is
 * missing or unreadable are dropped with a console.error rather than failing
 * the whole project load.
 */
async function stitchProjectBinaries(stored: Project): Promise<Project> {
  if (!stored.files.some((file) => file.isBinary && !file.binaryData)) return stored

  const tracked = trackedBinariesFor(stored.id)
  const files: ProjectFile[] = []
  for (const file of stored.files) {
    if (!file.isBinary || file.binaryData) {
      files.push(file)
      continue
    }
    try {
      const data = await idbGet<Uint8Array>(binaryRecordKey(stored.id, file.path), projectsStore)
      if (data instanceof Uint8Array) {
        files.push({ ...file, binaryData: data })
        tracked.set(file.path, data)
      } else {
        console.error(
          `Missing binary record for "${file.path}" in project "${stored.id}"; dropping the file.`,
        )
      }
    } catch (err) {
      console.error(
        `Failed to read binary record for "${file.path}" in project "${stored.id}"; dropping the file:`,
        err,
      )
    }
  }
  return { ...stored, files }
}

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
  persistedBinaryRecords.clear()
  homeMetaWriteChain = Promise.resolve()
  clearRecoveryJournal()
}

export interface CreateProjectOptions {
  /** When false, create without selecting / mounting the workspace (bulk import). Default true. */
  select?: boolean
}

export interface CreateProjectResult {
  id: string
  /** False when the project exists in memory but could not be written to IndexedDB. */
  persisted: boolean
  /** The persistence error, when `persisted` is false. */
  persistError?: unknown
}

export interface ProjectSaveError {
  message: string
  quota: boolean
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
  saveError: ProjectSaveError | null
  loadProjects: () => Promise<void>
  createProject: (name: string, scaffold?: ProjectScaffold, options?: CreateProjectOptions) => Promise<CreateProjectResult>
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
      console.error(
        isQuotaExceededError(err)
          ? 'Failed to persist home metadata to IDB (storage full):'
          : 'Failed to persist home metadata to IDB:',
        err,
      )
    }
  })
  return homeMetaWriteChain
}

/** Files eligible to become mainFile / currentFilePath after a delete. */
function isSelectableFallbackFile(file: ProjectFile): boolean {
  return !file.isBinary
    && !file.path.endsWith('.folder')
    && !isHiddenInternalPath(file.path)
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
  saveError: null,

  loadProjects: async () => {
    const projects: Project[] = []
    let homeMeta: HomeMeta | undefined
    persistedBinaryRecords.clear()
    try {
      const allKeys = await idbKeys(projectsStore)
      const projectKeys = allKeys.filter(
        (key): key is string => typeof key === 'string' && !key.startsWith(BINARY_RECORD_PREFIX),
      )
      const loaded = await Promise.all(
        projectKeys.map((key) => idbGet<Project>(key, projectsStore)),
      )
      for (const project of loaded) {
        if (project && Array.isArray(project.files) && typeof project.mainFile === 'string') {
          projects.push(await stitchProjectBinaries(project))
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
        await persistProjectRecord(defaultProject)
      } catch (err) {
        console.error(
          isQuotaExceededError(err)
            ? 'Failed to save default project to IDB (storage full):'
            : 'Failed to save default project to IDB:',
          err,
        )
      }
      projects.push(defaultProject)
    }

    const recoveryJournal = readRecoveryJournalMap()
    if (recoveryJournal.size > 0) {
      const recoveredKeysByProject = new Map<Project, string[]>()
      for (const [key, entry] of recoveryJournal) {
        const project = projects.find((item) => item.id === entry.projectId)
        const file = project?.files.find((item) => (
          item.path === entry.path && !item.isBinary
        ))
        if (!project || !file) {
          // Stale entry: the project or file no longer exists.
          recoveryJournal.delete(key)
          continue
        }
        const recoveredAt = Date.now()
        file.content = entry.content
        file.lastModified = recoveredAt
        project.updatedAt = recoveredAt
        const keys = recoveredKeysByProject.get(project) ?? []
        keys.push(key)
        recoveredKeysByProject.set(project, keys)
      }
      for (const [project, keys] of recoveredKeysByProject) {
        try {
          await persistProjectRecord(project)
          for (const key of keys) recoveryJournal.delete(key)
        } catch (err) {
          console.warn('Failed to persist recovered editor content to IDB:', err)
        }
      }
      persistRecoveryJournal(recoveryJournal)
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
        await persistProjectRecord(project)
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
    let persisted = true
    let persistError: unknown
    try {
      await persistProjectRecord(project)
    } catch (err) {
      persisted = false
      persistError = err
      console.error('Failed to save new project to IDB:', err)
      // Bulk import (select: false) reports persistence failures itself.
      if (select) {
        window.alert(isQuotaExceededError(err)
          ? `Project "${name}" could not be saved — storage is full. It will disappear when this tab is closed.`
          : `Project "${name}" could not be saved to browser storage and may disappear on reload.`)
      }
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
    return persisted ? { id, persisted } : { id, persisted, persistError }
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
    // Cascade: remove the project's split binary payload records too.
    try {
      await deleteProjectBinaryRecords(id)
    } catch (err) {
      console.warn('Failed to delete project binary records from IDB:', err)
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
      const fallbackFile = nextFiles.find(isSelectableFallbackFile)
      let nextMainFile = project.mainFile
      if (nextMainFile === path) {
        nextMainFile = fallbackFile?.path ?? ''
      }

      let nextCurrentPath = s.currentFilePath
      if (nextCurrentPath === path) {
        nextCurrentPath = nextFiles.some((f) => f.path === nextMainFile)
          ? nextMainFile
          : (fallbackFile?.path ?? null)
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
    writeRecoveryJournalEntry({ projectId, path, content })
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
      const fallbackFile = remainingFiles.find(isSelectableFallbackFile)
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

        await persistProjectRecord(latest)

        pruneRecoveryJournalForProject(latest)
        if (get().saveError) {
          set({ saveError: null })
        }

        // Reconcile races that landed during idbSet:
        // - deleted and still gone → remove any resurrected IDB row
        // - deleted then recreated (same id) → write the live snapshot
        if (getProjectEpoch(id) !== epoch) {
          const live = get().projects.find((p) => p.id === id)
          if (!live) {
            try {
              await idbDel(id, projectsStore)
              // A payload record may have been written after deleteProject's
              // cascade scan; sweep the namespace again.
              await deleteProjectBinaryRecords(id)
            } catch (err) {
              console.warn('Failed to roll back resurrected project in IDB:', err)
            }
          } else {
            try {
              await persistProjectRecord(live)
            } catch (err) {
              console.warn('Failed to re-save live project after stale write:', err)
            }
          }
          return
        }

        if (get().currentProjectId === id && get().projects.some((p) => p.id === id)) {
          // Only clear dirty state when the live editor buffer matches what we
          // just persisted — the user may have typed during the await above.
          const editor = useEditorStore.getState()
          const currentPath = get().currentFilePath
          const persistedFile = currentPath
            ? latest.files.find((file) => file.path === currentPath && !file.isBinary)
            : undefined
          if (!persistedFile || !editor.isDirty || editor.source === persistedFile.content) {
            useEditorStore.setState({ isDirty: false, saveStatus: 'saved' })
          } else {
            useEditorStore.setState({ saveStatus: 'unsaved' })
          }
        }
      } catch (err) {
        console.warn('Failed to save project to IDB:', err)
        const quota = isQuotaExceededError(err)
        set({
          saveError: {
            quota,
            message: quota
              ? 'Save failed — browser storage is full. Free up space to keep your changes.'
              : 'Save failed — changes could not be written to browser storage.',
          },
        })
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
