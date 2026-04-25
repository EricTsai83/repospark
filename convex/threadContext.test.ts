/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const OWNER = 'user|thread-context-test';
const OTHER_OWNER = 'user|thread-context-other';

interface SeedOptions {
  withRepository?: boolean;
  sandboxStatus?: 'provisioning' | 'ready' | 'stopped' | 'archived' | 'failed' | null;
  ownerTokenIdentifier?: string;
}

async function seedThread(
  t: ReturnType<typeof convexTest>,
  options: SeedOptions = {},
): Promise<{
  threadId: Id<'threads'>;
  repositoryId: Id<'repositories'> | null;
  sandboxId: Id<'sandboxes'> | null;
}> {
  const owner = options.ownerTokenIdentifier ?? OWNER;
  return await t.run(async (ctx) => {
    let repositoryId: Id<'repositories'> | null = null;
    let sandboxId: Id<'sandboxes'> | null = null;

    if (options.withRepository) {
      repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier: owner,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/widget',
        sourceRepoFullName: 'acme/widget',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'widget',
        visibility: 'unknown',
        accessMode: 'private',
        importStatus: 'idle',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
        fileCount: 0,
      });

      if (options.sandboxStatus) {
        sandboxId = await ctx.db.insert('sandboxes', {
          repositoryId,
          ownerTokenIdentifier: owner,
          provider: 'daytona',
          sourceAdapter: 'git_clone',
          remoteId: 'remote-1',
          status: options.sandboxStatus,
          workDir: '/work',
          repoPath: '/work/repo',
          cpuLimit: 1,
          memoryLimitGiB: 1,
          diskLimitGiB: 5,
          ttlExpiresAt: Date.now() + 60_000,
          autoStopIntervalMinutes: 10,
          autoArchiveIntervalMinutes: 30,
          autoDeleteIntervalMinutes: 60,
          networkBlockAll: false,
        });

        await ctx.db.patch(repositoryId, { latestSandboxId: sandboxId });
      }
    }

    const threadId = await ctx.db.insert('threads', {
      repositoryId: repositoryId ?? undefined,
      ownerTokenIdentifier: owner,
      title: 'thread',
      mode: 'fast',
      lastMessageAt: Date.now(),
    });

    return { threadId, repositoryId, sandboxId };
  });
}

describe('getThreadContext (internal)', () => {
  test('returns null when the thread does not exist', async () => {
    const t = convexTest(schema, modules);
    const fakeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('threads', {
        ownerTokenIdentifier: OWNER,
        title: 'temp',
        mode: 'fast',
        lastMessageAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId: fakeId,
    });
    expect(result).toBeNull();
  });

  test('thread without a repository: only general mode is available', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, { withRepository: false });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result).not.toBeNull();
    expect(result!.attachedRepository).toBeNull();
    expect(result!.sandboxStatus).toBeNull();
    expect(result!.chatModes.availableModes).toEqual(['general']);
    expect(result!.chatModes.defaultMode).toBe('general');
    expect(Object.keys(result!.chatModes.disabledReasons).sort()).toEqual(['deep', 'grounded']);
  });

  test('thread with repository but no sandbox: general + grounded available', async () => {
    const t = convexTest(schema, modules);
    const { threadId, repositoryId } = await seedThread(t, { withRepository: true });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result!.attachedRepository?._id).toBe(repositoryId);
    expect(result!.sandboxStatus).toBeNull();
    expect(result!.chatModes.availableModes).toEqual(['general', 'grounded']);
    expect(result!.chatModes.defaultMode).toBe('grounded');
    expect(Object.keys(result!.chatModes.disabledReasons)).toEqual(['deep']);
  });

  test('thread with repository and ready sandbox: all three modes available, default grounded', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: true,
      sandboxStatus: 'ready',
    });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result!.sandboxStatus).toBe('ready');
    expect(result!.chatModes.availableModes).toEqual(['general', 'grounded', 'deep']);
    expect(result!.chatModes.defaultMode).toBe('grounded');
    expect(result!.chatModes.disabledReasons).toEqual({});
  });

  test('thread with stopped sandbox maps to expired in resolver input', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: true,
      sandboxStatus: 'stopped',
    });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result!.sandboxStatus).toBe('stopped');
    expect(result!.chatModes.availableModes).toEqual(['general', 'grounded']);
    expect(result!.chatModes.disabledReasons.deep).toMatch(/expired|provision a new sandbox/i);
  });

  test('thread with archived sandbox maps to expired in resolver input', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: true,
      sandboxStatus: 'archived',
    });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result!.sandboxStatus).toBe('archived');
    expect(result!.chatModes.availableModes).toEqual(['general', 'grounded']);
    expect(result!.chatModes.disabledReasons.deep).toMatch(/expired|provision a new sandbox/i);
  });

  test('thread with provisioning sandbox surfaces a provisioning hint for deep mode', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: true,
      sandboxStatus: 'provisioning',
    });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result!.sandboxStatus).toBe('provisioning');
    expect(result!.chatModes.availableModes).toEqual(['general', 'grounded']);
    expect(result!.chatModes.disabledReasons.deep).toMatch(/provisioning/i);
  });

  test('thread with failed sandbox surfaces a failed hint for deep mode', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: true,
      sandboxStatus: 'failed',
    });

    const result = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(result!.sandboxStatus).toBe('failed');
    expect(result!.chatModes.disabledReasons.deep).toMatch(/failed|provision a new sandbox/i);
  });
});

describe('getThreadContext (public, owner-scoped)', () => {
  test('rejects access from a different owner', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: false,
      ownerTokenIdentifier: OWNER,
    });

    const intruder = t.withIdentity({ tokenIdentifier: OTHER_OWNER });
    await expect(
      intruder.query(api.threadContext.getThreadContext, { threadId }),
    ).rejects.toThrow();
  });

  test('returns the same shape as the internal query for the owner', async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThread(t, {
      withRepository: true,
      sandboxStatus: 'ready',
    });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    const publicResult = await viewer.query(api.threadContext.getThreadContext, { threadId });
    const internalResult = await t.query(internal.threadContext.getThreadContextInternal, {
      threadId,
    });

    expect(publicResult).not.toBeNull();
    expect(publicResult!.thread._id).toBe(internalResult!.thread._id);
    expect(publicResult!.chatModes).toEqual(internalResult!.chatModes);
  });
});
