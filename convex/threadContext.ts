import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalQuery, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';
import {
  resolveChatModes,
  type ChatModeResolution,
  type ChatModeSandboxStatus,
} from './chatModeResolver';

export type SandboxTableStatus = Doc<'sandboxes'>['status'];

export interface ThreadContext {
  thread: Doc<'threads'>;
  attachedRepository: Doc<'repositories'> | null;
  sandboxStatus: SandboxTableStatus | null;
  chatModes: ChatModeResolution;
}

/**
 * Maps the sandbox table status enum onto the ChatModeResolver's input domain.
 *
 * The sandbox table tracks provider-level lifecycle (`stopped`, `archived`, ...)
 * but the resolver only cares about whether deep mode is available right now.
 * Both `stopped` and `archived` collapse to `expired` for resolver purposes —
 * they are not currently usable but the user can re-provision a sandbox.
 */
function toChatModeSandboxStatus(status: SandboxTableStatus | null): ChatModeSandboxStatus {
  if (!status) {
    return 'none';
  }
  switch (status) {
    case 'ready':
    case 'provisioning':
    case 'failed':
      return status;
    case 'stopped':
    case 'archived':
      return 'expired';
  }
}

async function loadThread(
  ctx: QueryCtx,
  threadId: Id<'threads'>,
): Promise<Doc<'threads'> | null> {
  return await ctx.db.get(threadId);
}

async function enrichThreadContext(
  ctx: QueryCtx,
  thread: Doc<'threads'>,
): Promise<ThreadContext> {
  let attachedRepository: Doc<'repositories'> | null = null;
  let sandboxStatus: SandboxTableStatus | null = null;

  if (thread.repositoryId) {
    attachedRepository = await ctx.db.get(thread.repositoryId);
    if (attachedRepository?.latestSandboxId) {
      const sandbox = await ctx.db.get(attachedRepository.latestSandboxId);
      sandboxStatus = sandbox?.status ?? null;
    }
  }

  const chatModes = resolveChatModes(
    attachedRepository !== null,
    toChatModeSandboxStatus(sandboxStatus),
  );

  return {
    thread,
    attachedRepository,
    sandboxStatus,
    chatModes,
  };
}

async function loadThreadContext(
  ctx: QueryCtx,
  threadId: Id<'threads'>,
): Promise<ThreadContext | null> {
  const thread = await loadThread(ctx, threadId);
  if (!thread) {
    return null;
  }
  return enrichThreadContext(ctx, thread);
}

export const getThreadContext = query({
  args: { threadId: v.id('threads') },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const thread = await loadThread(ctx, args.threadId);

    if (!thread) {
      return null;
    }

    if (thread.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Thread not found.');
    }

    if (thread.repositoryId) {
      const repository = await ctx.db.get(thread.repositoryId);
      if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
        throw new Error('Thread not found.');
      }
    }

    return enrichThreadContext(ctx, thread);
  },
});

export const getThreadContextInternal = internalQuery({
  args: { threadId: v.id('threads') },
  handler: (ctx, args) => loadThreadContext(ctx, args.threadId),
});
