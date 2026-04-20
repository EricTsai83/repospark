import { memo, type FormEvent, type ReactNode } from 'react';
import type { Doc } from '../../convex/_generated/dataModel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatPanel } from '@/components/chat-panel';
import { JobRow } from '@/components/job-row';
import type { ChatMode, DeepModeStatus, ThreadId } from '@/lib/types';

export function RepositoryTabs({
  activeTab,
  onActiveTabChange,
  jobs,
  artifacts,
  selectedThreadId,
  messages,
  isChatLoading,
  chatInput,
  setChatInput,
  chatMode,
  setChatMode,
  isSending,
  onSendMessage,
  deepModeAvailable,
  deepModeStatus,
  isSyncing,
  onSync,
}: {
  activeTab: 'chat' | 'jobs' | 'artifacts';
  onActiveTabChange: (value: 'chat' | 'jobs' | 'artifacts') => void;
  jobs: Doc<'jobs'>[] | undefined;
  artifacts: Doc<'analysisArtifacts'>[] | undefined;
  selectedThreadId: ThreadId | null;
  messages: Doc<'messages'>[] | undefined;
  isChatLoading: boolean;
  chatInput: string;
  setChatInput: (value: string) => void;
  chatMode: ChatMode;
  setChatMode: (value: ChatMode) => void;
  isSending: boolean;
  onSendMessage: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  deepModeAvailable: boolean;
  deepModeStatus: DeepModeStatus | null;
  isSyncing: boolean;
  onSync: () => void;
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onActiveTabChange(value as typeof activeTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <MainTabsList jobCount={jobs?.length} artifactCount={artifacts?.length} />

      <TabsContent value="chat">
        <ChatPanel
          selectedThreadId={selectedThreadId}
          messages={messages}
          isChatLoading={isChatLoading}
          chatInput={chatInput}
          setChatInput={setChatInput}
          chatMode={chatMode}
          setChatMode={setChatMode}
          isSending={isSending}
          onSendMessage={onSendMessage}
          deepModeAvailable={deepModeAvailable}
          deepModeStatus={deepModeStatus}
          isSyncing={isSyncing}
          onSync={onSync}
        />
      </TabsContent>

      <TabsContent value="jobs">
        <ListPanel emptyText="No jobs yet." isLoading={jobs === undefined} isEmpty={jobs !== undefined && jobs.length === 0}>
          {jobs?.map((job) => (
            <JobRow key={job._id} job={job} />
          ))}
        </ListPanel>
      </TabsContent>

      <TabsContent value="artifacts">
        <ListPanel
          emptyText="Once the import finishes, manifests, READMEs, and architecture summaries appear here."
          isLoading={artifacts === undefined}
          isEmpty={artifacts !== undefined && artifacts.length === 0}
        >
          {artifacts?.map((artifact) => (
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
  );
}

function CountBadge({ count }: { count?: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-7 items-center justify-center bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">
      {count === undefined ? (
        <span className="invisible">0</span>
      ) : (
        <span className="animate-in fade-in duration-300">{count}</span>
      )}
    </span>
  );
}

const MainTabsList = memo(function MainTabsList({
  jobCount,
  artifactCount,
}: {
  jobCount?: number;
  artifactCount?: number;
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
  isLoading,
  isEmpty,
}: {
  emptyText: string;
  children: ReactNode;
  isLoading: boolean;
  isEmpty: boolean;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-6">
        {isLoading ? null : isEmpty ? (
          <p className="text-sm text-muted-foreground animate-in fade-in duration-300">{emptyText}</p>
        ) : (
          <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
