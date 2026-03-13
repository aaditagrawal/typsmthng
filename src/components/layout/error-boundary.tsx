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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          background: 'var(--bg-app)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            border: '2px solid var(--accent)',
            borderRadius: '2px',
            background: 'var(--bg-surface)',
            padding: '24px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              color: 'var(--accent)',
              marginBottom: '12px',
            }}
          >
            ERROR
          </div>

          <div
            style={{
              fontSize: '13px',
              lineHeight: '1.5',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
            }}
          >
            {message}
          </div>

          {this.state.error && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                marginBottom: '20px',
              }}
            >
              {this.state.error.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase' as const,
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              RELOAD
            </button>

            <button
              onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase' as const,
                padding: '8px 16px',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              {this.state.showDetails ? 'HIDE DETAILS' : 'DETAILS'}
            </button>
          </div>

          {this.state.showDetails && this.state.error?.stack && (
            <pre
              style={{
                fontSize: '11px',
                lineHeight: '1.6',
                color: 'var(--text-tertiary)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '2px',
                padding: '12px',
                overflow: 'auto',
                maxHeight: '200px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {this.state.error.stack}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
