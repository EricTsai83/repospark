import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { Authenticated, Unauthenticated, useMutation, useQuery } from 'convex/react';
import { GithubLogo, Plus, Robot, MagnifyingGlass } from '@phosphor-icons/react';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { ModeToggle } from './components/mode-toggle';

type RepositoryId = Id<'repositories'>;
type ThreadId = Id<'threads'>;

export default function App() {
  return (
    <div className="bc-appBg flex h-dvh overflow-hidden">
      <Authenticated>
        <WorkspaceShell />
      </Authenticated>
      <Unauthenticated>
        <SignedOutShell />
      </Unauthenticated>
    </div>
  );
}

function WorkspaceShell() {
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
      setImportError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  }

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
      <aside className="bc-sidebar w-72 shrink-0 hidden lg:block">
        <div className="bc-sidebar-inner">
          <div className="bc-sidebar-section">
            <div className="bc-chip w-full justify-start">
              <div className="bc-logoMark h-9 w-9">
                <Robot size={16} weight="bold" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="bc-title text-sm">Architect Agent</div>
                <div className="bc-subtitle text-[11px]">Grounded codebase answers</div>
              </div>
            </div>
          </div>

          <div className="bc-sidebar-section">
            <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider opacity-60">
              Import
            </div>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                void handleImport(e);
              }}
            >
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="bc-input text-xs"
              />
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="branch (optional)"
                className="bc-input text-xs"
              />
              <button
                type="submit"
                className="bc-btn bc-btn-primary w-full py-1.5 text-xs"
                disabled={isImporting || !importUrl.trim()}
              >
                <Plus size={14} weight="bold" />
                {isImporting ? 'Queuing import…' : 'Import repository'}
              </button>
              {importError ? (
                <p className="text-xs text-[hsl(var(--bc-error))]">{importError}</p>
              ) : null}
            </form>
          </div>

          <div className="bc-sidebar-section">
            <div className="bc-sidebar-search">
              <MagnifyingGlass size={14} className="bc-muted shrink-0" weight="bold" />
              <input
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search repositories…"
                className="bc-sidebar-search-input outline-none"
              />
            </div>
          </div>

          <div className="bc-thread-list" aria-live="polite">
            {repositories === undefined ? (
              <div className="px-3 py-2 text-xs bc-muted">Loading…</div>
            ) : filteredRepos.length === 0 ? (
              <div className="px-3 py-2 text-xs">
                <div className="font-semibold">No repositories</div>
                <p className="bc-muted mt-1">Import a public GitHub repo to get started.</p>
              </div>
            ) : (
              filteredRepos.map((repository) => (
                <button
                  key={repository._id}
                  type="button"
                  onClick={() => setSelectedRepositoryId(repository._id)}
                  className={
                    selectedRepositoryId === repository._id
                      ? 'bc-thread-item bc-thread-item-active'
                      : 'bc-thread-item'
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {repository.sourceRepoFullName}
                    </div>
                    <div className="bc-muted mt-1 text-[11px] truncate">
                      {repository.detectedFramework ?? 'Framework not detected yet'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="bc-sidebar-section bc-sidebar-footer">
            <div className="flex items-center gap-2">
              <ModeToggle />
              <a
                className="bc-iconBtn"
                href="https://github.com"
                rel="noreferrer"
                target="_blank"
                aria-label="GitHub"
                title="GitHub"
              >
                <GithubLogo size={18} weight="bold" />
              </a>
              <div className="ml-auto">
                <AuthButton />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {!workspace ? (
          <EmptyWorkspace />
        ) : (
          <>
            <div className="border-b border-border bg-[hsl(var(--bc-bg))]">
              <div className="flex flex-col gap-3 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="bc-kicker">
                    <span className="bc-kickerDot" />
                    Workspace
                  </div>
                  <h1 className="bc-h1 mt-2 truncate text-2xl">
                    {workspace.repository.sourceRepoFullName}
                  </h1>
                  <p className="bc-muted mt-2 max-w-3xl text-sm">
                    {workspace.repository.summary ??
                      'Repository created. Waiting for the first analysis to complete.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="bc-btn"
                    disabled={isRunningAnalysis || !analysisPrompt.trim()}
                    onClick={() => void handleRunAnalysis()}
                  >
                    {isRunningAnalysis ? 'Queuing…' : 'Run deep analysis'}
                  </button>
                  <button
                    type="button"
                    className="bc-btn"
                    disabled={isCleaningSandbox}
                    onClick={() => void handleCleanupSandbox()}
                  >
                    {isCleaningSandbox ? 'Cleaning…' : 'Clean sandbox'}
                  </button>
                </div>
              </div>

              <div className="grid gap-px border-t border-border bg-border md:grid-cols-4">
                <MetricCell label="Status" value={workspace.repository.importStatus} />
                <MetricCell
                  label="Framework"
                  value={workspace.repository.detectedFramework ?? 'Unknown'}
                />
                <MetricCell label="Files indexed" value={String(workspace.fileCount)} />
                <MetricCell
                  label="Languages"
                  value={workspace.repository.detectedLanguages.join(', ') || 'Unknown'}
                />
              </div>

              <nav className="flex items-center gap-1 px-4 pt-2">
                {(
                  [
                    ['chat', 'Chat'],
                    ['jobs', `Jobs · ${jobs.length}`],
                    ['artifacts', `Artifacts · ${artifacts.length}`],
                    ['analysis', 'Deep analysis'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`px-3 py-2 text-xs font-semibold transition ${
                      activeTab === id
                        ? 'border-b-2 border-[hsl(var(--bc-accent))] text-[hsl(var(--bc-fg))]'
                        : 'border-b-2 border-transparent text-[hsl(var(--bc-fg-muted))] hover:text-[hsl(var(--bc-fg))]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {activeTab === 'chat' ? (
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
              ) : activeTab === 'jobs' ? (
                <ListPanel emptyText="No jobs yet.">
                  {jobs.map((job) => (
                    <JobRow key={job._id} job={job} />
                  ))}
                </ListPanel>
              ) : activeTab === 'artifacts' ? (
                <ListPanel emptyText="Once the import finishes, manifests, READMEs, and architecture summaries appear here.">
                  {artifacts.map((artifact) => (
                    <article key={artifact._id} className="bc-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold truncate">{artifact.title}</h4>
                          <p className="mt-1 text-xs bc-muted">{artifact.summary}</p>
                        </div>
                        <span className="bc-badge text-[10px] uppercase">{artifact.kind}</span>
                      </div>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs bc-muted">
                        {artifact.contentMarkdown}
                      </pre>
                    </article>
                  ))}
                </ListPanel>
              ) : (
                <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-6">
                  <div className="bc-kicker">
                    <span className="bc-kickerDot" />
                    Deep analysis prompt
                  </div>
                  <p className="bc-muted mt-2 text-sm">
                    Send a sandbox investigation. The deep path re-reads files inside the sandbox.
                  </p>
                  <textarea
                    value={analysisPrompt}
                    onChange={(e) => setAnalysisPrompt(e.target.value)}
                    className="bc-input mt-4 min-h-40"
                  />
                  <button
                    type="button"
                    className="bc-btn bc-btn-primary mt-3"
                    disabled={isRunningAnalysis || !analysisPrompt.trim()}
                    onClick={() => void handleRunAnalysis()}
                  >
                    {isRunningAnalysis ? 'Queuing…' : 'Run deep analysis'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
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
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 overflow-x-auto">
        {workspace.threads.map((thread) => (
          <button
            key={thread._id}
            type="button"
            onClick={() => setSelectedThreadId(thread._id)}
            className={`shrink-0 border px-3 py-1.5 text-xs transition ${
              selectedThreadId === thread._id
                ? 'border-[hsl(var(--bc-accent))] bg-[hsl(var(--bc-surface-2))] text-[hsl(var(--bc-fg))]'
                : 'border-[hsl(var(--bc-border))] bg-transparent text-[hsl(var(--bc-fg-muted))] hover:text-[hsl(var(--bc-fg))]'
            }`}
          >
            {thread.title}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <select
            value={chatMode}
            onChange={(e) => setChatMode(e.target.value as 'fast' | 'deep')}
            className="bc-input py-1.5 text-xs"
            style={{ width: 'auto' }}
          >
            <option value="fast">Fast path</option>
            <option value="deep">Deep path</option>
          </select>
          <button
            type="button"
            className="bc-btn py-1.5 text-xs"
            disabled={isCreatingThread}
            onClick={() => void onCreateThread()}
          >
            <Plus size={12} weight="bold" />
            {isCreatingThread ? 'Creating…' : 'New thread'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {messages === undefined ? (
            <p className="text-sm bc-muted">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm bc-muted">
              Try asking something like: “How is the codebase layered, and where do requests flow?”
            </p>
          ) : (
            messages.map((message) => <MessageBubble key={message._id} message={message} />)
          )}
        </div>
      </div>

      <div className="border-t border-border bg-[hsl(var(--bc-bg))]">
        <form
          className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-4"
          onSubmit={(e) => {
            void onSendMessage(e);
          }}
        >
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask about architecture, module boundaries, data flow, risks…"
            className="bc-input min-h-24 resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs bc-muted">
              <span className="font-semibold text-[hsl(var(--bc-fg))]">Fast</span> uses the indexed
              context. <span className="font-semibold text-[hsl(var(--bc-fg))]">Deep</span> re-reads
              the repo in the sandbox.
            </p>
            <button
              type="submit"
              className="bc-btn bc-btn-primary"
              disabled={isSending || !selectedThreadId || !chatInput.trim()}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ListPanel({
  emptyText,
  children,
}: {
  emptyText: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.length === 0;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-6">
        {isEmpty ? <p className="text-sm bc-muted">{emptyText}</p> : children}
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[hsl(var(--bc-bg))] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider bc-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function MessageBubble({ message }: { message: Doc<'messages'> }) {
  const isUser = message.role === 'user';
  return (
    <article className={isUser ? 'chat-message-user' : 'chat-message-assistant'}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider bc-muted">
          {message.role}
        </p>
        <p className="text-[10px] bc-muted">{message.status}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{message.content || '…'}</p>
      {message.errorMessage ? (
        <p className="mt-2 text-xs text-[hsl(var(--bc-error))]">{message.errorMessage}</p>
      ) : null}
    </article>
  );
}

function JobRow({ job }: { job: Doc<'jobs'> }) {
  return (
    <article className="bc-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{job.kind}</p>
          <p className="text-xs bc-muted">
            {job.stage} · {Math.round(job.progress * 100)}%
          </p>
        </div>
        <span className="bc-badge text-[10px] uppercase">{job.status}</span>
      </div>
      {job.outputSummary ? (
        <p className="mt-2 text-xs bc-muted">{job.outputSummary}</p>
      ) : null}
      {job.errorMessage ? (
        <p className="mt-2 text-xs text-[hsl(var(--bc-error))]">{job.errorMessage}</p>
      ) : null}
      <p className="mt-2 text-[10px] bc-muted">{formatTimestamp(job._creationTime)}</p>
    </article>
  );
}

function AuthButton() {
  const { user, signIn, signOut } = useAuth();
  return user ? (
    <button type="button" className="bc-btn text-xs" onClick={() => signOut()}>
      Sign out
    </button>
  ) : (
    <button type="button" className="bc-btn bc-btn-primary text-xs" onClick={() => void signIn()}>
      Sign in
    </button>
  );
}

function EmptyWorkspace() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
      <div className="bc-logoMark h-16 w-16">
        <Robot size={32} weight="bold" />
      </div>
      <div>
        <h1 className="bc-h1 text-2xl">Import your first repository</h1>
        <p className="bc-muted mt-2 max-w-md text-sm">
          Paste a GitHub URL on the left. We will clone the source, spin up a Daytona sandbox, and
          ship the first batch of manifest and architecture artifacts.
        </p>
      </div>
    </div>
  );
}

function SignedOutShell() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bc-header">
        <div className="bc-container flex items-center justify-between gap-4 py-4">
          <div className="bc-chip">
            <div className="bc-logoMark h-9 w-9">
              <Robot size={16} weight="bold" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="bc-title text-sm">Architect Agent</div>
              <div className="bc-subtitle text-[11px]">Grounded codebase answers</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="bc-container flex flex-1 flex-col gap-14 py-12">
        <section className="flex flex-col gap-5">
          <div className="bc-kicker">
            <span className="bc-kickerDot" />
            Open-source workspace
          </div>
          <h1 className="bc-h1 max-w-3xl text-balance text-5xl sm:text-6xl">
            Ask the repo,{' '}
            <span className="text-[hsl(var(--bc-accent))]">not the internet.</span>
          </h1>
          <p className="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
            Import a public repository, let the sandbox boot, and get grounded answers about its
            architecture, data flow, and risk areas — not generic guesses from a model that never
            saw the code.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AuthButton />
            <a
              className="bc-chip"
              href="https://github.com"
              rel="noreferrer"
              target="_blank"
            >
              <GithubLogo size={16} weight="bold" />
              View on GitHub
            </a>
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
            <div key={card.label} className="bc-card flex h-full flex-col">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="bc-badge bc-badgeAccent">
                  <span className="bc-kickerDot" />
                  <span>{card.label}</span>
                </div>
                <div className="text-xs font-semibold uppercase tracking-wider bc-muted">
                  {card.eyebrow}
                </div>
              </div>
              <div className="flex flex-1 flex-col px-5 pb-5">
                <h2 className="text-lg font-semibold">{card.title}</h2>
                <p className="bc-prose mt-2 text-sm">{card.body}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
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
