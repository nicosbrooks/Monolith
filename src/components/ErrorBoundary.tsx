import { Component, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

/**
 * Keeps one broken screen from taking the app with it. Whatever failed is replaced by a short message with Try again
 * (re-render that part) and Reload; the rest of the app keeps working, and nothing saved is touched (saving happens in
 * the store, outside React). `area` names the part in the message and in the copied details.
 */
export class ErrorBoundary extends Component<{ area: string; children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.area}]`, error)
  }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    // Moving to another doc or screen gives the new one a fresh start.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const details = `${this.props.area}: ${error.message}\n${error.stack ?? ''}`.slice(0, 4000)
    return (
      <div className="crash blank" role="alert">
        <b>This part of {this.props.area} stopped working</b>
        <p>Your work is saved. Try again, or reload Monolith.</p>
        <div className="crash-actions">
          <button className="btn primary" onClick={() => this.setState({ error: null })}><RotateCcw size={14} /> Try again</button>
          <button className="btn" onClick={() => location.reload()}>Reload</button>
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(details)}>Copy details</button>
        </div>
      </div>
    )
  }
}
