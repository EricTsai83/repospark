/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('deep analysis guards', () => {
  test('requestDeepAnalysis rejects expired sandboxes before queuing work', async () => {
    const ownerTokenIdentifier = 'user|deep-analysis-expired';
    const t = convexTest(schema, modules);
    const now = Date.now();

    const repositoryId = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/expired-sandbox',
        sourceRepoFullName: 'acme/expired-sandbox',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'expired-sandbox',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'completed',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
      });

      const sandboxId = await ctx.db.insert('sandboxes', {
        repositoryId,
        ownerTokenIdentifier,
        provider: 'daytona',
        sourceAdapter: 'git_clone',
        remoteId: 'remote-expired',
        status: 'ready',
        workDir: '/workspace',
        repoPath: '/workspace/repo',
        cpuLimit: 2,
        memoryLimitGiB: 4,
        diskLimitGiB: 10,
        ttlExpiresAt: now - 1_000,
        autoStopIntervalMinutes: 30,
        autoArchiveIntervalMinutes: 60,
        autoDeleteIntervalMinutes: 120,
        networkBlockAll: false,
      });

      await ctx.db.patch(repositoryId, { latestSandboxId: sandboxId });
      return repositoryId;
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });

    await expect(
      viewer.mutation(api.analysis.requestDeepAnalysis, {
        repositoryId,
        prompt: 'Trace the request flow.',
      }),
    ).rejects.toThrow('sandbox expired');

    const jobs = await t.run(async (ctx) =>
      await ctx.db
        .query('jobs')
        .withIndex('by_repositoryId', (q) => q.eq('repositoryId', repositoryId))
        .take(10),
    );
    expect(jobs).toHaveLength(0);
  });
});
