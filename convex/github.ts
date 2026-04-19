import { v } from 'convex/values';
import { query, mutation, internalMutation, internalQuery } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';

// ---------------------------------------------------------------------------
// Public query: GitHub connection status for the current user
// ---------------------------------------------------------------------------

export const getGitHubConnectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        isConnected: false as const,
        installationId: null,
        accountLogin: null,
        repositorySelection: null,
      };
    }

    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_ownerTokenIdentifier', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier),
      )
      .first();

    if (!installation || installation.status !== 'active') {
      return {
        isConnected: false as const,
        installationId: null,
        accountLogin: null,
        repositorySelection: null,
      };
    }

    return {
      isConnected: true as const,
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      repositorySelection: installation.repositorySelection,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal mutations for the OAuth state flow (CSRF protection)
// ---------------------------------------------------------------------------

export const createOAuthState = internalMutation({
  args: {
    state: v.string(),
    ownerTokenIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert('githubOAuthStates', {
      state: args.state,
      ownerTokenIdentifier: args.ownerTokenIdentifier,
      createdAt: now,
      expiresAt: now + 10 * 60 * 1000, // 10-minute expiry
      consumed: false,
    });
  },
});

export const consumeOAuthState = internalMutation({
  args: {
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const stateDoc = await ctx.db
      .query('githubOAuthStates')
      .withIndex('by_state', (q) => q.eq('state', args.state))
      .first();

    if (!stateDoc) {
      throw new Error('Invalid state parameter.');
    }
    if (stateDoc.consumed) {
      throw new Error('State already consumed.');
    }
    if (stateDoc.expiresAt < Date.now()) {
      throw new Error('State expired.');
    }

    await ctx.db.patch(stateDoc._id, { consumed: true });
    return stateDoc.ownerTokenIdentifier;
  },
});

// ---------------------------------------------------------------------------
// Internal mutations for installation lifecycle
// ---------------------------------------------------------------------------

export const saveInstallation = internalMutation({
  args: {
    ownerTokenIdentifier: v.string(),
    installationId: v.number(),
    accountLogin: v.string(),
    accountType: v.union(v.literal('User'), v.literal('Organization')),
    repositorySelection: v.union(v.literal('all'), v.literal('selected')),
  },
  handler: async (ctx, args) => {
    // Upsert: update existing record for this user or insert a new one
    const existing = await ctx.db
      .query('githubInstallations')
      .withIndex('by_ownerTokenIdentifier', (q) =>
        q.eq('ownerTokenIdentifier', args.ownerTokenIdentifier),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        installationId: args.installationId,
        accountLogin: args.accountLogin,
        accountType: args.accountType,
        repositorySelection: args.repositorySelection,
        status: 'active',
        connectedAt: now,
        suspendedAt: undefined,
        deletedAt: undefined,
      });
    } else {
      await ctx.db.insert('githubInstallations', {
        ownerTokenIdentifier: args.ownerTokenIdentifier,
        installationId: args.installationId,
        accountLogin: args.accountLogin,
        accountType: args.accountType,
        status: 'active',
        repositorySelection: args.repositorySelection,
        connectedAt: now,
      });
    }
  },
});

export const markInstallationSuspended = internalMutation({
  args: {
    installationId: v.number(),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_installationId', (q) => q.eq('installationId', args.installationId))
      .first();

    if (installation) {
      await ctx.db.patch(installation._id, {
        status: 'suspended',
        suspendedAt: Date.now(),
      });
    }
  },
});

export const markInstallationDeleted = internalMutation({
  args: {
    installationId: v.number(),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_installationId', (q) => q.eq('installationId', args.installationId))
      .first();

    if (installation) {
      await ctx.db.patch(installation._id, {
        status: 'deleted',
        deletedAt: Date.now(),
      });
    }
  },
});

export const markInstallationActive = internalMutation({
  args: {
    installationId: v.number(),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_installationId', (q) => q.eq('installationId', args.installationId))
      .first();

    if (installation) {
      await ctx.db.patch(installation._id, {
        status: 'active',
        suspendedAt: undefined,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Internal query: get installationId for a given owner
// ---------------------------------------------------------------------------

export const getInstallationIdForOwner = internalQuery({
  args: {
    ownerTokenIdentifier: v.string(),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_ownerTokenIdentifier', (q) =>
        q.eq('ownerTokenIdentifier', args.ownerTokenIdentifier),
      )
      .first();

    if (!installation || installation.status !== 'active') {
      return null;
    }

    return installation.installationId;
  },
});

// ---------------------------------------------------------------------------
// Public mutation: user-initiated disconnect
// ---------------------------------------------------------------------------

export const disconnectGitHub = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireViewerIdentity(ctx);

    const installation = await ctx.db
      .query('githubInstallations')
      .withIndex('by_ownerTokenIdentifier', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier),
      )
      .first();

    if (installation) {
      await ctx.db.patch(installation._id, {
        status: 'deleted',
        deletedAt: Date.now(),
      });
    }
  },
});
