import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { db } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import { hashSessionToken } from "../lib/session.js";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../lib/sessionConfig.js";

/**
 * POST /auth/logout
 * Deletes the session row matching the cookie (if any) and clears the cookie.
 * Always succeeds — logging out when already logged out is not an error.
 */
export async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE_NAME];

  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
  }

  reply.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions);

  return reply.code(200).send({ loggedOut: true });
}

export function registerLogoutRoute(app: FastifyInstance) {
  app.post("/auth/logout", logoutHandler);
}
