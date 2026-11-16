import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  title?: string
  actionLabel?: string
  onReset?: () => void
}
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Keep render failures contained; never dump user or session data to logs.
  }

  render() {
    if (this.state.error) {
      return <section className="app-error-card" role="alert">
        <span className="app-error-icon"><AlertTriangle size={18} /></span>
        <div className="app-error-copy">
          <span className="mono-label">VIEW ERROR</span>
          <h2>{this.props.title ?? 'This page could not be displayed'}</h2>
          <p>{this.state.error.message || 'An unexpected rendering error occurred.'}</p>
          <button type="button" className="small-button" onClick={() => {
            this.setState({ error: null })
            this.props.onReset?.()
          }}><RefreshCw size={14} /> {this.props.actionLabel ?? 'Try again'}</button>
        </div>
      </section>
    }
    return this.props.children
  }
}
