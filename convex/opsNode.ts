"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { deleteSandbox, getSandboxState, stopSandbox } from './daytona';
import { logErrorWithId, logInfo } from './lib/observability';

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
      const errorId = logErrorWithId('ops', 'sandbox_cleanup_failed', error, {
        sandboxId: args.sandboxId,
        jobId: args.jobId,
        remoteId: sandbox.remoteId,
      });
      await ctx.runMutation(internal.ops.failSandboxCleanup, {
        sandboxId: args.sandboxId,
        jobId: args.jobId,
        errorMessage: `${
          error instanceof Error ? error.message : 'Unknown sandbox cleanup error'
        }\n\nReference: ${errorId}`,
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

    logInfo('sweep', 'expired_sandboxes_found', {
      count: expired.length,
    });

    for (const entry of expired) {
      try {
        const daytonaState = await getSandboxState(entry.remoteId);

        if (daytonaState === 'archived' || daytonaState === 'destroyed') {
          // Daytona already reclaimed it — mark as archived in Convex DB
          await ctx.runMutation(internal.ops.markSandboxSwept, {
            sandboxId: entry.sandboxId as never,
            newStatus: 'archived',
          });
          logInfo('sweep', 'sandbox_marked_archived', {
            sandboxId: entry.sandboxId,
            remoteId: entry.remoteId,
            daytonaState,
          });
        } else if (daytonaState === 'stopped') {
          // Still on disk but stopped — proactively delete to free disk cost
          try {
            await deleteSandbox(entry.remoteId);
            logInfo('sweep', 'stopped_sandbox_deleted', {
              sandboxId: entry.sandboxId,
              remoteId: entry.remoteId,
            });
            await ctx.runMutation(internal.ops.markSandboxSwept, {
              sandboxId: entry.sandboxId as never,
              newStatus: 'archived',
            });
          } catch {
            // Deletion failed, will retry on next sweep
          }
        } else if (daytonaState === 'started') {
          // Sandbox is somehow still running past TTL — stop it first, delete next sweep
          await stopSandbox(entry.remoteId);
          await ctx.runMutation(internal.ops.markSandboxSwept, {
            sandboxId: entry.sandboxId as never,
            newStatus: 'stopped',
          });
          logInfo('sweep', 'running_sandbox_stopped_for_ttl', {
            sandboxId: entry.sandboxId,
            remoteId: entry.remoteId,
          });
        }
      } catch (error) {
        logErrorWithId('sweep', 'sandbox_reconciliation_failed', error, {
          sandboxId: entry.sandboxId,
          remoteId: entry.remoteId,
        });
      }
    }
  },
});
