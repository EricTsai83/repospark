import { useCallback, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import {
  GithubLogoIcon,
  LockIcon,
  GlobeIcon,
  ArrowSquareOutIcon,
  ArrowClockwiseIcon,
  InfoIcon,
  ShieldCheckIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  CircleNotchIcon,
  MinusCircleIcon,
} from '@phosphor-icons/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type RepoInfo = {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  updatedAt: string;
};

function ImportStatusBadge({
  status,
}: {
  status:
    | { importStatus: string; lastImportedAt: number | undefined; hasRemoteUpdates: boolean }
    | undefined;
}) {
  if (!status) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <MinusCircleIcon size={12} weight="bold" />
        Not imported
      </span>
    );
  }

  if (status.importStatus === 'queued' || status.importStatus === 'running') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <CircleNotchIcon size={12} weight="bold" className="animate-spin" />
        Importing...
      </span>
    );
  }

  if (status.importStatus === 'failed') {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Failed
      </Badge>
    );
  }

  if (status.hasRemoteUpdates) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-500">
        <WarningCircleIcon size={12} weight="fill" />
        Updates available
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[10px] text-emerald-500">
      <CheckCircleIcon size={12} weight="fill" />
      Imported
    </span>
  );
}

export function GitHubReposDialog({
  installationId,
  repositorySelection,
  trigger,
}: {
  installationId: number;
  repositorySelection?: string | null;
  trigger?: React.ReactNode;
}) {
  const listRepos = useAction(api.githubAppNode.listInstallationRepos);
  const importedSummaries = useQuery(api.repositories.getImportedRepoSummaries);
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const fetchRepos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listRepos({});
      setRepos(result.repos);
      setTotalCount(result.totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories');
    } finally {
      setIsLoading(false);
    }
  }, [listRepos]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        void fetchRepos();
      }
    },
    [fetchRepos],
  );

  const isSelectedMode = repositorySelection === 'selected';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground">
            <ShieldCheckIcon size={14} weight="bold" className="mr-1" />
            Manage authorized repos
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GithubLogoIcon size={20} weight="fill" />
            Your authorized repositories
          </DialogTitle>
          <DialogDescription>
            {isSelectedMode
              ? 'You have authorized specific repositories. Only these repos (plus any public repos) can be accessed by this app.'
              : 'All repositories in your account are authorized for this app.'}
          </DialogDescription>
        </DialogHeader>

        {/* Access model explanation */}
        <div className="rounded-md border border-border/50 bg-muted/50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <InfoIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" weight="fill" />
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>
                <strong className="text-foreground">How access works:</strong>
              </p>
              <ul className="ml-3 list-disc space-y-0.5">
                <li>
                  <span className="font-medium text-foreground">Authorized repos</span> &mdash;
                  repos you explicitly selected when installing the GitHub App. Includes both public and private repos.
                </li>
                <li>
                  <span className="font-medium text-foreground">Public repos</span> &mdash;
                  any public repo on GitHub can also be imported by URL or search, even if it is not in your authorized list.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="min-h-[200px]">
          {isLoading && !repos ? (
            <div className="flex h-[200px] items-center justify-center">
              <p className="text-sm text-muted-foreground">Loading repositories...</p>
            </div>
          ) : error ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="ghost" size="sm" onClick={() => void fetchRepos()}>
                Retry
              </Button>
            </div>
          ) : repos && repos.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">No repositories are currently authorized.</p>
              <p className="text-xs text-muted-foreground">
                Click &ldquo;Update on GitHub&rdquo; below to grant access to your repositories.
              </p>
            </div>
          ) : repos ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {totalCount} authorized {totalCount === 1 ? 'repository' : 'repositories'}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => void fetchRepos()}
                  disabled={isLoading}
                  title="Refresh list"
                >
                  <ArrowClockwiseIcon size={14} weight="bold" className={isLoading ? 'animate-spin' : ''} />
                </Button>
              </div>
              <ScrollArea className="h-[240px]">
                <div className="flex flex-col gap-1 pr-3">
                  {repos.map((repo) => (
                    <a
                      key={repo.fullName}
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted"
                    >
                      {repo.isPrivate ? (
                        <LockIcon size={14} className="shrink-0 text-muted-foreground" weight="bold" />
                      ) : (
                        <GlobeIcon size={14} className="shrink-0 text-muted-foreground" weight="bold" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{repo.fullName}</span>
                          <Badge variant="muted" className="shrink-0 text-[10px]">
                            {repo.isPrivate ? 'private' : 'public'}
                          </Badge>
                        </div>
                        {repo.description && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {repo.description}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <ImportStatusBadge status={importedSummaries?.[repo.fullName]} />
                      </div>
                      <ArrowSquareOutIcon
                        size={14}
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        weight="bold"
                      />
                    </a>
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : null}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://github.com/settings/installations/${installationId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="gap-1.5"
            >
              <GithubLogoIcon size={14} weight="bold" />
              Update on GitHub
              <ArrowSquareOutIcon size={12} />
            </a>
          </Button>
          <p className="flex-1 text-right text-[11px] text-muted-foreground">
            After updating on GitHub, click refresh to see the changes.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
