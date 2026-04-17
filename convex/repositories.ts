import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation, query, internalQuery, internalMutation } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';
import { makeRepositoryTitle, parseGitHubUrl } from './lib/github';

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

    return {
      repository,
      artifacts,
      jobs: jobs.sort((left, right) => (right._creationTime ?? 0) - (left._creationTime ?? 0)),
      threads,
      fileCount,
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

export const cascadeDeleteRepository = internalMutation({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const batchSize = 200;
    let needsContinuation = false;

    // Delete threads and their messages
    const threads = await ctx.db
      .query('threads')
      .withIndex('by_repositoryId_and_lastMessageAt', (q) => q.eq('repositoryId', args.repositoryId))
      .take(50);
    for (const thread of threads) {
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_threadId', (q) => q.eq('threadId', thread._id))
        .take(batchSize);
      for (const message of messages) {
        await ctx.db.delete(message._id);
      }
      if (messages.length < batchSize) {
        await ctx.db.delete(thread._id);
      } else {
        needsContinuation = true;
      }
    }
    if (threads.length === 50) needsContinuation = true;

    // Delete jobs
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(batchSize);
    for (const job of jobs) {
      await ctx.db.delete(job._id);
    }
    if (jobs.length === batchSize) needsContinuation = true;

    // Delete analysis artifacts
    const artifacts = await ctx.db
      .query('analysisArtifacts')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(batchSize);
    for (const artifact of artifacts) {
      await ctx.db.delete(artifact._id);
    }
    if (artifacts.length === batchSize) needsContinuation = true;

    // Delete repo chunks
    const chunks = await ctx.db
      .query('repoChunks')
      .withIndex('by_repositoryId_and_path', (q) => q.eq('repositoryId', args.repositoryId))
      .take(batchSize);
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
    if (chunks.length === batchSize) needsContinuation = true;

    // Delete repo files
    const files = await ctx.db
      .query('repoFiles')
      .withIndex('by_repositoryId_and_path', (q) => q.eq('repositoryId', args.repositoryId))
      .take(batchSize);
    for (const file of files) {
      await ctx.db.delete(file._id);
    }
    if (files.length === batchSize) needsContinuation = true;

    // Delete imports
    const imports = await ctx.db
      .query('imports')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(batchSize);
    for (const imp of imports) {
      await ctx.db.delete(imp._id);
    }
    if (imports.length === batchSize) needsContinuation = true;

    // Delete sandboxes
    const sandboxes = await ctx.db
      .query('sandboxes')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .take(batchSize);
    for (const sandbox of sandboxes) {
      await ctx.db.delete(sandbox._id);
    }
    if (sandboxes.length === batchSize) needsContinuation = true;

    // Self-schedule if any table still has remaining records
    if (needsContinuation) {
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
