import { Routes, Route, Navigate } from 'react-router-dom';
import { useConvexAuth } from 'convex/react';
import { HomePage } from '@/pages/home';
import { ChatPage } from '@/pages/chat';
import { AppNotice } from '@/components/app-notice';
import { ScreenState } from '@/components/screen-state';
import { useConvexAuthStatus } from '@/providers/convex-provider-with-auth-kit';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { authError } = useConvexAuthStatus();

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      {authError ? (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-border px-4 py-3">
          <AppNotice
            title="Authentication error"
            message={authError}
            tone="error"
            actionLabel="Refresh"
            onAction={() => window.location.reload()}
          />
        </div>
      ) : null}
      <Routes>
        <Route
          path="/"
          element={
            isLoading ? <AuthLoadingScreen /> : isAuthenticated ? <Navigate to="/chat" replace /> : <HomePage />
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </div>
  );
}

function AuthLoadingScreen() {
  return (
    <ScreenState title="Authenticating…" description="Reconnecting your session and loading your workspace." />
  );
}
