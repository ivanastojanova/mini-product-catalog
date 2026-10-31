import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

import { settleIntent, type Outcome } from "../../events/lib/events.js";
import { getIntent } from "../../intents/lib/intents.js";
import { deliverEvent } from "../../webhooks/deliver.js";
import { renderFinishedPage, renderNotFoundPage, renderPayPage } from "../lib/payPage.js";

type Options = {
  sqlite: Database.Database;
  publicUrl: string;
  webhookUrl: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
};

const OUTCOMES: readonly string[] = ["succeed", "succeed_twice", "decline"];

/** No scripts, no framing, no outside resources: the page is plain HTML and nothing else may run on it. */
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

/**
 * The hosted payment page (browser-facing, no API key: the unguessable intent
 * id is the credential, as with Stripe's checkout URLs). Registered in its own
 * scope so its form parser applies here only.
 *
 * POST settles the intent, then delivers the event(s) BEFORE redirecting, so
 * by the time the shopper lands back on the order page the webhook has
 * normally been applied. A failed delivery never blocks the redirect.
 */
export function registerPayRoutes(app: FastifyInstance, options: Options) {
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 1024 },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );

    scope.get<{ Params: { intentId: string } }>("/pay/:intentId", async (request, reply) => {
      const intent = getIntent(options.sqlite, options.publicUrl, request.params.intentId);
      if (intent === null) {
        return reply.code(404).headers(PAGE_HEADERS).send(renderNotFoundPage());
      }
      const html = intent.status === "requires_payment" ? renderPayPage(intent) : renderFinishedPage(intent);
      return reply.code(200).headers(PAGE_HEADERS).send(html);
    });

    scope.post<{ Params: { intentId: string } }>("/pay/:intentId", async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;
      const outcome = typeof body?.outcome === "string" ? body.outcome : "";
      if (!OUTCOMES.includes(outcome)) {
        return reply.code(400).headers(PAGE_HEADERS).send(renderNotFoundPage());
      }

      const result = settleIntent(options.sqlite, request.params.intentId, outcome as Outcome);
      if (result.outcome === "not_found") {
        return reply.code(404).headers(PAGE_HEADERS).send(renderNotFoundPage());
      }

      if (result.outcome === "settled") {
        for (let i = 0; i < result.sends; i++) {
          const delivery = await deliverEvent(options.sqlite, result.eventId, {
            webhookUrl: options.webhookUrl,
            secret: options.webhookSecret,
            fetchImpl: options.fetchImpl,
          });
          if (!delivery.delivered) {
            request.log.warn({ eventId: result.eventId, ...delivery }, "webhook delivery failed");
          }
        }
      }

      return reply.code(303).header("location", result.returnUrl).send();
    });
  });
}
