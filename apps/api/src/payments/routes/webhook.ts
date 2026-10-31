import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { parseGatewayEvent, type GatewayEvent } from "../lib/gatewayEvent.js";
import { verifyWebhookSignature } from "../lib/verifyWebhookSignature.js";

/** Largest webhook body accepted. Events are tiny; this only bounds what an unauthenticated caller can make us read. */
const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;

/** What the route needs from the layer that applies events. `duplicate` means this event id was already handled. */
export type ProcessEvent = (
  event: GatewayEvent,
  rawBody: string,
  log: FastifyRequest["log"],
) => Promise<{ duplicate: boolean }>;

export type WebhookRouteOptions = {
  /** Required: a receiver that only acknowledged events would silently drop payments. */
  processEvent: ProcessEvent;
  /** Read per request so a missing secret fails closed instead of crashing at boot. */
  getSecret?: () => string | undefined;
  /** Unix seconds; injectable so tests don't depend on the clock. */
  now?: () => number;
};

/**
 * POST /webhooks/payments
 * Server-to-server: the only credential is the signature, so this route has no
 * cookies, no session and no CORS. It answers 400 without saying which check
 * failed. The body is verified as the exact string received, before any JSON
 * parsing, because re-serialized JSON would not match what was signed.
 */
export function createPaymentWebhookHandler(options: WebhookRouteOptions) {
  const getSecret = options.getSecret ?? (() => process.env.GATEWAY_WEBHOOK_SECRET);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  return async function paymentWebhookHandler(request: FastifyRequest, reply: FastifyReply) {
    const secret = getSecret();
    if (!secret) {
      request.log.error("GATEWAY_WEBHOOK_SECRET is not set; refusing every webhook");
      return reply.code(500).send({ message: "Webhook receiver is not configured" });
    }

    const rawBody = typeof request.body === "string" ? request.body : "";
    const header = request.headers["gateway-signature"];

    const result = verifyWebhookSignature({
      rawBody,
      header: typeof header === "string" ? header : undefined,
      secret,
      now: now(),
    });

    if (!result.ok) {
      request.log.warn({ reason: result.reason }, "rejected payment webhook");
      return reply.code(400).send({ message: "Invalid signature" });
    }

    const event = parseGatewayEvent(rawBody);
    if (event === null) {
      return reply.code(400).send({ message: "Invalid event" });
    }

    try {
      const { duplicate } = await options.processEvent(event, rawBody, request.log);
      return reply.code(200).send(duplicate ? { received: true, duplicate: true } : { received: true });
    } catch (error) {
      // 500 so a retrying gateway tries again; the event's DB row rolled back with the transaction.
      request.log.error(error, `could not process payment event ${event.id}`);
      return reply.code(500).send({ message: "Could not process event" });
    }
  };
}

/**
 * Registers the webhook inside its own encapsulated scope, so the string body
 * parser below applies to this route only; every other route keeps Fastify's
 * normal JSON parsing.
 */
export function registerPaymentWebhookRoute(app: FastifyInstance, options: WebhookRouteOptions) {
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      (_request, body, done) => done(null, body),
    );

    scope.post("/webhooks/payments", createPaymentWebhookHandler(options));
  });
}
