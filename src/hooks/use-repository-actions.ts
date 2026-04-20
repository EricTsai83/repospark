import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useAsyncCallback } from '@/hooks/use-async-callback';
import { toUserErrorMessage } from '@/lib/errors';
import type { ChatMode, RepositoryId, ThreadId } from '@/lib/types';

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
  setSelectedRepositoryId,
  setSelectedThreadId,
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
  setSelectedRepositoryId: (value: RepositoryId | null) => void;
  setSelectedThreadId: (value: ThreadId | null) => void;
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
          await sendMessageMutation({ threadId: selectedThreadId, content: chatInput, mode: chatMode });
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
        if (selectedThreadId === threadToDelete) setSelectedThreadId(null);
        setThreadToDelete(null);
      } catch (error) {
        setActionError(toUserErrorMessage(error, 'Failed to delete the thread.'));
      }
    }, [deleteThreadMutation, selectedThreadId, setActionError, setSelectedThreadId, setThreadToDelete, threadToDelete]),
  );

  const [isDeletingRepo, handleDeleteRepo] = useAsyncCallback(
    useCallback(async () => {
      if (!selectedRepositoryId) return;
      setActionError(null);
      try {
        await deleteRepositoryMutation({ repositoryId: selectedRepositoryId });
        setSelectedRepositoryId(null);
        setSelectedThreadId(null);
        setShowDeleteRepoDialog(false);
      } catch (error) {
        setActionError(toUserErrorMessage(error, 'Failed to delete the repository.'));
      }
    }, [deleteRepositoryMutation, selectedRepositoryId, setActionError, setSelectedRepositoryId, setSelectedThreadId, setShowDeleteRepoDialog]),
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
