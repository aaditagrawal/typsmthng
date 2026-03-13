import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SAMPLE_DOCUMENT } from '@/lib/sample-document'

// Mock idb-keyval before importing project store
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    createStore: () => 'mock-store',
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => { store.set(key, val) }),
    del: vi.fn(async (key: string) => { store.delete(key) }),
    keys: vi.fn(async () => Array.from(store.keys())),
    __store: store,
  }
})

import { useProjectStore } from '@/stores/project-store'
import * as idbKeyval from 'idb-keyval'

describe('Project Store', () => {
  beforeEach(() => {
    // Clear the mock idb store
    const mockStore = (idbKeyval as unknown as { __store: Map<string, unknown> }).__store
    mockStore.clear()

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

  it('should migrate old projects with empty content to SAMPLE_DOCUMENT', async () => {
    // Simulate an old project saved to IDB with empty content
    const mockStore = (idbKeyval as unknown as { __store: Map<string, unknown> }).__store
    mockStore.set('default', {
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
    useProjectStore.getState().selectProject('default')
    const project = useProjectStore.getState().getCurrentProject()
    const mainFile = project?.files.find((f) => f.path === '/main.typ')

    // Content should have been migrated to SAMPLE_DOCUMENT
    expect(mainFile?.content).toBe(SAMPLE_DOCUMENT)
  })

  it('should NOT overwrite existing non-empty content during migration', async () => {
    const mockStore = (idbKeyval as unknown as { __store: Map<string, unknown> }).__store
    mockStore.set('default', {
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
})
