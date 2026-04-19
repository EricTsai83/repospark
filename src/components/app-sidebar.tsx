import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ChatCircleIcon,
  TrashIcon,
  GlobeIcon,
  LockIcon,
} from '@phosphor-icons/react';
import type { Doc } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import { Logo } from '@/components/logo';
import { ImportRepoDialog } from '@/components/import-repo-dialog';
import { GitHubReposDialog } from '@/components/github-repos-dialog';
import { useAsyncCallback } from '@/hooks/use-async-callback';
import { useGitHubConnection } from '@/hooks/use-github-connection';
import type { RepositoryId, ThreadId, ChatMode } from '@/lib/types';

export function AppSidebar({
  repositories,
  selectedRepositoryId,
  onSelectRepository,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
  chatMode,
  defaultThreadId,
  onImported,
  authButton,
}: {
  repositories: Doc<'repositories'>[] | undefined;
  selectedRepositoryId: RepositoryId | null;
  onSelectRepository: (id: RepositoryId) => void;
  selectedThreadId: ThreadId | null;
  onSelectThread: (id: ThreadId) => void;
  onDeleteThread: (id: ThreadId) => void;
  chatMode: ChatMode;
  defaultThreadId?: ThreadId;
  onImported: (repoId: RepositoryId, threadId: ThreadId | null) => void;
  authButton: React.ReactNode;
}) {
  const [repoSearch, setRepoSearch] = useState('');

  const filteredRepos = useMemo(() => {
    if (!repositories) return [];
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((r) => r.sourceRepoFullName.toLowerCase().includes(q));
  }, [repoSearch, repositories]);

  return (
    <Sidebar>
      <SidebarHeader>
        <Logo size={30} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">Architect Agent</div>
          <div className="truncate text-[11px] text-muted-foreground">Grounded codebase answers</div>
        </div>
      </SidebarHeader>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-1 items-center gap-2 border border-border bg-card px-2.5 py-1.5">
          <MagnifyingGlassIcon size={14} className="shrink-0 text-muted-foreground" weight="bold" />
          <input
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ImportRepoDialog onImported={onImported} />
      </div>

      <SidebarContent>
        <div className="flex flex-col gap-1 p-3" aria-live="polite">
          {repositories === undefined ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
          ) : filteredRepos.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs">
              <p className="font-semibold">No repositories</p>
              <p className="mt-1 text-muted-foreground">Import a public GitHub repo to get started.</p>
            </div>
          ) : (
            filteredRepos.map((repository) => (
              <SidebarMenuButton
                key={repository._id}
                selected={selectedRepositoryId === repository._id}
                onClick={() => onSelectRepository(repository._id)}
              >
                {repository.visibility === 'private' ? (
                  <LockIcon size={13} className="shrink-0 text-muted-foreground" weight="bold" title="Private (authorized)" />
                ) : (
                  <GlobeIcon size={13} className="shrink-0 text-muted-foreground" weight="bold" title="Public" />
                )}
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{repository.sourceRepoFullName}</p>
                {/* Orange dot when remote has new commits */}
                {repository.latestRemoteSha &&
                  repository.lastSyncedCommitSha &&
                  repository.latestRemoteSha !== repository.lastSyncedCommitSha && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-orange-500"
                      title="New commits available"
                    />
                  )}
              </SidebarMenuButton>
            ))
          )}
        </div>

        {selectedRepositoryId !== null && (
          <ThreadsSection
            repositoryId={selectedRepositoryId}
            selectedThreadId={selectedThreadId}
            onSelectThread={onSelectThread}
            onDeleteThread={onDeleteThread}
            chatMode={chatMode}
            defaultThreadId={defaultThreadId}
          />
        )}
      </SidebarContent>

      <SidebarFooter>
        <GitHubStatusSection />
        <ModeToggle />
        <div className="ml-auto flex items-center gap-2">
          {authButton}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

// ---------------------------------------------------------------------------
// ThreadsSection – owns its own Convex subscription + create-thread mutation.
// When the user switches repos, only ThreadsList re-renders; ThreadsHeader
// is completely unaffected because it has zero data dependencies.
// ---------------------------------------------------------------------------

function ThreadsSection({
  repositoryId,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
  chatMode,
  defaultThreadId,
}: {
  repositoryId: RepositoryId;
  selectedThreadId: ThreadId | null;
  onSelectThread: (id: ThreadId) => void;
  onDeleteThread: (id: ThreadId) => void;
  chatMode: ChatMode;
  defaultThreadId?: ThreadId;
}) {
  const threads = useQuery(api.chat.listThreads, { repositoryId });
  const createThreadMutation = useMutation(api.chat.createThread);

  const [isCreatingThread, handleCreateThread] = useAsyncCallback(
    useCallback(async () => {
      const threadId = await createThreadMutation({ repositoryId, mode: chatMode });
      onSelectThread(threadId);
    }, [repositoryId, chatMode, createThreadMutation, onSelectThread]),
  );

  useEffect(() => {
    if (!threads?.length) {
      onSelectThread(null);
      return;
    }
    const preferred = defaultThreadId ?? threads[0]?._id;
    if (!selectedThreadId || !threads.some((t) => t._id === selectedThreadId)) {
      onSelectThread(preferred ?? null);
    }
  }, [threads, defaultThreadId, selectedThreadId, onSelectThread]);

  return (
    <>
      <div className="border-t border-border" />
      <div className="flex flex-col gap-1 p-3">
        <ThreadsHeader isCreatingThread={isCreatingThread} onCreateThread={handleCreateThread} />
        {threads === undefined ? (
          <p className="px-1 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ThreadsList
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelectThread={onSelectThread}
            onDeleteThread={onDeleteThread}
          />
        )}
      </div>
    </>
  );
}

/**
 * Static header – "Threads" label + "new thread" button.
 *
 * ThreadsSection does NOT unmount on repo switch (the parent condition is
 * `selectedRepositoryId !== null` which stays true), so `handleCreateThread`
 * changes identity in-place when the user picks a different repo. We rely on
 * React's default shallow-equality memo so the button always closes over the
 * current repositoryId / chatMode.
 */
const ThreadsHeader = memo(function ThreadsHeader({
  isCreatingThread,
  onCreateThread,
}: {
  isCreatingThread: boolean;
  onCreateThread: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 pb-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Threads</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        disabled={isCreatingThread}
        onClick={onCreateThread}
        aria-label="New thread"
        title="New thread"
      >
        <PlusIcon weight="bold" size={14} />
      </Button>
    </div>
  );
});

/**
 * Memoised thread list – re-renders when threads data or selection changes,
 * but independently of the header above.
 */
const ThreadsList = memo(function ThreadsList({
  threads,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
}: {
  threads: Doc<'threads'>[];
  selectedThreadId: ThreadId | null;
  onSelectThread: (id: ThreadId) => void;
  onDeleteThread: (id: ThreadId) => void;
}) {
  if (threads.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">No threads yet.</p>;
  }
  return (
    <>
      {threads.map((thread) => (
        <div key={thread._id} className="group relative">
          <SidebarMenuButton
            selected={selectedThreadId === thread._id}
            onClick={() => onSelectThread(thread._id)}
            className="py-1.5 pr-8"
          >
            <ChatCircleIcon
              size={14}
              weight={selectedThreadId === thread._id ? 'fill' : 'regular'}
              className="shrink-0"
            />
            <span className="truncate text-xs font-medium">{thread.title}</span>
          </SidebarMenuButton>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-destructive group-hover:flex"
            onClick={() => onDeleteThread(thread._id)}
            aria-label="Delete thread"
            title="Delete thread"
          >
            <TrashIcon size={13} weight="bold" />
          </Button>
        </div>
      ))}
    </>
  );
});

function GitHubStatusSection() {
  const { isConnected, accountLogin, installationId, repositorySelection, isLoading } = useGitHubConnection();

  if (isLoading) {
    return null;
  }

  if (!isConnected) {
    return (
      <p className="text-center text-[11px] text-muted-foreground">
        GitHub not connected
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-[11px] text-muted-foreground">
        GitHub connected as <span className="font-medium text-foreground">{accountLogin}</span>
        {repositorySelection === 'selected' && (
          <span className="block text-[10px]">(selected repos only)</span>
        )}
      </p>
      {installationId && (
        <GitHubReposDialog installationId={installationId} repositorySelection={repositorySelection} />
      )}
    </div>
  );
}
