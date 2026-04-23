import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { createOpaqueErrorId, logErrorWithId, logInfo, logWarn } from './lib/observability';

const http = httpRouter();

type NormalizedDaytonaWebhookEvent = {
  providerDeliveryId?: string;
  dedupeKey: string;
  eventType: 'sandbox.created' | 'sandbox.state.updated';
  remoteId: string;
  organizationId: string;
  eventTimestamp: number;
  normalizedState?: 'started' | 'stopped' | 'archived' | 'destroyed' | 'error' | 'unknown';
  payloadJson: string;
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function normalizeDaytonaSandboxState(
  value: unknown,
): 'started' | 'stopped' | 'archived' | 'destroyed' | 'error' | 'unknown' {
  if (typeof value !== 'string' || value.length === 0) {
    return 'unknown';
  }

  const normalized = value.toLowerCase();
  if (normalized === 'started') {
    return 'started';
  }
  if (normalized === 'stopped') {
    return 'stopped';
  }
  if (normalized === 'archived') {
    return 'archived';
  }
  if (normalized === 'destroyed' || normalized === 'deleted') {
    return 'destroyed';
  }
  if (normalized === 'error' || normalized === 'failed') {
    return 'error';
  }
  return 'unknown';
}

function parseDaytonaWebhookEvent(rawBody: string): NormalizedDaytonaWebhookEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON payload.');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Webhook payload must be an object.');
  }

  const event = 'event' in payload ? payload.event : undefined;
  const timestamp = 'timestamp' in payload ? payload.timestamp : undefined;
  const remoteId = 'id' in payload ? payload.id : undefined;
  const organizationId = 'organizationId' in payload ? payload.organizationId : undefined;

  if (event !== 'sandbox.created' && event !== 'sandbox.state.updated') {
    throw new Error('Unsupported Daytona webhook event.');
  }
  if (typeof remoteId !== 'string' || remoteId.length === 0) {
    throw new Error('Missing sandbox id.');
  }
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    throw new Error('Missing organization id.');
  }
  if (typeof timestamp !== 'string') {
    throw new Error('Missing event timestamp.');
  }

  const eventTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(eventTimestamp)) {
    throw new Error('Invalid event timestamp.');
  }

  const normalizedState =
    event === 'sandbox.created'
      ? normalizeDaytonaSandboxState('state' in payload ? payload.state : undefined)
      : normalizeDaytonaSandboxState('newState' in payload ? payload.newState : undefined);

  const dedupeKey = [event, remoteId, eventTimestamp, normalizedState].join(':');

  return {
    dedupeKey,
    eventType: event,
    remoteId,
    organizationId,
    eventTimestamp,
    normalizedState,
    payloadJson: rawBody,
  };
}

function readBearerToken(request: Request) {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

function verifyDaytonaWebhookRequest(
  request: Request,
  rawBody: string,
): { verified: true; event: NormalizedDaytonaWebhookEvent } {
  const configuredToken = process.env.DAYTONA_WEBHOOK_TOKEN;
  if (!configuredToken) {
    throw new Error('DAYTONA_WEBHOOK_TOKEN is not set.');
  }

  const url = new URL(request.url);
  const providedToken = readBearerToken(request) ?? url.searchParams.get('token');
  if (!providedToken || !constantTimeEqual(configuredToken, providedToken)) {
    throw new Error('Invalid Daytona webhook token.');
  }

  const event = parseDaytonaWebhookEvent(rawBody);
  const allowedOrganizationId = process.env.DAYTONA_WEBHOOK_ORGANIZATION_ID;
  if (allowedOrganizationId && !constantTimeEqual(allowedOrganizationId, event.organizationId)) {
    throw new Error('Unexpected Daytona webhook organization.');
  }

  return {
    verified: true,
    event,
  };
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

      const saveResult:
        | { kind: 'connected'; installationId: number }
        | {
            kind: 'conflict';
            existingInstallationId: number;
            existingAccountLogin: string;
          } = await ctx.runMutation(internal.github.saveInstallation, {
        ownerTokenIdentifier,
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
        return Response.redirect(`${siteUrl}?github_error=already_connected`, 302);
      }

      logInfo('http', 'github_callback_completed', {
        installationId,
      });
      return Response.redirect(`${siteUrl}?github_connected=true`, 302);
    } catch (error) {
      const errorId = logErrorWithId('http', 'github_callback_failed', error, {
        installationId: installationIdParam,
      });
      return Response.redirect(
        `${siteUrl}?github_error=callback_failed&error_id=${encodeURIComponent(errorId)}`,
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
    const rawBody = await request.text();

    let verifiedEvent: NormalizedDaytonaWebhookEvent;
    try {
      const result = verifyDaytonaWebhookRequest(request, rawBody);
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
