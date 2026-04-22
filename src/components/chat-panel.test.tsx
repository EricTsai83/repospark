// @vitest-environment jsdom

import type React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
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

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const threadId = 'thread_1' as ThreadId;
const assistantMessageId = 'message_1' as MessageId;

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
        chatMode="fast"
        setChatMode={vi.fn()}
        isSending={false}
        onSendMessage={vi.fn()}
        deepModeAvailable
        deepModeStatus={null}
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
        chatMode="fast"
        setChatMode={vi.fn()}
        isSending={false}
        onSendMessage={vi.fn()}
        deepModeAvailable
        deepModeStatus={null}
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
        chatMode="fast"
        setChatMode={vi.fn()}
        isSending={false}
        onSendMessage={vi.fn()}
        deepModeAvailable
        deepModeStatus={null}
        isSyncing={false}
        onSync={vi.fn()}
      />,
    );

    expect(screen.getAllByText('final streamed reply')).toHaveLength(1);
  });
});
