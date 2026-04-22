/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function createTestConvex() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

describe('deep analysis guards', () => {
  test('requestDeepAnalysis extends sandbox TTL before queuing work', async () => {
    const ownerTokenIdentifier = 'user|deep-analysis-ttl-extension';
    const t = createTestConvex();
    const now = Date.now();

    const { repositoryId, sandboxId } = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/ttl-extension',
        sourceRepoFullName: 'acme/ttl-extension',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'ttl-extension',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'completed',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
        fileCount: 0,
      });

      const sandboxId = await ctx.db.insert('sandboxes', {
        repositoryId,
        ownerTokenIdentifier,
        provider: 'daytona',
        sourceAdapter: 'git_clone',
        remoteId: 'remote-live',
        status: 'ready',
        workDir: '/workspace',
        repoPath: '/workspace/repo',
        cpuLimit: 2,
        memoryLimitGiB: 4,
        diskLimitGiB: 10,
        ttlExpiresAt: now + 5 * 60_000,
        autoStopIntervalMinutes: 30,
        autoArchiveIntervalMinutes: 60,
        autoDeleteIntervalMinutes: 120,
        networkBlockAll: false,
      });

      await ctx.db.patch(repositoryId, { latestSandboxId: sandboxId });
      return { repositoryId, sandboxId };
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    await viewer.mutation(api.analysis.requestDeepAnalysis, {
      repositoryId,
      prompt: 'Trace the request flow.',
    });

    const sandbox = await t.run(async (ctx) => await ctx.db.get(sandboxId));
    expect(sandbox).not.toBeNull();
    expect(sandbox?.ttlExpiresAt).toBeGreaterThanOrEqual(now + 30 * 60_000);
    expect(sandbox?.lastUsedAt).toBeGreaterThanOrEqual(now);
  });

  test('requestDeepAnalysis does not shorten an already-long sandbox TTL', async () => {
    const ownerTokenIdentifier = 'user|deep-analysis-ttl-preserve';
    const t = createTestConvex();
    const now = Date.now();
    const longTtl = now + 90 * 60_000;

    const { repositoryId, sandboxId } = await t.run(async (ctx) => {
      const repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/ttl-preserve',
        sourceRepoFullName: 'acme/ttl-preserve',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'ttl-preserve',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'completed',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
        fileCount: 0,
      });

      const sandboxId = await ctx.db.insert('sandboxes', {
        repositoryId,
        ownerTokenIdentifier,
        provider: 'daytona',
        sourceAdapter: 'git_clone',
        remoteId: 'remote-long-lived',
        status: 'ready',
        workDir: '/workspace',
        repoPath: '/workspace/repo',
        cpuLimit: 2,
        memoryLimitGiB: 4,
        diskLimitGiB: 10,
        ttlExpiresAt: longTtl,
        autoStopIntervalMinutes: 30,
        autoArchiveIntervalMinutes: 60,
        autoDeleteIntervalMinutes: 120,
        networkBlockAll: false,
      });

      await ctx.db.patch(repositoryId, { latestSandboxId: sandboxId });
      return { repositoryId, sandboxId };
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    await viewer.mutation(api.analysis.requestDeepAnalysis, {
      repositoryId,
      prompt: 'Trace the request flow.',
    });

    const sandbox = await t.run(async (ctx) => await ctx.db.get(sandboxId));
    expect(sandbox?.ttlExpiresAt).toBe(longTtl);
  });

  test('requestDeepAnalysis rejects expired sandboxes before queuing work', async () => {
    const ownerTokenIdentifier = 'user|deep-analysis-expired';
    const t = createTestConvex();
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
        fileCount: 0,
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
