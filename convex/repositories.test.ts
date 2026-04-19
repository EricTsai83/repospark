/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('repository detail metadata', () => {
  test('getRepositoryDetail caps oversized file counts as 400+', async () => {
    const ownerTokenIdentifier = 'user|repo-detail';
    const t = convexTest(schema, modules);

    const repositoryId = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/huge-repo',
        sourceRepoFullName: 'acme/huge-repo',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'huge-repo',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'completed',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
      });

      const jobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        kind: 'import',
        status: 'completed',
        stage: 'completed',
        progress: 1,
        costCategory: 'indexing',
        triggerSource: 'user',
      });

      const importId = await ctx.db.insert('imports', {
        repositoryId,
        ownerTokenIdentifier,
        sourceUrl: 'https://github.com/acme/huge-repo',
        branch: 'main',
        adapterKind: 'git_clone',
        status: 'completed',
        jobId,
      });

      await ctx.db.patch(repositoryId, { latestImportId: importId });

      for (let index = 0; index < 401; index += 1) {
        await ctx.db.insert('repoFiles', {
          repositoryId,
          ownerTokenIdentifier,
          importId,
          path: `src/file-${index}.ts`,
          parentPath: 'src',
          fileType: 'file',
          extension: 'ts',
          language: 'typescript',
          sizeBytes: 128,
          isEntryPoint: false,
          isConfig: false,
          isImportant: false,
        });
      }

      return repositoryId;
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    const detail = await viewer.query(api.repositories.getRepositoryDetail, { repositoryId });

    expect(detail.fileCount).toBe(400);
    expect(detail.fileCountLabel).toBe('400+');
  });
});
