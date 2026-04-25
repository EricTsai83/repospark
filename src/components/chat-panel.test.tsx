// @vitest-environment jsdom

import type React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Doc } from '../../convex/_generated/dataModel';
import { ChatPanel } from './chat-panel';
import type { MessageId, ThreadId } from '@/lib/types';

vi.mock('@/components/app-notice', () => ({
  AppNotice: ({ title, message }: { title: string; message: string }) => (
    <div>
      {title}
      {message}
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

// Tooltip is rendered as the disabled-mode hint container; the test only
// cares that the trigger child renders, so we replace it with passthroughs.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const threadId = 'thread_1' as ThreadId;
const assistantMessageId = 'message_1' as MessageId;

afterEach(() => {
  cleanup();
});

describe('ChatPanel streaming rendering', () => {
  test('renders active stream content for the in-flight assistant message', () => {
    render(
      <ChatPanel
        selectedThreadId={threadId}
        messages={[
          {
            _id: assistantMessageId,
            role: 'assistant',
            status: 'streaming',
            content: '',
            errorMessage: undefined,
          } as unknown as Doc<'messages'>,
        ]}
        activeMessageStream={{
          assistantMessageId,
          content: 'streamed reply',
          startedAt: Date.now(),
          lastAppendedAt: Date.now(),
        }}
        isChatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatMode="discuss"
        setChatMode={vi.fn()}
        availableModes={['discuss']}
        disabledModeReasons={{
          docs: 'Attach a repository to use Docs mode.',
          sandbox: 'Attach a repository with a ready sandbox to use Sandbox mode.',
        }}
        isSending={false}
        onSendMessage={vi.fn()}
        sandboxModeStatus={{ reasonCode: 'available', message: null }}
        isSyncing={false}
        onSync={vi.fn()}
      />,
    );

    expect(screen.getByText('streamed reply')).toBeInTheDocument();
  });

  test('hands off from active stream content to durable message content without duplication', () => {
    const { rerender } = render(
      <ChatPanel
        selectedThreadId={threadId}
        messages={[
          {
            _id: assistantMessageId,
            role: 'assistant',
            status: 'streaming',
            content: '',
            errorMessage: undefined,
          } as unknown as Doc<'messages'>,
        ]}
        activeMessageStream={{
          assistantMessageId,
          content: 'final streamed reply',
          startedAt: Date.now(),
          lastAppendedAt: Date.now(),
        }}
        isChatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatMode="docs"
        setChatMode={vi.fn()}
        availableModes={['discuss', 'docs']}
        disabledModeReasons={{ sandbox: 'Provision a sandbox to use Sandbox mode.' }}
        isSending={false}
        onSendMessage={vi.fn()}
        sandboxModeStatus={{ reasonCode: 'available', message: null }}
        isSyncing={false}
        onSync={vi.fn()}
      />,
    );

    expect(screen.getByText('final streamed reply')).toBeInTheDocument();

    rerender(
      <ChatPanel
        selectedThreadId={threadId}
        messages={[
          {
            _id: assistantMessageId,
            role: 'assistant',
            status: 'completed',
            content: 'final streamed reply',
            errorMessage: undefined,
          } as unknown as Doc<'messages'>,
        ]}
        activeMessageStream={null}
        isChatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatMode="docs"
        setChatMode={vi.fn()}
        availableModes={['discuss', 'docs']}
        disabledModeReasons={{ sandbox: 'Provision a sandbox to use Sandbox mode.' }}
        isSending={false}
        onSendMessage={vi.fn()}
        sandboxModeStatus={{ reasonCode: 'available', message: null }}
        isSyncing={false}
        onSync={vi.fn()}
      />,
    );

    expect(screen.getAllByText('final streamed reply')).toHaveLength(1);
  });

  test('supports arrow-key navigation across enabled modes', () => {
    const setChatMode = vi.fn();

    render(
      <ChatPanel
        selectedThreadId={threadId}
        messages={[]}
        activeMessageStream={null}
        isChatLoading={false}
        chatInput=""
        setChatInput={vi.fn()}
        chatMode="discuss"
        setChatMode={setChatMode}
        availableModes={['discuss', 'docs', 'sandbox']}
        disabledModeReasons={{}}
        isSending={false}
        onSendMessage={vi.fn()}
        sandboxModeStatus={{ reasonCode: 'available', message: null }}
        isSyncing={false}
        onSync={vi.fn()}
      />,
    );

    const discussButton = screen.getByRole('radio', { name: /discuss/i });
    const docsButton = screen.getByRole('radio', { name: /docs/i });

    discussButton.focus();
    fireEvent.keyDown(discussButton, { key: 'ArrowRight' });

    expect(setChatMode).toHaveBeenCalledWith('docs');
    expect(docsButton).toHaveFocus();
  });
});
