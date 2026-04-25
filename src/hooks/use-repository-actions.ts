import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useAsyncCallback } from '@/hooks/use-async-callback';
import { toUserErrorMessage } from '@/lib/errors';
import type { ChatMode, RepositoryId, ThreadId } from '@/lib/types';

/**
 * Aggregates all repo / thread mutations the workspace can fire and exposes
 * pending flags for the dialogs that wrap them. The hook is selection-aware
 * but selection-state-agnostic: callers tell us which thread / repo is
 * currently in view, and we hand back navigation hooks via
 * `onAfterDeleteThread` / `onAfterDeleteRepo` so the parent can update the URL
 * (or do whatever it needs) once a destructive mutation succeeds.
 */
export function useRepositoryActions({
  selectedRepositoryId,
  selectedThreadId,
  threadToDelete,
  analysisPrompt,
  chatInput,
  chatMode,
  setChatInput,
  setActionError,
  setAnalysisError,
  onAfterDeleteThread,
  onAfterDeleteRepo,
  setThreadToDelete,
  setShowDeleteRepoDialog,
  setShowAnalysisDialog,
}: {
  selectedRepositoryId: RepositoryId | null;
  selectedThreadId: ThreadId | null;
  threadToDelete: ThreadId | null;
  analysisPrompt: string;
  chatInput: string;
  chatMode: ChatMode;
  setChatInput: (value: string) => void;
  setActionError: (value: string | null) => void;
  setAnalysisError: (value: string | null) => void;
  /**
   * Fired after a thread has been deleted. The argument is the deleted thread
   * id; callers compare it with the currently visible thread to decide
   * whether to navigate away.
   */
  onAfterDeleteThread: (deletedThreadId: ThreadId) => void;
  /** Fired after the active repository has been deleted. */
  onAfterDeleteRepo: () => void;
  setThreadToDelete: (value: ThreadId | null) => void;
  setShowDeleteRepoDialog: (value: boolean) => void;
  setShowAnalysisDialog: (value: boolean) => void;
}) {
  const requestDeepAnalysis = useMutation(api.analysis.requestDeepAnalysis);
  const sendMessageMutation = useMutation(api.chat.sendMessage);
  const syncRepositoryMutation = useMutation(api.repositories.syncRepository);
  const deleteThreadMutation = useMutation(api.chat.deleteThread);
  const deleteRepositoryMutation = useMutation(api.repositories.deleteRepository);

  const [isSending, handleSendMessage] = useAsyncCallback(
    useCallback(
      async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedThreadId || !chatInput.trim()) return;
        setActionError(null);
        try {
          await sendMessageMutation({
            threadId: selectedThreadId,
            content: chatInput,
            mode: chatMode,
          });
          setChatInput('');
        } catch (error) {
          setActionError(toUserErrorMessage(error, 'Failed to send the message.'));
        }
      },
      [chatInput, chatMode, selectedThreadId, sendMessageMutation, setActionError, setChatInput],
    ),
  );

  const [isRunningAnalysis, handleRunAnalysis] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      setActionError(null);
      setAnalysisError(null);
      try {
        await requestDeepAnalysis({ repositoryId: selectedRepositoryId, prompt: analysisPrompt });
        setShowAnalysisDialog(false);
      } catch (error) {
        const message = toUserErrorMessage(error, 'Failed to start deep analysis.');
        setActionError(message);
        setAnalysisError(message);
      }
    }, [analysisPrompt, requestDeepAnalysis, selectedRepositoryId, setActionError, setAnalysisError, setShowAnalysisDialog]),
  );

  const [isSyncing, handleSync] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      setActionError(null);
      try {
        await syncRepositoryMutation({ repositoryId: selectedRepositoryId });
      } catch (error) {
        setActionError(toUserErrorMessage(error, 'Failed to sync the repository.'));
      }
    }, [selectedRepositoryId, setActionError, syncRepositoryMutation]),
  );

  const [isDeletingThread, handleDeleteThread] = useAsyncCallback(
    useCallback(async () => {
      if (!threadToDelete) return;
      setActionError(null);
      try {
        await deleteThreadMutation({ threadId: threadToDelete });
        const deletedId = threadToDelete;
        setThreadToDelete(null);
        // Notify the parent only after the dialog is reset so navigation does
        // not race with the controlled-dialog close animation.
        if (selectedThreadId === deletedId) {
          onAfterDeleteThread(deletedId);
        }
      } catch (error) {
        setActionError(toUserErrorMessage(error, 'Failed to delete the thread.'));
      }
    }, [
      deleteThreadMutation,
      onAfterDeleteThread,
      selectedThreadId,
      setActionError,
      setThreadToDelete,
      threadToDelete,
    ]),
  );

  const [isDeletingRepo, handleDeleteRepo] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      setActionError(null);
      try {
        await deleteRepositoryMutation({ repositoryId: selectedRepositoryId });
        setShowDeleteRepoDialog(false);
        onAfterDeleteRepo();
      } catch (error) {
        setActionError(toUserErrorMessage(error, 'Failed to delete the repository.'));
      }
    }, [
      deleteRepositoryMutation,
      onAfterDeleteRepo,
      selectedRepositoryId,
      setActionError,
      setShowDeleteRepoDialog,
    ]),
  );

  return {
    isSending,
    handleSendMessage,
    isRunningAnalysis,
    handleRunAnalysis,
    isSyncing,
    handleSync,
    isDeletingThread,
    handleDeleteThread,
    isDeletingRepo,
    handleDeleteRepo,
  };
}
