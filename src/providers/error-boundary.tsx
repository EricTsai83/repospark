import { Component, ReactNode } from 'react';

const isDevelopment = import.meta.env.DEV;

type ErrorBoundaryState = {
  errorMessage: string | null;
  isWorkosConfigError: boolean;
};

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { errorMessage: null, isWorkosConfigError: false };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const errorMessage = normalizeErrorMessage(error);
    return {
      errorMessage,
      isWorkosConfigError:
        errorMessage.includes('@workos-inc/authkit-react') && errorMessage.includes('clientId'),
    };
  }

  componentDidCatch(error: unknown, errorInfo: { componentStack: string }) {
    console.error('[ui] render failure', {
      error: normalizeErrorMessage(error),
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.errorMessage !== null) {
      return (
        <div className="container mx-auto flex flex-col gap-4 border border-destructive/40 bg-destructive/10 p-8">
          <h1 className="text-xl font-bold">Something went wrong while rendering the app.</h1>
          {this.state.isWorkosConfigError ? (
            <>
              <p>
                Add the following environment variables to your <code>.env.local</code> file:
              </p>
              <ul className="list-disc pl-4">
                <li>
                  <code>VITE_WORKOS_CLIENT_ID="your-client-id"</code>
                </li>
                <li>
                  <code>VITE_CONVEX_URL="your-convex-url"</code>
                </li>
              </ul>
              <p>
                You can find these values in your WorkOS dashboard at{' '}
                <a
                  className="underline hover:no-underline"
                  href="https://dashboard.workos.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  https://dashboard.workos.com
                </a>
              </p>
            </>
          ) : (
            <p>Reload the page and check your environment configuration if the problem keeps happening.</p>
          )}
          {isDevelopment ? (
            <p className="text-sm font-mono text-muted-foreground">Raw error: {this.state.errorMessage}</p>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}
