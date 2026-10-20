import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '@/components/sidebar/file-tree'
import { useProjectStore, type Project } from '@/stores/project-store'
import * as projectIo from '@/lib/project-io'

function makeProject(): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    files: [
      { path: '/main.typ', content: 'hello', isBinary: false, lastModified: 1 },
    ],
    mainFile: '/main.typ',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('FileTree', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    useProjectStore.setState({
      projects: [makeProject()],
      currentProjectId: 'p1',
      currentFilePath: '/main.typ',
      hasSelectedProject: true,
    })
  })

  it('labels the search input for assistive tech', () => {
    render(<FileTree />)
    expect(screen.getByLabelText('Search files')).toBeInTheDocument()
  })

  it('rejects invalid names in the inline new-file input and cancels on blur', () => {
    const createFile = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ createFile })
    render(<FileTree />)

    fireEvent.click(screen.getByTitle('New file or folder'))
    fireEvent.click(screen.getByText('NEW FILE'))

    const input = screen.getByPlaceholderText('file name')
    fireEvent.change(input, { target: { value: 'a/b.typ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(window.alert).toHaveBeenCalledWith('Name cannot contain /, \\, or null characters.')
    expect(createFile).not.toHaveBeenCalled()

    // Blur with an invalid name cancels instead of submitting.
    fireEvent.blur(input)
    expect(createFile).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('file name')).not.toBeInTheDocument()
  })

  it('creates a file from the inline input when the name is valid', async () => {
    const createFile = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ createFile })
    render(<FileTree />)

    fireEvent.click(screen.getByTitle('New file or folder'))
    fireEvent.click(screen.getByText('NEW FILE'))

    const input = screen.getByPlaceholderText('file name')
    fireEvent.change(input, { target: { value: 'notes.typ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(createFile).toHaveBeenCalledWith('/notes.typ'))
  })

  it('does not overwrite an existing file from the new-file input', () => {
    const createFile = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ createFile })
    render(<FileTree />)
    fireEvent.click(screen.getByTitle('New file or folder'))
    fireEvent.click(screen.getByText('NEW FILE'))
    const input = screen.getByPlaceholderText('file name')
    fireEvent.change(input, { target: { value: 'main.typ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(createFile).not.toHaveBeenCalled()
    expect(window.alert).toHaveBeenCalledWith('A file or folder with that name already exists.')
    expect(useProjectStore.getState().getCurrentProject()?.files[0].content).toBe('hello')
  })

  it('does not overwrite a file created while an upload is being converted', async () => {
    let finish: (result: projectIo.BuiltProjectFiles) => void = () => { throw new Error('Upload was not started') }
    vi.spyOn(projectIo, 'prepareUploadedFiles').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const createFilesBatch = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ createFilesBatch })
    const { container } = render(<FileTree />)
    const input = container.querySelector('input[type=file]:not([webkitdirectory])')!
    fireEvent.change(input, { target: { files: [new File(['source'], 'chapter.tex')] } })
    await waitFor(() => expect(projectIo.prepareUploadedFiles).toHaveBeenCalled())
    const project = makeProject()
    project.files.push({ path: '/chapter.typ', content: 'Created during conversion', isBinary: false, lastModified: 2 })
    useProjectStore.setState({ projects: [project] })
    finish({ projectFiles: [{ path: '/chapter.typ', content: 'Converted', isBinary: false, lastModified: 3 }], texFilesConverted: 1, warnings: [], metadata: { packages: [] }, mainFile: '/chapter.typ' })
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('destination file was created')))
    expect(createFilesBatch).not.toHaveBeenCalled()
  })

  it('places the detected document first when uploading into an empty project', async () => {
    const project = { ...makeProject(), files: [], mainFile: '' }
    const createFilesBatch = vi.fn().mockResolvedValue(undefined)
    useProjectStore.setState({ projects: [project], createFilesBatch })
    vi.spyOn(projectIo, 'prepareUploadedFiles').mockResolvedValue({
      projectFiles: [
        { path: '/chapters/intro.typ', content: 'Intro', isBinary: false, lastModified: 1 },
        { path: '/main.typ', content: '#include "chapters/intro.typ"', isBinary: false, lastModified: 1 },
      ], texFilesConverted: 2, warnings: [], metadata: { packages: [] }, mainFile: '/main.typ',
    })
    const { container } = render(<FileTree />)
    fireEvent.change(container.querySelector('input[type=file]:not([webkitdirectory])')!, { target: { files: [new File(['source'], 'main.tex')] } })
    await waitFor(() => expect(createFilesBatch).toHaveBeenCalled())
    expect(createFilesBatch.mock.calls[0][0][0].path).toBe('/main.typ')
  })
})
