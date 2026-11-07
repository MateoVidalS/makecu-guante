import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps one broken page from blanking the whole app (header, safety banner and status chips stay up).
 * Pass `resetKey` (e.g. the pathname) so navigating away clears the error.
 */
export class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null; key?: string }
> {
  state: { error: Error | null; key?: string } = {
    error: null,
    key: this.props.resetKey,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: { error: Error | null; key?: string },
  ) {
    return props.resetKey !== state.key
      ? { error: null, key: props.resetKey }
      : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="page-error" role="alert">
        <h1>Something went wrong on this page</h1>
        <p>
          The STOP button on the glove still works. Reload the page, or go back
          home.
        </p>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          <a className="button" href="/">
            Go home
          </a>
        </div>
        <details>
          <summary>Technical details</summary>
          <pre>{error.message}</pre>
        </details>
      </section>
    );
  }
}
