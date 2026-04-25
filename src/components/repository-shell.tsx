import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { AttachRepoMenu } from '@/components/attach-repo-menu';
import { TopBar } from '@/components/top-bar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { AppNotice } from '@/components/app-notice';
import { RepositoryTabs } from '@/components/repository-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAsyncCallback } from '@/hooks/use-async-callback';
import { useCheckForUpdates } from '@/hooks/use-check-for-updates';
import { useRepositoryActions } from '@/hooks/use-repository-actions';
import { useThreadCapabilities } from '@/hooks/use-thread-capabilities';
import type { RepositoryId, ThreadId, ChatMode, SandboxModeStatus } from '@/lib/types';
import { toUserErrorMessage } from '@/lib/errors';

type RepositoryWorkspaceStatus = 'initializing' | 'no-repo' | 'ready';

const DeepAnalysisDialog = lazy(() =>
  import('@/components/deep-analysis-dialog').then((module) => ({ default: module.DeepAnalysisDialog })),
);

/**
 * URL ↔ workspace-state bridge. The route layer (`/chat`, `/t/:threadId`,
 * `/r/:repoId`) hands us the params; everything else in the workspace is
 * derived from them so that selection stays a single source of truth and a
 * shareable URL always restores the same view.
 *
 * Resolution order:
 *
 * 1. `urlThreadId` is the highest-priority hint. The thread's own
 *    `repositoryId` (loaded via `getThreadContext`) drives the repo panel —
 *    repo-less threads show the chat input but no repo-scoped tabs.
 * 2. `urlRepositoryId` (no thread) shows the repo's overview without forcing
 *    a thread selection; the user picks a thread from the sidebar.
 * 3. Neither set (`/chat`) and the user has at least one thread → redirect to
 *    `/t/:mostRecent` so the URL always reflects the visible thread (PRD US 27).
 * 4. Neither set and the user has no threads → render the empty state with
 *    the dual CTA (PRD US 9).
 */
export function RepositoryShell({
  urlThreadId,
  urlRepositoryId,
}: {
  urlThreadId: ThreadId | null;
  urlRepositoryId: RepositoryId | null;
}) {
  const navigate = useNavigate();
  const repositories = useQuery(api.repositories.listRepositories);
  const createThreadMutation = useMutation(api.chat.createThread);

  // useThreadCapabilities is the canonical bridge between the resolver-side
  // ChatModeResolver / ThreadContextResolver and the UI's mode selector.
  // It also forwards the attached repository summary, so we do not need a
  // second `getThreadContext` subscription here.
  const capabilities = useThreadCapabilities(urlThreadId);

  // Loaded only on the no-selection landing (`/chat`) so we can redirect to
  // the most recent thread when one exists. The query is owner-scoped via
  // chat.listThreads's no-arg branch added in Phase 1.
  const ownerThreads = useQuery(
    api.chat.listThreads,
    urlThreadId === null && urlRepositoryId === null ? {} : 'skip',
  );

  const [threadToDelete, setThreadToDelete] = useState<ThreadId | null>(null);
  const [showDeleteRepoDialog, setShowDeleteRepoDialog] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState(
    'Summarize the main modules, data flow, and risk areas for this repository.',
  );
  const [chatInput, setChatInput] = useState('');
  // The user's last explicit mode pick, scoped to the thread it was made for.
  // When `urlThreadId` changes, the scope check fails and the effective mode
  // collapses to the new thread's resolver-supplied default — no effect or
  // setState required, so the per-thread default behaviour stays a pure
  // derivation. We also drop the pick if it became unavailable for the same
  // thread (e.g. the user picked `sandbox` and then the sandbox expired).
  const [pickedChatMode, setPickedChatMode] = useState<{
    threadId: ThreadId | null;
    mode: ChatMode;
  } | null>(null);
  const chatMode: ChatMode =
    pickedChatMode &&
    pickedChatMode.threadId === urlThreadId &&
    capabilities.availableModes.includes(pickedChatMode.mode)
      ? pickedChatMode.mode
      : capabilities.defaultMode;
  const setChatMode = useCallback(
    (mode: ChatMode) => {
      setPickedChatMode({ threadId: urlThreadId, mode });
    },
    [urlThreadId],
  );
  const [activeTab, setActiveTab] = useState<'chat' | 'jobs' | 'artifacts'>('chat');
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const isRepositoriesLoading = repositories === undefined;

  // /t/:threadId → use thread's repository (if any). /r/:repoId → use the
  // URL repo. /chat → null until the redirect-to-most-recent effect runs.
  const effectiveSelectedRepositoryId: RepositoryId | null =
    urlRepositoryId ?? capabilities.attachedRepository?.id ?? null;

  const effectiveSelectedThreadId: ThreadId | null = urlThreadId;

  const selectedRepoName = repositories?.find(
    (repository) => repository._id === effectiveSelectedRepositoryId,
  )?.sourceRepoFullName;

  const repoDetail = useQuery(
    api.repositories.getRepositoryDetail,
    effectiveSelectedRepositoryId ? { repositoryId: effectiveSelectedRepositoryId } : 'skip',
  );
  const effectiveSandboxModeStatus: SandboxModeStatus | null =
    effectiveSelectedThreadId !== null
      ? capabilities.sandboxModeStatus
      : repoDetail?.sandboxModeStatus ?? null;

  // PRD US 27: most recent thread loads on landing. Runs only on `/chat` when
  // the owner has at least one thread; the redirect is `replace` so the user
  // can still hit Back to leave the workspace without bouncing through /chat.
  useEffect(() => {
    if (urlThreadId !== null || urlRepositoryId !== null) {
      return;
    }
    if (!ownerThreads || ownerThreads.length === 0) {
      return;
    }
    void navigate(`/t/${ownerThreads[0]._id}`, { replace: true });
  }, [navigate, ownerThreads, urlRepositoryId, urlThreadId]);

  // Fall back gracefully when a thread URL points at an entity the viewer no
  // longer owns or that has been deleted. Matches the empty-state recovery
  // path so the user sees actionable CTAs instead of a broken workspace.
  useEffect(() => {
    if (urlThreadId === null) {
      return;
    }
    if (capabilities.isMissingThread) {
      void navigate('/chat', { replace: true });
    }
  }, [capabilities.isMissingThread, navigate, urlThreadId]);

  // Check GitHub for new remote commits on tab-focus and repo-switch.
  useCheckForUpdates(effectiveSelectedRepositoryId);

  const messages = useQuery(
    api.chat.listMessages,
    effectiveSelectedThreadId ? { threadId: effectiveSelectedThreadId } : 'skip',
  );
  const activeMessageStream = useQuery(
    api.chat.getActiveMessageStream,
    effectiveSelectedThreadId ? { threadId: effectiveSelectedThreadId } : 'skip',
  );

  const isOnLanding = urlThreadId === null && urlRepositoryId === null;
  const isLandingResolving =
    isOnLanding && (ownerThreads === undefined || (ownerThreads.length > 0));

  const workspaceStatus: RepositoryWorkspaceStatus = isRepositoriesLoading || isLandingResolving
    ? 'initializing'
    : isOnLanding && ownerThreads?.length === 0
      ? 'no-repo'
      : effectiveSelectedRepositoryId === null && effectiveSelectedThreadId === null
        ? 'no-repo'
        : 'ready';

  const isChatLoading =
    workspaceStatus === 'initializing' ||
    (effectiveSelectedThreadId !== null && (messages === undefined || capabilities.isLoading));

  const handleSelectThread = useCallback(
    (threadId: ThreadId | null) => {
      setActionError(null);
      setAnalysisError(null);
      if (threadId === null) {
        void navigate('/chat');
      } else {
        void navigate(`/t/${threadId}`);
      }
    },
    [navigate],
  );

  const handleSelectRepository = useCallback(
    (repoId: RepositoryId) => {
      setActionError(null);
      setAnalysisError(null);
      void navigate(`/r/${repoId}`);
    },
    [navigate],
  );

  // Import success can produce either a fresh repo+thread (when the user
  // imports their first repository) or just a repo (subsequent imports).
  // We prefer the thread URL so the user lands directly in chatting context.
  const handleImported = useCallback(
    (repoId: RepositoryId, threadId: ThreadId | null) => {
      setActionError(null);
      setAnalysisError(null);
      if (threadId) {
        void navigate(`/t/${threadId}`);
      } else {
        void navigate(`/r/${repoId}`);
      }
    },
    [navigate],
  );

  // Empty-state CTA: create a no-repo thread and navigate into it (PRD US 1
  // and US 9). We intentionally let the backend choose the repo-less default
  // mode so the empty-state CTA stays in lockstep with `chat.createThread`;
  // the user can attach a repo later via
  // AttachRepoMenu, at which point the mode selector unlocks `docs` and
  // potentially `sandbox`. Errors surface in the workspace's standard
  // `actionError` slot.
  const [isStartingConversation, handleStartConversation] = useAsyncCallback(
    useCallback(async () => {
      setActionError(null);
      try {
        const newThreadId = await createThreadMutation({});
        void navigate(`/t/${newThreadId}`);
      } catch (error) {
        setActionError(toUserErrorMessage(error, 'Failed to start a conversation.'));
      }
    }, [createThreadMutation, navigate]),
  );

  const {
    isSending,
    handleSendMessage,
    isRunningAnalysis,
    handleRunAnalysis,
    isSyncing,
    handleSync,
    isDeletingThread,
    handleDeleteThread,
    isDeletingRepo,
    handleDeleteRepo,
  } = useRepositoryActions({
    selectedRepositoryId: effectiveSelectedRepositoryId,
    selectedThreadId: effectiveSelectedThreadId,
    threadToDelete,
    analysisPrompt,
    chatInput,
    chatMode,
    setChatInput,
    setActionError,
    setAnalysisError,
    onAfterDeleteThread: () => {
      // After deletion the thread no longer exists. Send the user back to the
      // landing so the redirect-to-most-recent or empty-state logic re-resolves.
      void navigate('/chat');
    },
    onAfterDeleteRepo: () => {
      void navigate('/chat');
    },
    setThreadToDelete,
    setShowDeleteRepoDialog,
    setShowAnalysisDialog,
  });

  return (
    <>
      <AppSidebar
        repositories={repositories}
        selectedRepositoryId={effectiveSelectedRepositoryId}
        onSelectRepository={handleSelectRepository}
        selectedThreadId={effectiveSelectedThreadId}
        onSelectThread={handleSelectThread}
        onDeleteThread={setThreadToDelete}
        onImported={handleImported}
      />

      <SidebarInset>
        <TopBar
          repoDetail={repoDetail}
          repoName={selectedRepoName}
          isSyncing={isSyncing}
          onSync={() => void handleSync()}
          onDeleteRepo={() => setShowDeleteRepoDialog(true)}
          onRunAnalysis={() => {
            setAnalysisError(null);
            setShowAnalysisDialog(true);
          }}
        />

        {actionError ? (
          <div className="border-b border-border px-6 py-3">
            <AppNotice title="Action failed" message={actionError} tone="error" />
          </div>
        ) : null}

        {workspaceStatus === 'no-repo' ? (
          <EmptyState
            onStartConversation={() => void handleStartConversation()}
            onImported={handleImported}
            isStartingConversation={isStartingConversation}
          />
        ) : (
          <>
            {effectiveSelectedThreadId !== null ? (
              // PRD US 2 / 3: in-thread affordance to attach, swap, or detach
              // the bound repository. Lives below the TopBar so it stays
              // visible across chat / jobs / artifacts tabs and the user
              // never has to leave the thread to change its grounding.
              <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2">
                <AttachRepoMenu
                  threadId={effectiveSelectedThreadId}
                  attachedRepository={capabilities.attachedRepository}
                  availableRepositories={repositories ?? []}
                />
              </div>
            ) : null}
            <RepositoryTabs
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              jobs={repoDetail?.jobs}
              artifacts={repoDetail?.artifacts}
              selectedThreadId={effectiveSelectedThreadId}
              messages={messages}
              activeMessageStream={activeMessageStream}
              isChatLoading={isChatLoading}
              chatInput={chatInput}
              setChatInput={setChatInput}
              chatMode={chatMode}
              setChatMode={setChatMode}
              availableModes={capabilities.availableModes}
              disabledModeReasons={capabilities.disabledReasons}
              isSending={isSending}
              onSendMessage={handleSendMessage}
              sandboxModeStatus={effectiveSandboxModeStatus}
              isSyncing={isSyncing}
              onSync={() => void handleSync()}
            />
          </>
        )}
      </SidebarInset>

      <ConfirmDialog
        open={threadToDelete !== null}
        onOpenChange={(open) => !open && setThreadToDelete(null)}
        title="Delete thread"
        description="This will permanently delete this thread and all its messages. This action cannot be undone."
        actionLabel="Delete thread"
        loadingLabel="Deleting…"
        isPending={isDeletingThread}
        onConfirm={() => void handleDeleteThread()}
      />

      <ConfirmDialog
        open={showDeleteRepoDialog}
        onOpenChange={setShowDeleteRepoDialog}
        title="Delete repository"
        description="This will permanently delete this repository and all its threads, messages, analysis artifacts, jobs, and indexed files. This action cannot be undone."
        actionLabel="Delete repository"
        loadingLabel="Deleting…"
        isPending={isDeletingRepo}
        onConfirm={() => void handleDeleteRepo()}
      />

      {showAnalysisDialog ? (
        <Suspense fallback={<DeepAnalysisDialogSkeleton />}>
          <DeepAnalysisDialog
            open={showAnalysisDialog}
            onOpenChange={(open) => {
              setShowAnalysisDialog(open);
              if (!open) {
                setAnalysisError(null);
              }
            }}
            analysisPrompt={analysisPrompt}
            onAnalysisPromptChange={setAnalysisPrompt}
            sandboxModeStatus={
              effectiveSandboxModeStatus ?? {
                reasonCode: 'missing_sandbox',
                message: 'A live sandbox is unavailable right now. Sync the repository to provision a fresh sandbox.',
              }
            }
            errorMessage={analysisError}
            isRunning={isRunningAnalysis}
            onRun={handleRunAnalysis}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function DeepAnalysisDialogSkeleton() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deep analysis</DialogTitle>
          <DialogDescription>Loading the analysis workspace…</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
