import { useEffect, useRef } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * Triggers a lightweight GitHub remote-SHA check for the selected repo.
 *
 * Fires on:
 *  1. `visibilitychange` — user switches back to this browser tab
 *  2. `repositoryId` change — user selects a different repo in the sidebar
 *
 * The action is throttled server-side (skips if checked < 60 s ago) so
 * rapid tab-switching or repo-switching won't spam the GitHub API.
 */
export function useCheckForUpdates(repositoryId: Id<'repositories'> | null) {
  const checkForUpdates = useAction(api.githubCheck.checkForUpdates);
  const repoIdRef = useRef(repositoryId);

  useEffect(() => {
    repoIdRef.current = repositoryId;
  }, [repositoryId]);

  // Fire on repo switch
  useEffect(() => {
    if (!repositoryId) return;
    checkForUpdates({ repositoryId }).catch(() => {
      // Silently ignore — non-critical background check
    });
  }, [repositoryId, checkForUpdates]);

  // Fire on visibility change (tab re-focus)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && repoIdRef.current) {
        checkForUpdates({ repositoryId: repoIdRef.current }).catch(() => {
          // Silently ignore
        });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkForUpdates]);
}
