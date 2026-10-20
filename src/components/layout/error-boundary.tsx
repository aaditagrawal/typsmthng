import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallbackMessage?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  showDetails: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, showDetails: false }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const message = this.props.fallbackMessage ?? 'Something went wrong'

    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-(--bg-app) font-mono text-(--text-primary) p-6">
        <div className="max-w-120 w-full border-2 border-(color:--accent) rounded-xs bg-(--bg-surface) p-6">
          <div className="fs-11 font-bold tracking-widest uppercase text-(--accent) mb-3">
            ERROR
          </div>

          <div className="fs-13 leading-(--lh) text-(--text-secondary) mb-2" style={{ '--lh': '1.5' }}>
            {message}
          </div>

          {this.state.error && (
            <div className="fs-12 text-(--text-tertiary) mb-5">
              {this.state.error.message}
            </div>
          )}

          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => this.setState({ hasError: false, error: null, showDetails: false })}
              className="font-mono fs-11 font-bold tracking-widest uppercase py-2 px-4 bg-(--accent) text-(--accent-text) border-none rounded-xs cursor-pointer"
            >
              TRY AGAIN
            </button>

            <button
              onClick={() => window.location.reload()}
              className="font-mono fs-11 font-bold tracking-widest uppercase py-2 px-4 bg-transparent text-(--text-secondary) border border-(color:--border-default) rounded-xs cursor-pointer"
            >
              RELOAD
            </button>

            <button
              onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
              className="font-mono fs-11 font-bold tracking-widest uppercase py-2 px-4 bg-transparent text-(--text-secondary) border border-(color:--border-default) rounded-xs cursor-pointer"
            >
              {this.state.showDetails ? 'HIDE DETAILS' : 'DETAILS'}
            </button>
          </div>

          {this.state.showDetails && this.state.error?.stack && (
            <pre
              className="fs-11 leading-(--lh) text-(--text-tertiary) bg-(--bg-inset) border border-(color:--border-subtle) rounded-xs p-3 overflow-auto max-h-50 whitespace-pre-wrap break-all"
              style={{ '--lh': '1.6' }}
            >
              {this.state.error.stack}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
