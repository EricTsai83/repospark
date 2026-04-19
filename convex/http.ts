import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const http = httpRouter();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// GitHub App installation callback
// ---------------------------------------------------------------------------

/**
 * GitHub redirects here after a user installs (or updates) the GitHub App.
 *
 * Query params sent by GitHub:
 *   - installation_id: numeric ID of the installation
 *   - setup_action: "install" | "update" | "request"
 *   - state: the CSRF token we generated in initiateGitHubInstall
 *
 * We validate the state, fetch installation details from GitHub, store the
 * installation record in Convex, then redirect the user to the frontend.
 */
http.route({
  path: '/api/github/callback',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const installationIdParam = url.searchParams.get('installation_id');
    const state = url.searchParams.get('state');

    const siteUrl = process.env.SITE_URL ?? 'http://localhost:5173';

    if (!installationIdParam || !state) {
      return Response.redirect(`${siteUrl}?github_error=missing_params`, 302);
    }

    const installationId = parseInt(installationIdParam, 10);
    if (isNaN(installationId)) {
      return Response.redirect(`${siteUrl}?github_error=invalid_installation`, 302);
    }

    try {
      // Validate and consume the CSRF state
      const ownerTokenIdentifier: string = await ctx.runMutation(
        internal.github.consumeOAuthState,
        { state },
      );

      // Fetch installation details from GitHub API
      const details: {
        accountLogin: string;
        accountType: 'User' | 'Organization';
        repositorySelection: 'all' | 'selected';
      } = await ctx.runAction(internal.githubAppNode.fetchInstallationDetails, {
        installationId,
      });

      // Persist the installation record (upsert)
      await ctx.runMutation(internal.github.saveInstallation, {
        ownerTokenIdentifier,
        installationId,
        accountLogin: details.accountLogin,
        accountType: details.accountType,
        repositorySelection: details.repositorySelection,
      });

      return Response.redirect(`${siteUrl}?github_connected=true`, 302);
    } catch (error) {
      console.error('[http] GitHub callback error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return Response.redirect(
        `${siteUrl}?github_error=${encodeURIComponent(message)}`,
        302,
      );
    }
  }),
});

// ---------------------------------------------------------------------------
// GitHub App webhook receiver
// ---------------------------------------------------------------------------

/**
 * Receives webhook events from the GitHub App. Verifies the payload signature
 * using HMAC-SHA256 (Web Crypto API), then dispatches to the appropriate handler.
 *
 * Supported events:
 *   - installation.deleted  -> marks installation as deleted
 *   - installation.suspend  -> marks installation as suspended
 *   - installation.unsuspend -> marks installation as active
 */
http.route({
  path: '/api/github/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[webhook] GITHUB_APP_WEBHOOK_SECRET is not set.');
      return new Response('Server misconfigured', { status: 500 });
    }

    const signature = request.headers.get('X-Hub-Signature-256');
    if (!signature) {
      return new Response('Missing signature', { status: 401 });
    }

    const body = await request.text();

    // Verify HMAC-SHA256 signature using Web Crypto API
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const computed =
      'sha256=' +
      Array.from(new Uint8Array(signatureBytes), (b) => b.toString(16).padStart(2, '0')).join('');

    // Constant-time comparison to prevent timing attacks
    if (!constantTimeEqual(computed, signature)) {
      return new Response('Invalid signature', { status: 401 });
    }

    // Parse the event
    const event = request.headers.get('X-GitHub-Event');
    const payload = JSON.parse(body) as {
      action: string;
      installation?: { id: number };
    };

    if (event === 'installation' && payload.installation) {
      const installationId = payload.installation.id;

      switch (payload.action) {
        case 'deleted':
          await ctx.runMutation(internal.github.markInstallationDeleted, {
            installationId,
          });
          break;
        case 'suspend':
          await ctx.runMutation(internal.github.markInstallationSuspended, {
            installationId,
          });
          break;
        case 'unsuspend':
          await ctx.runMutation(internal.github.markInstallationActive, {
            installationId,
          });
          break;
      }
    }

    return new Response('OK', { status: 200 });
  }),
});

export default http;
