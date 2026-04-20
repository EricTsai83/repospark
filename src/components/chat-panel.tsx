import { LightningIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import type { Doc } from '../../convex/_generated/dataModel';
import { AppNotice } from '@/components/app-notice';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ThreadId, ChatMode, DeepModeStatus } from '@/lib/types';

const MODE_OPTIONS: ReadonlyArray<{
  value: ChatMode;
  label: string;
  caption: string;
  icon: typeof LightningIcon;
}> = [
  { value: 'fast', label: 'Fast', caption: 'uses summary', icon: LightningIcon },
  { value: 'deep', label: 'Thorough', caption: 'reads live code', icon: MagnifyingGlassIcon },
];

export function ChatPanel({
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
  selectedThreadId: ThreadId | null;
  messages: Doc<'messages'>[] | undefined;
  isChatLoading: boolean;
  chatInput: string;
  setChatInput: (v: string) => void;
  chatMode: ChatMode;
  setChatMode: (v: ChatMode) => void;
  isSending: boolean;
  onSendMessage: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  deepModeAvailable: boolean;
  deepModeStatus: DeepModeStatus | null;
  isSyncing: boolean;
  onSync: () => void;
}) {
  const hasMessages = (messages?.length ?? 0) > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {!isChatLoading && chatMode === 'deep' && !deepModeAvailable ? (
            <AppNotice
              title={getDeepModeTitle(deepModeStatus?.reasonCode)}
              message={
                deepModeStatus?.message ??
                'Thorough mode is unavailable right now. Sync the repository to provision a fresh sandbox, or switch to Fast mode.'
              }
              tone="warning"
              actionLabel={isSyncing ? 'Syncing…' : 'Sync now'}
              actionDisabled={isSyncing}
              onAction={onSync}
            />
          ) : null}
          {isChatLoading ? null : !hasMessages ? (
            <EmptyChatHint />
          ) : (
            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {messages!.map((message) => (
                <MessageBubble key={message._id} message={message} />
              ))}
            </div>
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
            <Select value={chatMode} onValueChange={(v) => setChatMode(v as ChatMode)}>
              <SelectTrigger
                aria-label="Answer mode"
                className="h-8 w-auto gap-1.5 border-transparent bg-transparent px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {(() => {
                  const current = MODE_OPTIONS.find((o) => o.value === chatMode) ?? MODE_OPTIONS[0];
                  const Icon = current.icon;
                  return (
                    <>
                      <Icon size={12} weight="bold" />
                      <span className="font-medium text-foreground">{current.label}</span>
                      <span>answer</span>
                    </>
                  );
                })()}
              </SelectTrigger>
              <SelectContent align="start">
                {MODE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-1.5">
                        <Icon size={12} weight="bold" />
                        <span className="font-medium">{option.label}</span>
                        <span className="ml-1 text-muted-foreground">{option.caption}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              variant="default"
              size="sm"
              className="min-w-24"
              disabled={isSending || !selectedThreadId || !chatInput.trim()}
            >
              <PaperPlaneTiltIcon weight="bold" />
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
    <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="text-sm font-medium text-foreground">Ask anything about this repo</p>
      <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {hints.map((hint) => (
          <li key={hint}>"{hint}"</li>
        ))}
      </ul>
    </div>
  );
}

function MessageBubble({ message }: { message: Doc<'messages'> }) {
  const isUser = message.role === 'user';
  const statusLabel = getMessageStatusLabel(message.status);
  return (
    <Card className={cn('p-4', isUser ? 'bg-muted border-transparent' : 'border-transparent bg-transparent px-0')}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{message.role}</p>
        <p className="text-[10px] text-muted-foreground">{statusLabel}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{message.content || '…'}</p>
      {message.errorMessage ? <p className="mt-2 text-xs text-destructive">{message.errorMessage}</p> : null}
    </Card>
  );
}

function getDeepModeTitle(reasonCode: DeepModeStatus['reasonCode'] | undefined) {
  switch (reasonCode) {
    case 'sandbox_provisioning':
      return 'Sandbox still provisioning';
    case 'missing_sandbox':
      return 'Sandbox not ready yet';
    case 'sandbox_unavailable':
      return 'Sandbox no longer available';
    case 'sandbox_expired':
    default:
      return 'Sandbox expired';
  }
}

function getMessageStatusLabel(status: Doc<'messages'>['status']) {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'streaming':
      return 'Generating';
    case 'completed':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}
