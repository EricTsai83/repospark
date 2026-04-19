import { useAction } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';

type ConnectionState = 'idle' | 'loading' | 'success' | 'error';

export function OnboardingConnectGitHub() {
  const initiateGitHubInstall = useAction(api.githubAppNode.initiateGitHubInstall);
  const [state, setState] = useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('github_connected') === 'true') {
      setState('success');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);
    try {
      const url = await initiateGitHubInstall({});
      window.location.href = url;
    } catch (error) {
      console.error('[onboarding] Failed to start GitHub install:', error);
      setErrorMessage('Failed to start GitHub connection. Please try again.');
      setState('error');
    }
  }, [initiateGitHubInstall]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
      <Logo size={64} hero />
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome! Connect your GitHub
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect your GitHub account to start importing and analyzing repositories.
        </p>

        {state === 'idle' || state === 'loading' || state === 'error' ? (
          <>
            <Button
              onClick={() => void handleConnect()}
              disabled={state === 'loading'}
              className="w-full"
            >
              {state === 'loading' ? 'Redirecting to GitHub...' : 'Connect GitHub'}
            </Button>
            <p className="text-xs text-muted-foreground">
              You'll be able to select which repositories to grant access to.
            </p>
          </>
        ) : null}

        {state === 'success' && (
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            GitHub connected successfully! You can now import your repositories.
          </p>
        )}

        {errorMessage && (
          <p className="text-xs text-destructive">{errorMessage}</p>
        )}
      </div>
    </div>
  );
}
