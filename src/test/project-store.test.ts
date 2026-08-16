import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SAMPLE_DOCUMENT } from '@/lib/sample-document'

type IdbSetCall = {
  key: string
  val: unknown
  resolve: () => void
  reject: (err: unknown) => void
}

// Mock idb-keyval before importing project store
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  const delayedKeys = new Set<string>()
  const failedKeyPrefixes = new Map<string, unknown>()
  const pendingSets: IdbSetCall[] = []

  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => {
      for (const [prefix, error] of failedKeyPrefixes) {
        if (key.startsWith(prefix)) throw error
      }
      if (!delayedKeys.has(key)) {
        store.set(key, val)
        return
      }
      await new Promise<void>((resolve, reject) => {
        pendingSets.push({
          key,
          val,
          resolve: () => {
            store.set(key, val)
            resolve()
          },
          reject,
        })
      })
    }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    keys: vi.fn(async () => Array.from(store.keys())),
    __store: store,
    __pendingSets: pendingSets,
    __delayKeys: (...keys: string[]) => {
      delayedKeys.clear()
      for (const key of keys) delayedKeys.add(key)
    },
    __clearDelayKeys: () => { delayedKeys.clear() },
    __failKeyPrefix: (prefix: string, error: unknown) => { failedKeyPrefixes.set(prefix, error) },
    __clearFailures: () => { failedKeyPrefixes.clear() },
    __flushPendingSets: () => {
      const queued = pendingSets.splice(0, pendingSets.length)
      for (const call of queued) call.resolve()
    },
  }
})

import { useProjectStore, resetProjectPersistStateForTests } from '@/stores/project-store'
import * as idbKeyval from 'idb-keyval'

type MockIdb = typeof idbKeyval & {
  __store: Map<string, unknown>
  __pendingSets: IdbSetCall[]
  __delayKeys: (...keys: string[]) => void
  __clearDelayKeys: () => void
  __failKeyPrefix: (prefix: string, error: unknown) => void
  __clearFailures: () => void
  __flushPendingSets: () => void
}

const mockIdb = idbKeyval as MockIdb

describe('Project Store', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetProjectPersistStateForTests()
    mockIdb.__clearDelayKeys()
    mockIdb.__clearFailures()
    mockIdb.__flushPendingSets()

    // Clear the mock idb store
    mockIdb.__store.clear()

    // Reset zustand store state between tests
    useProjectStore.setState({
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
    })
  })

  afterEach(() => {
    resetProjectPersistStateForTests()
    mockIdb.__clearDelayKeys()
    mockIdb.__clearFailures()
    mockIdb.__flushPendingSets()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should load projects and create default if empty', async () => {
    await useProjectStore.getState().loadProjects()
    const state = useProjectStore.getState()

    expect(state.loading).toBe(false)
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0].id).toBe('default')
    expect(state.projects[0].name).toBe('My Document')
    expect(state.currentProjectId).toBeNull()
    expect(state.currentFilePath).toBeNull()
    expect(state.hasSelectedProject).toBe(false)
  })

  it('default project should contain SAMPLE_DOCUMENT', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    const project = useProjectStore.getState().getCurrentProject()

    expect(project).toBeDefined()
    const mainFile = project!.files.find((f) => f.path === '/main.typ')
    expect(mainFile).toBeDefined()
    expect(mainFile!.content).toBe(SAMPLE_DOCUMENT)
  })

  it('should create a new project', async () => {
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Test Project')

    const state = useProjectStore.getState()
    expect(state.projects).toHaveLength(2)
    expect(state.currentProjectId).toBe(id)
    expect(state.currentFilePath).toBe('/main.typ')

    const project = state.projects.find((p) => p.id === id)
    expect(project?.name).toBe('Test Project')
    expect(project?.files).toHaveLength(1)
  })

  it('should create a project from scaffold data', async () => {
    await useProjectStore.getState().loadProjects()

    const { id } = await useProjectStore.getState().createProject('Scaffolded', {
      mainFile: '/paper.typ',
      templateMeta: {
        source: 'typst-universe',
        resolvedSpec: '@preview/aero-check:0.1.1',
        templateEntrypoint: 'paper.typ',
        layoutLocked: true,
        createdAt: 123,
      },
      files: [
        { path: '/paper.typ', content: '= Paper\\n', isBinary: false },
        { path: '/refs.bib', content: '@book{x, title={X}}', isBinary: false },
      ],
    })

    const project = useProjectStore.getState().projects.find((p) => p.id === id)
    expect(project).toBeDefined()
    expect(project?.mainFile).toBe('/paper.typ')
    expect(project?.templateMeta?.layoutLocked).toBe(true)
    expect(project?.files.map((f) => f.path).sort()).toEqual(['/paper.typ', '/refs.bib'])
    expect(useProjectStore.getState().currentFilePath).toBe('/paper.typ')
  })

  it('should select a file', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectFile('/other.typ')
    expect(useProjectStore.getState().currentFilePath).toBe('/other.typ')
  })

  it('should create a file in current project', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/helpers.typ', '// helpers')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files).toHaveLength(2)
    expect(project?.files.find((f) => f.path === '/helpers.typ')?.content).toBe('// helpers')
    expect(useProjectStore.getState().currentFilePath).toBe('/helpers.typ')
  })

  it('should create files in batch and select the last created file', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFilesBatch([
      { path: '/a.typ', content: '= A' },
      { path: '/b.typ', content: '= B' },
    ])

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files.find((f) => f.path === '/a.typ')?.content).toBe('= A')
    expect(project?.files.find((f) => f.path === '/b.typ')?.content).toBe('= B')
    expect(useProjectStore.getState().currentFilePath).toBe('/b.typ')
  })

  it('should add binary files in batch', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().addBinaryFilesBatch([
      { path: '/img/a.png', data: new Uint8Array([1, 2]) },
      { path: '/img/b.png', data: new Uint8Array([3, 4, 5]) },
    ])

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files.find((f) => f.path === '/img/a.png')?.isBinary).toBe(true)
    expect(project?.files.find((f) => f.path === '/img/b.png')?.binaryData?.length).toBe(3)
  })

  it('should update file content', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    useProjectStore.getState().updateFileContent('/main.typ', 'new content')

    const project = useProjectStore.getState().getCurrentProject()
    const mainFile = project?.files.find((f) => f.path === '/main.typ')
    expect(mainFile?.content).toBe('new content')
  })

  it('recovers editor content journaled before a debounced IDB save', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    useProjectStore.getState().updateFileContent('/main.typ', '= Recovered immediately')

    await useProjectStore.getState().loadProjects()

    const recovered = useProjectStore.getState().projects
      .find((project) => project.id === 'default')
      ?.files.find((file) => file.path === '/main.typ')
    expect(recovered?.content).toBe('= Recovered immediately')
    expect(localStorage.getItem('typsmthng-recovery-journal')).toBeNull()
    const persisted = mockIdb.__store.get('default') as { files: Array<{ path: string; content: string }> }
    expect(persisted.files.find((file) => file.path === '/main.typ')?.content)
      .toBe('= Recovered immediately')
  })

  it('discards a recovery journal that no longer points to a live project file', async () => {
    localStorage.setItem('typsmthng-recovery-journal', JSON.stringify({
      projectId: 'deleted-project',
      path: '/main.typ',
      content: '= stale',
    }))

    await useProjectStore.getState().loadProjects()

    expect(useProjectStore.getState().projects[0].files[0].content).toBe(SAMPLE_DOCUMENT)
    expect(localStorage.getItem('typsmthng-recovery-journal')).toBeNull()
  })

  it('should delete a file', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/temp.typ', 'temp')
    expect(useProjectStore.getState().getCurrentProject()?.files).toHaveLength(2)

    await useProjectStore.getState().deleteFile('/temp.typ')
    expect(useProjectStore.getState().getCurrentProject()?.files).toHaveLength(1)
  })

  it('should rename a file', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    useProjectStore.getState().selectFile('/main.typ')
    await useProjectStore.getState().renameFile('/main.typ', '/document.typ')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files[0].path).toBe('/document.typ')
    expect(useProjectStore.getState().currentFilePath).toBe('/document.typ')
  })

  it('rejects renaming a file over an existing file without mutation', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/existing.typ', '= keep me')
    const before = useProjectStore.getState().getCurrentProject()

    await expect(
      useProjectStore.getState().renameFile('/main.typ', '/existing.typ'),
    ).rejects.toThrow('already exists')

    const after = useProjectStore.getState().getCurrentProject()
    expect(after).toEqual(before)
    expect(after?.files.find((f) => f.path === '/main.typ')?.content).toBe(SAMPLE_DOCUMENT)
    expect(after?.files.find((f) => f.path === '/existing.typ')?.content).toBe('= keep me')
  })

  it('rejects renaming a folder when a descendant target exists without mutation', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/source/note.typ', '= source')
    await useProjectStore.getState().createFile('/destination/note.typ', '= destination')
    const before = useProjectStore.getState().getCurrentProject()

    await expect(
      useProjectStore.getState().renameFolder('/source', '/destination'),
    ).rejects.toThrow('already exists')

    const after = useProjectStore.getState().getCurrentProject()
    expect(after).toEqual(before)
    expect(after?.files.find((f) => f.path === '/source/note.typ')?.content).toBe('= source')
    expect(after?.files.find((f) => f.path === '/destination/note.typ')?.content).toBe('= destination')
  })

  it('should toggle sidebar', () => {
    expect(useProjectStore.getState().sidebarOpen).toBe(false)
    useProjectStore.getState().setSidebarOpen(true)
    expect(useProjectStore.getState().sidebarOpen).toBe(true)
  })

  it('getCurrentProject should return current project', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.id).toBe('default')
    expect(project?.name).toBe('My Document')
  })

  it('should migrate old default projects with empty content to SAMPLE_DOCUMENT', async () => {
    // Simulate an old project saved to IDB with empty content
    mockIdb.__store.set('default', {
      id: 'default',
      name: 'My Document',
      files: [{
        path: '/main.typ',
        content: '', // Old empty content
        isBinary: false,
        lastModified: 1000,
      }],
      mainFile: '/main.typ',
      createdAt: 1000,
      updatedAt: 1000,
    })

    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().loading).toBe(false)

    // Migration must hit IDB before first paint completes (loading cleared).
    const persisted = mockIdb.__store.get('default') as {
      files: Array<{ path: string; content: string }>
    }
    expect(persisted.files.find((f) => f.path === '/main.typ')?.content).toBe(SAMPLE_DOCUMENT)

    useProjectStore.getState().selectProject('default')
    const project = useProjectStore.getState().getCurrentProject()
    const mainFile = project?.files.find((f) => f.path === '/main.typ')

    // Content should have been migrated to SAMPLE_DOCUMENT
    expect(mainFile?.content).toBe(SAMPLE_DOCUMENT)
  })

  it('does not migrate intentional empty mains on non-default projects', async () => {
    mockIdb.__store.set('project-user', {
      id: 'project-user',
      name: 'Blank',
      files: [{
        path: '/main.typ',
        content: '',
        isBinary: false,
        lastModified: 1000,
      }],
      mainFile: '/main.typ',
      createdAt: 1000,
      updatedAt: 1000,
    })

    await useProjectStore.getState().loadProjects()
    const project = useProjectStore.getState().projects.find((p) => p.id === 'project-user')
    expect(project?.files.find((f) => f.path === '/main.typ')?.content).toBe('')
  })

  it('should NOT overwrite existing non-empty content during migration', async () => {
    mockIdb.__store.set('default', {
      id: 'default',
      name: 'My Document',
      files: [{
        path: '/main.typ',
        content: '= My Custom Content',
        isBinary: false,
        lastModified: 1000,
      }],
      mainFile: '/main.typ',
      createdAt: 1000,
      updatedAt: 1000,
    })

    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    const project = useProjectStore.getState().getCurrentProject()
    const mainFile = project?.files.find((f) => f.path === '/main.typ')

    // Content should be preserved
    expect(mainFile?.content).toBe('= My Custom Content')
  })

  it('should create and persist home workspaces with assignments', async () => {
    await useProjectStore.getState().loadProjects()
    const { id: projectId } = await useProjectStore.getState().createProject('Grouped Project')

    const workspaceId = await useProjectStore.getState().createHomeWorkspace('Requirements', [projectId])

    const state = useProjectStore.getState()
    expect(state.homeWorkspaces).toEqual([
      expect.objectContaining({ id: workspaceId, name: 'Requirements' }),
    ])
    expect(state.projectWorkspaceAssignments[projectId]).toBe(workspaceId)
    expect(state.selectedHomeWorkspaceId).toBe(workspaceId)
  })

  it('should clear assignments when a workspace is deleted', async () => {
    await useProjectStore.getState().loadProjects()
    const { id: projectId } = await useProjectStore.getState().createProject('Client Brief')
    const workspaceId = await useProjectStore.getState().createHomeWorkspace('Client Docs', [projectId])

    await useProjectStore.getState().deleteHomeWorkspace(workspaceId)

    const state = useProjectStore.getState()
    expect(state.homeWorkspaces).toHaveLength(0)
    expect(state.projectWorkspaceAssignments[projectId]).toBeUndefined()
    expect(state.selectedHomeWorkspaceId).toBeNull()
  })

  it('should restore the selected home workspace after reload', async () => {
    await useProjectStore.getState().loadProjects()
    const { id: projectId } = await useProjectStore.getState().createProject('Persistent Workspace Project')
    const workspaceId = await useProjectStore.getState().createHomeWorkspace('Persistent Workspace', [projectId])

    await useProjectStore.getState().setSelectedHomeWorkspace(workspaceId)

    useProjectStore.setState({
      projects: [],
      homeWorkspaces: [],
      projectWorkspaceAssignments: {},
      selectedHomeWorkspaceId: null,
      currentProjectId: null,
      currentFilePath: null,
      sidebarOpen: false,
      loading: true,
      hasSelectedProject: false,
    })

    await useProjectStore.getState().loadProjects()

    const state = useProjectStore.getState()
    expect(state.homeWorkspaces).toEqual([
      expect.objectContaining({ id: workspaceId, name: 'Persistent Workspace' }),
    ])
    expect(state.projectWorkspaceAssignments[projectId]).toBe(workspaceId)
    expect(state.selectedHomeWorkspaceId).toBe(workspaceId)
  })

  it('flushes pending autosave for the previous project when switching projects', async () => {
    await useProjectStore.getState().loadProjects()
    const { id: projectA } = await useProjectStore.getState().createProject('Project A')
    // Ensure distinct project ids when Date.now() is later frozen by fake timers.
    await new Promise((resolve) => setTimeout(resolve, 2))
    const { id: projectB } = await useProjectStore.getState().createProject('Project B')

    vi.useFakeTimers()
    useProjectStore.getState().selectProject(projectA)
    useProjectStore.getState().updateFileContent('/main.typ', '= edits for A')

    // Switch before the 2s debounce fires — previously this caused saveCurrentProject
    // to persist B (or nothing useful) and drop A's pending write.
    useProjectStore.getState().selectProject(projectB)
    await Promise.resolve()
    await Promise.resolve()

    const savedA = mockIdb.__store.get(projectA) as { files: Array<{ content: string }> } | undefined
    expect(savedA?.files.find((f) => f.content === '= edits for A')).toBeTruthy()

    // Advancing timers must not overwrite A with B's content.
    await vi.advanceTimersByTimeAsync(2500)
    const savedAAfter = mockIdb.__store.get(projectA) as { files: Array<{ content: string }> } | undefined
    expect(savedAAfter?.files.some((f) => f.content === '= edits for A')).toBe(true)
  })

  it('persists rename for a non-current project', async () => {
    await useProjectStore.getState().loadProjects()
    const { id: otherId } = await useProjectStore.getState().createProject('Other')
    useProjectStore.getState().selectProject('default')

    await useProjectStore.getState().renameProject(otherId, 'Renamed Other')

    const saved = mockIdb.__store.get(otherId) as { name: string } | undefined
    expect(saved?.name).toBe('Renamed Other')
    expect(useProjectStore.getState().projects.find((p) => p.id === otherId)?.name).toBe('Renamed Other')
  })

  it('does not resurrect a project deleted during an in-flight save', async () => {
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Doomed')
    useProjectStore.getState().selectProject(id)

    mockIdb.__delayKeys(id)
    const savePromise = useProjectStore.getState().saveProject(id)

    // Poll until the delayed idbSet is queued (microtask timing varies).
    for (let i = 0; i < 20 && !mockIdb.__pendingSets.some((call) => call.key === id); i++) {
      await Promise.resolve()
    }
    expect(mockIdb.__pendingSets.some((call) => call.key === id)).toBe(true)

    await useProjectStore.getState().deleteProject(id)
    expect(mockIdb.__store.has(id)).toBe(false)

    mockIdb.__flushPendingSets()
    mockIdb.__clearDelayKeys()
    await savePromise

    expect(mockIdb.__store.has(id)).toBe(false)
    expect(useProjectStore.getState().projects.find((p) => p.id === id)).toBeUndefined()
  }, 5_000)

  it('autosave after delete does not write the deleted project back', async () => {
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Temp')
    useProjectStore.getState().selectProject(id)

    vi.useFakeTimers()
    useProjectStore.getState().updateFileContent('/main.typ', '= pending')

    // deleteProject is real-async (IDB); run it with real timers.
    vi.useRealTimers()
    await useProjectStore.getState().deleteProject(id)

    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(2500)
    await Promise.resolve()

    expect(mockIdb.__store.has(id)).toBe(false)
  })

  it('creates unique project ids under rapid create calls', async () => {
    await useProjectStore.getState().loadProjects()
    const results = await Promise.all([
      useProjectStore.getState().createProject('A', undefined, { select: false }),
      useProjectStore.getState().createProject('B', undefined, { select: false }),
      useProjectStore.getState().createProject('C', undefined, { select: false }),
    ])
    expect(new Set(results.map((result) => result.id)).size).toBe(3)
    expect(results.every((result) => result.persisted && mockIdb.__store.has(result.id))).toBe(true)
    expect(useProjectStore.getState().hasSelectedProject).toBe(false)
  })

  it('assigns new projects to the selected home workspace', async () => {
    await useProjectStore.getState().loadProjects()
    const workspaceId = await useProjectStore.getState().createHomeWorkspace('Active')
    await useProjectStore.getState().setSelectedHomeWorkspace(workspaceId)

    const { id: projectId } = await useProjectStore.getState().createProject('In Workspace')
    expect(useProjectStore.getState().projectWorkspaceAssignments[projectId]).toBe(workspaceId)

    const homeMeta = mockIdb.__store.get('home-meta') as {
      projectWorkspaceAssignments: Record<string, string>
    }
    expect(homeMeta.projectWorkspaceAssignments[projectId]).toBe(workspaceId)
  })

  it('persists editor buffer for the previous project on selectProject', async () => {
    const { useEditorStore } = await import('@/stores/editor-store')
    await useProjectStore.getState().loadProjects()
    const { id: projectA } = await useProjectStore.getState().createProject('A')
    const { id: projectB } = await useProjectStore.getState().createProject('B')

    useProjectStore.getState().selectProject(projectA)
    useEditorStore.setState({ source: '= live A buffer', isDirty: true, saveStatus: 'unsaved' })

    useProjectStore.getState().selectProject(projectB)
    await Promise.resolve()
    await Promise.resolve()

    const savedA = mockIdb.__store.get(projectA) as { files: Array<{ content: string }> }
    expect(savedA.files.some((f) => f.content === '= live A buffer')).toBe(true)
  })

  it('retargets currentFilePath when the main file is deleted', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/other.typ', '= other')
    useProjectStore.getState().selectFile('/main.typ')

    await useProjectStore.getState().deleteFile('/main.typ')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.mainFile).toBe('/other.typ')
    expect(useProjectStore.getState().currentFilePath).toBe('/other.typ')
  })

  it('retargets mainFile and currentFilePath when their folder is deleted', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().renameFile('/main.typ', '/removed/main.typ')
    await useProjectStore.getState().createFile('/remaining.typ', '= remaining')
    useProjectStore.getState().selectFile('/removed/main.typ')

    await useProjectStore.getState().deleteFolder('/removed')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files.map((f) => f.path)).toEqual(['/remaining.typ'])
    expect(project?.mainFile).toBe('/remaining.typ')
    expect(useProjectStore.getState().currentFilePath).toBe('/remaining.typ')
  })

  it('clears file pointers when deleting the only populated folder', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().renameFile('/main.typ', '/only/main.typ')

    await useProjectStore.getState().deleteFolder('/only')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files).toEqual([])
    expect(project?.mainFile).toBe('')
    expect(useProjectStore.getState().currentFilePath).toBeNull()
  })

  it('does not select an empty-folder placeholder after deleting the main folder', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().renameFile('/main.typ', '/removed/main.typ')
    await useProjectStore.getState().createFolder('/empty')

    await useProjectStore.getState().deleteFolder('/removed')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.files.map((file) => file.path)).toEqual(['/empty/.folder'])
    expect(project?.mainFile).toBe('')
    expect(useProjectStore.getState().currentFilePath).toBeNull()
  })

  it('rejects renaming a folder into its own descendant', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/notes/item.typ', '= note')
    const before = useProjectStore.getState().getCurrentProject()

    await expect(
      useProjectStore.getState().renameFolder('/notes', '/notes/archive'),
    ).rejects.toThrow('descendants')
    expect(useProjectStore.getState().getCurrentProject()).toEqual(before)
  })

  it('keeps newer content when concurrent saves overlap', async () => {
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Race')
    useProjectStore.getState().selectProject(id)

    mockIdb.__delayKeys(id)
    useProjectStore.getState().updateFileContent('/main.typ', '= first')
    const firstSave = useProjectStore.getState().saveProject(id)

    for (let i = 0; i < 20 && mockIdb.__pendingSets.length === 0; i++) {
      await Promise.resolve()
    }

    useProjectStore.getState().updateFileContent('/main.typ', '= second')
    const secondSave = useProjectStore.getState().saveProject(id)

    mockIdb.__flushPendingSets()
    mockIdb.__clearDelayKeys()
    await Promise.all([firstSave, secondSave])

    const saved = mockIdb.__store.get(id) as { files: Array<{ path: string; content: string }> }
    expect(saved.files.find((f) => f.path === '/main.typ')?.content).toBe('= second')
  })

  it('reports and alerts when a new project cannot be persisted', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await useProjectStore.getState().loadProjects()

    mockIdb.__failKeyPrefix('project-', new DOMException('quota exceeded', 'QuotaExceededError'))
    const result = await useProjectStore.getState().createProject('Doomed Save')

    expect(result.persisted).toBe(false)
    expect(result.persistError).toBeInstanceOf(DOMException)
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('storage is full'))
    // The project stays usable in memory for the session.
    expect(useProjectStore.getState().projects.some((p) => p.id === result.id)).toBe(true)
    expect(mockIdb.__store.has(result.id)).toBe(false)
  })

  it('does not alert on persistence failure for bulk (select: false) creates', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await useProjectStore.getState().loadProjects()

    mockIdb.__failKeyPrefix('project-', new DOMException('quota exceeded', 'QuotaExceededError'))
    const result = await useProjectStore.getState().createProject('Bulk', undefined, { select: false })

    expect(result.persisted).toBe(false)
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('journals edits to multiple files within one debounce window and recovers both', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFile('/second.typ', '= second')
    await useProjectStore.getState().saveCurrentProject()

    // Both edits land inside the 2s autosave debounce; neither reaches IDB.
    useProjectStore.getState().updateFileContent('/main.typ', '= edit A')
    useProjectStore.getState().updateFileContent('/second.typ', '= edit B')

    await useProjectStore.getState().loadProjects()

    const recovered = useProjectStore.getState().projects.find((p) => p.id === 'default')
    expect(recovered?.files.find((f) => f.path === '/main.typ')?.content).toBe('= edit A')
    expect(recovered?.files.find((f) => f.path === '/second.typ')?.content).toBe('= edit B')
    expect(localStorage.getItem('typsmthng-recovery-journal')).toBeNull()
  })

  it('recovers a legacy single-object recovery journal', async () => {
    localStorage.setItem('typsmthng-recovery-journal', JSON.stringify({
      projectId: 'default',
      path: '/main.typ',
      content: '= legacy journal',
    }))

    await useProjectStore.getState().loadProjects()

    const recovered = useProjectStore.getState().projects.find((p) => p.id === 'default')
    expect(recovered?.files.find((f) => f.path === '/main.typ')?.content).toBe('= legacy journal')
    expect(localStorage.getItem('typsmthng-recovery-journal')).toBeNull()
  })

  it('skips journaling oversized file contents', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')

    useProjectStore.getState().updateFileContent('/main.typ', 'x'.repeat(2 * 1024 * 1024 + 1))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('journal size limit'))
    expect(localStorage.getItem('typsmthng-recovery-journal')).toBeNull()
  })

  it('does not promote placeholders or hidden files when deleting the main file', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFolder('/empty')
    await useProjectStore.getState().createFile('/.typsmthng/meta.json', '{}')
    await useProjectStore.getState().createFile('/real.typ', '= real')
    useProjectStore.getState().selectFile('/main.typ')

    await useProjectStore.getState().deleteFile('/main.typ')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.mainFile).toBe('/real.typ')
    expect(useProjectStore.getState().currentFilePath).toBe('/real.typ')
  })

  it('clears file pointers when deleting the main file leaves only placeholders', async () => {
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')
    await useProjectStore.getState().createFolder('/empty')
    useProjectStore.getState().selectFile('/main.typ')

    await useProjectStore.getState().deleteFile('/main.typ')

    const project = useProjectStore.getState().getCurrentProject()
    expect(project?.mainFile).toBe('')
    expect(useProjectStore.getState().currentFilePath).toBeNull()
  })

  it('serves a fresh file index when two mutations land in the same millisecond', async () => {
    const { getProjectFileIndex } = await import('@/lib/file-index')
    await useProjectStore.getState().loadProjects()
    useProjectStore.getState().selectProject('default')

    // Freeze Date.now so both mutations share one updatedAt millisecond.
    vi.useFakeTimers()
    await useProjectStore.getState().createFilesBatch([{ path: '/notes.typ', content: '= notes' }])
    const first = getProjectFileIndex(useProjectStore.getState().getCurrentProject())
    expect(first.searchablePaths).toContain('/notes.typ')

    await useProjectStore.getState().addBinaryFilesBatch([{ path: '/img.png', data: new Uint8Array([1]) }])
    const second = getProjectFileIndex(useProjectStore.getState().getCurrentProject())
    expect(second.searchablePaths).toContain('/img.png')
  })

  it('does not clear dirty state when the user types during an in-flight save', async () => {
    const { useEditorStore } = await import('@/stores/editor-store')
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Typing Race')
    useProjectStore.getState().selectProject(id)

    useProjectStore.getState().updateFileContent('/main.typ', '= v1')
    useEditorStore.setState({ source: '= v1', isDirty: true, saveStatus: 'unsaved' })

    mockIdb.__delayKeys(id)
    const savePromise = useProjectStore.getState().saveProject(id)
    for (let i = 0; i < 20 && !mockIdb.__pendingSets.some((call) => call.key === id); i++) {
      await Promise.resolve()
    }

    useEditorStore.getState().setSource('= v2 typed during save')

    mockIdb.__flushPendingSets()
    mockIdb.__clearDelayKeys()
    await savePromise

    expect(useEditorStore.getState().isDirty).toBe(true)
    expect(useEditorStore.getState().saveStatus).toBe('unsaved')
    useEditorStore.setState({ source: '', isDirty: false, saveStatus: 'saved' })
  })

  it('clears dirty state after save when the editor buffer matches the persisted content', async () => {
    const { useEditorStore } = await import('@/stores/editor-store')
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Clean Save')
    useProjectStore.getState().selectProject(id)

    useProjectStore.getState().updateFileContent('/main.typ', '= stable')
    useEditorStore.setState({ source: '= stable', isDirty: true, saveStatus: 'unsaved' })

    await useProjectStore.getState().saveProject(id)

    expect(useEditorStore.getState().isDirty).toBe(false)
    expect(useEditorStore.getState().saveStatus).toBe('saved')
  })

  it('records a quota save error on failure and clears it on the next successful save', async () => {
    const { useEditorStore } = await import('@/stores/editor-store')
    await useProjectStore.getState().loadProjects()
    const { id } = await useProjectStore.getState().createProject('Save Errors')
    useProjectStore.getState().selectProject(id)
    useEditorStore.setState({ source: '', isDirty: false, saveStatus: 'saved' })

    mockIdb.__failKeyPrefix(id, new DOMException('quota exceeded', 'QuotaExceededError'))
    await useProjectStore.getState().saveProject(id)

    const saveError = useProjectStore.getState().saveError
    expect(saveError?.quota).toBe(true)
    expect(saveError?.message).toContain('storage is full')
    expect(useEditorStore.getState().saveStatus).toBe('unsaved')

    mockIdb.__clearFailures()
    await useProjectStore.getState().saveProject(id)
    expect(useProjectStore.getState().saveError).toBeNull()
  })
})
