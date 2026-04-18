"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { deleteSandbox, getSandboxState } from './daytona';

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

// ---------------------------------------------------------------------------
// Scheduled sweep: reconcile Convex DB status with Daytona reality
// ---------------------------------------------------------------------------

type ExpiredSandbox = {
  sandboxId: string;
  remoteId: string;
  repositoryId: string;
  ttlExpiresAt: number;
};

export const sweepExpiredSandboxes = internalAction({
  args: {},
  handler: async (ctx) => {
    // Cast required: Convex action ctx.runQuery cannot infer return types
    // for functions defined in a different file (framework limitation).
    const expired = (await ctx.runQuery(
      internal.ops.getExpiredSandboxes,
      {},
    )) as ExpiredSandbox[];

    if (expired.length === 0) {
      return;
    }

    console.log(`[sweep] Found ${expired.length} sandbox(es) past TTL, reconciling…`);

    for (const entry of expired) {
      try {
        const daytonaState = await getSandboxState(entry.remoteId);

        if (daytonaState === 'archived' || daytonaState === 'destroyed') {
          // Daytona already reclaimed it — mark as archived in Convex DB
          await ctx.runMutation(internal.ops.markSandboxSwept, {
            sandboxId: entry.sandboxId as never,
            newStatus: 'archived',
          });
          console.log(
            `[sweep] Sandbox ${entry.remoteId} is ${daytonaState} on Daytona → marked archived in DB.`,
          );
        } else if (daytonaState === 'stopped') {
          // Still on disk but stopped — proactively delete to free disk cost
          try {
            await deleteSandbox(entry.remoteId);
            console.log(`[sweep] Deleted stopped sandbox ${entry.remoteId} (past TTL).`);
          } catch {
            // Deletion failed, will retry on next sweep
          }
          await ctx.runMutation(internal.ops.markSandboxSwept, {
            sandboxId: entry.sandboxId as never,
            newStatus: 'archived',
          });
        } else if (daytonaState === 'started') {
          // Sandbox is somehow still running past TTL — stop it first, delete next sweep
          await ctx.runMutation(internal.ops.markSandboxSwept, {
            sandboxId: entry.sandboxId as never,
            newStatus: 'stopped',
          });
          console.log(
            `[sweep] Sandbox ${entry.remoteId} still running past TTL → marked stopped, will delete next cycle.`,
          );
        }
      } catch (error) {
        console.error(
          `[sweep] Error processing sandbox ${entry.remoteId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  },
});
