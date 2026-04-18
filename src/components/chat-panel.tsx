import { WarningCircleIcon, PaperPlaneTiltIcon, ArrowsClockwiseIcon } from '@phosphor-icons/react';
import type { Doc } from '../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ThreadId, ChatMode } from '@/lib/types';

export function ChatPanel({
  selectedThreadId,
  messages,
  chatInput,
  setChatInput,
  chatMode,
  setChatMode,
  isSending,
  onSendMessage,
  deepModeAvailable,
  isSyncing,
  onSync,
}: {
  selectedThreadId: ThreadId | null;
  messages: Doc<'messages'>[] | undefined;
  chatInput: string;
  setChatInput: (v: string) => void;
  chatMode: ChatMode;
  setChatMode: (v: ChatMode) => void;
  isSending: boolean;
  onSendMessage: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  deepModeAvailable: boolean;
  isSyncing: boolean;
  onSync: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {chatMode === 'deep' && !deepModeAvailable ? (
            <div className="flex items-start gap-3 border border-border bg-muted/50 px-4 py-3">
              <WarningCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Sandbox expired</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Deep mode is unavailable because the sandbox has been reclaimed.
                  Sync the repository to provision a fresh sandbox, or switch to Quick mode.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-1.5 text-xs"
                  disabled={isSyncing}
                  onClick={onSync}
                >
                  <ArrowsClockwiseIcon weight="bold" className={isSyncing ? 'animate-spin' : ''} />
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </Button>
              </div>
            </div>
          ) : null}
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
            <Select value={chatMode} onValueChange={(v) => setChatMode(v as ChatMode)}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">
                  <span className="font-medium">Quick</span>
                  <span className="ml-1.5 text-muted-foreground">indexed data</span>
                </SelectItem>
                <SelectItem value="deep">
                  <span className="font-medium">Deep</span>
                  <span className="ml-1.5 text-muted-foreground">live sandbox</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="submit"
              variant="default"
              size="sm"
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
    <div className="flex flex-col items-center gap-3 py-16 text-center">
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
  return (
    <Card className={cn('p-4', isUser ? 'bg-muted border-transparent' : 'border-transparent bg-transparent px-0')}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{message.role}</p>
        <p className="text-[10px] text-muted-foreground">{message.status}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{message.content || '…'}</p>
      {message.errorMessage ? <p className="mt-2 text-xs text-destructive">{message.errorMessage}</p> : null}
    </Card>
  );
}
