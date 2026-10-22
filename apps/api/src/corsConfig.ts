/** Origin apps/web runs at — must be a specific origin, not "*", since we send credentials (cookies) cross-origin. */
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

/**
 * CORS options shared by the server and its tests. `methods` is explicit
 * because @fastify/cors defaults to GET,HEAD,POST, which would fail the
 * browser preflight for the cart's PUT/DELETE routes.
 */
export const corsOptions = {
  origin: WEB_ORIGIN,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
};
