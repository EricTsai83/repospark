/// <reference types="vite/client" />

import { afterEach, describe, expect, test } from "vitest";
import { Webhook } from "svix";
import { convexTest } from "convex-test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const GITHUB_WEBHOOK_SECRET_ENV = "GITHUB_APP_WEBHOOK_SECRET";
const DAYTONA_SIGNING_SECRET_ENV = "DAYTONA_WEBHOOK_SIGNING_SECRET";
const RETURN_TO_ALLOWLIST_ENV = "ALLOWED_RETURN_TO_ORIGINS";

const originalGitHubWebhookSecret = process.env[GITHUB_WEBHOOK_SECRET_ENV];
const originalDaytonaSigningSecret = process.env[DAYTONA_SIGNING_SECRET_ENV];
const originalReturnToAllowlist = process.env[RETURN_TO_ALLOWLIST_ENV];

afterEach(() => {
  if (originalGitHubWebhookSecret === undefined) {
    delete process.env[GITHUB_WEBHOOK_SECRET_ENV];
  } else {
    process.env[GITHUB_WEBHOOK_SECRET_ENV] = originalGitHubWebhookSecret;
  }

  if (originalDaytonaSigningSecret === undefined) {
    delete process.env[DAYTONA_SIGNING_SECRET_ENV];
  } else {
    process.env[DAYTONA_SIGNING_SECRET_ENV] = originalDaytonaSigningSecret;
  }

  if (originalReturnToAllowlist === undefined) {
    delete process.env[RETURN_TO_ALLOWLIST_ENV];
  } else {
    process.env[RETURN_TO_ALLOWLIST_ENV] = originalReturnToAllowlist;
  }
});

async function computeGitHubSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return "sha256=" + Array.from(new Uint8Array(signatureBytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeDaytonaWebhookRequest(signingSecret: string, rawBody: string, overrides?: Record<string, string>) {
  const webhook = new Webhook(signingSecret);
  const messageId = "msg_daytona_http_test";
  const timestamp = new Date();
  const signature = webhook.sign(messageId, timestamp, rawBody);

  return {
    method: "POST",
    headers: {
      "svix-id": messageId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
      ...overrides,
    },
    body: rawBody,
  };
}

describe("http router", () => {
  test("returns 404 for unregistered paths", async () => {
    const t = convexTest(schema, modules);

    const response = await t.fetch("/nope", { method: "GET" });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/github/webhook", () => {
  test("returns 500 when the webhook secret is not configured", async () => {
    delete process.env[GITHUB_WEBHOOK_SECRET_ENV];
    const t = convexTest(schema, modules);

    const response = await t.fetch("/api/github/webhook", {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": "sha256=doesnotmatter",
        "X-GitHub-Event": "ping",
      },
      body: JSON.stringify({ zen: "Anything added dilutes everything else." }),
    });

    expect(response.status).toBe(500);
  });

  test("rejects a request with an incorrect signature", async () => {
    process.env[GITHUB_WEBHOOK_SECRET_ENV] = "test-github-webhook-secret";
    const t = convexTest(schema, modules);
    const body = JSON.stringify({
      action: "deleted",
      installation: { id: 4242 },
    });

    const response = await t.fetch("/api/github/webhook", {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": "sha256=" + "0".repeat(64),
        "X-GitHub-Event": "installation",
        "content-type": "application/json",
      },
      body,
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid signature");
  });

  test("accepts a correctly signed installation.deleted event and marks the installation deleted", async () => {
    const secret = "test-github-webhook-secret";
    process.env[GITHUB_WEBHOOK_SECRET_ENV] = secret;
    const t = convexTest(schema, modules);
    const ownerTokenIdentifier = "user|http-webhook-installation";
    const installationId = 9001;

    await t.run(async (ctx) => {
      await ctx.db.insert("githubInstallations", {
        ownerTokenIdentifier,
        installationId,
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "all",
        status: "active",
        connectedAt: Date.now(),
      });
    });

    const body = JSON.stringify({
      action: "deleted",
      installation: { id: installationId },
    });
    const signature = await computeGitHubSignature(secret, body);

    const response = await t.fetch("/api/github/webhook", {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": "installation",
        "content-type": "application/json",
      },
      body,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("OK");

    const installation = await t.run(async (ctx) => {
      return await ctx.db
        .query("githubInstallations")
        .withIndex("by_installationId", (q) => q.eq("installationId", installationId))
        .unique();
    });
    expect(installation?.status).toBe("deleted");
  });
});

describe("POST /api/daytona/webhook", () => {
  test("rejects a request with an invalid Svix signature", async () => {
    process.env[DAYTONA_SIGNING_SECRET_ENV] = "whsec_ZmFrZS1zZWNyZXQtZm9yLXRlc3RzLW9ubHk=";
    const t = convexTest(schema, modules);
    const rawBody = JSON.stringify({
      event: "sandbox.created",
      timestamp: "2026-04-23T12:00:00.000Z",
      id: "sandbox-http-test",
      organizationId: "org-1",
      state: "started",
      createdAt: "2026-04-23T12:00:00.000Z",
    });

    const requestInit = makeDaytonaWebhookRequest(process.env[DAYTONA_SIGNING_SECRET_ENV], rawBody, {
      "svix-signature": "v1,not-a-real-signature",
    });

    const response = await t.fetch("/api/daytona/webhook", requestInit);

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Unauthorized");
  });

  test("accepts a validly signed event and records the webhook event row", async () => {
    const signingSecret = "whsec_ZmFrZS1zZWNyZXQtZm9yLXRlc3RzLW9ubHk=";
    process.env[DAYTONA_SIGNING_SECRET_ENV] = signingSecret;
    const t = convexTest(schema, modules);
    const rawBody = JSON.stringify({
      event: "sandbox.created",
      timestamp: "2026-04-23T12:00:00.000Z",
      id: "sandbox-http-accepted",
      organizationId: "org-1",
      state: "started",
      createdAt: "2026-04-23T12:00:00.000Z",
    });

    const requestInit = makeDaytonaWebhookRequest(signingSecret, rawBody);

    const response = await t.fetch("/api/daytona/webhook", requestInit);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("OK");

    const storedEvent = await t.run(async (ctx) => {
      return await ctx.db
        .query("daytonaWebhookEvents")
        .withIndex("by_remoteId", (q) => q.eq("remoteId", "sandbox-http-accepted"))
        .unique();
    });
    expect(storedEvent).not.toBeNull();
    expect(storedEvent?.status).toBe("received");
    expect(storedEvent?.eventType).toBe("sandbox.created");
  });
});

describe("GET /api/github/callback", () => {
  test("does not redirect to a non-allowlisted returnTo origin", async () => {
    process.env[RETURN_TO_ALLOWLIST_ENV] = "https://app.systify.dev";
    const t = convexTest(schema, modules);
    const state = "callback-state-blocked-returnto";

    await t.run(async (ctx) => {
      await ctx.db.insert("githubOAuthStates", {
        state,
        ownerTokenIdentifier: "user|callback-blocked",
        returnTo: "https://evil.example.com/phish",
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        consumed: false,
      });
    });

    const response = await t.fetch(`/api/github/callback?state=${state}&error=access_denied&error_description=nope`, {
      method: "GET",
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    // The non-allowlisted returnTo must not appear as a redirect target.
    expect(body).not.toContain("evil.example.com");
    expect(body).toContain("var redirect = null;");
  });

  test("redirects to an allowlisted returnTo origin", async () => {
    process.env[RETURN_TO_ALLOWLIST_ENV] = "https://app.systify.dev";
    const t = convexTest(schema, modules);
    const state = "callback-state-allowed-returnto";

    await t.run(async (ctx) => {
      await ctx.db.insert("githubOAuthStates", {
        state,
        ownerTokenIdentifier: "user|callback-allowed",
        returnTo: "https://app.systify.dev/settings/integrations",
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        consumed: false,
      });
    });

    const response = await t.fetch(`/api/github/callback?state=${state}&error=access_denied&error_description=nope`, {
      method: "GET",
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("https://app.systify.dev/settings/integrations");
  });
});
