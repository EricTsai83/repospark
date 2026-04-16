import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { Button } from './components/ui/button';

type RepositoryId = Id<'repositories'>;
type ThreadId = Id<'threads'>;

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Architect Agent</p>
            <h1 className="text-lg font-semibold">GitHub 開源分析 Agent</h1>
          </div>
          <AuthButton />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <Authenticated>
          <WorkspaceApp />
        </Authenticated>
        <Unauthenticated>
          <SignedOutView />
        </Unauthenticated>
      </main>
    </div>
  );
}

function WorkspaceApp() {
  const repositories = useQuery(api.repositories.listRepositories);
  const createRepositoryImport = useMutation(api.repositories.createRepositoryImport);
  const requestDeepAnalysis = useMutation(api.analysis.requestDeepAnalysis);
  const sendMessage = useMutation(api.chat.sendMessage);
  const createThread = useMutation(api.chat.createThread);
  const requestSandboxCleanup = useMutation(api.ops.requestSandboxCleanup);

  const [selectedRepositoryId, setSelectedRepositoryId] = useState<RepositoryId | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState('請整理這個 repository 的主要模組、資料流與風險。');
  const [chatInput, setChatInput] = useState('');
  const [chatMode, setChatMode] = useState<'fast' | 'deep'>('fast');
  const [isSending, setIsSending] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false);
  const [isCleaningSandbox, setIsCleaningSandbox] = useState(false);

  useEffect(() => {
    if (!repositories || repositories.length === 0) {
      return;
    }

    if (!selectedRepositoryId || !repositories.some((repository) => repository._id === selectedRepositoryId)) {
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

    const preferredThreadId = workspace.repository.defaultThreadId ?? workspace.threads[0]?._id;
    if (!selectedThreadId || !workspace.threads.some((thread) => thread._id === selectedThreadId)) {
      setSelectedThreadId(preferredThreadId ?? null);
    }
  }, [selectedThreadId, workspace]);

  const messages = useQuery(api.chat.listMessages, selectedThreadId ? { threadId: selectedThreadId } : 'skip');
  const artifacts = useMemo(() => workspace?.artifacts ?? [], [workspace?.artifacts]);
  const jobs = useMemo(() => workspace?.jobs ?? [], [workspace?.jobs]);

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
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
      setSelectedRepositoryId(result.repositoryId);
      if (result.defaultThreadId) {
        setSelectedThreadId(result.defaultThreadId);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '匯入失敗。');
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThreadId || !chatInput.trim()) {
      return;
    }

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
    if (!selectedRepositoryId) {
      return;
    }

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
    if (!selectedRepositoryId) {
      return;
    }

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
    if (!selectedRepositoryId) {
      return;
    }

    setIsCleaningSandbox(true);
    try {
      await requestSandboxCleanup({
        repositoryId: selectedRepositoryId,
      });
    } finally {
      setIsCleaningSandbox(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Import</p>
            <h2 className="mt-1 text-base font-semibold">下載 GitHub repository</h2>
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              void handleImport(event);
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">GitHub URL</span>
              <input
                value={importUrl}
                onChange={(event) => setImportUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Branch（可選）</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
              />
            </label>
            <Button className="w-full" disabled={isImporting || !importUrl.trim()} type="submit">
              {isImporting ? '建立匯入工作中...' : '開始匯入'}
            </Button>
            {importError ? <p className="text-xs text-destructive">{importError}</p> : null}
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Repositories</p>
              <h2 className="mt-1 text-base font-semibold">工作區</h2>
            </div>
            <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
              {repositories?.length ?? 0}
            </span>
          </div>
          <div className="space-y-2">
            {repositories === undefined ? (
              <p className="text-sm text-muted-foreground">載入中...</p>
            ) : repositories.length === 0 ? (
              <p className="text-sm text-muted-foreground">先匯入一個 public GitHub repo。</p>
            ) : (
              repositories.map((repository) => (
                <button
                  key={repository._id}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedRepositoryId === repository._id
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-background hover:border-foreground'
                  }`}
                  onClick={() => setSelectedRepositoryId(repository._id)}
                >
                  <p className="text-sm font-semibold">{repository.sourceRepoFullName}</p>
                  <p
                    className={`mt-1 text-xs ${
                      selectedRepositoryId === repository._id ? 'text-background/80' : 'text-muted-foreground'
                    }`}
                  >
                    {repository.detectedFramework ?? '尚未偵測 framework'}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <section className="min-w-0 space-y-4">
        {!workspace ? (
          <EmptyWorkspace />
        ) : (
          <>
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</p>
                  <h2 className="mt-1 truncate text-2xl font-semibold">{workspace.repository.sourceRepoFullName}</h2>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    {workspace.repository.summary ?? 'Repository 已建立，等待第一次分析結果。'}
                  </p>
                </div>
                <div className="grid gap-2 text-sm text-muted-foreground lg:text-right">
                  <p>Framework: {workspace.repository.detectedFramework ?? 'Unknown'}</p>
                  <p>Files indexed: {workspace.fileCount}</p>
                  <p>Status: {workspace.repository.importStatus}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  disabled={isRunningAnalysis || !analysisPrompt.trim()}
                  onClick={() => {
                    void handleRunAnalysis();
                  }}
                  variant="outline"
                >
                  {isRunningAnalysis ? '建立深度分析中...' : '建立深度分析'}
                </Button>
                <Button
                  disabled={isCleaningSandbox}
                  onClick={() => {
                    void handleCleanupSandbox();
                  }}
                  variant="ghost"
                >
                  {isCleaningSandbox ? '清理中...' : '清理 sandbox'}
                </Button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <MetricCard label="Languages" value={workspace.repository.detectedLanguages.join(', ') || 'Unknown'} />
                <MetricCard
                  label="Package managers"
                  value={workspace.repository.packageManagers.join(', ') || 'Unknown'}
                />
                <MetricCard label="Entrypoints" value={workspace.repository.entrypoints.join(', ') || 'Not detected'} />
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_420px]">
              <div className="space-y-4">
                <section className="rounded-2xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Chat</p>
                      <h3 className="mt-1 text-base font-semibold">分析對話</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={chatMode}
                        onChange={(event) => setChatMode(event.target.value as 'fast' | 'deep')}
                        className="rounded-xl border border-border bg-background px-3 py-2 text-xs"
                      >
                        <option value="fast">Fast path</option>
                        <option value="deep">Deep path</option>
                      </select>
                      <Button
                        disabled={isCreatingThread}
                        onClick={() => {
                          void handleCreateThread();
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {isCreatingThread ? '建立中...' : '新對話'}
                      </Button>
                    </div>
                  </div>

                  <div className="mb-3 flex gap-2 overflow-auto pb-1">
                    {workspace.threads.map((thread) => (
                      <button
                        key={thread._id}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          selectedThreadId === thread._id
                            ? 'border-foreground bg-muted text-foreground'
                            : 'border-border'
                        }`}
                        onClick={() => setSelectedThreadId(thread._id)}
                      >
                        {thread.title}
                      </button>
                    ))}
                  </div>

                  <div className="h-112 space-y-3 overflow-y-auto rounded-2xl border border-border bg-background p-3">
                    {messages === undefined ? (
                      <p className="text-sm text-muted-foreground">載入對話中...</p>
                    ) : messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        先問一個問題，例如「這個專案的主要模組怎麼分層？」
                      </p>
                    ) : (
                      messages.map((message) => <MessageBubble key={message._id} message={message} />)
                    )}
                  </div>

                  <form
                    className="mt-3 space-y-3"
                    onSubmit={(event) => {
                      void handleSendMessage(event);
                    }}
                  >
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="問它這個 open source 的架構、模組邊界、資料流、風險..."
                      className="min-h-28 w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm outline-none focus:border-foreground"
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        `fast` 走已索引資料，`deep` 適合需要更精準的 repo 現查。
                      </p>
                      <Button disabled={isSending || !selectedThreadId || !chatInput.trim()} type="submit">
                        {isSending ? '送出中...' : '送出問題'}
                      </Button>
                    </div>
                  </form>
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Jobs</p>
                  <h3 className="mt-1 text-base font-semibold">任務追蹤</h3>
                  <div className="mt-3 space-y-2">
                    {jobs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">目前還沒有任務。</p>
                    ) : (
                      jobs.map((job) => <JobRow key={job._id} job={job} />)
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Artifacts</p>
                  <h3 className="mt-1 text-base font-semibold">分析產物</h3>
                  <div className="mt-3 space-y-2">
                    {artifacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        匯入完成後會在這裡顯示 manifest、README 與架構摘要。
                      </p>
                    ) : (
                      artifacts.map((artifact) => (
                        <article key={artifact._id} className="rounded-xl border border-border bg-background p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold">{artifact.title}</h4>
                              <p className="mt-1 text-xs text-muted-foreground">{artifact.summary}</p>
                            </div>
                            <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase text-muted-foreground">
                              {artifact.kind}
                            </span>
                          </div>
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                            {artifact.contentMarkdown}
                          </pre>
                        </article>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Deep Analysis</p>
                  <h3 className="mt-1 text-base font-semibold">要求 sandbox 深入檢查</h3>
                  <textarea
                    value={analysisPrompt}
                    onChange={(event) => setAnalysisPrompt(event.target.value)}
                    className="mt-3 min-h-28 w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm outline-none focus:border-foreground"
                  />
                  <Button
                    className="mt-3 w-full"
                    disabled={isRunningAnalysis || !analysisPrompt.trim()}
                    onClick={() => {
                      void handleRunAnalysis();
                    }}
                  >
                    {isRunningAnalysis ? '建立分析工作中...' : '執行深度分析'}
                  </Button>
                </section>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AuthButton() {
  const { user, signIn, signOut } = useAuth();

  return user ? (
    <Button variant="outline" onClick={() => signOut()}>
      Sign out
    </Button>
  ) : (
    <Button onClick={() => void signIn()}>Sign in</Button>
  );
}

function SignedOutView() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 rounded-3xl border border-border bg-card px-8 py-12 text-center">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Open source workspace</p>
        <h2 className="text-3xl font-semibold">把 GitHub repository 變成可對話的系統分析工作台</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        登入後你可以匯入 public GitHub repo、建立 sandbox 任務、查看分析 artifact，並用 chatbot 問系統設計問題。
      </p>
      <AuthButton />
    </div>
  );
}

function EmptyWorkspace() {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card p-8">
      <h2 className="text-xl font-semibold">準備好匯入第一個 repository</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        左側輸入 GitHub repo URL 後，系統會建立 Convex 工作記錄、啟動 Daytona sandbox、clone 原始碼，並產生第一批
        manifest 與 architecture artifact。
      </p>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function MessageBubble({ message }: { message: Doc<'messages'> }) {
  return (
    <article
      className={`rounded-2xl border p-3 ${
        message.role === 'user'
          ? 'ml-10 border-foreground bg-foreground text-background'
          : 'mr-10 border-border bg-card'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] opacity-70">{message.role}</p>
        <p className="text-[10px] opacity-70">{message.status}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{message.content || '...'}</p>
      {message.errorMessage ? <p className="mt-2 text-xs text-destructive">{message.errorMessage}</p> : null}
    </article>
  );
}

function JobRow({ job }: { job: Doc<'jobs'> }) {
  return (
    <article className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{job.kind}</p>
          <p className="text-xs text-muted-foreground">
            {job.stage} · {Math.round(job.progress * 100)}%
          </p>
        </div>
        <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase text-muted-foreground">
          {job.status}
        </span>
      </div>
      {job.outputSummary ? <p className="mt-2 text-xs text-muted-foreground">{job.outputSummary}</p> : null}
      {job.errorMessage ? <p className="mt-2 text-xs text-destructive">{job.errorMessage}</p> : null}
      <p className="mt-2 text-[10px] text-muted-foreground">{formatTimestamp(job._creationTime)}</p>
    </article>
  );
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
