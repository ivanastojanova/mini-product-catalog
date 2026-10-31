import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

import { isValidIdempotencyKey } from "../../idempotency/lib/idempotency.js";
import { createIntent, getIntent } from "../lib/intents.js";
import { validateIntentInput } from "../lib/validateIntentInput.js";

type Options = { sqlite: Database.Database; publicUrl: string; allowedReturnOrigin: string };

/**
 * POST /v1/payment_intents - creates (or replays) an intent. Requires an
 * `Idempotency-Key`: without one a retry after a timeout could create two.
 * GET /v1/payment_intents/:id - current state.
 * Both sit behind the API-key hook of the scope they are registered in.
 */
export function registerIntentRoutes(app: FastifyInstance, options: Options) {
  const { sqlite, publicUrl, allowedReturnOrigin } = options;

  app.post("/v1/payment_intents", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (!isValidIdempotencyKey(key)) {
      return reply.code(400).send({ message: "Idempotency-Key header is required (1-255 characters)" });
    }

    const validation = validateIntentInput(request.body, allowedReturnOrigin);
    if (!validation.ok) {
      return reply.code(400).send({ message: validation.message });
    }

    const result = createIntent(sqlite, { publicUrl, idempotencyKey: key, input: validation.input });

    switch (result.outcome) {
      case "created":
        return reply.code(201).send(result.intent);
      case "replayed":
        return reply.code(200).send(result.intent);
      case "key_reused_with_different_request":
        return reply.code(409).send({ message: "Idempotency-Key was already used with a different request" });
    }
  });

  app.get<{ Params: { id: string } }>("/v1/payment_intents/:id", async (request, reply) => {
    const intent = getIntent(sqlite, publicUrl, request.params.id);
    if (intent === null) {
      return reply.code(404).send({ message: "Payment intent not found" });
    }
    return intent;
  });
}
