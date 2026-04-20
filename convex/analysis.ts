import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';
import { getDeepModeAvailability } from './lib/sandboxAvailability';

export const listArtifacts = query({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    return await ctx.db
      .query('analysisArtifacts')
      .withIndex('by_repositoryId', (q) => q.eq('repositoryId', args.repositoryId))
      .order('desc')
      .take(40);
  },
});

export const requestDeepAnalysis = mutation({
  args: {
    repositoryId: v.id('repositories'),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    const sandbox = repository.latestSandboxId ? await ctx.db.get(repository.latestSandboxId) : null;
    const deepModeStatus = getDeepModeAvailability(sandbox);
    if (!sandbox || !deepModeStatus.available) {
      throw new Error(deepModeStatus.message ?? 'Deep analysis is unavailable.');
    }

    const jobId = await ctx.db.insert('jobs', {
      repositoryId: args.repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      sandboxId: sandbox._id,
      kind: 'deep_analysis',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      costCategory: 'deep_analysis',
      triggerSource: 'user',
    });

    await ctx.db.patch(args.repositoryId, {
      latestAnalysisJobId: jobId,
    });

    await ctx.scheduler.runAfter(0, internal.analysisNode.runDeepAnalysis, {
      repositoryId: args.repositoryId,
      jobId,
      prompt: args.prompt,
    });

    return { jobId };
  },
});

export const getDeepAnalysisContext = internalQuery({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository) {
      throw new Error('Repository not found.');
    }

    const sandbox = repository.latestSandboxId ? await ctx.db.get(repository.latestSandboxId) : null;

    return {
      repositoryId: repository._id,
      ownerTokenIdentifier: repository.ownerTokenIdentifier,
      latestSandboxId: sandbox?._id,
      sandboxStatus: sandbox?.status,
      ttlExpiresAt: sandbox?.ttlExpiresAt,
      remoteSandboxId: sandbox?.remoteId,
      repoPath: sandbox?.repoPath,
      sourceRepoFullName: repository.sourceRepoFullName,
    };
  },
});

export const markDeepAnalysisRunning = internalMutation({
  args: {
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: 'running',
      stage: 'focused_inspection',
      progress: 0.2,
      startedAt: Date.now(),
    });
  },
});

export const completeDeepAnalysis = internalMutation({
  args: {
    repositoryId: v.id('repositories'),
    jobId: v.id('jobs'),
    ownerTokenIdentifier: v.string(),
    summary: v.string(),
    contentMarkdown: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('analysisArtifacts', {
      repositoryId: args.repositoryId,
      jobId: args.jobId,
      ownerTokenIdentifier: args.ownerTokenIdentifier,
      kind: 'deep_analysis',
      title: 'Focused Deep Analysis',
      summary: args.summary,
      contentMarkdown: args.contentMarkdown,
      source: 'sandbox',
      version: 1,
    });

    await ctx.db.patch(args.jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 1,
      completedAt: Date.now(),
      outputSummary: args.summary,
    });
  },
});

export const failDeepAnalysis = internalMutation({
  args: {
    jobId: v.id('jobs'),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: 'failed',
      stage: 'failed',
      progress: 1,
      completedAt: Date.now(),
      errorMessage: args.errorMessage,
    });
  },
});
