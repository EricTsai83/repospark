import { useMemo, useState } from 'react';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ChatCircleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import type { Doc } from '../../convex/_generated/dataModel';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { ImportRepoDialog } from '@/components/import-repo-dialog';
import type { RepositoryId, ThreadId } from '@/lib/types';

export function AppSidebar({
  repositories,
  selectedRepositoryId,
  onSelectRepository,
  selectedThreadId,
  onSelectThread,
  threads,
  isCreatingThread,
  onCreateThread,
  onDeleteThread,
  onImported,
  authButton,
}: {
  repositories: Doc<'repositories'>[] | undefined;
  selectedRepositoryId: RepositoryId | null;
  onSelectRepository: (id: RepositoryId) => void;
  selectedThreadId: ThreadId | null;
  onSelectThread: (id: ThreadId) => void;
  threads: Doc<'threads'>[] | null;
  isCreatingThread: boolean;
  onCreateThread: () => void;
  onDeleteThread: (id: ThreadId) => void;
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
              <button
                key={repository._id}
                type="button"
                onClick={() => onSelectRepository(repository._id)}
                className={cn(
                  'flex w-full items-center gap-2 border px-3 py-2 text-left transition-colors',
                  selectedRepositoryId === repository._id
                    ? 'border-primary bg-muted'
                    : 'border-transparent hover:border-border hover:bg-muted',
                )}
              >
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
              </button>
            ))
          )}
        </div>

        {threads !== null ? (
          <>
            <div className="border-t border-border" />
            <div className="flex flex-col gap-1 p-3">
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
              {threads.length > 0 ? (
                threads.map((thread) => (
                  <div
                    key={thread._id}
                    className={cn(
                      'group flex w-full items-center border transition-colors',
                      selectedThreadId === thread._id
                        ? 'border-primary bg-muted text-foreground'
                        : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectThread(thread._id)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                    >
                      <ChatCircleIcon
                        size={14}
                        weight={selectedThreadId === thread._id ? 'fill' : 'regular'}
                        className="shrink-0"
                      />
                      <span className="truncate text-xs font-medium">{thread.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteThread(thread._id);
                      }}
                      className="mr-1.5 hidden shrink-0 p-1 text-muted-foreground hover:text-destructive group-hover:block"
                      aria-label="Delete thread"
                      title="Delete thread"
                    >
                      <TrashIcon size={13} weight="bold" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-1 text-xs text-muted-foreground">No threads yet.</p>
              )}
            </div>
          </>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <ModeToggle />
        <div className="ml-auto">{authButton}</div>
      </SidebarFooter>
    </Sidebar>
  );
}
