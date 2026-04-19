import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { CASCADE_BATCH_SIZE } from './lib/constants';

const REPOSITORY_DELETION_CANCEL_REASON =
  'Repository deletion is in progress. The import was cancelled before it could finish.';

async function finalizeImportCancellation(
  ctx: MutationCtx,
  args: {
    importId: Id<'imports'>;
    jobId: Id<'jobs'>;
    reason: string;
  },
) {
  const now = Date.now();
  const importRecord = await ctx.db.get(args.importId);
  const job = await ctx.db.get(args.jobId);

  if (importRecord) {
    await ctx.db.patch(args.importId, {
      status: 'cancelled',
      completedAt: now,
      errorMessage: args.reason,
    });
  }

  if (job) {
    await ctx.db.patch(args.jobId, {
      status: 'cancelled',
      stage: 'cancelled',
      progress: 1,
      completedAt: now,
      outputSummary: args.reason,
      errorMessage: args.reason,
    });
  }
}

export const getImportContext = internalQuery({
  args: {
    importId: v.id('imports'),
  },
  handler: async (ctx, args) => {
    const importRecord = await ctx.db.get(args.importId);
    if (!importRecord) {
      return null;
    }

    const repository = await ctx.db.get(importRecord.repositoryId);
    if (!repository || repository.deletionRequestedAt) {
      return {
        kind: 'cancelled' as const,
        jobId: importRecord.jobId,
        reason: REPOSITORY_DELETION_CANCEL_REASON,
      };
    }

    return {
      kind: 'ready' as const,
      repositoryId: repository._id,
      jobId: importRecord.jobId,
      branch: importRecord.branch,
      sourceUrl: importRecord.sourceUrl,
      ownerTokenIdentifier: importRecord.ownerTokenIdentifier,
      accessMode: repository.accessMode,
      sourceRepoFullName: repository.sourceRepoFullName,
    };
  },
});

export const getExistingSandboxForRepo = internalQuery({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository?.latestSandboxId) {
      return null;
    }
    const sandbox = await ctx.db.get(repository.latestSandboxId);
    if (!sandbox || sandbox.status === 'archived') {
      return null;
    }
    return { sandboxId: sandbox._id, remoteId: sandbox.remoteId };
  },
});

export const archiveSandbox = internalMutation({
  args: {
    sandboxId: v.id('sandboxes'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      status: 'archived',
    });
  },
});

export const markImportRunning = internalMutation({
  args: {
    importId: v.id('imports'),
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    const importRecord = await ctx.db.get(args.importId);
    const job = await ctx.db.get(args.jobId);
    const repository = importRecord ? await ctx.db.get(importRecord.repositoryId) : null;

    if (!importRecord || !job || !repository || repository.deletionRequestedAt) {
      return {
        kind: 'cancelled' as const,
        reason: REPOSITORY_DELETION_CANCEL_REASON,
      };
    }

    const now = Date.now();
    await ctx.db.patch(args.importId, {
      status: 'running',
      startedAt: now,
    });
    await ctx.db.patch(args.jobId, {
      status: 'running',
      stage: 'provisioning_sandbox',
      progress: 0.1,
      startedAt: now,
    });

    return {
      kind: 'running' as const,
    };
  },
});

export const registerSandbox = internalMutation({
  args: {
    importId: v.id('imports'),
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    sourceAdapter: v.union(v.literal('git_clone'), v.literal('source_service')),
    remoteId: v.string(),
    workDir: v.string(),
    repoPath: v.string(),
    cpuLimit: v.number(),
    memoryLimitGiB: v.number(),
    diskLimitGiB: v.number(),
    autoStopIntervalMinutes: v.number(),
    autoArchiveIntervalMinutes: v.number(),
    autoDeleteIntervalMinutes: v.number(),
    networkBlockAll: v.boolean(),
    networkAllowList: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sandboxId = await ctx.db.insert('sandboxes', {
      repositoryId: args.repositoryId,
      ownerTokenIdentifier: args.ownerTokenIdentifier,
      provider: 'daytona',
      sourceAdapter: args.sourceAdapter,
      remoteId: args.remoteId,
      status: 'provisioning',
      workDir: args.workDir,
      repoPath: args.repoPath,
      cpuLimit: args.cpuLimit,
      memoryLimitGiB: args.memoryLimitGiB,
      diskLimitGiB: args.diskLimitGiB,
      ttlExpiresAt: Date.now() + args.autoDeleteIntervalMinutes * 60_000,
      autoStopIntervalMinutes: args.autoStopIntervalMinutes,
      autoArchiveIntervalMinutes: args.autoArchiveIntervalMinutes,
      autoDeleteIntervalMinutes: args.autoDeleteIntervalMinutes,
      networkBlockAll: args.networkBlockAll,
      networkAllowList: args.networkAllowList,
    });

    await ctx.db.patch(args.importId, {
      sandboxId,
      remoteSandboxId: args.remoteId,
    });
    await ctx.db.patch(args.repositoryId, {
      latestSandboxId: sandboxId,
    });

    return sandboxId;
  },
});

export const persistImportResults = internalMutation({
  args: {
    importId: v.id('imports'),
    repositoryId: v.id('repositories'),
    jobId: v.id('jobs'),
    sandboxId: v.id('sandboxes'),
    commitSha: v.string(),
    branch: v.optional(v.string()),
    detectedLanguages: v.array(v.string()),
    packageManagers: v.array(v.string()),
    entrypoints: v.array(v.string()),
    summary: v.string(),
    readmeSummary: v.string(),
    architectureSummary: v.string(),
    repoFiles: v.array(
      v.object({
        path: v.string(),
        parentPath: v.string(),
        fileType: v.union(v.literal('file'), v.literal('dir')),
        extension: v.optional(v.string()),
        language: v.optional(v.string()),
        sizeBytes: v.number(),
        isEntryPoint: v.boolean(),
        isConfig: v.boolean(),
        isImportant: v.boolean(),
        summary: v.optional(v.string()),
      }),
    ),
    repoChunks: v.array(
      v.object({
        path: v.string(),
        chunkIndex: v.number(),
        startLine: v.number(),
        endLine: v.number(),
        chunkKind: v.union(v.literal('code'), v.literal('summary'), v.literal('readme')),
        symbolName: v.optional(v.string()),
        symbolKind: v.optional(v.string()),
        summary: v.string(),
        content: v.string(),
      }),
    ),
    artifacts: v.array(
      v.object({
        kind: v.union(
          v.literal('manifest'),
          v.literal('readme_summary'),
          v.literal('architecture'),
          v.literal('entrypoints'),
          v.literal('dependency_overview'),
          v.literal('deep_analysis'),
          v.literal('risk_report'),
        ),
        title: v.string(),
        summary: v.string(),
        contentMarkdown: v.string(),
        source: v.union(v.literal('heuristic'), v.literal('llm'), v.literal('sandbox')),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const importRecord = await ctx.db.get(args.importId);
    const repository = await ctx.db.get(args.repositoryId);
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!importRecord || !repository || repository.deletionRequestedAt || !sandbox) {
      await finalizeImportCancellation(ctx, {
        importId: args.importId,
        jobId: args.jobId,
        reason: REPOSITORY_DELETION_CANCEL_REASON,
      });
      return {
        kind: 'cancelled' as const,
      };
    }
    const previousCompletedImportId = repository.latestImportId;
    const previousCompletedImportJobId = repository.latestImportJobId;

    const fileIdsByPath = new Map<string, string>();
    for (const file of args.repoFiles) {
      const fileId = await ctx.db.insert('repoFiles', {
        repositoryId: args.repositoryId,
        ownerTokenIdentifier: repository.ownerTokenIdentifier,
        importId: args.importId,
        ...file,
      });
      fileIdsByPath.set(file.path, fileId);
    }

    for (const chunk of args.repoChunks) {
      const fileId = fileIdsByPath.get(chunk.path);
      if (!fileId) {
        continue;
      }

      await ctx.db.insert('repoChunks', {
        repositoryId: args.repositoryId,
        ownerTokenIdentifier: repository.ownerTokenIdentifier,
        importId: args.importId,
        fileId: fileId as never,
        ...chunk,
      });
    }

    for (const artifact of args.artifacts) {
      await ctx.db.insert('analysisArtifacts', {
        repositoryId: args.repositoryId,
        jobId: args.jobId,
        ownerTokenIdentifier: repository.ownerTokenIdentifier,
        version: 1,
        ...artifact,
      });
    }

    await ctx.db.patch(args.importId, {
      status: 'completed',
      commitSha: args.commitSha,
      branch: args.branch,
      completedAt: Date.now(),
    });
    await ctx.db.patch(args.jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 1,
      completedAt: Date.now(),
      outputSummary: args.summary,
    });
    await ctx.db.patch(args.repositoryId, {
      importStatus: 'completed',
      latestImportId: args.importId,
      latestImportJobId: args.jobId,
      latestSandboxId: args.sandboxId,
      defaultBranch: args.branch ?? repository.defaultBranch,
      summary: args.summary,
      readmeSummary: args.readmeSummary,
      architectureSummary: args.architectureSummary,
      detectedLanguages: args.detectedLanguages,
      packageManagers: args.packageManagers,
      entrypoints: args.entrypoints,
      lastImportedAt: Date.now(),
      lastIndexedAt: Date.now(),
      lastSyncedCommitSha: args.commitSha,
    });
    await ctx.db.patch(args.sandboxId, {
      status: 'ready',
      lastHeartbeatAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    if (
      previousCompletedImportId &&
      (previousCompletedImportId !== args.importId || previousCompletedImportJobId !== args.jobId)
    ) {
      await ctx.scheduler.runAfter(0, internal.imports.cleanupSupersededImportSnapshot, {
        importId: previousCompletedImportId,
        importJobId: previousCompletedImportJobId,
      });
    }

    return {
      kind: 'completed' as const,
    };
  },
});

export const cleanupSupersededImportSnapshot = internalMutation({
  args: {
    importId: v.id('imports'),
    importJobId: v.optional(v.id('jobs')),
  },
  handler: async (ctx, args) => {
    const repoFiles = await ctx.db
      .query('repoFiles')
      .withIndex('by_importId', (q) => q.eq('importId', args.importId))
      .take(CASCADE_BATCH_SIZE);
    const repoChunks = await ctx.db
      .query('repoChunks')
      .withIndex('by_importId_and_path_and_chunkIndex', (q) => q.eq('importId', args.importId))
      .take(CASCADE_BATCH_SIZE);
    const importArtifacts = args.importJobId
      ? await ctx.db
          .query('analysisArtifacts')
          .withIndex('by_jobId', (q) => q.eq('jobId', args.importJobId))
          .take(CASCADE_BATCH_SIZE)
      : [];

    for (const doc of repoChunks) {
      await ctx.db.delete(doc._id);
    }
    for (const doc of repoFiles) {
      await ctx.db.delete(doc._id);
    }
    for (const doc of importArtifacts) {
      await ctx.db.delete(doc._id);
    }

    const hasMore =
      repoFiles.length === CASCADE_BATCH_SIZE ||
      repoChunks.length === CASCADE_BATCH_SIZE ||
      importArtifacts.length === CASCADE_BATCH_SIZE;

    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.imports.cleanupSupersededImportSnapshot, args);
    }
  },
});

export const markImportFailed = internalMutation({
  args: {
    importId: v.id('imports'),
    jobId: v.id('jobs'),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const importRecord = await ctx.db.get(args.importId);
    if (!importRecord) {
      return;
    }

    const repository = await ctx.db.get(importRecord.repositoryId);
    if (!repository || repository.deletionRequestedAt) {
      await finalizeImportCancellation(ctx, {
        importId: args.importId,
        jobId: args.jobId,
        reason: REPOSITORY_DELETION_CANCEL_REASON,
      });
      return;
    }

    const job = await ctx.db.get(args.jobId);
    const now = Date.now();

    await ctx.db.patch(args.importId, {
      status: 'failed',
      completedAt: now,
      errorMessage: args.errorMessage,
    });
    if (job) {
      await ctx.db.patch(args.jobId, {
        status: 'failed',
        stage: 'failed',
        progress: 1,
        completedAt: now,
        errorMessage: args.errorMessage,
      });
    }
    if (importRecord.sandboxId) {
      const sandbox = await ctx.db.get(importRecord.sandboxId);
      if (sandbox) {
        await ctx.db.patch(importRecord.sandboxId, {
          status: 'failed',
          lastErrorMessage: args.errorMessage,
        });
      }
    }
    await ctx.db.patch(importRecord.repositoryId, {
      importStatus: 'failed',
    });
  },
});

export const cancelImport = internalMutation({
  args: {
    importId: v.id('imports'),
    jobId: v.id('jobs'),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await finalizeImportCancellation(ctx, args);
  },
});
