import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import { corsOptions } from "./corsConfig.js";
import { registerAuthRoutes } from "./auth/routes/register.js";
import { registerLoginRoute } from "./auth/routes/login.js";
import { registerLogoutRoute } from "./auth/routes/logout.js";
import { registerSessionRoute } from "./auth/routes/session.js";
import { registerCartRoutes } from "./cart/routes/cart.js";

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

app
  .listen({ port: PORT })
  .then(() => {
    app.log.info(`apps/api listening on :${PORT}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

