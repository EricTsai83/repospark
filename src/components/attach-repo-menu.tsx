import { useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import {
  CaretDownIcon,
  CircleNotchIcon,
  GitBranchIcon,
  GlobeIcon,
  LinkBreakIcon,
  LinkIcon,
  LockIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Doc } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toUserErrorMessage } from '@/lib/errors';
import type { AttachedRepositorySummary } from '@/hooks/use-thread-capabilities';
import type { RepositoryId, ThreadId } from '@/lib/types';

/**
 * In-thread affordance to attach, swap, or detach the repository bound to
 * the current thread. PRD #19 user stories 2 and 3:
 *
 *   - Attach a repository to an existing design thread to move from abstract
 *     discussion to grounded analysis without losing context.
 *   - Detach or swap the attached repository so the same thread can compare
 *     designs across codebases.
 *
 * The trigger is a single button whose copy reflects the current state — this
 * keeps the affordance scannable without claiming sidebar real-estate. When a
 * repo is attached, the button shows that repo's full name + a caret; the
 * dropdown lists the other repos as swap targets plus a destructive-styled
 * Detach action. When no repo is attached, the button reads "Attach
 * repository" and the dropdown lists every repo the user owns.
 */
export function AttachRepoMenu({
  threadId,
  attachedRepository,
  availableRepositories,
}: {
  threadId: ThreadId;
  attachedRepository: AttachedRepositorySummary | null;
  availableRepositories: ReadonlyArray<Doc<'repositories'>>;
}) {
  const setThreadRepository = useMutation(api.chat.setThreadRepository);
  const latestRequestRef = useRef(0);
  const [pendingRequest, setPendingRequest] = useState<{
    threadId: ThreadId;
    requestId: number;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    threadId: ThreadId;
    message: string;
  } | null>(null);
  const isPending = pendingRequest?.threadId === threadId;
  const error = errorState?.threadId === threadId ? errorState.message : null;

  const handleSelect = async (repoId: RepositoryId | null) => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setErrorState(null);
    setPendingRequest({ threadId, requestId });
    try {
      await setThreadRepository({ threadId, repositoryId: repoId });
    } catch (err) {
      if (latestRequestRef.current !== requestId) {
        return;
      }
      setErrorState({
        threadId,
        message: toUserErrorMessage(err, 'Failed to update repository.'),
      });
    } finally {
      if (latestRequestRef.current !== requestId) {
        return;
      }
      setPendingRequest((current) =>
        current?.requestId === requestId ? null : current,
      );
    }
  };

  const swapTargets = attachedRepository
    ? availableRepositories.filter((repo) => repo._id !== attachedRepository.id)
    : availableRepositories;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={attachedRepository ? 'ghost' : 'outline'}
            size="sm"
            disabled={isPending}
            className="gap-1.5 text-xs"
            aria-label={attachedRepository ? 'Change attached repository' : 'Attach a repository'}
          >
            {attachedRepository ? (
              <>
                <GitBranchIcon size={12} weight="bold" />
                <span className="max-w-[200px] truncate font-medium">
                  {attachedRepository.fullName}
                </span>
              </>
            ) : (
              <>
                <LinkIcon size={12} weight="bold" />
                <span className="font-medium">Attach repository</span>
              </>
            )}
            {isPending ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground" aria-live="polite">
                <CircleNotchIcon size={11} className="animate-spin" />
                <span>Updating…</span>
              </span>
            ) : null}
            <CaretDownIcon size={10} weight="bold" className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">
            {attachedRepository ? 'Swap repository' : 'Attach a repository'}
          </DropdownMenuLabel>
          {swapTargets.length === 0 ? (
            // Empty-state copy is intentionally different from the sidebar's
            // "no repositories" — here the user has *some* repos but none
            // they could *swap to*, or none at all. Both collapse to the
            // same UX (open the import dialog from the sidebar) so we don't
            // duplicate that flow inside this menu.
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {attachedRepository
                ? 'No other repositories to swap to. Import one from the sidebar.'
                : 'You have no repositories yet. Import one from the sidebar.'}
            </div>
          ) : (
            swapTargets.map((repo) => (
              <DropdownMenuItem
                key={repo._id}
                disabled={isPending}
                onSelect={() => {
                  void handleSelect(repo._id);
                }}
                className="flex items-center gap-2 text-xs"
              >
                {repo.visibility === 'private' ? (
                  <LockIcon size={12} weight="bold" className="shrink-0 text-muted-foreground" />
                ) : (
                  <GlobeIcon size={12} weight="bold" className="shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{repo.sourceRepoFullName}</span>
              </DropdownMenuItem>
            ))
          )}
          {attachedRepository ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isPending}
                onSelect={() => {
                  void handleSelect(null);
                }}
                className="flex items-center gap-2 text-xs text-destructive focus:text-destructive"
              >
                <LinkBreakIcon size={12} weight="bold" />
                Detach repository
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span role="alert" className="inline-flex items-center gap-1 text-xs text-destructive">
          <span>{error}</span>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-destructive/80 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() =>
              setErrorState((current) =>
                current?.threadId === threadId ? null : current,
              )
            }
            aria-label="Dismiss repository update error"
          >
            <XIcon size={10} weight="bold" />
          </button>
        </span>
      ) : null}
    </div>
  );
}
