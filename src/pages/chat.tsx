import { useParams } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { RepositoryShell } from '@/components/repository-shell';
import type { RepositoryId, ThreadId } from '@/lib/types';

/**
 * Workspace entry point. The route layer mounts this component at three URLs:
 *
 *   - `/chat`           → no-selection state; RepositoryShell decides whether to
 *                          redirect to the most recent thread or show the empty
 *                          state with the dual CTA.
 *   - `/t/:threadId`    → open this design thread directly. PRD #19 US 25.
 *   - `/r/:repoId`      → open this repository's overview. PRD #19 US 26.
 *
 * The page itself does not read or validate the params; it just hands them to
 * the shell so that workspace-wide URL ↔ state syncing lives in exactly one
 * place. RepositoryShell is responsible for the navigate-to-most-recent-thread
 * fallback and for surfacing a recoverable empty state when a stale or
 * unauthorised id is hit.
 */
export function ChatPage() {
  const params = useParams<{ threadId?: string; repoId?: string }>();
  const urlThreadId = (params.threadId ?? null) as ThreadId | null;
  const urlRepositoryId = (params.repoId ?? null) as RepositoryId | null;

  return (
    <SidebarProvider>
      <RepositoryShell urlThreadId={urlThreadId} urlRepositoryId={urlRepositoryId} />
    </SidebarProvider>
  );
}
