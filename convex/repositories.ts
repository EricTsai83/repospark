import { v } from 'convex/values';
import type { GenericDatabaseWriter } from 'convex/server';
import type { DataModel, TableNames } from './_generated/dataModel';
import { internal } from './_generated/api';
import { mutation, query, internalQuery, internalMutation } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';
import { makeRepositoryTitle, parseGitHubUrl } from './lib/github';
import { CASCADE_BATCH_SIZE } from './lib/constants';

export const listRepositories = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireViewerIdentity(ctx);
    const repositories = await ctx.db
      .query('repositories')
      .withIndex('by_ownerTokenIdentifier', (q) => q.eq('ownerTokenIdentifier', identity.tokenIdentifier))
      .take(100);

    return repositories.sort((left, right) => (right.lastImportedAt ?? 0) - (left.lastImportedAt ?? 0));
  },
});

export const getRepositoryDetail = query({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    const artifacts = await ctx.db
      .query('analysisArtifacts')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(20);
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(30);
    const threads = await ctx.db
      .query('threads')
      .withIndex('by_repositoryId_and_lastMessageAt', (q) => q.eq('repositoryId', args.repositoryId))
      .order('desc')
      .take(10);

    const latestImportId = repository.latestImportId;
    const fileCount = latestImportId
      ? (
          await ctx.db
            .query('repoFiles')
            .withIndex('by_importId', (q) => q.eq('importId', latestImportId))
            .take(400)
        ).length
      : 0;

    const sandbox = repository.latestSandboxId ? await ctx.db.get(repository.latestSandboxId) : null;

    // Determine whether Deep mode is available right now
    const deepModeAvailable =
      sandbox !== null &&
      sandbox.status !== 'archived' &&
      sandbox.status !== 'failed' &&
      Date.now() <= sandbox.ttlExpiresAt;

    // Determine whether the remote has commits we haven't synced yet
    const hasRemoteUpdates =
      !!repository.latestRemoteSha &&
      !!repository.lastSyncedCommitSha &&
      repository.latestRemoteSha !== repository.lastSyncedCommitSha;

    return {
      repository,
      artifacts,
      jobs: jobs.sort((left, right) => (right._creationTime ?? 0) - (left._creationTime ?? 0)),
      threads,
      fileCount,
      deepModeAvailable,
      hasRemoteUpdates,
      sandbox: sandbox
        ? {
            status: sandbox.status,
            ttlExpiresAt: sandbox.ttlExpiresAt,
            autoStopIntervalMinutes: sandbox.autoStopIntervalMinutes,
            autoArchiveIntervalMinutes: sandbox.autoArchiveIntervalMinutes,
          }
        : null,
    };
  },
});

export const createRepositoryImport = mutation({
  args: {
    url: v.string(),
    branch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const parsed = parseGitHubUrl(args.url);

    let repository = await ctx.db
      .query('repositories')
      .withIndex('by_ownerTokenIdentifier_and_sourceUrl', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier).eq('sourceUrl', parsed.normalizedUrl),
      )
      .unique();

    let repositoryId = repository?._id;
    let defaultThreadId = repository?.defaultThreadId;

    if (!repository) {
      repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier: identity.tokenIdentifier,
        sourceHost: 'github',
        sourceUrl: parsed.normalizedUrl,
        sourceRepoFullName: parsed.fullName,
        sourceRepoOwner: parsed.owner,
        sourceRepoName: parsed.repo,
        defaultBranch: args.branch ?? parsed.branch,
        visibility: 'public',
        accessMode: 'public',
        importStatus: 'idle',
        detectedLanguages: [],
        packageManagers: [],
        entrypoints: [],
      });

      defaultThreadId = await ctx.db.insert('threads', {
        repositoryId,
        ownerTokenIdentifier: identity.tokenIdentifier,
        title: `${makeRepositoryTitle(parsed.fullName)} chat`,
        mode: 'fast',
        lastMessageAt: Date.now(),
      });

      await ctx.db.patch(repositoryId, {
        defaultThreadId,
      });

      repository = await ctx.db.get(repositoryId);
    }

    if (!repositoryId || !repository) {
      throw new Error('Failed to create repository.');
    }

    const now = Date.now();
    const jobId = await ctx.db.insert('jobs', {
      repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      kind: 'import',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      costCategory: 'indexing',
      triggerSource: 'user',
    });

    const importId = await ctx.db.insert('imports', {
      repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      sourceUrl: parsed.normalizedUrl,
      branch: args.branch ?? parsed.branch ?? repository.defaultBranch,
      adapterKind: 'git_clone',
      status: 'queued',
      jobId,
    });

    await ctx.db.patch(repositoryId, {
      importStatus: 'queued',
      latestImportId: importId,
      latestImportJobId: jobId,
      lastImportedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.importsNode.runImportPipeline, {
      importId,
    });

    return {
      repositoryId,
      importId,
      jobId,
      defaultThreadId,
    };
  },
});

export const syncRepository = mutation({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    // Prevent duplicate syncs while one is already running
    if (repository.importStatus === 'queued' || repository.importStatus === 'running') {
      throw new Error('A sync is already in progress for this repository.');
    }

    const now = Date.now();
    const jobId = await ctx.db.insert('jobs', {
      repositoryId: args.repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      kind: 'import',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      costCategory: 'indexing',
      triggerSource: 'user',
    });

    const importId = await ctx.db.insert('imports', {
      repositoryId: args.repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      sourceUrl: repository.sourceUrl,
      branch: repository.defaultBranch,
      adapterKind: 'git_clone',
      status: 'queued',
      jobId,
    });

    await ctx.db.patch(args.repositoryId, {
      importStatus: 'queued',
      latestImportId: importId,
      latestImportJobId: jobId,
      lastImportedAt: now,
      // Clear remote SHA so the "updates available" indicator disappears
      // immediately when the user triggers a sync.
      latestRemoteSha: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.importsNode.runImportPipeline, {
      importId,
    });

    return { jobId, importId };
  },
});

export const deleteRepository = mutation({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    // Delete the repository immediately so it disappears from the UI
    await ctx.db.delete(args.repositoryId);

    // Schedule cascading deletion of all related data
    await ctx.scheduler.runAfter(0, internal.repositories.cascadeDeleteRepository, {
      repositoryId: args.repositoryId,
    });
  },
});

/**
 * Drains up to `batchSize` documents from a table using the given index,
 * deleting each one. Returns `true` if the table may still have more rows.
 */
async function drainTable<T extends TableNames>(
  db: GenericDatabaseWriter<DataModel>,
  table: T,
  indexName: string,
  field: string,
  value: string,
  batchSize: number,
): Promise<boolean> {
  const docs = await (db
    .query(table)
    .withIndex(indexName, (q: any) => q.eq(field, value)) as any)
    .take(batchSize);
  for (const doc of docs) {
    await db.delete(doc._id);
  }
  return docs.length === batchSize;
}

export const cascadeDeleteRepository = internalMutation({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    let more = false;

    // Delete threads and their messages (threads need special handling)
    const threads = await ctx.db
      .query('threads')
      .withIndex('by_repositoryId_and_lastMessageAt', (q) => q.eq('repositoryId', args.repositoryId))
      .take(50);
    for (const thread of threads) {
      const msgs = await ctx.db
        .query('messages')
        .withIndex('by_threadId', (q) => q.eq('threadId', thread._id))
        .take(CASCADE_BATCH_SIZE);
      for (const msg of msgs) await ctx.db.delete(msg._id);
      if (msgs.length < CASCADE_BATCH_SIZE) {
        await ctx.db.delete(thread._id);
      } else {
        more = true;
      }
    }
    if (threads.length === 50) more = true;

    // Drain remaining tables
    more = await drainTable(ctx.db, 'jobs', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'analysisArtifacts', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'repoChunks', 'by_repositoryId_and_path', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'repoFiles', 'by_repositoryId_and_path', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'imports', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'sandboxes', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;

    // Self-schedule if any table still has remaining records
    if (more) {
      await ctx.scheduler.runAfter(0, internal.repositories.cascadeDeleteRepository, {
        repositoryId: args.repositoryId,
      });
    }
  },
});

export const getRepositoryForProcessing = internalQuery({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) {
      throw new Error('Repository not found.');
    }

    const artifacts = await ctx.db
      .query('analysisArtifacts')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(20);
    const chunks = await ctx.db
      .query('repoChunks')
      .withIndex('by_repositoryId_and_path', (q) => q.eq('repositoryId', args.repositoryId))
      .take(60);

    return {
      repository,
      artifacts,
      chunks,
    };
  },
});
