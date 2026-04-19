import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useConvexAuth } from 'convex/react';
import { HomePage } from '@/pages/home';
import { ChatPage } from '@/pages/chat';
import { AUTH_TOKEN_ERROR_EVENT } from '@/lib/auth-events';

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
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    function handleAuthError(event: Event) {
      setAuthError((event as CustomEvent<string>).detail);
    }

    window.addEventListener(AUTH_TOKEN_ERROR_EVENT, handleAuthError);
    return () => {
      window.removeEventListener(AUTH_TOKEN_ERROR_EVENT, handleAuthError);
    };
  }, []);

  const visibleAuthError = isAuthenticated ? null : authError;

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      {visibleAuthError ? (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {visibleAuthError}
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
    <div className="flex h-full w-full items-center justify-center px-6 text-sm text-muted-foreground">
      Authenticating…
    </div>
  );
}
