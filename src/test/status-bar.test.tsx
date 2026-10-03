import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBar } from '@/components/layout/status-bar'
import { useCompileStore } from '@/stores/compile-store'

describe('StatusBar page count', () => {
  it('shows the compiled page count from page dimensions', () => {
    useCompileStore.setState({
      pageDimensions: [
        { width: 612, height: 792 },
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ],
      status: 'success',
      compilerReady: true,
      compileTime: 0,
      errorCount: 0,
      warningCount: 0,
    })
    render(<StatusBar />)
    expect(screen.getByText('3 Pages')).toBeInTheDocument()
  })

  it('uses the singular label for one page and hides a count of zero', () => {
    useCompileStore.setState({
      pageDimensions: [{ width: 612, height: 792 }],
      status: 'success',
      compilerReady: true,
      compileTime: 0,
      errorCount: 0,
      warningCount: 0,
    })
    const view = render(<StatusBar />)
    expect(screen.getByText('1 Page')).toBeInTheDocument()

    useCompileStore.setState({ pageDimensions: [] })
    view.rerender(<StatusBar />)
    expect(screen.queryByText(/page/i)).not.toBeInTheDocument()
  })
})
