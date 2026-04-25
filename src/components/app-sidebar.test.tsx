// @vitest-environment jsdom

import type React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Doc } from '../../convex/_generated/dataModel';
import { AppSidebar } from './app-sidebar';
import type { RepositoryId, ThreadId } from '@/lib/types';

const { createThreadMutationMock, useMutationMock, useQueryMock } = vi.hoisted(() => ({
  createThreadMutationMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('@/components/profile-card', () => ({
  ProfileCard: () => <div>profile</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
}));

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode; selected?: boolean }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/logo', () => ({
  Logo: () => <div>logo</div>,
}));

vi.mock('@/components/import-repo-dialog', () => ({
  ImportRepoDialog: () => <div>import repo</div>,
}));

const threadOne = {
  _id: 'thread_1',
  title: 'First thread',
  repositoryId: null,
  lastMessageAt: 1,
} as unknown as Doc<'threads'>;

const threadTwo = {
  _id: 'thread_2',
  title: 'Second thread',
  repositoryId: null,
  lastMessageAt: 2,
} as unknown as Doc<'threads'>;

const threadThree = {
  _id: 'thread_3',
  title: 'Third thread',
  repositoryId: null,
  lastMessageAt: 3,
} as unknown as Doc<'threads'>;

let threadsResult: Doc<'threads'>[] | undefined;

beforeEach(() => {
  threadsResult = [];
  createThreadMutationMock.mockReset();
  useMutationMock.mockReset();
  useQueryMock.mockReset();
  useMutationMock.mockReturnValue(createThreadMutationMock);
  useQueryMock.mockImplementation(() => threadsResult);
});

afterEach(() => {
  cleanup();
});

describe('AppSidebar', () => {
  test('surfaces create-thread failures through the shared error callback', async () => {
    const onError = vi.fn();
    createThreadMutationMock.mockRejectedValueOnce(new Error('Rate limit exceeded.'));

    renderSidebar({ onError });

    fireEvent.click(screen.getByRole('button', { name: /new design conversation/i }));

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith('Rate limit exceeded.');
    });
  });

  test('announces thread-count deltas with distinct live-region text', () => {
    threadsResult = [threadOne];
    const { rerender } = renderSidebar();

    expect(screen.getByRole('status')).toHaveTextContent('');

    threadsResult = [threadOne, threadTwo];
    rerender(createSidebarElement());
    expect(screen.getByRole('status')).toHaveTextContent('1 new conversation. 2 total.');

    threadsResult = [threadOne, threadTwo, threadThree];
    rerender(createSidebarElement());
    expect(screen.getByRole('status')).toHaveTextContent('1 new conversation. 3 total.');
  });
});

function renderSidebar({
  onError = vi.fn(),
}: {
  onError?: (message: string | null) => void;
} = {}) {
  return render(createSidebarElement({ onError }));
}

function createSidebarElement({
  onError = vi.fn(),
}: {
  onError?: (message: string | null) => void;
} = {}) {
  return (
    <AppSidebar
      repositories={[] as Doc<'repositories'>[]}
      selectedRepositoryId={null as RepositoryId | null}
      onSelectRepository={vi.fn()}
      selectedThreadId={null as ThreadId | null}
      onSelectThread={vi.fn()}
      onDeleteThread={vi.fn()}
      onImported={vi.fn()}
      onError={onError}
    />
  );
}
