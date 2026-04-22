import { lazy, Suspense, useCallback, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TopBar } from '@/components/top-bar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { AppNotice } from '@/components/app-notice';
import { RepositoryTabs } from '@/components/repository-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCheckForUpdates } from '@/hooks/use-check-for-updates';
import { useRepositoryActions } from '@/hooks/use-repository-actions';
import { useRepositorySelection } from '@/hooks/use-repository-selection';
import type { RepositoryId, ThreadId, ChatMode } from '@/lib/types';

type RepositoryWorkspaceStatus = 'initializing' | 'no-repo' | 'ready';

const DeepAnalysisDialog = lazy(() =>
  import('@/components/deep-analysis-dialog').then((module) => ({ default: module.DeepAnalysisDialog })),
);

export function RepositoryShell() {
  const repositories = useQuery(api.repositories.listRepositories);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<RepositoryId | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const [threadToDelete, setThreadToDelete] = useState<ThreadId | null>(null);
  const [showDeleteRepoDialog, setShowDeleteRepoDialog] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState(
    'Summarize the main modules, data flow, and risk areas for this repository.',
  );
  const [chatInput, setChatInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('fast');
  const [activeTab, setActiveTab] = useState<'chat' | 'jobs' | 'artifacts'>('chat');
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const { effectiveSelectedRepositoryId, isRepositoriesLoading, selectedRepoName } = useRepositorySelection(
    repositories,
    selectedRepositoryId,
  );

  const repoDetail = useQuery(
    api.repositories.getRepositoryDetail,
    effectiveSelectedRepositoryId ? { repositoryId: effectiveSelectedRepositoryId } : 'skip',
  );

  const handleSelectThread = useCallback((threadId: ThreadId | null) => {
    setActionError(null);
    setAnalysisError(null);
    setSelectedThreadId(threadId);
  }, []);

  // Check GitHub for new remote commits on tab-focus and repo-switch
  useCheckForUpdates(effectiveSelectedRepositoryId);

  // Threads are also subscribed inside the sidebar's ThreadsSection; Convex
  // dedupes identical subscriptions, so this extra useQuery is free and lets
  // the main panel compute a single unified "chat is still resolving" flag
  // instead of flashing between skeletons and empty states.
  const threadsForChat = useQuery(
    api.chat.listThreads,
    effectiveSelectedRepositoryId ? { repositoryId: effectiveSelectedRepositoryId } : 'skip',
  );
  const artifacts = repoDetail?.artifacts;
  const jobs = repoDetail?.jobs;

  const workspaceStatus: RepositoryWorkspaceStatus = isRepositoriesLoading
    ? 'initializing'
    : effectiveSelectedRepositoryId === null
      ? 'no-repo'
      : 'ready';

  const defaultThreadId = repoDetail?.repository.defaultThreadId;
  const preferredThreadId =
    workspaceStatus === 'ready' && threadsForChat && threadsForChat.length > 0
      ? defaultThreadId && threadsForChat.some((thread) => thread._id === defaultThreadId)
        ? defaultThreadId
        : threadsForChat[0]._id
      : null;
  const effectiveSelectedThreadId =
    selectedThreadId && threadsForChat?.some((thread) => thread._id === selectedThreadId)
      ? selectedThreadId
      : preferredThreadId;
  const messages = useQuery(
    api.chat.listMessages,
    effectiveSelectedThreadId ? { threadId: effectiveSelectedThreadId } : 'skip',
  );
  const activeMessageStream = useQuery(
    api.chat.getActiveMessageStream,
    effectiveSelectedThreadId ? { threadId: effectiveSelectedThreadId } : 'skip',
  );

  const isChatLoading =
    workspaceStatus === 'initializing' ||
    (workspaceStatus === 'ready' && (threadsForChat === undefined || (effectiveSelectedThreadId !== null && messages === undefined)));

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
    setSelectedRepositoryId,
    setSelectedThreadId,
    setThreadToDelete,
    setShowDeleteRepoDialog,
    setShowAnalysisDialog,
  });

  return (
    <>
      <AppSidebar
        repositories={repositories}
        selectedRepositoryId={effectiveSelectedRepositoryId}
        onSelectRepository={(id) => {
          setActionError(null);
          setAnalysisError(null);
          setSelectedRepositoryId(id);
          setSelectedThreadId(null);
          setThreadToDelete(null);
        }}
          selectedThreadId={effectiveSelectedThreadId}
        onSelectThread={handleSelectThread}
        onDeleteThread={setThreadToDelete}
        chatMode={chatMode}
        onImported={(repoId, threadId) => {
          setActionError(null);
          setAnalysisError(null);
          setSelectedRepositoryId(repoId);
          if (threadId) setSelectedThreadId(threadId);
        }}
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

        {effectiveSelectedRepositoryId && actionError ? (
          <div className="border-b border-border px-6 py-3">
            <AppNotice title="Action failed" message={actionError} tone="error" />
          </div>
        ) : null}

        {workspaceStatus === 'no-repo' ? (
          <EmptyState />
        ) : (
          <RepositoryTabs
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            jobs={jobs}
            artifacts={artifacts}
            selectedThreadId={effectiveSelectedThreadId}
            messages={messages}
            activeMessageStream={activeMessageStream}
            isChatLoading={isChatLoading}
            chatInput={chatInput}
            setChatInput={setChatInput}
            chatMode={chatMode}
            setChatMode={setChatMode}
            isSending={isSending}
            onSendMessage={handleSendMessage}
            deepModeAvailable={repoDetail?.deepModeAvailable ?? true}
            deepModeStatus={repoDetail?.deepModeStatus ?? null}
            isSyncing={isSyncing}
            onSync={() => void handleSync()}
          />
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
            deepModeAvailable={repoDetail !== undefined && repoDetail.deepModeAvailable}
            deepModeReason={repoDetail?.deepModeStatus?.message ?? null}
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
