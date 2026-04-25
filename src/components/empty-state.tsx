import { ChatCircleTextIcon, GitBranchIcon } from '@phosphor-icons/react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { ImportRepoDialog } from '@/components/import-repo-dialog';
import type { RepositoryId, ThreadId } from '@/lib/types';

/**
 * Workspace empty state — what the user sees the very first time they sign
 * in (no threads, no repos) and any time they hit `/chat` without any
 * threads to redirect to.
 *
 * The dual CTA mirrors the architectural reversal described in PRD #19:
 * threads are the root primitive, so "Start a design conversation" is the
 * primary path, while "Import repository" is a secondary path for users who
 * want grounded analysis from the start. Either CTA leads back into the
 * thread-first workspace.
 */
export function EmptyState({
  onStartConversation,
  onImported,
  isStartingConversation = false,
}: {
  onStartConversation: () => void;
  onImported: (repoId: RepositoryId, threadId: ThreadId | null) => void;
  isStartingConversation?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
      <Logo size={64} hero />
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Design with your codebase</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Talk through architecture refactors, generate diagrams and ADRs, and pressure-test
          designs against your real code.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="default"
          size="default"
          className="gap-2"
          disabled={isStartingConversation}
          onClick={onStartConversation}
        >
          <ChatCircleTextIcon size={14} weight="bold" />
          {isStartingConversation ? 'Starting…' : 'Start a design conversation'}
        </Button>
        <ImportRepoDialog
          onImported={onImported}
          trigger={
            <Button type="button" variant="outline" size="default" className="gap-2">
              <GitBranchIcon size={14} weight="bold" />
              Import repository
            </Button>
          }
        />
      </div>
      <p className="max-w-md text-xs text-muted-foreground">
        Threads can stand on their own for general design conversation, or be grounded by
        attaching a repository at any time.
      </p>
    </div>
  );
}
