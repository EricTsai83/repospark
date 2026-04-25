import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  PlusIcon,
  GlobeIcon,
  LockIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  CircleNotchIcon,
  CheckCircleIcon,
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  GithubLogoIcon,
} from '@phosphor-icons/react';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useGitHubConnection } from '@/hooks/use-github-connection';
import { useAsyncCallback } from '@/hooks/use-async-callback';
import type { RepositoryId, ThreadId } from '@/lib/types';

type ImportSummary = {
  importStatus: string;
  lastImportedAt: number | undefined;
  hasRemoteUpdates: boolean;
};

type RepoInfo = {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  updatedAt: string;
  ownerAvatarUrl?: string;
};

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isGitHubUrl(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.includes('github.com/') || /^https?:\/\//.test(trimmed);
}

// ---------------------------------------------------------------------------
// Shared repo row component
// ---------------------------------------------------------------------------

function RepoRow({
  repo,
  isImporting,
  onImport,
  importSummary,
}: {
  repo: RepoInfo;
  isAuthorized: boolean;
  isImporting: boolean;
  onImport: () => void;
  importSummary?: ImportSummary;
}) {
  const ownerInitial = (repo.fullName.split('/')[0] ?? '?')[0].toUpperCase();
  const hasCompletedImport = importSummary?.importStatus === 'completed' || importSummary?.lastImportedAt !== undefined;
  const isRunning = importSummary?.importStatus === 'queued' || importSummary?.importStatus === 'running';
  const hasUpdates = hasCompletedImport && !!importSummary?.hasRemoteUpdates;
  const canRetryFailedSync = hasCompletedImport && importSummary?.importStatus === 'failed';
  const runningLabel = hasCompletedImport ? 'Syncing…' : 'Importing…';

  return (
    <div
      className={`flex items-center gap-3 border-b border-border/50 px-1 py-3 last:border-b-0 ${hasCompletedImport && !isRunning ? 'opacity-60' : ''}`}
    >
      {/* Avatar */}
      {repo.ownerAvatarUrl ? (
        <img src={repo.ownerAvatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {ownerInitial}
        </div>
      )}

      {/* Repo name + metadata */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-sm font-medium">{repo.fullName}</span>
        {repo.isPrivate && <LockIcon size={12} className="shrink-0 text-muted-foreground" weight="bold" />}
        <span className="shrink-0 text-xs text-muted-foreground">· {formatRelativeDate(repo.updatedAt)}</span>
      </div>

      {/* Action area: status badge or import/sync button */}
      {isRunning ? (
        <Badge variant="muted" className="shrink-0 gap-1">
          <CircleNotchIcon size={12} className="animate-spin" />
          {runningLabel}
        </Badge>
      ) : hasCompletedImport ? (
        hasUpdates ? (
          <Button
            variant="outline"
            size="sm"
            className="min-w-30 shrink-0 justify-center gap-1 text-xs"
            disabled={isImporting}
            onClick={onImport}
          >
            <ArrowsClockwiseIcon size={12} weight="bold" />
            {isImporting ? 'Syncing…' : 'Sync'}
          </Button>
        ) : canRetryFailedSync ? (
          <Button
            variant="outline"
            size="sm"
            className="min-w-30 shrink-0 justify-center gap-1 text-xs"
            disabled={isImporting}
            onClick={onImport}
          >
            <ArrowsClockwiseIcon size={12} weight="bold" />
            {isImporting ? 'Syncing…' : 'Retry sync'}
          </Button>
        ) : (
          <Badge variant="muted" className="shrink-0 gap-1">
            <CheckCircleIcon size={12} weight="fill" />
            Imported
          </Badge>
        )
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="min-w-30 shrink-0 justify-center text-xs"
          disabled={isImporting}
          onClick={onImport}
        >
          {isImporting ? 'Importing…' : 'Import'}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function ImportRepoDialog({
  onImported,
}: {
  onImported: (repoId: RepositoryId, threadId: ThreadId | null) => void;
}) {
  const createRepositoryImport = useMutation(api.repositories.createRepositoryImport);
  const initiateGitHubInstall = useAction(api.githubAppNode.initiateGitHubInstall);
  const listRepos = useAction(api.githubAppNode.listInstallationRepos);
  const searchReposAction = useAction(api.githubAppNode.searchGitHubRepos);
  const verifyAccess = useAction(api.githubAppNode.verifyRepoAccess);
  const importedSummaries = useQuery(api.repositories.getImportedRepoSummaries);
  const { isConnected, installationId } = useGitHubConnection();
  const [open, setOpen] = useState(false);

  // --- Shared state ---
  const [importError, setImportError] = useState<string | null>(null);
  const [importingRepo, setImportingRepo] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  // --- Authorized repos (fetched once on dialog open) ---
  const [authorizedRepos, setAuthorizedRepos] = useState<RepoInfo[] | null>(null);
  const [isLoadingAuthorized, setIsLoadingAuthorized] = useState(false);
  const [authorizedError, setAuthorizedError] = useState<string | null>(null);

  // Derived: set of authorized repo fullNames for O(1) badge lookup
  const authorizedSet = useMemo(() => {
    if (!authorizedRepos) return new Set<string>();
    return new Set(authorizedRepos.map((r) => r.fullName));
  }, [authorizedRepos]);

  // Derived: authorized private repos for the Private tab, sorted so
  // not-yet-imported repos appear first and imported ones sink to the bottom.
  const authorizedPrivateRepos = useMemo(() => {
    if (!authorizedRepos) return null;
    const privateRepos = authorizedRepos.filter((r) => r.isPrivate);
    if (!importedSummaries) return privateRepos;
    return privateRepos.slice().sort((a, b) => {
      const aImported = a.fullName in importedSummaries ? 1 : 0;
      const bImported = b.fullName in importedSummaries ? 1 : 0;
      return aImported - bImported;
    });
  }, [authorizedRepos, importedSummaries]);

  // --- Public tab state ---
  const [publicInput, setPublicInput] = useState('');
  const [branch, setBranch] = useState('');
  const [importStage, setImportStage] = useState<'idle' | 'verifying' | 'importing'>('idle');
  const [searchResults, setSearchResults] = useState<RepoInfo[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const isUrlMode = isGitHubUrl(publicInput);

  // Track the latest search request to avoid stale results
  const latestSearchRef = useRef(0);

  const [isConnectingGitHub, handleConnectGitHub] = useAsyncCallback(async () => {
    setConnectError(null);
    try {
      const redirectUrl = await initiateGitHubInstall({
        returnTo: window.location.origin,
      });
      window.location.assign(redirectUrl);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Failed to connect GitHub.');
    }
  });

  // Fetch authorized repos
  const fetchAuthorizedRepos = useCallback(async () => {
    setIsLoadingAuthorized(true);
    setAuthorizedError(null);
    try {
      const result = await listRepos({});
      setAuthorizedRepos(result.repos);
    } catch (err) {
      setAuthorizedError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setIsLoadingAuthorized(false);
    }
  }, [listRepos]);

  // Fetch authorized repos when the dialog is open and the connection becomes
  // available. This covers the race condition where the dialog opens before
  // the GitHub connection status query has resolved — without this effect
  // fetchAuthorizedRepos would never be called and the Private tab stays empty.
  useEffect(() => {
    if (open && isConnected && !authorizedRepos && !isLoadingAuthorized) {
      void fetchAuthorizedRepos();
    }
  }, [open, isConnected, authorizedRepos, isLoadingAuthorized, fetchAuthorizedRepos]);

  // Auto-refresh authorized repos when the user returns to the window (e.g.
  // after configuring repos on GitHub in another tab).
  useEffect(() => {
    if (!open || !isConnected) return;

    const handleFocus = () => {
      void fetchAuthorizedRepos();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [open, isConnected, fetchAuthorizedRepos]);

  // Debounced search effect
  useEffect(() => {
    const trimmed = publicInput.trim();

    if (isUrlMode || trimmed.length < 2) {
      // Increment requestId to invalidate any pending search requests
      latestSearchRef.current++;
      setSearchResults(null);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const requestId = ++latestSearchRef.current;

    const timer = setTimeout(() => {
      searchReposAction({ query: trimmed })
        .then((result) => {
          if (requestId === latestSearchRef.current) {
            setSearchResults(result.repos);
            setSearchError(null);
          }
        })
        .catch((err) => {
          if (requestId === latestSearchRef.current) {
            setSearchError(err instanceof Error ? err.message : 'Search failed');
            setSearchResults(null);
          }
        })
        .finally(() => {
          if (requestId === latestSearchRef.current) {
            setIsSearching(false);
          }
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [publicInput, isUrlMode, searchReposAction]);

  // Check if the URL-mode repo is authorized
  const urlRepoAuthorized = useMemo(() => {
    if (!isUrlMode || !publicInput.trim()) return false;
    try {
      const match = publicInput.match(/github\.com\/([^/]+\/[^/\s#?]+)/);
      if (match) {
        const fullName = match[1].replace(/\.git$/, '');
        return authorizedSet.has(fullName);
      }
    } catch {
      // ignore parse errors
    }
    return false;
  }, [isUrlMode, publicInput, authorizedSet]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && isConnected) {
        void fetchAuthorizedRepos();
      }
      if (!nextOpen) {
        setPublicInput('');
        setBranch('');
        setImportError(null);
        setConnectError(null);
        setImportingRepo(null);
        setSearchResults(null);
        setSearchError(null);
        setImportStage('idle');
      }
    },
    [fetchAuthorizedRepos, isConnected],
  );

  // Import by URL
  async function handleImportByUrl(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError(null);
    setImportStage('verifying');
    try {
      await verifyAccess({ url: publicInput });
      setImportStage('importing');
      const result = await createRepositoryImport({
        url: publicInput,
        branch: branch.trim() || undefined,
      });
      setPublicInput('');
      setBranch('');
      setOpen(false);
      onImported(result.repositoryId, result.defaultThreadId ?? null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setImportStage('idle');
    }
  }

  // Import from list (search result or authorized repo)
  async function handleImportFromList(repo: RepoInfo) {
    setImportingRepo(repo.fullName);
    setImportError(null);
    try {
      const result = await createRepositoryImport({
        url: `https://github.com/${repo.fullName}`,
      });
      setOpen(false);
      onImported(result.repositoryId, result.defaultThreadId ?? null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setImportingRepo(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Add repository" title="Add repository">
          <PlusIcon weight="bold" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[560px] flex-col overflow-y-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add a repository</DialogTitle>
          <DialogDescription>
            {!isConnected
              ? 'Connect your GitHub account to import repositories.'
              : 'Import any public repo by URL or search, or add your private repos.'}
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">Connect your GitHub account first to import repositories.</p>
            <Button
              type="button"
              variant="default"
              className="gap-2"
              disabled={isConnectingGitHub}
              onClick={() => void handleConnectGitHub()}
            >
              {isConnectingGitHub ? (
                <>
                  <CircleNotchIcon size={14} className="animate-spin" />
                  Connecting…
                </>
              ) : (
                <>
                  <GithubLogoIcon size={14} weight="fill" />
                  Connect GitHub
                </>
              )}
            </Button>
            {connectError ? <p className="text-xs text-destructive">{connectError}</p> : null}
          </div>
        ) : (
          <Tabs defaultValue="public" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TabsList className="w-full shrink-0 border-b border-border px-0">
              <TabsTrigger value="public" className="gap-1.5">
                <GlobeIcon size={14} weight="bold" />
                Public Repo
              </TabsTrigger>
              <TabsTrigger value="private" className="gap-1.5">
                <LockIcon size={14} weight="bold" />
                Private Repo
              </TabsTrigger>
            </TabsList>

            {/* ---- Tab 1: Public Repo (URL + Search) ---- */}
            <TabsContent value="public" className="pt-3">
              {/* Smart input */}
              <div className="relative shrink-0">
                <MagnifyingGlassIcon
                  size={14}
                  weight="bold"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={publicInput}
                  onChange={(e) => {
                    setPublicInput(e.target.value);
                    setImportError(null);
                  }}
                  placeholder="Search any GitHub repo or paste a URL..."
                  className="pl-8"
                  autoFocus
                />
              </div>

              {/* URL import mode */}
              {isUrlMode ? (
                <form
                  className="mt-3 flex min-h-0 flex-1 flex-col gap-3"
                  onSubmit={(e) => {
                    void handleImportByUrl(e);
                  }}
                >
                  {urlRepoAuthorized && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheckIcon size={14} weight="fill" className="text-primary" />
                      <span>This repo is in your authorized list.</span>
                    </div>
                  )}
                  <Input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="Branch (leave empty for repo default)"
                  />

                  {importError && <p className="text-xs text-destructive">{importError}</p>}

                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="secondary">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button
                      type="submit"
                      variant="default"
                      className="min-w-36"
                      disabled={importStage !== 'idle' || !publicInput.trim()}
                    >
                      {importStage === 'verifying'
                        ? 'Checking access…'
                        : importStage === 'importing'
                          ? 'Queuing import…'
                          : 'Import'}
                    </Button>
                  </DialogFooter>
                </form>
              ) : publicInput.trim().length >= 2 ? (
                /* Search results */
                <div className="mt-3 flex min-h-0 flex-1 flex-col">
                  {isSearching && !searchResults ? (
                    <div className="flex flex-1 items-center justify-center gap-2">
                      <CircleNotchIcon size={16} className="animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Searching…</p>
                    </div>
                  ) : searchError ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2">
                      <p className="text-sm text-destructive">{searchError}</p>
                    </div>
                  ) : searchResults && searchResults.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                      <p className="text-sm text-muted-foreground">
                        No repositories found for &ldquo;{publicInput.trim()}&rdquo;
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Try a different search term, or paste a full GitHub URL above.
                      </p>
                    </div>
                  ) : searchResults ? (
                    <ScrollArea className="min-h-0 flex-1">
                      <div className="flex flex-col pr-3">
                        {isSearching && (
                          <div className="flex items-center justify-center gap-1.5 border-b border-border/50 py-2.5">
                            <CircleNotchIcon size={12} className="animate-spin text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">Updating results…</span>
                          </div>
                        )}
                        {searchResults.map((repo) => (
                          <RepoRow
                            key={repo.fullName}
                            repo={repo}
                            isAuthorized={authorizedSet.has(repo.fullName)}
                            isImporting={importingRepo === repo.fullName}
                            onImport={() => void handleImportFromList(repo)}
                            importSummary={importedSummaries?.[repo.fullName]}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  ) : null}

                  {importError && <p className="mt-2 shrink-0 text-xs text-destructive">{importError}</p>}
                </div>
              ) : (
                /* Empty state / hint */
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm text-muted-foreground">
                    Search any public repository on GitHub, or paste a URL to import directly.
                  </p>
                  <p className="text-xs text-muted-foreground">Type at least 2 characters to start searching.</p>
                </div>
              )}
            </TabsContent>

            {/* ---- Tab 2: Private Repo ---- */}
            <TabsContent value="private" className="pt-3">
              {installationId && (
                <a
                  href={`https://github.com/settings/installations/${installationId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-3 flex shrink-0 items-center gap-3 border-l-2 border-l-primary bg-muted px-3 py-2.5 transition-colors hover:bg-muted/80"
                >
                  <GithubLogoIcon size={20} weight="fill" className="shrink-0 text-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Manage repo access</p>
                    <p className="text-[11px] text-muted-foreground">
                      Select which private repos are available for import
                    </p>
                  </div>
                  <ArrowSquareOutIcon size={16} weight="bold" className="shrink-0 text-muted-foreground" />
                </a>
              )}

              <p className="mb-2 shrink-0 text-[11px] text-muted-foreground">Your authorized private repositories</p>

              {isLoadingAuthorized && !authorizedRepos ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 border-b border-border/50 px-1 py-3 last:border-b-0"
                    >
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-8 w-28" />
                    </div>
                  ))}
                </div>
              ) : authorizedError ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2">
                  <p className="text-sm text-destructive">{authorizedError}</p>
                  <Button variant="ghost" size="sm" onClick={() => void fetchAuthorizedRepos()}>
                    Retry
                  </Button>
                </div>
              ) : authorizedPrivateRepos && authorizedPrivateRepos.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm text-muted-foreground">No private repos authorized yet.</p>
                  <p className="text-xs text-muted-foreground">Use the link above to select repos on GitHub.</p>
                </div>
              ) : authorizedPrivateRepos ? (
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col pr-3">
                    {authorizedPrivateRepos.map((repo) => (
                      <RepoRow
                        key={repo.fullName}
                        repo={repo}
                        isAuthorized={true}
                        isImporting={importingRepo === repo.fullName}
                        onImport={() => void handleImportFromList(repo)}
                        importSummary={importedSummaries?.[repo.fullName]}
                      />
                    ))}
                  </div>
                </ScrollArea>
              ) : null}

              {importError && <p className="mt-2 shrink-0 text-xs text-destructive">{importError}</p>}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
