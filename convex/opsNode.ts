"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { deleteSandbox } from './daytona';

export const runSandboxCleanup = internalAction({
  args: {
    sandboxId: v.id('sandboxes'),
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.runMutation(internal.ops.markSandboxCleanupRunning, {
      sandboxId: args.sandboxId,
      jobId: args.jobId,
    });

    try {
      if (sandbox.remoteId) {
        await deleteSandbox(sandbox.remoteId);
      }

      await ctx.runMutation(internal.ops.completeSandboxCleanup, {
        sandboxId: args.sandboxId,
        jobId: args.jobId,
      });
    } catch (error) {
      await ctx.runMutation(internal.ops.failSandboxCleanup, {
        sandboxId: args.sandboxId,
        jobId: args.jobId,
        errorMessage: error instanceof Error ? error.message : 'Unknown sandbox cleanup error',
      });
    }
  },
});
