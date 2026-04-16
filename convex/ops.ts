import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';

export const requestSandboxCleanup = mutation({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    if (!repository.latestSandboxId) {
      throw new Error('This repository does not have an active sandbox.');
    }

    const sandbox = await ctx.db.get(repository.latestSandboxId);
    if (!sandbox) {
      throw new Error('Sandbox not found.');
    }

    const jobId = await ctx.db.insert('jobs', {
      repositoryId: args.repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      sandboxId: sandbox._id,
      kind: 'cleanup',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      costCategory: 'ops',
      triggerSource: 'user',
    });

    await ctx.scheduler.runAfter(0, internal.opsNode.runSandboxCleanup, {
      sandboxId: sandbox._id,
      jobId,
    });

    return { jobId };
  },
});

export const markSandboxCleanupRunning = internalMutation({
  args: {
    sandboxId: v.id('sandboxes'),
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db.get(args.sandboxId);
    if (!sandbox) {
      throw new Error('Sandbox not found.');
    }

    await ctx.db.patch(args.jobId, {
      status: 'running',
      stage: 'deleting_remote_sandbox',
      progress: 0.3,
      startedAt: Date.now(),
    });

    return {
      remoteId: sandbox.remoteId,
    };
  },
});

export const completeSandboxCleanup = internalMutation({
  args: {
    sandboxId: v.id('sandboxes'),
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      status: 'archived',
      lastUsedAt: Date.now(),
    });
    await ctx.db.patch(args.jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 1,
      completedAt: Date.now(),
      outputSummary: 'Sandbox deleted and archived.',
    });
  },
});

export const failSandboxCleanup = internalMutation({
  args: {
    sandboxId: v.id('sandboxes'),
    jobId: v.id('jobs'),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      status: 'failed',
      lastErrorMessage: args.errorMessage,
    });
    await ctx.db.patch(args.jobId, {
      status: 'failed',
      stage: 'failed',
      progress: 1,
      completedAt: Date.now(),
      errorMessage: args.errorMessage,
    });
  },
});
