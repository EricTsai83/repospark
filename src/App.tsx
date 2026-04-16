import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import {
  GithubLogo,
  Plus,
  Robot,
  MagnifyingGlass,
  DotsThreeVertical,
  Broom,
  Sparkle,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { ModeToggle } from './components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

type RepositoryId = Id<'repositories'>;
type ThreadId = Id<'threads'>;

export default function App() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Authenticated>
        <SidebarProvider>
          <WorkspaceShell />
        </SidebarProvider>
      </Authenticated>
      <Unauthenticated>
        <SignedOutShell />
      </Unauthenticated>
    </div>
  );
}

function WorkspaceShell() {
  const repositories = useQuery(api.repositories.listRepositories);
  const requestDeepAnalysis = useMutation(api.analysis.requestDeepAnalysis);
  const sendMessage = useMutation(api.chat.sendMessage);
  const createThread = useMutation(api.chat.createThread);
  const requestSandboxCleanup = useMutation(api.ops.requestSandboxCleanup);

  const [selectedRepositoryId, setSelectedRepositoryId] = useState<RepositoryId | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState(
    'Summarize the main modules, data flow, and risk areas for this repository.',
  );
  const [chatInput, setChatInput] = useState('');
  const [chatMode, setChatMode] = useState<'fast' | 'deep'>('fast');
  const [isSending, setIsSending] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  const [isCleaningSandbox, setIsCleaningSandbox] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'jobs' | 'artifacts' | 'analysis'>('chat');
  const [repoSearch, setRepoSearch] = useState('');

  useEffect(() => {
    if (!repositories || repositories.length === 0) {
      return;
    }
    if (
      !selectedRepositoryId ||
      !repositories.some((r) => r._id === selectedRepositoryId)
    ) {
      setSelectedRepositoryId(repositories[0]._id);
    }
  }, [repositories, selectedRepositoryId]);

  const workspace = useQuery(
    api.repositories.getWorkspace,
    selectedRepositoryId ? { repositoryId: selectedRepositoryId } : 'skip',
  );

  useEffect(() => {
    if (!workspace?.threads?.length) {
      setSelectedThreadId(null);
      return;
    }
    const preferred = workspace.repository.defaultThreadId ?? workspace.threads[0]?._id;
    if (!selectedThreadId || !workspace.threads.some((t) => t._id === selectedThreadId)) {
      setSelectedThreadId(preferred ?? null);
    }
  }, [selectedThreadId, workspace]);

  const messages = useQuery(
    api.chat.listMessages,
    selectedThreadId ? { threadId: selectedThreadId } : 'skip',
  );
  const artifacts = useMemo(() => workspace?.artifacts ?? [], [workspace?.artifacts]);
  const jobs = useMemo(() => workspace?.jobs ?? [], [workspace?.jobs]);

  const filteredRepos = useMemo(() => {
    if (!repositories) return [];
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((r) =>
      r.sourceRepoFullName.toLowerCase().includes(q),
    );
  }, [repoSearch, repositories]);

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThreadId || !chatInput.trim()) return;
    setIsSending(true);
    try {
      await sendMessage({
        threadId: selectedThreadId,
        content: chatInput,
        mode: chatMode,
      });
      setChatInput('');
    } finally {
      setIsSending(false);
    }
  }

  async function handleCreateThread() {
    if (!selectedRepositoryId) return;
    setIsCreatingThread(true);
    try {
      const threadId = await createThread({
        repositoryId: selectedRepositoryId,
        mode: chatMode,
      });
      setSelectedThreadId(threadId);
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleRunAnalysis() {
    if (!selectedRepositoryId) return;
    setIsRunningAnalysis(true);
    try {
      await requestDeepAnalysis({
        repositoryId: selectedRepositoryId,
        prompt: analysisPrompt,
      });
    } finally {
      setIsRunningAnalysis(false);
    }
  }

  async function handleCleanupSandbox() {
    if (!selectedRepositoryId) return;
    setIsCleaningSandbox(true);
    try {
      await requestSandboxCleanup({ repositoryId: selectedRepositoryId });
    } finally {
      setIsCleaningSandbox(false);
    }
  }

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <LogoMark size="sm" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">Architect Agent</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Grounded codebase answers
            </div>
          </div>
        </SidebarHeader>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-1 items-center gap-2 border border-border bg-card px-2.5 py-1.5">
            <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" weight="bold" />
            <input
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ImportRepoDialog
            onImported={(repoId, threadId) => {
              setSelectedRepositoryId(repoId);
              if (threadId) setSelectedThreadId(threadId);
            }}
          />
        </div>

        <SidebarContent>
          <div className="flex flex-col gap-1 p-3" aria-live="polite">
            {repositories === undefined ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
            ) : filteredRepos.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs">
                <p className="font-semibold">No repositories</p>
                <p className="mt-1 text-muted-foreground">
                  Import a public GitHub repo to get started.
                </p>
              </div>
            ) : (
              filteredRepos.map((repository) => (
                <button
                  key={repository._id}
                  type="button"
                  onClick={() => setSelectedRepositoryId(repository._id)}
                  className={cn(
                    'flex w-full items-center gap-2 border px-3 py-2 text-left transition-colors',
                    selectedRepositoryId === repository._id
                      ? 'border-primary bg-muted'
                      : 'border-transparent hover:border-border hover:bg-muted',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {repository.sourceRepoFullName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {repository.detectedFramework ?? 'Framework pending'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </SidebarContent>

        <SidebarFooter>
          <ModeToggle />
          <Button asChild variant="ghost" size="icon" aria-label="GitHub" title="GitHub">
            <a href="https://github.com" rel="noreferrer" target="_blank">
              <GithubLogo weight="bold" />
            </a>
          </Button>
          <div className="ml-auto">
            <AuthButton size="sm" />
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {!workspace ? (
          <>
            <WorkspaceTopBar title="Workspace" />
            <EmptyWorkspace />
          </>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as typeof activeTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <WorkspaceTopBar title={workspace.repository.sourceRepoFullName}>
              <StatusBadge status={workspace.repository.importStatus} />
              <div className="ml-auto flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Workspace actions"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <DotsThreeVertical weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={isRunningAnalysis || !analysisPrompt.trim()}
                      onSelect={(e) => {
                        e.preventDefault();
                        void handleRunAnalysis();
                      }}
                    >
                      <Sparkle weight="bold" />
                      {isRunningAnalysis ? 'Queuing…' : 'Run deep analysis'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isCleaningSandbox}
                      onSelect={(e) => {
                        e.preventDefault();
                        void handleCleanupSandbox();
                      }}
                    >
                      <Broom weight="bold" />
                      {isCleaningSandbox ? 'Cleaning…' : 'Clean sandbox'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Summary</DropdownMenuLabel>
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      <div className="flex justify-between gap-4">
                        <span>Framework</span>
                        <span className="truncate text-foreground">
                          {workspace.repository.detectedFramework ?? 'Unknown'}
                        </span>
                      </div>
                      <div className="mt-1 flex justify-between gap-4">
                        <span>Files indexed</span>
                        <span className="text-foreground">{workspace.fileCount}</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-4">
                        <span>Languages</span>
                        <span className="max-w-[60%] truncate text-right text-foreground">
                          {workspace.repository.detectedLanguages.join(', ') || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </WorkspaceTopBar>

            <TabsList className="border-b border-border px-4">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="jobs">
                Jobs
                {jobs.length > 0 ? <CountBadge count={jobs.length} /> : null}
              </TabsTrigger>
              <TabsTrigger value="artifacts">
                Artifacts
                {artifacts.length > 0 ? <CountBadge count={artifacts.length} /> : null}
              </TabsTrigger>
              <TabsTrigger value="analysis">Deep analysis</TabsTrigger>
            </TabsList>

            <TabsContent value="chat">
              <ChatPanel
                workspace={workspace}
                selectedThreadId={selectedThreadId}
                setSelectedThreadId={setSelectedThreadId}
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatMode={chatMode}
                setChatMode={setChatMode}
                isSending={isSending}
                isCreatingThread={isCreatingThread}
                onCreateThread={handleCreateThread}
                onSendMessage={handleSendMessage}
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

            <TabsContent value="analysis">
              <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-8">
                <h2 className="text-lg font-semibold tracking-tight">Deep analysis prompt</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sends a sandbox investigation. The deep path re-reads files inside the sandbox.
                </p>
                <Textarea
                  value={analysisPrompt}
                  onChange={(e) => setAnalysisPrompt(e.target.value)}
                  className="mt-4 min-h-40"
                />
                <Button
                  variant="default"
                  className="mt-3"
                  disabled={isRunningAnalysis || !analysisPrompt.trim()}
                  onClick={() => void handleRunAnalysis()}
                >
                  <Sparkle weight="bold" />
                  {isRunningAnalysis ? 'Queuing…' : 'Run deep analysis'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </SidebarInset>
    </>
  );
}

function WorkspaceTopBar({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-4">
      <SidebarTrigger />
      <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight md:text-base">
        {title}
      </h1>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const variant: React.ComponentProps<typeof Badge>['variant'] =
    lower.includes('ready') || lower.includes('complete') || lower.includes('success')
      ? 'accent'
      : lower.includes('fail') || lower.includes('error')
        ? 'destructive'
        : 'muted';
  return (
    <Badge variant={variant} className="ml-1 text-[10px] uppercase tracking-wide">
      {status}
    </Badge>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">
      {count}
    </span>
  );
}

function ImportRepoDialog({
  onImported,
}: {
  onImported: (repoId: RepositoryId, threadId: ThreadId | null) => void;
}) {
  const createRepositoryImport = useMutation(api.repositories.createRepositoryImport);
  const [open, setOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError(null);
    setIsImporting(true);
    try {
      const result = await createRepositoryImport({
        url: importUrl,
        branch: branch.trim() || undefined,
      });
      setImportUrl('');
      setBranch('');
      setOpen(false);
      onImported(result.repositoryId, result.defaultThreadId ?? null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" aria-label="Import repository" title="Import repository">
          <Plus weight="bold" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a repository</DialogTitle>
          <DialogDescription>
            Paste a public GitHub URL. We will clone the source and spin up a sandbox.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <Input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            autoFocus
          />
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="branch (optional)"
          />
          {importError ? (
            <p className="text-xs text-destructive">{importError}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="default" disabled={isImporting || !importUrl.trim()}>
              {isImporting ? 'Queuing import…' : 'Import repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChatPanel({
  workspace,
  selectedThreadId,
  setSelectedThreadId,
  messages,
  chatInput,
  setChatInput,
  chatMode,
  setChatMode,
  isSending,
  isCreatingThread,
  onCreateThread,
  onSendMessage,
}: {
  workspace: NonNullable<ReturnType<typeof useQuery<typeof api.repositories.getWorkspace>>>;
  selectedThreadId: ThreadId | null;
  setSelectedThreadId: (id: ThreadId | null) => void;
  messages: Doc<'messages'>[] | undefined;
  chatInput: string;
  setChatInput: (v: string) => void;
  chatMode: 'fast' | 'deep';
  setChatMode: (v: 'fast' | 'deep') => void;
  isSending: boolean;
  isCreatingThread: boolean;
  onCreateThread: () => Promise<void>;
  onSendMessage: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {workspace.threads.length > 0 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-1.5">
          {workspace.threads.map((thread) => (
            <button
              key={thread._id}
              type="button"
              onClick={() => setSelectedThreadId(thread._id)}
              className={cn(
                'shrink-0 border px-2.5 py-1 text-xs font-medium transition-colors',
                selectedThreadId === thread._id
                  ? 'border-primary bg-muted text-foreground'
                  : 'border-transparent bg-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {thread.title}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              disabled={isCreatingThread}
              onClick={() => void onCreateThread()}
            >
              <Plus weight="bold" />
              {isCreatingThread ? 'Creating…' : 'New thread'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {messages === undefined ? (
            <p className="text-sm text-muted-foreground">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <EmptyChatHint />
          ) : (
            messages.map((message) => <MessageBubble key={message._id} message={message} />)
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background">
        <form
          className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-3"
          onSubmit={(e) => {
            void onSendMessage(e);
          }}
        >
          <Textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask about architecture, module boundaries, data flow, risks…"
            className="min-h-20 resize-none border-border"
          />
          <div className="flex items-center justify-between gap-3">
            <Select value={chatMode} onValueChange={(v) => setChatMode(v as 'fast' | 'deep')}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast path</SelectItem>
                <SelectItem value="deep">Deep path</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSending || !selectedThreadId || !chatInput.trim()}
            >
              <PaperPlaneTilt weight="bold" />
              {isSending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyChatHint() {
  const hints = [
    'How is the codebase layered, and where do requests flow?',
    'What are the main modules and how do they depend on each other?',
    'Where are the risky areas or likely hotspots?',
  ];
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm font-medium text-foreground">Ask anything about this repo</p>
      <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {hints.map((hint) => (
          <li key={hint}>“{hint}”</li>
        ))}
      </ul>
    </div>
  );
}

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

function MessageBubble({ message }: { message: Doc<'messages'> }) {
  const isUser = message.role === 'user';
  return (
    <Card
      className={cn(
        'p-4',
        isUser ? 'bg-muted' : 'border-transparent bg-transparent px-0',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {message.role}
        </p>
        <p className="text-[10px] text-muted-foreground">{message.status}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{message.content || '…'}</p>
      {message.errorMessage ? (
        <p className="mt-2 text-xs text-destructive">{message.errorMessage}</p>
      ) : null}
    </Card>
  );
}

function JobRow({ job }: { job: Doc<'jobs'> }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{job.kind}</p>
          <p className="text-xs text-muted-foreground">
            {job.stage} · {Math.round(job.progress * 100)}%
          </p>
        </div>
        <Badge variant="outline" className="uppercase">
          {job.status}
        </Badge>
      </div>
      {job.outputSummary ? (
        <p className="mt-2 text-xs text-muted-foreground">{job.outputSummary}</p>
      ) : null}
      {job.errorMessage ? (
        <p className="mt-2 text-xs text-destructive">{job.errorMessage}</p>
      ) : null}
      <p className="mt-2 text-[10px] text-muted-foreground">
        {formatTimestamp(job._creationTime)}
      </p>
    </Card>
  );
}

function AuthButton({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const { user, signIn, signOut } = useAuth();
  return user ? (
    <Button variant="secondary" size={size} onClick={() => signOut()}>
      Sign out
    </Button>
  ) : (
    <Button variant="default" size={size} onClick={() => void signIn()}>
      Sign in
    </Button>
  );
}

function EmptyWorkspace() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10 text-center">
      <LogoMark size="lg" />
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Import your first repository</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the <span className="font-semibold text-foreground">+</span> button in the sidebar
          to paste a GitHub URL.
        </p>
      </div>
    </div>
  );
}

function SignedOutShell() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <LogoMark size="sm" />
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold tracking-tight">Architect Agent</div>
              <div className="text-[11px] text-muted-foreground">Grounded codebase answers</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <AuthButton size="sm" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-12">
        <section className="flex flex-col gap-5">
          <div className="inline-flex items-center gap-2.5 text-xs font-semibold tracking-wide text-muted-foreground">
            <span className="h-2 w-2 bg-primary" />
            Open-source workspace
          </div>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Ask the repo,{' '}
            <span className="text-primary">not the internet.</span>
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Import a public repository, let the sandbox boot, and get grounded answers about its
            architecture, data flow, and risk areas — not generic guesses from a model that never
            saw the code.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AuthButton />
            <Button asChild variant="secondary">
              <a href="https://github.com" rel="noreferrer" target="_blank">
                <GithubLogo weight="bold" />
                View on GitHub
              </a>
            </Button>
          </div>
        </section>

        <section className="grid items-stretch gap-5 lg:grid-cols-3">
          {[
            {
              label: 'Import',
              eyebrow: 'step 1',
              title: 'Paste a GitHub URL.',
              body: 'We clone it into a fresh sandbox and map the structure.',
            },
            {
              label: 'Ask',
              eyebrow: 'step 2',
              title: 'Pick fast or deep mode.',
              body: 'Fast answers from the index. Deep re-reads files inside the sandbox.',
            },
            {
              label: 'Capture',
              eyebrow: 'step 3',
              title: 'Save the answer.',
              body: 'Conversations, manifests, and architecture notes are saved as artifacts.',
            },
          ].map((card) => (
            <Card key={card.label} className="flex h-full flex-col">
              <CardHeader className="flex-row items-center justify-between gap-4 p-5 pb-3">
                <Badge variant="accent">
                  <span className="h-1.5 w-1.5 bg-primary" />
                  <span>{card.label}</span>
                </Badge>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {card.eyebrow}
                </span>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col p-5 pt-0">
                <h2 className="text-lg font-semibold">{card.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}

function LogoMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const isLg = size === 'lg';
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center border border-border bg-card text-foreground',
        isLg ? 'h-16 w-16' : 'h-9 w-9',
      )}
    >
      <Robot size={isLg ? 32 : 16} weight="bold" />
    </div>
  );
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
