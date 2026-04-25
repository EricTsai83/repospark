import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import {
  DaytonaWebhookBodyReadError,
  prepareDaytonaWebhookVerification,
  readDaytonaWebhookRawBody,
  verifyDaytonaWebhookRequest,
  type NormalizedDaytonaWebhookEvent,
  type DaytonaWebhookVerificationContext,
} from './lib/daytonaWebhookVerification';
import { createOpaqueErrorId, logErrorWithId, logInfo, logWarn } from './lib/observability';

const http = httpRouter();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function buildRedirectUrl(
  baseUrl: string,
  params: Record<string, string>,
): string {
  const redirectUrl = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return redirectUrl.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function githubCallbackErrorResponse(
  status: number,
  title: string,
  message: string,
): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b1020;
        color: #e5e7eb;
      }
      main {
        max-width: 36rem;
        padding: 2rem;
        border: 1px solid rgba(229, 231, 235, 0.16);
        border-radius: 1rem;
        background: rgba(15, 23, 42, 0.92);
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.25rem;
      }
      p {
        margin: 0;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function redirectOrReturnError(
  redirectTarget: string | null,
  params: Record<string, string>,
  status: number,
  message: string,
): Response {
  if (redirectTarget) {
    return Response.redirect(buildRedirectUrl(redirectTarget, params), 302);
  }

  return githubCallbackErrorResponse(
    status,
    'GitHub connection could not be completed.',
    message,
  );
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
    let redirectTarget: string | null = state
      ? await ctx.runQuery(internal.github.getOAuthReturnToByState, { state })
      : null;

    if (!installationIdParam || !state) {
      return redirectOrReturnError(
        redirectTarget,
        { github_error: 'missing_params' },
        400,
        'GitHub did not send the parameters needed to complete the installation flow.',
      );
    }

    const installationId = parseInt(installationIdParam, 10);
    if (isNaN(installationId)) {
      return redirectOrReturnError(
        redirectTarget,
        { github_error: 'invalid_installation' },
        400,
        'GitHub returned an invalid installation identifier.',
      );
    }

    try {
      // Validate and consume the CSRF state
      const oauthState: {
        ownerTokenIdentifier: string;
        returnTo: string | null;
      } = await ctx.runMutation(
        internal.github.consumeOAuthState,
        { state },
      );
      redirectTarget = oauthState.returnTo;

      // Fetch installation details from GitHub API
      const details: {
        accountLogin: string;
        accountType: 'User' | 'Organization';
        repositorySelection: 'all' | 'selected';
      } = await ctx.runAction(internal.githubAppNode.fetchInstallationDetails, {
        installationId,
      });

      const saveResult:
        | { kind: 'connected'; installationId: number }
        | {
            kind: 'conflict';
            existingInstallationId: number;
            existingAccountLogin: string;
          } = await ctx.runMutation(internal.github.saveInstallation, {
        ownerTokenIdentifier: oauthState.ownerTokenIdentifier,
        installationId,
        accountLogin: details.accountLogin,
        accountType: details.accountType,
        repositorySelection: details.repositorySelection,
      });

      if (saveResult.kind === 'conflict') {
        logInfo('http', 'github_callback_conflict', {
          installationId,
          existingInstallationId: saveResult.existingInstallationId,
          existingAccountLogin: saveResult.existingAccountLogin,
        });
        return redirectOrReturnError(
          redirectTarget,
          { github_error: 'already_connected' },
          409,
          'This GitHub account is already connected to a different installation in RepoSpark.',
        );
      }

      logInfo('http', 'github_callback_completed', {
        installationId,
      });
      return redirectOrReturnError(
        redirectTarget,
        { github_connected: 'true' },
        500,
        'GitHub finished the installation flow, but RepoSpark could not determine where to return you.',
      );
    } catch (error) {
      const errorId = logErrorWithId('http', 'github_callback_failed', error, {
        installationId: installationIdParam,
      });
      return redirectOrReturnError(
        redirectTarget,
        {
          github_error: 'callback_failed',
          error_id: errorId,
        },
        500,
        `GitHub callback processing failed. Reference: ${errorId}`,
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
      logErrorWithId('webhook', 'missing_webhook_secret', new Error('GITHUB_APP_WEBHOOK_SECRET is not set.'));
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
      logWarn('webhook', 'signature_verification_failed', {
        errorId: createOpaqueErrorId('webhook_signature'),
      });
      return new Response('Invalid signature', { status: 401 });
    }

    // Parse the event
    const event = request.headers.get('X-GitHub-Event');
    let payload: {
      action: string;
      installation?: { id: number };
    };
    try {
      payload = JSON.parse(body) as {
        action: string;
        installation?: { id: number };
      };
    } catch {
      return new Response('Invalid JSON payload', { status: 400 });
    }

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

      logInfo('webhook', 'installation_event_processed', {
        event,
        action: payload.action,
        installationId,
      });
    }

    return new Response('OK', { status: 200 });
  }),
});

// ---------------------------------------------------------------------------
// Daytona sandbox webhook receiver
// ---------------------------------------------------------------------------

http.route({
  path: '/api/daytona/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    let verificationContext: DaytonaWebhookVerificationContext;
    try {
      verificationContext = prepareDaytonaWebhookVerification(request);
    } catch (error) {
      logWarn('webhook', 'daytona_webhook_signature_failed', {
        error: error instanceof Error ? error.message : 'Unknown verification error',
      });
      return new Response('Unauthorized', { status: 401 });
    }

    let rawBody: string;
    try {
      rawBody = await readDaytonaWebhookRawBody(request);
    } catch (error) {
      if (error instanceof DaytonaWebhookBodyReadError) {
        logWarn('webhook', 'daytona_webhook_invalid_body', {
          error: error.message,
          status: error.status,
        });
        return new Response(error.status === 413 ? 'Payload too large' : 'Bad Request', {
          status: error.status,
        });
      }
      throw error;
    }

    let verifiedEvent: NormalizedDaytonaWebhookEvent;
    try {
      const result = verifyDaytonaWebhookRequest(verificationContext, rawBody);
      verifiedEvent = result.event;
    } catch (error) {
      logWarn('webhook', 'daytona_webhook_signature_failed', {
        error: error instanceof Error ? error.message : 'Unknown verification error',
      });
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      const ingestResult:
        | { kind: 'duplicate'; eventId: string }
        | { kind: 'enqueued'; eventId: string } = await ctx.runMutation(
        internal.daytonaWebhooks.ingestValidatedEvent,
        verifiedEvent,
      );

      logInfo(
        'webhook',
        ingestResult.kind === 'duplicate' ? 'daytona_webhook_duplicate' : 'daytona_webhook_received',
        {
          eventId: ingestResult.eventId,
          remoteId: verifiedEvent.remoteId,
          eventType: verifiedEvent.eventType,
          organizationId: verifiedEvent.organizationId,
        },
      );

      return new Response('OK', { status: 200 });
    } catch (error) {
      const errorId = logErrorWithId('webhook', 'daytona_webhook_ingest_failed', error, {
        remoteId: verifiedEvent.remoteId,
        eventType: verifiedEvent.eventType,
        organizationId: verifiedEvent.organizationId,
      });
      return new Response(`Failed to ingest webhook. Reference: ${errorId}`, { status: 500 });
    }
  }),
});

export default http;
