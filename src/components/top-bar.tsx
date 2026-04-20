import {
  DotsThreeVerticalIcon,
  SparkleIcon,
  TrashIcon,
  ArrowsClockwiseIcon,
  GitBranchIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { RepoInfoPopover } from '@/components/repo-info-popover';
import { RepoStatusIndicator } from '@/components/repo-status-indicator';

export type TopBarRepoDetail = {
  repository: {
    sourceRepoFullName: string;
    importStatus: string;
    defaultBranch?: string | null;
    detectedLanguages: string[];
    lastImportedAt?: number;
    lastSyncedCommitSha?: string;
  };
  sandbox: { status: string; ttlExpiresAt: number; autoArchiveIntervalMinutes: number } | null;
  deepModeAvailable: boolean;
  hasRemoteUpdates: boolean;
  fileCount: number;
  fileCountLabel: string;
};

export function TopBar({
  repoDetail,
  repoName,
  isSyncing,
  onSync,
  onDeleteRepo,
  onRunAnalysis,
}: {
  repoDetail?: TopBarRepoDetail;
  /** Immediate repo name from the already-loaded repository list so the title
   *  never flashes "Repository" while `repoDetail` is still loading. */
  repoName?: string;
  isSyncing: boolean;
  onSync: () => void;
  onDeleteRepo: () => void;
  onRunAnalysis: () => void;
}) {
  const title = repoDetail?.repository.sourceRepoFullName ?? repoName;

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-4">
      <SidebarTrigger />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {title ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 animate-in fade-in duration-300">
            {repoDetail ? (
              <RepoInfoPopover repoDetail={repoDetail} title={title} />
            ) : (
              <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight md:text-base">
                {title}
              </h1>
            )}
            {repoDetail?.repository.defaultBranch ? (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex animate-in fade-in duration-300">
                <GitBranchIcon size={13} weight="bold" className="shrink-0" />
                <span className="max-w-[120px] truncate">{repoDetail.repository.defaultBranch}</span>
              </span>
            ) : null}
            {repoDetail ? (
              <div className="animate-in fade-in duration-300">
                <RepoStatusIndicator
                  importStatus={repoDetail.repository.importStatus}
                  sandbox={repoDetail.sandbox}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <SyncButton
          repoDetail={repoDetail}
          isSyncing={isSyncing}
          onSync={onSync}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={!repoDetail}
              aria-label="Repository actions"
              className="text-muted-foreground hover:text-foreground"
            >
              <DotsThreeVerticalIcon weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onRunAnalysis()}>
              <SparkleIcon weight="bold" />
              Run deep analysis
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                onDeleteRepo();
              }}
            >
              <TrashIcon weight="bold" />
              Delete repository
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Unified sync button that combines the action with a live-updating
 * "Synced X ago" label, so there is one compact control instead of two.
 */
function SyncButton({
  repoDetail,
  isSyncing,
  onSync,
}: {
  repoDetail?: TopBarRepoDetail;
  isSyncing: boolean;
  onSync: () => void;
}) {
  const syncedLabel = useRelativeTime(repoDetail?.repository.lastImportedAt);
  const repositoryImportStatus = repoDetail?.repository.importStatus;
  const isRepositorySyncing =
    repositoryImportStatus === 'queued' || repositoryImportStatus === 'running';
  const isBusy = isSyncing || isRepositorySyncing;
  const hasUpdates = repoDetail?.hasRemoteUpdates && !isBusy;

  // Derive the text shown inside the button
  let label: string | null = null;
  if (isBusy) {
    label = 'Syncing…';
  } else if (hasUpdates) {
    label = 'Update available';
  } else if (syncedLabel) {
    label = `Synced ${syncedLabel}`;
  } else if (repoDetail) {
    label = 'Sync';
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!repoDetail || isBusy}
      onClick={onSync}
      className={
        hasUpdates
          ? 'relative min-w-[8.75rem] justify-start gap-1.5 text-xs text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300'
          : 'min-w-[8.75rem] justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground'
      }
      title={
        hasUpdates
          ? 'New commits available on remote — click to sync'
          : repoDetail?.repository.lastImportedAt
            ? new Date(repoDetail.repository.lastImportedAt).toLocaleString()
            : undefined
      }
    >
      {hasUpdates && (
        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
        </span>
      )}
      {label ? (
        <span className="inline-flex items-center gap-1.5 animate-in fade-in duration-300">
          <ArrowsClockwiseIcon weight="bold" className={isBusy ? 'animate-spin' : ''} />
          {label}
        </span>
      ) : null}
    </Button>
  );
}
