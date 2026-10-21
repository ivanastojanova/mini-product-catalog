import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

import { registerAuthRoutes } from "./auth/routes/register.js";
import { registerLoginRoute } from "./auth/routes/login.js";
import { registerLogoutRoute } from "./auth/routes/logout.js";
import { registerSessionRoute } from "./auth/routes/session.js";

const PORT = Number(process.env.PORT ?? 4000);

/** Origin apps/web runs at — must be a specific origin, not "*", since we send credentials (cookies) cross-origin. */
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: WEB_ORIGIN,
  credentials: true,
});

await app.register(cookie);

app.get("/health", async () => ({ ok: true }));

registerAuthRoutes(app);
registerLoginRoute(app);
registerLogoutRoute(app);
registerSessionRoute(app);

app
  .listen({ port: PORT })
  .then(() => {
    app.log.info(`apps/api listening on :${PORT}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });

