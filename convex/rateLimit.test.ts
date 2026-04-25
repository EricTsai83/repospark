/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
type AppTestConvex = ReturnType<typeof createTestConvex>;

describe('rate limits and interactive job guards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('createRepositoryImport rejects the sixth request without extra side effects', async () => {
    const ownerTokenIdentifier = 'user|import-rate-limit';
    const t = createTestConvex();
    await seedGithubInstallation(t, ownerTokenIdentifier, 1);

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    for (let index = 0; index < 5; index += 1) {
      await viewer.mutation(api.repositories.createRepositoryImport, {
        url: `https://github.com/acme/import-rate-limit-${index}`,
      });
    }

    const before = await getOwnerImportCounts(t, ownerTokenIdentifier);
    const error = await viewer
      .mutation(api.repositories.createRepositoryImport, {
        url: 'https://github.com/acme/import-rate-limit-5',
      })
      .catch((caughtError) => caughtError);

    expectStructuredError(error, 'RATE_LIMIT_EXCEEDED', 'importRequests');
    expect(await getOwnerImportCounts(t, ownerTokenIdentifier)).toEqual(before);
  });

  test('requestDeepAnalysis rejects active leased jobs without creating another job', async () => {
    const ownerTokenIdentifier = 'user|deep-analysis-in-flight';
    const t = createTestConvex();
    const { repositoryId, sandboxId } = await createRepositoryFixture(t, ownerTokenIdentifier, 'deep-analysis-active', {
      withSandbox: true,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        sandboxId,
        kind: 'deep_analysis',
        status: 'running',
        stage: 'focused_inspection',
        progress: 0.4,
        costCategory: 'deep_analysis',
        triggerSource: 'user',
        startedAt: Date.now(),
        leaseExpiresAt: Date.now() + 60_000,
      });
    });

    const before = await countRepositoryJobs(t, repositoryId);
    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    const error = await viewer
      .mutation(api.analysis.requestDeepAnalysis, {
        repositoryId,
        prompt: 'Trace the data flow.',
      })
      .catch((caughtError) => caughtError);

    expectStructuredError(error, 'OPERATION_ALREADY_IN_PROGRESS', 'repositoryDeepAnalysisInFlight');
    expect(await countRepositoryJobs(t, repositoryId)).toBe(before);
  });

  test('sendMessage rejects active chat jobs without creating extra jobs or messages', async () => {
    const ownerTokenIdentifier = 'user|chat-in-flight';
    const t = createTestConvex();
    const { repositoryId, threadId } = await createRepositoryFixture(t, ownerTokenIdentifier, 'chat-active');

    await t.run(async (ctx) => {
      const jobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        threadId,
        kind: 'chat',
        status: 'running',
        stage: 'generating_reply',
        progress: 0.3,
        costCategory: 'chat',
        triggerSource: 'user',
        startedAt: Date.now(),
        leaseExpiresAt: Date.now() + 60_000,
      });

      await ctx.db.insert('messages', {
        repositoryId,
        threadId,
        jobId,
        ownerTokenIdentifier,
        role: 'assistant',
        status: 'streaming',
        mode: 'discuss',
        content: '',
      });
    });

    const before = await getThreadCounts(t, threadId);
    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    const error = await viewer
      .mutation(api.chat.sendMessage, {
        threadId,
        content: 'Can you answer this now?',
      })
      .catch((caughtError) => caughtError);

    expectStructuredError(error, 'OPERATION_ALREADY_IN_PROGRESS', 'threadChatInFlight');
    expect(await getThreadCounts(t, threadId)).toEqual(before);
  });

  test('sendMessage allows a burst of six then rate limits the seventh request', async () => {
    const ownerTokenIdentifier = 'user|chat-rate-limit';
    const t = createTestConvex();
    const { threadId } = await createRepositoryFixture(t, ownerTokenIdentifier, 'chat-rate-limit');
    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });

    for (let index = 0; index < 6; index += 1) {
      const result = await viewer.mutation(api.chat.sendMessage, {
        threadId,
        content: `message-${index}`,
      });
      await completeJob(t, result.jobId);
    }

    const before = await getThreadCounts(t, threadId);
    const error = await viewer
      .mutation(api.chat.sendMessage, {
        threadId,
        content: 'message-6',
      })
      .catch((caughtError) => caughtError);

    expectStructuredError(error, 'RATE_LIMIT_EXCEEDED', 'chatRequestsPerOwner');
    expect(await getThreadCounts(t, threadId)).toEqual(before);
  });

  test('chat global limiter eventually rejects a multi-owner burst without side effects', async () => {
    const t = createTestConvex();

    let successCount = 0;
    let blockedThreadId: Id<'threads'> | null = null;
    let blockedError: unknown = null;

    for (let index = 0; index < 120; index += 1) {
      const ownerTokenIdentifier = `user|chat-global-${index}`;
      const { threadId } = await createRepositoryFixture(t, ownerTokenIdentifier, `chat-global-${index}`);
      const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
      const result = await viewer
        .mutation(api.chat.sendMessage, {
          threadId,
          content: `hello-${index}`,
        })
        .catch((caughtError) => caughtError);

      if (result instanceof Error) {
        blockedThreadId = threadId;
        blockedError = result;
        break;
      }

      successCount += 1;
    }

    expect(successCount).toBeGreaterThan(0);
    expect(blockedThreadId).not.toBeNull();
    expectStructuredError(blockedError, 'RATE_LIMIT_EXCEEDED', 'chatRequestsGlobal');
    expect(await getThreadCounts(t, blockedThreadId!)).toEqual({
      jobs: 0,
      messages: 0,
      streams: 0,
      streamChunks: 0,
    });
  });

  test('daytona global limiter eventually rejects multi-owner imports without side effects', async () => {
    const t = createTestConvex();

    let successCount = 0;
    let blockedOwner: string | null = null;
    let blockedError: unknown = null;

    for (let index = 0; index < 80; index += 1) {
      const ownerTokenIdentifier = `user|daytona-global-${index}`;
      await seedGithubInstallation(t, ownerTokenIdentifier, index + 10);
      const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
      const result = await viewer
        .mutation(api.repositories.createRepositoryImport, {
          url: `https://github.com/acme/daytona-global-${index}`,
        })
        .catch((caughtError) => caughtError);

      if (result instanceof Error) {
        blockedOwner = ownerTokenIdentifier;
        blockedError = result;
        break;
      }

      successCount += 1;
    }

    expect(successCount).toBeGreaterThan(0);
    expect(blockedOwner).not.toBeNull();
    expectStructuredError(blockedError, 'RATE_LIMIT_EXCEEDED', 'daytonaRequestsGlobal');
    expect(await getOwnerImportCounts(t, blockedOwner!)).toEqual({
      repositories: 0,
      imports: 0,
      jobs: 0,
    });
  });

  test('stale chat recovery fails the job and assistant message', async () => {
    const ownerTokenIdentifier = 'user|stale-chat';
    const t = createTestConvex();
    const { repositoryId, threadId } = await createRepositoryFixture(t, ownerTokenIdentifier, 'stale-chat');

    const { jobId, assistantMessageId } = await t.run(async (ctx) => {
      const jobId = await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        threadId,
        kind: 'chat',
        status: 'running',
        stage: 'generating_reply',
        progress: 0.6,
        costCategory: 'chat',
        triggerSource: 'user',
        startedAt: Date.now() - 120_000,
        leaseExpiresAt: Date.now() - 1_000,
      });

      await ctx.db.insert('messages', {
        repositoryId,
        threadId,
        jobId,
        ownerTokenIdentifier,
        role: 'user',
        status: 'completed',
        mode: 'discuss',
        content: 'Hello?',
      });

      const assistantMessageId = await ctx.db.insert('messages', {
        repositoryId,
        threadId,
        jobId,
        ownerTokenIdentifier,
        role: 'assistant',
        status: 'streaming',
        mode: 'discuss',
        content: '',
      });

      const streamId = await ctx.db.insert('messageStreams', {
        repositoryId,
        threadId,
        jobId,
        assistantMessageId,
        ownerTokenIdentifier,
        compactedContent: 'Partial ',
        compactedThroughSequence: -1,
        nextSequence: 1,
        startedAt: Date.now() - 120_000,
        lastAppendedAt: Date.now() - 30_000,
      });
      await ctx.db.insert('messageStreamChunks', {
        streamId,
        sequence: 0,
        text: 'reply',
      });

      return { jobId, assistantMessageId };
    });

    await t.action(internal.opsNode.reconcileStaleInteractiveJobs, {});

    const result = await t.run(async (ctx) => ({
      job: await ctx.db.get(jobId),
      assistantMessage: await ctx.db.get(assistantMessageId),
      streams: await ctx.db
        .query('messageStreams')
        .withIndex('by_jobId', (q) => q.eq('jobId', jobId))
        .take(10),
    }));

    expect(result.job?.status).toBe('failed');
    expect(result.job?.leaseExpiresAt).toBeUndefined();
    expect(result.assistantMessage?.status).toBe('failed');
    expect(result.assistantMessage?.content).toBe('Partial reply');
    expect(result.assistantMessage?.errorMessage).toContain('stalled');
    expect(result.streams).toHaveLength(0);
  });

  test('stale deep analysis recovery fails the expired job', async () => {
    const ownerTokenIdentifier = 'user|stale-analysis';
    const t = createTestConvex();
    const { repositoryId, sandboxId } = await createRepositoryFixture(t, ownerTokenIdentifier, 'stale-analysis', {
      withSandbox: true,
    });

    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert('jobs', {
        repositoryId,
        ownerTokenIdentifier,
        sandboxId,
        kind: 'deep_analysis',
        status: 'queued',
        stage: 'queued',
        progress: 0,
        costCategory: 'deep_analysis',
        triggerSource: 'user',
        leaseExpiresAt: Date.now() - 1_000,
      });
    });

    await t.action(internal.opsNode.reconcileStaleInteractiveJobs, {});

    const job = await t.run(async (ctx) => await ctx.db.get(jobId));
    expect(job?.status).toBe('failed');
    expect(job?.leaseExpiresAt).toBeUndefined();
    expect(job?.errorMessage).toContain('stalled');
  });
});

function createTestConvex() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

async function seedGithubInstallation(
  t: AppTestConvex,
  ownerTokenIdentifier: string,
  installationId: number,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('githubInstallations', {
      ownerTokenIdentifier,
      installationId,
      accountLogin: `account-${installationId}`,
      accountType: 'User',
      status: 'active',
      repositorySelection: 'all',
      connectedAt: Date.now(),
    });
  });
}

async function createRepositoryFixture(
  t: AppTestConvex,
  ownerTokenIdentifier: string,
  slug: string,
  options?: {
    withSandbox?: boolean;
  },
) {
  return await t.run(async (ctx) => {
    const repositoryId = await ctx.db.insert('repositories', {
      ownerTokenIdentifier,
      sourceHost: 'github',
      sourceUrl: `https://github.com/acme/${slug}`,
      sourceRepoFullName: `acme/${slug}`,
      sourceRepoOwner: 'acme',
      sourceRepoName: slug,
      defaultBranch: 'main',
      visibility: 'private',
      accessMode: 'private',
      importStatus: 'completed',
      detectedLanguages: [],
      packageManagers: [],
      entrypoints: [],
      fileCount: 0,
    });

    const threadId = await ctx.db.insert('threads', {
      repositoryId,
      ownerTokenIdentifier,
      title: `${slug} thread`,
      mode: 'discuss',
      lastMessageAt: Date.now(),
    });

    let sandboxId: Id<'sandboxes'> | undefined;
    if (options?.withSandbox) {
      sandboxId = await ctx.db.insert('sandboxes', {
        repositoryId,
        ownerTokenIdentifier,
        provider: 'daytona',
        sourceAdapter: 'git_clone',
        remoteId: `remote-${slug}`,
        status: 'ready',
        workDir: '/workspace',
        repoPath: `/workspace/${slug}`,
        cpuLimit: 2,
        memoryLimitGiB: 4,
        diskLimitGiB: 10,
        ttlExpiresAt: Date.now() + 60 * 60_000,
        autoStopIntervalMinutes: 30,
        autoArchiveIntervalMinutes: 60,
        autoDeleteIntervalMinutes: 120,
        networkBlockAll: false,
      });

      await ctx.db.patch(repositoryId, {
        latestSandboxId: sandboxId,
      });
    }

    return { repositoryId, threadId, sandboxId };
  });
}

async function getOwnerImportCounts(t: AppTestConvex, ownerTokenIdentifier: string) {
  return await t.run(async (ctx) => {
    const repositories = await ctx.db
      .query('repositories')
      .withIndex('by_ownerTokenIdentifier', (q) => q.eq('ownerTokenIdentifier', ownerTokenIdentifier))
      .take(20);
    const imports = await ctx.db
      .query('imports')
      .withIndex('by_ownerTokenIdentifier', (q) => q.eq('ownerTokenIdentifier', ownerTokenIdentifier))
      .take(20);
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_ownerTokenIdentifier', (q) => q.eq('ownerTokenIdentifier', ownerTokenIdentifier))
      .take(20);

    return {
      repositories: repositories.length,
      imports: imports.length,
      jobs: jobs.length,
    };
  });
}

async function countRepositoryJobs(t: AppTestConvex, repositoryId: Id<'repositories'>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', repositoryId))
      .take(20);
    return jobs.length;
  });
}

async function getThreadCounts(t: AppTestConvex, threadId: Id<'threads'>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .take(50);
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .take(100);
    const streams = await ctx.db
      .query('messageStreams')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .take(50);
    let streamChunks = 0;
    for (const stream of streams) {
      const chunks = await ctx.db
        .query('messageStreamChunks')
        .withIndex('by_streamId_and_sequence', (q) => q.eq('streamId', stream._id))
        .take(100);
      streamChunks += chunks.length;
    }

    return {
      jobs: jobs.length,
      messages: messages.length,
      streams: streams.length,
      streamChunks,
    };
  });
}

async function completeJob(t: AppTestConvex, jobId: Id<'jobs'>) {
  await t.run(async (ctx) => {
    await ctx.db.patch(jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 1,
      completedAt: Date.now(),
      leaseExpiresAt: undefined,
    });
  });
}

function expectStructuredError(
  error: any,
  code: 'RATE_LIMIT_EXCEEDED' | 'OPERATION_ALREADY_IN_PROGRESS',
  bucket: string,
) {
  const data = typeof error?.data === 'string' ? JSON.parse(error.data) : error?.data;
  expect(data).toMatchObject({
    code,
    bucket,
  });
  expect(data.message).toEqual(expect.any(String));
  if (code === 'RATE_LIMIT_EXCEEDED') {
    expect(data.retryAfterMs).toEqual(expect.any(Number));
  }
}
