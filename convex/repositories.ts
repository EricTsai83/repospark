import { v } from 'convex/values';
import type { GenericDatabaseWriter } from 'convex/server';
import type { DataModel, TableNames } from './_generated/dataModel';
import { internal } from './_generated/api';
import { mutation, query, internalQuery, internalMutation } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';
import { isDeepModeAvailable } from './lib/sandboxAvailability';
import { makeRepositoryTitle, parseGitHubUrl } from './lib/github';
import { CASCADE_BATCH_SIZE } from './lib/constants';

const FILE_COUNT_DISPLAY_LIMIT = 400;
const REPOSITORY_DELETE_RETRY_MS = 5_000;

function isRepositoryDeleting(repository: { deletionRequestedAt?: number } | null | undefined) {
  return typeof repository?.deletionRequestedAt === 'number';
}

export const listRepositories = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireViewerIdentity(ctx);
    const repositories = await ctx.db
      .query('repositories')
      .withIndex('by_ownerTokenIdentifier', (q) => q.eq('ownerTokenIdentifier', identity.tokenIdentifier))
      .take(100);

    return repositories
      .filter((repository) => !isRepositoryDeleting(repository))
      .sort((left, right) => (right.lastImportedAt ?? 0) - (left.lastImportedAt ?? 0));
  },
});

/**
 * Returns a summary of all imported repositories for the current user,
 * keyed by `sourceRepoFullName`. Used by the authorized-repos dialog
 * to show import status alongside each GitHub-authorised repo.
 */
export const getImportedRepoSummaries = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireViewerIdentity(ctx);
    const repos = await ctx.db
      .query('repositories')
      .withIndex('by_ownerTokenIdentifier', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier),
      )
      .take(200);

    const summaries: Record<
      string,
      {
        importStatus: string;
        lastImportedAt: number | undefined;
        hasRemoteUpdates: boolean;
      }
    > = {};

    for (const repo of repos) {
      if (isRepositoryDeleting(repo)) {
        continue;
      }

      summaries[repo.sourceRepoFullName] = {
        importStatus: repo.importStatus,
        lastImportedAt: repo.lastImportedAt,
        hasRemoteUpdates:
          !!repo.latestRemoteSha &&
          !!repo.lastSyncedCommitSha &&
          repo.latestRemoteSha !== repo.lastSyncedCommitSha,
      };
    }

    return summaries;
  },
});

export const getRepositoryDetail = query({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (
      !repository ||
      isRepositoryDeleting(repository) ||
      repository.ownerTokenIdentifier !== identity.tokenIdentifier
    ) {
      throw new Error('Repository not found.');
    }

    const currentImportArtifacts = repository.latestImportJobId
      ? await ctx.db
          .query('analysisArtifacts')
          .withIndex('by_jobId', (q) => q.eq('jobId', repository.latestImportJobId!))
          .take(10)
      : [];
    const recentDeepAnalysisArtifacts = await ctx.db
      .query('analysisArtifacts')
      .withIndex('by_repositoryId_and_kind', (q) =>
        q.eq('repositoryId', args.repositoryId).eq('kind', 'deep_analysis'),
      )
      .order('desc')
      .take(Math.max(0, 20 - currentImportArtifacts.length));
    const artifacts = [...currentImportArtifacts, ...recentDeepAnalysisArtifacts];
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .order('desc')
      .take(30);
    const threads = await ctx.db
      .query('threads')
      .withIndex('by_repositoryId_and_lastMessageAt', (q) => q.eq('repositoryId', args.repositoryId))
      .order('desc')
      .take(10);

    const latestImportId = repository.latestImportId;
    const sampledFiles = latestImportId
      ? await ctx.db
          .query('repoFiles')
          .withIndex('by_importId', (q) => q.eq('importId', latestImportId))
          .take(FILE_COUNT_DISPLAY_LIMIT + 1)
      : [];
    const fileCount = Math.min(sampledFiles.length, FILE_COUNT_DISPLAY_LIMIT);
    const fileCountLabel =
      sampledFiles.length > FILE_COUNT_DISPLAY_LIMIT ? `${FILE_COUNT_DISPLAY_LIMIT}+` : String(fileCount);

    const sandbox = repository.latestSandboxId ? await ctx.db.get(repository.latestSandboxId) : null;

    // Determine whether Deep mode is available right now
    const deepModeAvailable = isDeepModeAvailable(sandbox);

    // Determine whether the remote has commits we haven't synced yet
    const hasRemoteUpdates =
      !!repository.latestRemoteSha &&
      !!repository.lastSyncedCommitSha &&
      repository.latestRemoteSha !== repository.lastSyncedCommitSha;

    return {
      repository,
      artifacts,
      jobs,
      threads,
      fileCount,
      fileCountLabel,
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

    // Check if user has GitHub connected via GitHub App installation
    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_ownerTokenIdentifier_and_status', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier).eq('status', 'active'),
      )
      .first();

    if (!installation) {
      throw new Error('Please connect your GitHub account first to import repositories.');
    }

    // Installation tokens can access both public and private repos
    const accessMode = 'private' as const;

    let repository = await ctx.db
      .query('repositories')
      .withIndex('by_ownerTokenIdentifier_and_sourceUrl', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier).eq('sourceUrl', parsed.normalizedUrl),
      )
      .unique();

    let repositoryId = repository?._id;
    let defaultThreadId = repository?.defaultThreadId;

    if (repository && isRepositoryDeleting(repository)) {
      throw new Error('Repository deletion is already in progress.');
    }

    if (repository && (repository.importStatus === 'queued' || repository.importStatus === 'running')) {
      throw new Error('An import is already in progress for this repository.');
    }

    if (!repository) {
      // Visibility will be updated after the import pipeline checks GitHub API.
      // Default to 'unknown' until the actual check completes.
      repositoryId = await ctx.db.insert('repositories', {
        ownerTokenIdentifier: identity.tokenIdentifier,
        sourceHost: 'github',
        sourceUrl: parsed.normalizedUrl,
        sourceRepoFullName: parsed.fullName,
        sourceRepoOwner: parsed.owner,
        sourceRepoName: parsed.repo,
        defaultBranch: args.branch ?? parsed.branch,
        visibility: 'unknown',
        accessMode,
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
      accessMode,
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
    if (
      !repository ||
      isRepositoryDeleting(repository) ||
      repository.ownerTokenIdentifier !== identity.tokenIdentifier
    ) {
      throw new Error('Repository not found.');
    }

    // Check if user has an active GitHub installation
    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_ownerTokenIdentifier_and_status', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier).eq('status', 'active'),
      )
      .first();

    if (!installation) {
      throw new Error('Please connect your GitHub account first to sync repositories.');
    }

    // Prevent duplicate syncs while one is already running
    if (repository.importStatus === 'queued' || repository.importStatus === 'running') {
      throw new Error('A sync is already in progress for this repository.');
    }

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

    if (isRepositoryDeleting(repository)) {
      return;
    }

    await ctx.db.patch(args.repositoryId, {
      deletionRequestedAt: Date.now(),
    });

    await ctx.runMutation(internal.ops.scheduleRepositorySandboxCleanup, {
      repositoryId: args.repositoryId,
    });

    // Schedule cascading deletion of all related data once background jobs have
    // had a chance to observe the tombstone and stop cleanly.
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
    const cleanupState: { pendingCleanupCount: number } = await ctx.runMutation(
      internal.ops.scheduleRepositorySandboxCleanup,
      {
        repositoryId: args.repositoryId,
      },
    );
    let more = false;
    let waitingOnSandboxCleanup = cleanupState.pendingCleanupCount > 0;

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

    // Drain remaining tables, but keep cleanup jobs until sandbox deletion has finished.
    more = await drainTable(ctx.db, 'analysisArtifacts', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'repoChunks', 'by_repositoryId_and_path', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'repoFiles', 'by_repositoryId_and_path', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    more = await drainTable(ctx.db, 'imports', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;

    const sandboxes = await ctx.db
      .query('sandboxes')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .order('desc')
      .take(CASCADE_BATCH_SIZE);
    for (const sandbox of sandboxes) {
      if (sandbox.status === 'archived') {
        await ctx.db.delete(sandbox._id);
      } else {
        waitingOnSandboxCleanup = true;
      }
    }
    if (sandboxes.length === CASCADE_BATCH_SIZE) {
      more = true;
    }

    if (!waitingOnSandboxCleanup) {
      more = await drainTable(ctx.db, 'jobs', 'by_repositoryId', 'repositoryId', args.repositoryId, CASCADE_BATCH_SIZE) || more;
    }

    // Self-schedule if any table still has remaining records
    if (more || waitingOnSandboxCleanup) {
      await ctx.scheduler.runAfter(waitingOnSandboxCleanup ? REPOSITORY_DELETE_RETRY_MS : 0, internal.repositories.cascadeDeleteRepository, {
        repositoryId: args.repositoryId,
      });
      return;
    }

    const repository = await ctx.db.get(args.repositoryId);
    if (repository) {
      await ctx.db.delete(args.repositoryId);
    }
  },
});

export const updateRepoVisibility = internalMutation({
  args: {
    repositoryId: v.id('repositories'),
    visibility: v.union(v.literal('public'), v.literal('private')),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repositoryId);
    if (!repo) return;
    await ctx.db.patch(args.repositoryId, { visibility: args.visibility });
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

    const artifacts = repository.latestImportJobId
      ? await ctx.db
          .query('analysisArtifacts')
          .withIndex('by_jobId', (q) => q.eq('jobId', repository.latestImportJobId!))
          .take(20)
      : [];
    const chunks = repository.latestImportId
      ? await ctx.db
          .query('repoChunks')
          .withIndex('by_importId_and_path_and_chunkIndex', (q) =>
            q.eq('importId', repository.latestImportId!),
          )
          .take(60)
      : [];

    return {
      repository,
      artifacts,
      chunks,
    };
  },
});
