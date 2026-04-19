import { Routes, Route, Navigate } from 'react-router-dom';
import { useConvexAuth } from 'convex/react';
import { HomePage } from '@/pages/home';
import { ChatPage } from '@/pages/chat';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Routes>
        <Route
          path="/"
          element={
            !isLoading && isAuthenticated ? <Navigate to="/chat" replace /> : <HomePage />
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
