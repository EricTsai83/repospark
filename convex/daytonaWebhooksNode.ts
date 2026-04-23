"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { deleteSandbox, getRemoteSandboxDetails } from './daytona';
import { logErrorWithId, logInfo } from './lib/observability';

const UNKNOWN_REMOTE_CONFIRM_RETRY_MS = 5 * 60_000;

type ObservationRecord = Doc<'sandboxRemoteObservations'> | null;
type SandboxRecord = Doc<'sandboxes'> | null;

export const confirmUnknownRemote = internalAction({
  args: {
    remoteId: v.string(),
  },
  handler: async (ctx, args) => {
    const observation = (await ctx.runQuery(internal.daytonaWebhooks.getObservationByRemoteId, {
      remoteId: args.remoteId,
    })) as ObservationRecord;
    if (!observation || observation.discoveryStatus !== 'unknown_pending_confirmation') {
      return { kind: 'noop' as const };
    }

    const now = Date.now();
    if (observation.confirmAfterAt !== undefined && observation.confirmAfterAt > now) {
      await ctx.scheduler.runAfter(
        observation.confirmAfterAt - now,
        internal.daytonaWebhooksNode.confirmUnknownRemote,
        {
          remoteId: args.remoteId,
        },
      );
      return { kind: 'waiting' as const };
    }

    const sandbox = (await ctx.runQuery(internal.daytonaWebhooks.getSandboxRecordByRemoteId, {
      remoteId: args.remoteId,
    })) as SandboxRecord;
    if (sandbox) {
      await ctx.runMutation(internal.daytonaWebhooks.markObservationKnown, {
        remoteId: args.remoteId,
        sandboxId: sandbox._id,
        repositoryId: sandbox.repositoryId,
      });
      return { kind: 'known' as const };
    }

    const remote = await getRemoteSandboxDetails(args.remoteId);
    if (!remote.exists) {
      await ctx.runMutation(internal.daytonaWebhooks.markObservationIgnored, {
        remoteId: args.remoteId,
        discoveryStatus: 'ignored',
      });
      return { kind: 'gone' as const };
    }

    try {
      await deleteSandbox(args.remoteId);
      await ctx.runMutation(internal.daytonaWebhooks.markObservationDeleted, {
        remoteId: args.remoteId,
      });
      logInfo('webhook', 'daytona_orphan_deleted_via_webhook', {
        remoteId: args.remoteId,
        organizationId: remote.organizationId,
        state: remote.state,
      });
      return { kind: 'deleted' as const };
    } catch (error) {
      const retryAt = Date.now() + UNKNOWN_REMOTE_CONFIRM_RETRY_MS;
      const errorId = logErrorWithId('webhook', 'daytona_unknown_remote_confirm_failed', error, {
        remoteId: args.remoteId,
      });
      await ctx.runMutation(internal.daytonaWebhooks.retryUnknownRemoteConfirmation, {
        remoteId: args.remoteId,
        retryAt,
      });
      await ctx.scheduler.runAfter(
        UNKNOWN_REMOTE_CONFIRM_RETRY_MS,
        internal.daytonaWebhooksNode.confirmUnknownRemote,
        {
          remoteId: args.remoteId,
        },
      );
      return {
        kind: 'retry_scheduled' as const,
        errorId,
      };
    }
  },
});
