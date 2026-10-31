import Fastify from "fastify";
import type Database from "better-sqlite3";

import { requireApiKey } from "./auth/apiKey.js";
import type { GatewayConfig } from "./config.js";
import { registerIntentRoutes } from "./intents/routes/intents.js";
import { registerPayRoutes } from "./pay/routes/pay.js";
import { registerRefundRoutes } from "./refunds/routes/refunds.js";

type BuildAppOptions = {
  sqlite: Database.Database;
  config: GatewayConfig;
  logger?: boolean;
  /** Injectable so tests can capture webhook deliveries without a network. */
  fetchImpl?: typeof fetch;
};

/** Builds the Fastify app without listening, so tests (and server.ts) share one wiring. */
export function buildApp({ sqlite, config, logger = false, fetchImpl }: BuildAppOptions) {
  const app = Fastify({ logger });

  app.get("/health", async () => ({ ok: true }));

  registerPayRoutes(app, {
    sqlite,
    publicUrl: config.publicUrl,
    webhookUrl: config.webhookUrl,
    webhookSecret: config.webhookSecret,
    fetchImpl,
  });

  // Everything under /v1 is server-to-server and needs the API key. The hosted /pay page is registered outside this scope: its credential is the unguessable intent id.
  void app.register(async (v1) => {
    v1.addHook("onRequest", requireApiKey(config.apiKey));
    registerIntentRoutes(v1, {
      sqlite,
      publicUrl: config.publicUrl,
      allowedReturnOrigin: config.allowedReturnOrigin,
    });
    registerRefundRoutes(v1, { sqlite });
  });

  return app;
}
