import { useMemo } from 'react';
import type { Doc } from '../../convex/_generated/dataModel';
import type { RepositoryId } from '@/lib/types';

export function useRepositorySelection(
  repositories: Doc<'repositories'>[] | undefined,
  selectedRepositoryId: RepositoryId | null,
) {
  const effectiveSelectedRepositoryId = useMemo(() => {
    if (!repositories || repositories.length === 0) {
      return null;
    }
    if (selectedRepositoryId && repositories.some((repository) => repository._id === selectedRepositoryId)) {
      return selectedRepositoryId;
    }
    return repositories[0]._id;
  }, [repositories, selectedRepositoryId]);

  const selectedRepoName = useMemo(
    () => repositories?.find((repository) => repository._id === effectiveSelectedRepositoryId)?.sourceRepoFullName,
    [effectiveSelectedRepositoryId, repositories],
  );

  return {
    effectiveSelectedRepositoryId,
    selectedRepoName,
  };
}
