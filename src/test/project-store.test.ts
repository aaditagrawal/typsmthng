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
  const pendingSets: IdbSetCall[] = []

  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => {
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
  __flushPendingSets: () => void
}

const mockIdb = idbKeyval as MockIdb

describe('Project Store', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetProjectPersistStateForTests()
    mockIdb.__clearDelayKeys()
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
    })
  })

  afterEach(() => {
    resetProjectPersistStateForTests()
    mockIdb.__clearDelayKeys()
    mockIdb.__flushPendingSets()
    vi.useRealTimers()
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
    const id = await useProjectStore.getState().createProject('Test Project')

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

    const id = await useProjectStore.getState().createProject('Scaffolded', {
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
    const projectId = await useProjectStore.getState().createProject('Grouped Project')

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
    const projectId = await useProjectStore.getState().createProject('Client Brief')
    const workspaceId = await useProjectStore.getState().createHomeWorkspace('Client Docs', [projectId])

    await useProjectStore.getState().deleteHomeWorkspace(workspaceId)

    const state = useProjectStore.getState()
    expect(state.homeWorkspaces).toHaveLength(0)
    expect(state.projectWorkspaceAssignments[projectId]).toBeUndefined()
    expect(state.selectedHomeWorkspaceId).toBeNull()
  })

  it('should restore the selected home workspace after reload', async () => {
    await useProjectStore.getState().loadProjects()
    const projectId = await useProjectStore.getState().createProject('Persistent Workspace Project')
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
    const projectA = await useProjectStore.getState().createProject('Project A')
    // Ensure distinct project ids when Date.now() is later frozen by fake timers.
    await new Promise((resolve) => setTimeout(resolve, 2))
    const projectB = await useProjectStore.getState().createProject('Project B')

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
    const otherId = await useProjectStore.getState().createProject('Other')
    useProjectStore.getState().selectProject('default')

    await useProjectStore.getState().renameProject(otherId, 'Renamed Other')

    const saved = mockIdb.__store.get(otherId) as { name: string } | undefined
    expect(saved?.name).toBe('Renamed Other')
    expect(useProjectStore.getState().projects.find((p) => p.id === otherId)?.name).toBe('Renamed Other')
  })

  it('does not resurrect a project deleted during an in-flight save', async () => {
    await useProjectStore.getState().loadProjects()
    const id = await useProjectStore.getState().createProject('Doomed')
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
    const id = await useProjectStore.getState().createProject('Temp')
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
    const ids = await Promise.all([
      useProjectStore.getState().createProject('A', undefined, { select: false }),
      useProjectStore.getState().createProject('B', undefined, { select: false }),
      useProjectStore.getState().createProject('C', undefined, { select: false }),
    ])
    expect(new Set(ids).size).toBe(3)
    expect(ids.every((id) => mockIdb.__store.has(id))).toBe(true)
    expect(useProjectStore.getState().hasSelectedProject).toBe(false)
  })

  it('assigns new projects to the selected home workspace', async () => {
    await useProjectStore.getState().loadProjects()
    const workspaceId = await useProjectStore.getState().createHomeWorkspace('Active')
    await useProjectStore.getState().setSelectedHomeWorkspace(workspaceId)

    const projectId = await useProjectStore.getState().createProject('In Workspace')
    expect(useProjectStore.getState().projectWorkspaceAssignments[projectId]).toBe(workspaceId)

    const homeMeta = mockIdb.__store.get('home-meta') as {
      projectWorkspaceAssignments: Record<string, string>
    }
    expect(homeMeta.projectWorkspaceAssignments[projectId]).toBe(workspaceId)
  })

  it('persists editor buffer for the previous project on selectProject', async () => {
    const { useEditorStore } = await import('@/stores/editor-store')
    await useProjectStore.getState().loadProjects()
    const projectA = await useProjectStore.getState().createProject('A')
    const projectB = await useProjectStore.getState().createProject('B')

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

  it('keeps newer content when concurrent saves overlap', async () => {
    await useProjectStore.getState().loadProjects()
    const id = await useProjectStore.getState().createProject('Race')
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
})
