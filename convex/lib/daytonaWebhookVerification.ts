import { Webhook, WebhookVerificationError } from "svix";
import { constantTimeEqual } from "./constantTimeEqual";

export type NormalizedDaytonaWebhookEvent = {
  providerDeliveryId?: string;
  dedupeKey: string;
  eventType: "sandbox.created" | "sandbox.state.updated";
  remoteId: string;
  organizationId: string;
  eventTimestamp: number;
  normalizedState?: "started" | "stopped" | "archived" | "destroyed" | "error" | "unknown";
  payloadJson: string;
};

type DaytonaWebhookSignatureHeaders = {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
};

export type DaytonaWebhookVerificationContext = {
  signingSecret: string;
  headers: DaytonaWebhookSignatureHeaders;
};

export const DAYTONA_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

export class DaytonaWebhookBodyReadError extends Error {
  constructor(
    message: "Daytona webhook payload too large." | "Invalid Daytona webhook content length.",
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "DaytonaWebhookBodyReadError";
  }
}

function normalizeDaytonaSandboxState(
  value: unknown,
): "started" | "stopped" | "archived" | "destroyed" | "error" | "unknown" {
  if (typeof value !== "string" || value.length === 0) {
    return "unknown";
  }

  const normalized = value.toLowerCase();
  if (normalized === "started") {
    return "started";
  }
  if (normalized === "stopped") {
    return "stopped";
  }
  if (normalized === "archived") {
    return "archived";
  }
  if (normalized === "destroyed" || normalized === "deleted") {
    return "destroyed";
  }
  if (normalized === "error" || normalized === "failed") {
    return "error";
  }
  return "unknown";
}

function parseDaytonaWebhookPayload(
  payload: unknown,
  rawBody: string,
  providerDeliveryId?: string,
): NormalizedDaytonaWebhookEvent {
  if (!payload || typeof payload !== "object") {
    throw new Error("Webhook payload must be an object.");
  }

  const event = "event" in payload ? payload.event : undefined;
  const timestamp = "timestamp" in payload ? payload.timestamp : undefined;
  const remoteId = "id" in payload ? payload.id : undefined;
  const organizationId = "organizationId" in payload ? payload.organizationId : undefined;

  if (event !== "sandbox.created" && event !== "sandbox.state.updated") {
    throw new Error("Unsupported Daytona webhook event.");
  }
  if (typeof remoteId !== "string" || remoteId.length === 0) {
    throw new Error("Missing sandbox id.");
  }
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new Error("Missing organization id.");
  }
  if (typeof timestamp !== "string") {
    throw new Error("Missing event timestamp.");
  }

  const eventTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(eventTimestamp)) {
    throw new Error("Invalid event timestamp.");
  }

  const normalizedState =
    event === "sandbox.created"
      ? normalizeDaytonaSandboxState("state" in payload ? payload.state : undefined)
      : normalizeDaytonaSandboxState("newState" in payload ? payload.newState : undefined);

  return {
    providerDeliveryId,
    dedupeKey: providerDeliveryId ?? [event, remoteId, eventTimestamp, normalizedState].join(":"),
    eventType: event,
    remoteId,
    organizationId,
    eventTimestamp,
    normalizedState,
    payloadJson: rawBody,
  };
}

function readRequiredSvixHeaders(request: Request): DaytonaWebhookSignatureHeaders {
  const messageId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!messageId || !timestamp || !signature) {
    throw new Error("Missing Svix signature headers.");
  }
  return {
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}

export function prepareDaytonaWebhookVerification(request: Request): DaytonaWebhookVerificationContext {
  const signingSecret = process.env.DAYTONA_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("DAYTONA_WEBHOOK_SIGNING_SECRET is not set.");
  }

  return {
    signingSecret,
    headers: readRequiredSvixHeaders(request),
  };
}

export async function readDaytonaWebhookRawBody(
  request: Request,
  maxBytes = DAYTONA_WEBHOOK_MAX_BODY_BYTES,
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);
    if (!Number.isInteger(parsedContentLength) || parsedContentLength < 0) {
      throw new DaytonaWebhookBodyReadError("Invalid Daytona webhook content length.", 400);
    }
    if (parsedContentLength > maxBytes) {
      throw new DaytonaWebhookBodyReadError("Daytona webhook payload too large.", 413);
    }
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let rawBody = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Daytona webhook payload too large.");
        throw new DaytonaWebhookBodyReadError("Daytona webhook payload too large.", 413);
      }

      rawBody += decoder.decode(value, { stream: true });
    }

    rawBody += decoder.decode();
    return rawBody;
  } finally {
    reader.releaseLock();
  }
}

export function verifyDaytonaWebhookRequest(
  context: DaytonaWebhookVerificationContext,
  rawBody: string,
): { verified: true; event: NormalizedDaytonaWebhookEvent } {
  const { signingSecret, headers } = context;

  let payload: unknown;
  try {
    payload = new Webhook(signingSecret).verify(rawBody, headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new Error(`Invalid Daytona webhook signature: ${error.message}`);
    }
    throw error;
  }

  const event = parseDaytonaWebhookPayload(payload, rawBody, headers["svix-id"]);
  const allowedOrganizationId = process.env.DAYTONA_WEBHOOK_ORGANIZATION_ID;
  if (allowedOrganizationId && !constantTimeEqual(allowedOrganizationId, event.organizationId)) {
    throw new Error("Unexpected Daytona webhook organization.");
  }

  return {
    verified: true,
    event,
  };
}
