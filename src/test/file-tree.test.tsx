import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '@/components/sidebar/file-tree'
import { useProjectStore, type Project } from '@/stores/project-store'

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
})
