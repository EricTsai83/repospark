import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

type AuthContext = ActionCtx | MutationCtx | QueryCtx;

export async function requireViewerIdentity(ctx: AuthContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('You must sign in to use this app.');
  }
  return identity;
}

export function getViewerLabel(identity: { name?: string | null; email?: string | null; tokenIdentifier: string }) {
  return identity.name ?? identity.email ?? identity.tokenIdentifier;
}
