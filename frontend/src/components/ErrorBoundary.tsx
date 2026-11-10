import { Component, type ReactNode } from "react";
import { Button } from "./ui";

/** Keeps one broken screen from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md py-16 text-center" role="alert">
        <h1 className="font-display text-2xl font-bold">Something went wrong on this screen</h1>
        <p className="mt-2 text-sm text-muted">Your data is safe. Reload to try again. If it keeps happening, tell Guestlog support what you were doing.</p>
        <Button className="mt-6" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
