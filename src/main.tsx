import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithAuthKit } from '@/providers/convex-provider-with-auth-kit';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from '@/providers/error-boundary';
import { ThemeProvider } from '@/providers/theme-provider';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const workosRedirectUri = new URL('/callback', window.location.origin).toString();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <AuthKitProvider
          clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
          redirectUri={workosRedirectUri}
        >
          <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
            <App />
          </ConvexProviderWithAuthKit>
        </AuthKitProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
