import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

import { isValidIdempotencyKey } from "../../idempotency/lib/idempotency.js";
import { refundIntent } from "../lib/refunds.js";

/** POST /v1/refunds - behind the API-key hook of the scope it is registered in. */
export function registerRefundRoutes(app: FastifyInstance, options: { sqlite: Database.Database }) {
  app.post("/v1/refunds", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (!isValidIdempotencyKey(key)) {
      return reply.code(400).send({ message: "Idempotency-Key header is required (1-255 characters)" });
    }

    const body = request.body;
    const paymentIntentId =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).paymentIntentId
        : undefined;
    if (typeof paymentIntentId !== "string" || paymentIntentId === "" || paymentIntentId.length > 100) {
      return reply.code(400).send({ message: "paymentIntentId is required" });
    }

    const result = refundIntent(options.sqlite, { idempotencyKey: key, paymentIntentId });

    switch (result.outcome) {
      case "created":
        return reply.code(201).send(result.refund);
      case "replayed":
        return reply.code(200).send(result.refund);
      case "intent_not_found":
        return reply.code(404).send({ message: "Payment intent not found" });
      case "not_refundable":
        return reply.code(409).send({ message: `A ${result.status.replace("_", " ")} payment can't be refunded` });
      case "key_reused_with_different_request":
        return reply.code(409).send({ message: "Idempotency-Key was already used with a different request" });
    }
  });
}
