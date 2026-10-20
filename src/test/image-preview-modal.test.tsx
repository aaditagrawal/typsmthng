import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ImagePreviewModal } from '@/components/preview/image-preview-modal'
import { useProjectStore, type ProjectFile } from '@/stores/project-store'
import { useUIStore } from '@/stores/ui-store'

const binary: ProjectFile = { path: '/image.png', content: '', isBinary: true, binaryData: new Uint8Array([1, 2]), lastModified: 1 }
const svg: ProjectFile = { path: '/image.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>', isBinary: false, lastModified: 1 }

function setFiles(files: ProjectFile[]) {
  useProjectStore.setState({
    currentProjectId: 'images',
    projects: [{ id: 'images', name: 'Images', files, mainFile: '/main.typ', createdAt: 1, updatedAt: 1 }],
  })
}

describe('image preview URL lifecycle', () => {
  let nextUrl = 0
  const createObjectURL = vi.fn(() => `blob:preview-${++nextUrl}`)
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    nextUrl = 0
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    setFiles([binary, svg])
    useUIStore.setState({ imagePreviewPath: binary.path })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('releases every object URL when replacing an image and closing under Strict Mode', () => {
    const { unmount } = render(<StrictMode><ImagePreviewModal /></StrictMode>)
    const firstUrl = screen.getByRole('img').getAttribute('src')
    expect(firstUrl).toMatch(/^blob:preview-/)
    act(() => setFiles([{ ...binary, binaryData: new Uint8Array([3]) }, svg]))
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)
    expect(screen.getByRole('img').getAttribute('src')).not.toBe(firstUrl)
    act(() => useUIStore.setState({ imagePreviewPath: null }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()
    expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual(createObjectURL.mock.results.map(({ value }) => value).sort())
  })

  it('switches from a binary image to SVG without displaying its revoked blob URL', () => {
    const { unmount } = render(<ImagePreviewModal />)
    const previousUrl = screen.getByRole('img').getAttribute('src')
    act(() => useUIStore.setState({ imagePreviewPath: svg.path }))
    expect(revokeObjectURL).toHaveBeenCalledWith(previousUrl)
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml;base64,/))
    unmount()
  })
})
