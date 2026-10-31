import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import { corsOptions } from "./corsConfig.js";
import { registerAuthRoutes } from "./auth/routes/register.js";
import { registerLoginRoute } from "./auth/routes/login.js";
import { registerLogoutRoute } from "./auth/routes/logout.js";
import { registerSessionRoute } from "./auth/routes/session.js";
import { registerCartRoutes } from "./cart/routes/cart.js";
import { registerStockRoutes } from "./inventory/routes/stock.js";
import { registerCheckoutRoutes } from "./orders/routes/checkoutPreview.js";
import { registerCreateOrderRoute } from "./orders/routes/createOrder.js";
import { registerOrderRoutes } from "./orders/routes/orders.js";
import { db } from "./db/client.js";
import { assertPaymentSecrets } from "./payments/lib/assertPaymentSecrets.js";
import { createHttpPaymentGateway } from "./payments/lib/gatewayClient.js";
import { createEventProcessor } from "./payments/lib/processPaymentEvent.js";
import { registerPayOrderRoute } from "./payments/routes/payOrder.js";
import { registerPaymentWebhookRoute } from "./payments/routes/webhook.js";

assertPaymentSecrets();

const PORT = Number(process.env.PORT ?? 4000);

const app = Fastify({ logger: true });

await app.register(cors, corsOptions);

await app.register(cookie);

app.get("/health", async () => ({ ok: true }));

registerAuthRoutes(app);
registerLoginRoute(app);
registerLogoutRoute(app);
registerSessionRoute(app);
registerCartRoutes(app);
registerStockRoutes(app);
registerCheckoutRoutes(app);
registerCreateOrderRoute(app);
registerOrderRoutes(app);

const paymentGateway = createHttpPaymentGateway();
registerPayOrderRoute(app, { gateway: paymentGateway });
registerPaymentWebhookRoute(app, {
  processEvent: createEventProcessor(db, paymentGateway),
});

app
  .listen({ port: PORT })
  .then(() => {
    app.log.info(`apps/api listening on :${PORT}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

