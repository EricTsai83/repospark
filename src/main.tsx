import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithAuthKit } from '@/providers/convex-provider-with-auth-kit';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from '@/providers/error-boundary';
import { ThemeProvider } from '@/providers/theme-provider';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <BrowserRouter>
          <AuthKitProvider
            clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
            redirectUri={import.meta.env.VITE_WORKOS_REDIRECT_URI}
          >
            <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
              <App />
            </ConvexProviderWithAuthKit>
          </AuthKitProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
