/// <reference types="vite/client" />

import { describe, expect, test } from 'vitest';
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function createTestConvex() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

function activeInstallation(ownerTokenIdentifier: string, installationId: number) {
  return {
    ownerTokenIdentifier,
    installationId,
    accountLogin: `active-${installationId}`,
    accountType: 'User' as const,
    status: 'active' as const,
    repositorySelection: 'selected' as const,
    connectedAt: Date.now(),
  };
}

function deletedInstallation(ownerTokenIdentifier: string, installationId: number) {
  return {
    ownerTokenIdentifier,
    installationId,
    accountLogin: `deleted-${installationId}`,
    accountType: 'User' as const,
    status: 'deleted' as const,
    repositorySelection: 'selected' as const,
    connectedAt: Date.now() - 10_000,
    deletedAt: Date.now() - 5_000,
  };
}

describe('GitHub installation selection', () => {
  test('saveInstallation updates metadata when reconnecting the same installation', async () => {
    const ownerTokenIdentifier = 'user|same-installation';
    const t = createTestConvex();

    await t.run(async (ctx) => {
      await ctx.db.insert('githubInstallations', {
        ownerTokenIdentifier,
        installationId: 501,
        accountLogin: 'old-login',
        accountType: 'User',
        status: 'active',
        repositorySelection: 'selected',
        connectedAt: Date.now() - 10_000,
      });
    });

    const result = await t.mutation(internal.github.saveInstallation, {
      ownerTokenIdentifier,
      installationId: 501,
      accountLogin: 'new-login',
      accountType: 'Organization',
      repositorySelection: 'all',
    });

    expect(result).toEqual({
      kind: 'connected',
      installationId: 501,
    });

    const installations = await t.run(async (ctx) =>
      await ctx.db
        .query('githubInstallations')
        .withIndex('by_ownerTokenIdentifier', (q) => q.eq('ownerTokenIdentifier', ownerTokenIdentifier))
        .take(10),
    );
    expect(installations).toHaveLength(1);
    expect(installations[0]).toMatchObject({
      installationId: 501,
      accountLogin: 'new-login',
      accountType: 'Organization',
      repositorySelection: 'all',
      status: 'active',
    });
  });

  test('saveInstallation returns a conflict instead of overwriting a different active installation', async () => {
    const ownerTokenIdentifier = 'user|installation-conflict';
    const t = createTestConvex();

    await t.run(async (ctx) => {
      await ctx.db.insert('githubInstallations', activeInstallation(ownerTokenIdentifier, 601));
    });

    const result = await t.mutation(internal.github.saveInstallation, {
      ownerTokenIdentifier,
      installationId: 602,
      accountLogin: 'new-account',
      accountType: 'Organization',
      repositorySelection: 'all',
    });

    expect(result).toEqual({
      kind: 'conflict',
      existingInstallationId: 601,
      existingAccountLogin: 'active-601',
    });

    const activeInstallations = await t.run(async (ctx) =>
      await ctx.db
        .query('githubInstallations')
        .withIndex('by_ownerTokenIdentifier_and_status', (q) =>
          q.eq('ownerTokenIdentifier', ownerTokenIdentifier).eq('status', 'active'),
        )
        .take(10),
    );
    expect(activeInstallations).toHaveLength(1);
    expect(activeInstallations[0]?.installationId).toBe(601);
  });

  test('connection status ignores deleted installations that were created first', async () => {
    const ownerTokenIdentifier = 'user|github-status';
    const t = createTestConvex();

    await t.run(async (ctx) => {
      await ctx.db.insert('githubInstallations', deletedInstallation(ownerTokenIdentifier, 101));
      await ctx.db.insert('githubInstallations', activeInstallation(ownerTokenIdentifier, 202));
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    const status = await viewer.query(api.github.getGitHubConnectionStatus, {});

    expect(status).toMatchObject({
      isConnected: true,
      installationId: 202,
      accountLogin: 'active-202',
      repositorySelection: 'selected',
    });
  });

  test('syncRepository uses the active installation when history rows exist', async () => {
    const ownerTokenIdentifier = 'user|sync';
    const t = createTestConvex();

    const repositoryId = await t.run(async (ctx) => {
      await ctx.db.insert('githubInstallations', deletedInstallation(ownerTokenIdentifier, 301));
      await ctx.db.insert('githubInstallations', activeInstallation(ownerTokenIdentifier, 302));

      return await ctx.db.insert('repositories', {
        ownerTokenIdentifier,
        sourceHost: 'github',
        sourceUrl: 'https://github.com/acme/repo',
        sourceRepoFullName: 'acme/repo',
        sourceRepoOwner: 'acme',
        sourceRepoName: 'repo',
        defaultBranch: 'main',
        visibility: 'private',
        accessMode: 'private',
        importStatus: 'idle',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
        fileCount: 0,
      });
    });

    const viewer = t.withIdentity({ tokenIdentifier: ownerTokenIdentifier });
    const result = await viewer.mutation(api.repositories.syncRepository, { repositoryId });

    expect(result.jobId).toBeTruthy();
    expect(result.importId).toBeTruthy();

    const repository = await t.run(async (ctx) => await ctx.db.get(repositoryId));
    expect(repository?.importStatus).toBe('queued');
  });

  test('getInstallationIdForOwner returns the active installation id', async () => {
    const ownerTokenIdentifier = 'user|installation-query';
    const t = createTestConvex();

    await t.run(async (ctx) => {
      await ctx.db.insert('githubInstallations', deletedInstallation(ownerTokenIdentifier, 401));
      await ctx.db.insert('githubInstallations', activeInstallation(ownerTokenIdentifier, 402));
    });

    const installationId = await t.query(internal.github.getInstallationIdForOwner, {
      ownerTokenIdentifier,
    });

    expect(installationId).toBe(402);
  });
});
