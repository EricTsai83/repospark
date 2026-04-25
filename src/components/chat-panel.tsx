import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import {
  ChatCircleIcon,
  CubeIcon,
  FileTextIcon,
  PaperPlaneTiltIcon,
} from '@phosphor-icons/react';
import type { Doc } from '../../convex/_generated/dataModel';
import { AppNotice } from '@/components/app-notice';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ActiveMessageStream, ThreadId, ChatMode, SandboxModeStatus } from '@/lib/types';

/**
 * Static catalogue of every mode the selector can render. Order is stable and
 * doubles as the visual order of the pill bar so the user's eye learns the
 * capability ladder left-to-right: discuss → docs → sandbox, lowest-context
 * to highest-context (and lowest-cost to highest-cost).
 *
 * Each caption is the short user-facing answer to "what does this mode read
 * from?". The disabled-mode tooltip (rendered by the resolver via
 * `disabledModeReasons`) takes over when the option isn't usable.
 */
const MODE_CATALOG: ReadonlyArray<{
  value: ChatMode;
  label: string;
  caption: string;
  icon: typeof ChatCircleIcon;
}> = [
  {
    value: 'discuss',
    label: 'Discuss',
    caption: 'no code reference',
    icon: ChatCircleIcon,
  },
  {
    value: 'docs',
    label: 'Docs',
    caption: 'searches your design docs',
    icon: FileTextIcon,
  },
  {
    value: 'sandbox',
    label: 'Sandbox',
    caption: 'runs in a sandbox against live code',
    icon: CubeIcon,
  },
];

const EMPTY_CHAT_OWL = ['   ^...^   ', '  / o,o \\  ', '  |):::(|  ', '====w=w===='].join('\n');

const EMPTY_CHAT_OWL_BLINK = ['   ^...^   ', '  / -,- \\  ', '  |):::(|  ', '====w=w===='].join('\n');

export function ChatPanel({
  selectedThreadId,
  messages,
  activeMessageStream,
  isChatLoading,
  chatInput,
  setChatInput,
  chatMode,
  setChatMode,
  availableModes,
  disabledModeReasons,
  isSending,
  onSendMessage,
  sandboxModeStatus,
  isSyncing,
  onSync,
}: {
  selectedThreadId: ThreadId | null;
  messages: Doc<'messages'>[] | undefined;
  activeMessageStream: ActiveMessageStream | null | undefined;
  isChatLoading: boolean;
  chatInput: string;
  setChatInput: (v: string) => void;
  chatMode: ChatMode;
  setChatMode: (v: ChatMode) => void;
  availableModes: readonly ChatMode[];
  disabledModeReasons: Partial<Record<ChatMode, string>>;
  isSending: boolean;
  onSendMessage: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  sandboxModeStatus: SandboxModeStatus | null;
  isSyncing: boolean;
  onSync: () => void;
}) {
  const hasMessages = (messages?.length ?? 0) > 0;
  const availableModeSet = new Set(availableModes);
  const sandboxModeAvailable = sandboxModeStatus?.reasonCode === 'available';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-6 py-6">
          {!isChatLoading && chatMode === 'sandbox' && sandboxModeStatus && !sandboxModeAvailable ? (
            <AppNotice
              title={getSandboxStatusTitle(sandboxModeStatus?.reasonCode)}
              message={
                sandboxModeStatus?.message ??
                'Sandbox mode is unavailable right now. Sync the repository to provision a fresh sandbox, or switch to a lighter mode.'
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
                <MessageBubble key={message._id} message={message} activeMessageStream={activeMessageStream ?? null} />
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
            <ModePillBar
              chatMode={chatMode}
              setChatMode={setChatMode}
              availableModeSet={availableModeSet}
              disabledModeReasons={disabledModeReasons}
            />
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

/**
 * Pill-bar mode selector. Shows all three modes side by side so the capability
 * ladder is visible at a glance (PRD US 11–14). Modes that the resolver
 * disabled render as `aria-disabled` pills wrapped in a Tooltip whose content
 * is the resolver-provided unlock hint.
 */
function ModePillBar({
  chatMode,
  setChatMode,
  availableModeSet,
  disabledModeReasons,
}: {
  chatMode: ChatMode;
  setChatMode: (v: ChatMode) => void;
  availableModeSet: Set<ChatMode>;
  disabledModeReasons: Partial<Record<ChatMode, string>>;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (targetIndex: number) => {
    const targetOption = MODE_CATALOG[targetIndex];
    if (!targetOption || !availableModeSet.has(targetOption.value)) {
      return;
    }
    setChatMode(targetOption.value);
    buttonRefs.current[targetIndex]?.focus();
  };

  const getWrappedAvailableIndex = (currentIndex: number, step: -1 | 1) => {
    for (let offset = 1; offset <= MODE_CATALOG.length; offset += 1) {
      const nextIndex =
        (currentIndex + offset * step + MODE_CATALOG.length) % MODE_CATALOG.length;
      if (availableModeSet.has(MODE_CATALOG[nextIndex]!.value)) {
        return nextIndex;
      }
    }
    return currentIndex;
  };

  const getBoundaryAvailableIndex = (direction: 'first' | 'last') => {
    const orderedIndexes =
      direction === 'first'
        ? MODE_CATALOG.map((_, index) => index)
        : MODE_CATALOG.map((_, index) => MODE_CATALOG.length - 1 - index);
    return orderedIndexes.find((index) => availableModeSet.has(MODE_CATALOG[index]!.value));
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        focusAndSelect(getWrappedAvailableIndex(currentIndex, -1));
        return;
      }
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        focusAndSelect(getWrappedAvailableIndex(currentIndex, 1));
        return;
      }
      case 'Home': {
        const firstIndex = getBoundaryAvailableIndex('first');
        if (firstIndex !== undefined) {
          event.preventDefault();
          focusAndSelect(firstIndex);
        }
        return;
      }
      case 'End': {
        const lastIndex = getBoundaryAvailableIndex('last');
        if (lastIndex !== undefined) {
          event.preventDefault();
          focusAndSelect(lastIndex);
        }
        return;
      }
      case ' ':
      case 'Enter': {
        event.preventDefault();
        focusAndSelect(currentIndex);
        return;
      }
      default:
        return;
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div role="radiogroup" aria-label="Answer mode" className="flex items-center gap-1">
        {MODE_CATALOG.map((option, index) => {
          const isAvailable = availableModeSet.has(option.value);
          const isSelected = chatMode === option.value;
          const reason = disabledModeReasons[option.value];

          // We use `aria-disabled` rather than the native `disabled` attribute
          // so the element still receives pointer/focus events — Radix
          // Tooltip needs that to fire its hover/focus reveal on disabled
          // pills (US 14: "tooltip explaining how to unlock them").
          const pill = (
            <button
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={!isAvailable}
              tabIndex={isSelected ? 0 : -1}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => {
                if (!isAvailable) return;
                setChatMode(option.value);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors',
                'border border-transparent',
                isAvailable
                  ? 'cursor-pointer hover:bg-muted'
                  : 'cursor-not-allowed text-muted-foreground/60 opacity-60',
                isSelected && isAvailable
                  ? 'border-border bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <option.icon size={12} weight="bold" />
              <span className="font-medium">{option.label}</span>
              <span className="hidden text-muted-foreground sm:inline">{option.caption}</span>
            </button>
          );

          if (!isAvailable && reason) {
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>{pill}</TooltipTrigger>
                <TooltipContent side="top">{reason}</TooltipContent>
              </Tooltip>
            );
          }
          return <span key={option.value}>{pill}</span>;
        })}
      </div>
    </TooltipProvider>
  );
}

function EmptyChatHint() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-1 inline-grid place-items-center">
          <pre
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 select-none font-mono text-[12px] leading-4 tracking-tight text-muted-foreground"
          >
            {EMPTY_CHAT_OWL}
          </pre>
          <pre
            aria-hidden="true"
            className="animate-terminal-owl-double-blink pointer-events-none col-start-1 row-start-1 select-none bg-background font-mono text-[12px] leading-4 tracking-tight text-muted-foreground"
          >
            {EMPTY_CHAT_OWL_BLINK}
          </pre>
        </div>
        <p className="mt-5 text-base font-medium text-foreground">Start a design conversation</p>
        <p className="mt-2 max-w-sm text-xs text-muted-foreground">
          Architecture · Module dependencies · Risk hotspots
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  activeMessageStream,
}: {
  message: Doc<'messages'>;
  activeMessageStream: ActiveMessageStream | null;
}) {
  const isUser = message.role === 'user';
  const statusLabel = getMessageStatusLabel(message.status);
  const displayContent =
    message.role === 'assistant' && activeMessageStream?.assistantMessageId === message._id
      ? activeMessageStream.content || message.content
      : message.content;
  return (
    <Card className={cn('p-4', isUser ? 'bg-muted border-transparent' : 'border-transparent bg-transparent px-0')}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{message.role}</p>
        <p className="text-[10px] text-muted-foreground">{statusLabel}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6">{displayContent || '…'}</p>
      {message.errorMessage ? <p className="mt-2 text-xs text-destructive">{message.errorMessage}</p> : null}
    </Card>
  );
}

function getSandboxStatusTitle(reasonCode: SandboxModeStatus['reasonCode'] | undefined) {
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
