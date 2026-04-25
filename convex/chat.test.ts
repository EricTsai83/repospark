/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function insertRepository(
  t: ReturnType<typeof convexTest>,
  ownerTokenIdentifier: string,
): Promise<Id<'repositories'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('repositories', {
      ownerTokenIdentifier,
      sourceHost: 'github',
      sourceUrl: 'https://github.com/acme/widget',
      sourceRepoFullName: 'acme/widget',
      sourceRepoOwner: 'acme',
      sourceRepoName: 'widget',
      defaultBranch: 'main',
      visibility: 'private',
      accessMode: 'private',
      importStatus: 'completed',
      detectedLanguages: [],
      packageManagers: [],
      entrypoints: [],
      fileCount: 0,
    });
  });
}

describe('chat thread defaults', () => {
  test('repo-less createThread and detach converge on the same persisted default mode', async () => {
    const ownerTokenIdentifier = 'user|chat-default-mode';
    const t = convexTest(schema, modules);
    const repositoryId = await insertRepository(t, ownerTokenIdentifier);

    const threadId = await t.run(async (ctx) => {
      return await ctx.db.insert('threads', {
        repositoryId,
        ownerTokenIdentifier,
        title: 'Grounded thread',
        mode: 'sandbox',
        lastMessageAt: Date.now(),
      });
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    await viewer.mutation(api.chat.setThreadRepository, {
      threadId,
      repositoryId: null,
    });
    const emptyThreadId = await viewer.mutation(api.chat.createThread, {});

    const { detachedThread, emptyThread } = await t.run(async (ctx) => ({
      detachedThread: await ctx.db.get(threadId),
      emptyThread: await ctx.db.get(emptyThreadId),
    }));

    expect(detachedThread?.repositoryId).toBeUndefined();
    expect(detachedThread?.mode).toBe('discuss');
    expect(emptyThread?.mode).toBe('discuss');
    expect(detachedThread?.mode).toBe(emptyThread?.mode);
  });

  test('createThread defaults to docs when a repository is attached', async () => {
    const ownerTokenIdentifier = 'user|chat-default-attached-mode';
    const t = convexTest(schema, modules);
    const repositoryId = await insertRepository(t, ownerTokenIdentifier);

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    const threadId = await viewer.mutation(api.chat.createThread, { repositoryId });

    const thread = await t.run(async (ctx) => await ctx.db.get(threadId));
    expect(thread?.mode).toBe('docs');
    expect(thread?.repositoryId).toBe(repositoryId);
  });
});
