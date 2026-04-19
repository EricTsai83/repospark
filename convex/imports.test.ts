/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('import snapshot cleanup', () => {
  test('removes superseded files, chunks, and import-generated artifacts', async () => {
    const ownerTokenIdentifier = 'user|import-cleanup';
    const t = convexTest(schema, modules);

    const ids = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/cleanup-repo',
        sourceRepoFullName: 'acme/cleanup-repo',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'cleanup-repo',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'completed',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
      });

      const oldJobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        kind: 'import',
        status: 'completed',
        stage: 'completed',
        progress: 1,
        costCategory: 'indexing',
        triggerSource: 'user',
      });
      const oldImportId = await ctx.db.insert('imports', {
        repositoryId,
        ownerTokenIdentifier,
        sourceUrl: 'https://github.com/acme/cleanup-repo',
        branch: 'main',
        adapterKind: 'git_clone',
        status: 'completed',
        jobId: oldJobId,
      });
      const oldFileId = await ctx.db.insert('repoFiles', {
        repositoryId,
        ownerTokenIdentifier,
        importId: oldImportId,
        path: 'src/old.ts',
        parentPath: 'src',
        fileType: 'file',
        extension: 'ts',
        language: 'typescript',
        sizeBytes: 100,
        isEntryPoint: false,
        isConfig: false,
        isImportant: false,
      });
      await ctx.db.insert('repoChunks', {
        repositoryId,
        ownerTokenIdentifier,
        importId: oldImportId,
        fileId: oldFileId,
        path: 'src/old.ts',
        chunkIndex: 0,
        startLine: 1,
        endLine: 3,
        chunkKind: 'code',
        summary: 'Old chunk',
        content: 'old',
      });
      await ctx.db.insert('analysisArtifacts', {
        repositoryId,
        jobId: oldJobId,
        ownerTokenIdentifier,
        kind: 'manifest',
        title: 'Old Manifest',
        summary: 'Old summary',
        contentMarkdown: 'old',
        source: 'heuristic',
        version: 1,
      });

      const currentJobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        kind: 'import',
        status: 'completed',
        stage: 'completed',
        progress: 1,
        costCategory: 'indexing',
        triggerSource: 'user',
      });
      const currentImportId = await ctx.db.insert('imports', {
        repositoryId,
        ownerTokenIdentifier,
        sourceUrl: 'https://github.com/acme/cleanup-repo',
        branch: 'main',
        adapterKind: 'git_clone',
        status: 'completed',
        jobId: currentJobId,
      });
      const currentFileId = await ctx.db.insert('repoFiles', {
        repositoryId,
        ownerTokenIdentifier,
        importId: currentImportId,
        path: 'src/current.ts',
        parentPath: 'src',
        fileType: 'file',
        extension: 'ts',
        language: 'typescript',
        sizeBytes: 120,
        isEntryPoint: true,
        isConfig: false,
        isImportant: true,
      });
      await ctx.db.insert('repoChunks', {
        repositoryId,
        ownerTokenIdentifier,
        importId: currentImportId,
        fileId: currentFileId,
        path: 'src/current.ts',
        chunkIndex: 0,
        startLine: 1,
        endLine: 3,
        chunkKind: 'code',
        summary: 'Current chunk',
        content: 'current',
      });
      await ctx.db.insert('analysisArtifacts', {
        repositoryId,
        jobId: currentJobId,
        ownerTokenIdentifier,
        kind: 'manifest',
        title: 'Current Manifest',
        summary: 'Current summary',
        contentMarkdown: 'current',
        source: 'heuristic',
        version: 1,
      });

      return { oldImportId, oldJobId, currentImportId, currentJobId };
    });

    await t.mutation(internal.imports.cleanupSupersededImportSnapshot, {
      importId: ids.oldImportId,
      importJobId: ids.oldJobId,
    });

    const snapshot = await t.run(async (ctx) => ({
      files: await ctx.db
        .query('repoFiles')
        .withIndex('by_importId', (q) => q.eq('importId', ids.oldImportId))
        .take(10),
      chunks: await ctx.db
        .query('repoChunks')
        .withIndex('by_importId_and_path_and_chunkIndex', (q) => q.eq('importId', ids.oldImportId))
        .take(10),
      artifacts: await ctx.db
        .query('analysisArtifacts')
        .withIndex('by_jobId', (q) => q.eq('jobId', ids.oldJobId))
        .take(10),
      currentFiles: await ctx.db
        .query('repoFiles')
        .withIndex('by_importId', (q) => q.eq('importId', ids.currentImportId))
        .take(10),
      currentChunks: await ctx.db
        .query('repoChunks')
        .withIndex('by_importId_and_path_and_chunkIndex', (q) => q.eq('importId', ids.currentImportId))
        .take(10),
      currentArtifacts: await ctx.db
        .query('analysisArtifacts')
        .withIndex('by_jobId', (q) => q.eq('jobId', ids.currentJobId))
        .take(10),
    }));

    expect(snapshot.files).toHaveLength(0);
    expect(snapshot.chunks).toHaveLength(0);
    expect(snapshot.artifacts).toHaveLength(0);
    expect(snapshot.currentFiles).toHaveLength(1);
    expect(snapshot.currentChunks).toHaveLength(1);
    expect(snapshot.currentArtifacts).toHaveLength(1);
  });
});

describe('repository deletion during import', () => {
  test('persistImportResults cancels cleanly when deletion starts mid-import', async () => {
    const ownerTokenIdentifier = 'user|delete-mid-import';
    const t = convexTest(schema, modules);

    const ids = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/delete-mid-import',
        sourceRepoFullName: 'acme/delete-mid-import',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'delete-mid-import',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'running',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
      });

      const jobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        kind: 'import',
        status: 'running',
        stage: 'indexing',
        progress: 0.6,
        costCategory: 'indexing',
        triggerSource: 'user',
        startedAt: Date.now() - 5_000,
      });

      const importId = await ctx.db.insert('imports', {
        repositoryId,
        ownerTokenIdentifier,
        sourceUrl: 'https://github.com/acme/delete-mid-import',
        branch: 'main',
        adapterKind: 'git_clone',
        status: 'running',
        jobId,
        startedAt: Date.now() - 5_000,
      });

      const sandboxId = await ctx.db.insert('sandboxes', {
        repositoryId,
        ownerTokenIdentifier,
        provider: 'daytona',
        sourceAdapter: 'git_clone',
        remoteId: 'remote-delete-mid-import',
        status: 'ready',
        workDir: '/workspace',
        repoPath: '/workspace/repo',
        cpuLimit: 2,
        memoryLimitGiB: 4,
        diskLimitGiB: 10,
        ttlExpiresAt: Date.now() + 60_000,
        autoStopIntervalMinutes: 30,
        autoArchiveIntervalMinutes: 60,
        autoDeleteIntervalMinutes: 120,
        networkBlockAll: false,
      });

      await ctx.db.patch(repositoryId, {
        latestSandboxId: sandboxId,
      });
      await ctx.db.patch(importId, {
        sandboxId,
        remoteSandboxId: 'remote-delete-mid-import',
      });

      return { repositoryId, jobId, importId, sandboxId };
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    await viewer.mutation(api.repositories.deleteRepository, { repositoryId: ids.repositoryId });

    const result = await t.mutation(internal.imports.persistImportResults, {
      importId: ids.importId,
      repositoryId: ids.repositoryId,
      jobId: ids.jobId,
      sandboxId: ids.sandboxId,
      commitSha: 'abc123',
      branch: 'main',
      detectedLanguages: ['typescript'],
      packageManagers: ['npm'],
      entrypoints: ['src/main.ts'],
      summary: 'Import summary',
      readmeSummary: 'README summary',
      architectureSummary: 'Architecture summary',
      repoFiles: [
        {
          path: 'src/main.ts',
          parentPath: 'src',
          fileType: 'file',
          extension: 'ts',
          language: 'typescript',
          sizeBytes: 128,
          isEntryPoint: true,
          isConfig: false,
          isImportant: true,
          summary: 'Entry point',
        },
      ],
      repoChunks: [
        {
          path: 'src/main.ts',
          chunkIndex: 0,
          startLine: 1,
          endLine: 3,
          chunkKind: 'code',
          summary: 'Chunk summary',
          content: 'console.log("hello");',
        },
      ],
      artifacts: [
        {
          kind: 'manifest',
          title: 'Repository Manifest',
          summary: 'Manifest summary',
          contentMarkdown: '# Manifest',
          source: 'heuristic',
        },
      ],
    });

    expect(result).toEqual({ kind: 'cancelled' });

    const state = await t.run(async (ctx) => ({
      importRecord: await ctx.db.get(ids.importId),
      job: await ctx.db.get(ids.jobId),
      files: await ctx.db
        .query('repoFiles')
        .withIndex('by_importId', (q) => q.eq('importId', ids.importId))
        .take(10),
      chunks: await ctx.db
        .query('repoChunks')
        .withIndex('by_importId_and_path_and_chunkIndex', (q) => q.eq('importId', ids.importId))
        .take(10),
      artifacts: await ctx.db
        .query('analysisArtifacts')
        .withIndex('by_jobId', (q) => q.eq('jobId', ids.jobId))
        .take(10),
    }));

    expect(state.importRecord?.status).toBe('cancelled');
    expect(state.job?.status).toBe('cancelled');
    expect(state.files).toHaveLength(0);
    expect(state.chunks).toHaveLength(0);
    expect(state.artifacts).toHaveLength(0);
  });

  test('markImportFailed does not throw when the repository row is already gone', async () => {
    const ownerTokenIdentifier = 'user|missing-repo-failure';
    const t = convexTest(schema, modules);

    const ids = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/missing-repo-failure',
        sourceRepoFullName: 'acme/missing-repo-failure',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'missing-repo-failure',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'running',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
      });

      const jobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        kind: 'import',
        status: 'running',
        stage: 'indexing',
        progress: 0.4,
        costCategory: 'indexing',
        triggerSource: 'user',
      });

      const importId = await ctx.db.insert('imports', {
        repositoryId,
        ownerTokenIdentifier,
        sourceUrl: 'https://github.com/acme/missing-repo-failure',
        branch: 'main',
        adapterKind: 'git_clone',
        status: 'running',
        jobId,
      });

      return { repositoryId, jobId, importId };
    });

    await t.run(async (ctx) => {
      await ctx.db.delete(ids.repositoryId);
    });

    await expect(
      t.mutation(internal.imports.markImportFailed, {
        importId: ids.importId,
        jobId: ids.jobId,
        errorMessage: 'Clone failed',
      }),
    ).resolves.toBeNull();

    const state = await t.run(async (ctx) => ({
      importRecord: await ctx.db.get(ids.importId),
      job: await ctx.db.get(ids.jobId),
    }));

    expect(state.importRecord?.status).toBe('cancelled');
    expect(state.job?.status).toBe('cancelled');
  });
});
