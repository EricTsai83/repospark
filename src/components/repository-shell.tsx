import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TopBar } from '@/components/top-bar';
import { ChatPanel } from '@/components/chat-panel';
import { JobRow } from '@/components/job-row';
import { DeepAnalysisDialog } from '@/components/deep-analysis-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AuthButton } from '@/components/auth-button';
import { EmptyState } from '@/components/empty-state';
import { useCheckForUpdates } from '@/hooks/use-check-for-updates';
import { useAsyncCallback } from '@/hooks/use-async-callback';
import type { RepositoryId, ThreadId, ChatMode } from '@/lib/types';

export function RepositoryShell() {
  const repositories = useQuery(api.repositories.listRepositories);
  const requestDeepAnalysis = useMutation(api.analysis.requestDeepAnalysis);
  const sendMessageMutation = useMutation(api.chat.sendMessage);
  const syncRepositoryMutation = useMutation(api.repositories.syncRepository);
  const deleteThreadMutation = useMutation(api.chat.deleteThread);
  const deleteRepositoryMutation = useMutation(api.repositories.deleteRepository);

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

  useEffect(() => {
    if (!repositories || repositories.length === 0) return;
    if (!selectedRepositoryId || !repositories.some((r) => r._id === selectedRepositoryId)) {
      setSelectedRepositoryId(repositories[0]._id);
    }
  }, [repositories, selectedRepositoryId]);

  const repoDetail = useQuery(
    api.repositories.getRepositoryDetail,
    selectedRepositoryId ? { repositoryId: selectedRepositoryId } : 'skip',
  );

  // Derive repo name from the already-loaded list so the TopBar title is
  // available immediately when switching repos (no flash of "Repository").
  const selectedRepoName = repositories?.find((r) => r._id === selectedRepositoryId)?.sourceRepoFullName;

  // Check GitHub for new remote commits on tab-focus and repo-switch
  useCheckForUpdates(selectedRepositoryId);


  const messages = useQuery(api.chat.listMessages, selectedThreadId ? { threadId: selectedThreadId } : 'skip');
  const artifacts = useMemo(() => repoDetail?.artifacts ?? [], [repoDetail?.artifacts]);
  const jobs = useMemo(() => repoDetail?.jobs ?? [], [repoDetail?.jobs]);

  const [isSending, handleSendMessage] = useAsyncCallback(
    useCallback(
      async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedThreadId || !chatInput.trim()) return;
        await sendMessageMutation({ threadId: selectedThreadId, content: chatInput, mode: chatMode });
        setChatInput('');
      },
      [selectedThreadId, chatInput, chatMode, sendMessageMutation],
    ),
  );

  const [isRunningAnalysis, handleRunAnalysis] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      await requestDeepAnalysis({ repositoryId: selectedRepositoryId, prompt: analysisPrompt });
    }, [selectedRepositoryId, analysisPrompt, requestDeepAnalysis]),
  );

  const [isSyncing, handleSync] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      await syncRepositoryMutation({ repositoryId: selectedRepositoryId });
    }, [selectedRepositoryId, syncRepositoryMutation]),
  );

  const [isDeletingThread, handleDeleteThread] = useAsyncCallback(
    useCallback(async () => {
      if (!threadToDelete) return;
      await deleteThreadMutation({ threadId: threadToDelete });
      if (selectedThreadId === threadToDelete) setSelectedThreadId(null);
      setThreadToDelete(null);
    }, [threadToDelete, selectedThreadId, deleteThreadMutation]),
  );

  const [isDeletingRepo, handleDeleteRepo] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      await deleteRepositoryMutation({ repositoryId: selectedRepositoryId });
      setSelectedRepositoryId(null);
      setSelectedThreadId(null);
      setShowDeleteRepoDialog(false);
    }, [selectedRepositoryId, deleteRepositoryMutation]),
  );

  return (
    <>
      <AppSidebar
        repositories={repositories}
        selectedRepositoryId={selectedRepositoryId}
        onSelectRepository={(id) => {
          setSelectedRepositoryId(id);
          setSelectedThreadId(null);
          setThreadToDelete(null);
        }}
        selectedThreadId={selectedThreadId}
        onSelectThread={setSelectedThreadId}
        onDeleteThread={setThreadToDelete}
        chatMode={chatMode}
        defaultThreadId={repoDetail?.repository.defaultThreadId}
        onImported={(repoId, threadId) => {
          setSelectedRepositoryId(repoId);
          if (threadId) setSelectedThreadId(threadId);
        }}
        authButton={<AuthButton size="sm" />}
      />

      <SidebarInset>
        <TopBar
          repoDetail={repoDetail}
          repoName={selectedRepoName}
          isSyncing={isSyncing}
          onSync={() => void handleSync()}
          onDeleteRepo={() => setShowDeleteRepoDialog(true)}
          onRunAnalysis={() => setShowAnalysisDialog(true)}
        />

        {!selectedRepositoryId ? (
          <EmptyState />
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as typeof activeTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <MainTabsList jobCount={jobs.length} artifactCount={artifacts.length} />

            <TabsContent value="chat">
              <ChatPanel
                selectedThreadId={selectedThreadId}
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatMode={chatMode}
                setChatMode={setChatMode}
                isSending={isSending}
                onSendMessage={handleSendMessage}
                deepModeAvailable={repoDetail?.deepModeAvailable ?? false}
                isSyncing={isSyncing}
                onSync={() => void handleSync()}
              />
            </TabsContent>

            <TabsContent value="jobs">
              <ListPanel emptyText="No jobs yet." isEmpty={jobs.length === 0}>
                {jobs.map((job) => (
                  <JobRow key={job._id} job={job} />
                ))}
              </ListPanel>
            </TabsContent>

            <TabsContent value="artifacts">
              <ListPanel
                emptyText="Once the import finishes, manifests, READMEs, and architecture summaries appear here."
                isEmpty={artifacts.length === 0}
              >
                {artifacts.map((artifact) => (
                  <Card key={artifact._id}>
                    <CardHeader className="flex-row items-start justify-between gap-3 p-4 pb-2">
                      <div className="min-w-0">
                        <h4 className="truncate text-sm font-semibold">{artifact.title}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">{artifact.summary}</p>
                      </div>
                      <Badge variant="outline" className="uppercase">
                        {artifact.kind}
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                        {artifact.contentMarkdown}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </ListPanel>
            </TabsContent>
          </Tabs>
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

      <DeepAnalysisDialog
        open={showAnalysisDialog}
        onOpenChange={setShowAnalysisDialog}
        analysisPrompt={analysisPrompt}
        onAnalysisPromptChange={setAnalysisPrompt}
        isRunning={isRunningAnalysis}
        onRun={() => void handleRunAnalysis()}
      />
    </>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center px-1 py-px text-[10px] font-semibold bg-muted text-muted-foreground">
      {count}
    </span>
  );
}

/**
 * Memoised tab bar – only re-renders when the badge counts actually change,
 * not on every repo switch or repoDetail reload.
 */
const MainTabsList = memo(function MainTabsList({
  jobCount,
  artifactCount,
}: {
  jobCount: number;
  artifactCount: number;
}) {
  return (
    <TabsList className="border-b border-border px-4">
      <TabsTrigger value="chat">Chat</TabsTrigger>
      <TabsTrigger value="jobs">
        Jobs
        <CountBadge count={jobCount} />
      </TabsTrigger>
      <TabsTrigger value="artifacts">
        Artifacts
        <CountBadge count={artifactCount} />
      </TabsTrigger>
    </TabsList>
  );
});

function ListPanel({
  emptyText,
  children,
  isEmpty,
}: {
  emptyText: string;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-6">
        {isEmpty ? <p className="text-sm text-muted-foreground">{emptyText}</p> : children}
      </div>
    </div>
  );
}
