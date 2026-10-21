import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { getCustomerForSessionToken } from "../lib/getSession.js";
import { SESSION_COOKIE_NAME } from "../lib/sessionConfig.js";

/**
 * GET /auth/session
 * Returns the logged-in customer (or null) for the current session cookie.
 * Used by apps/web's `useSession` to know whether to show account vs.
 * login/register UI.
 */
export async function sessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE_NAME];
  const customer = await getCustomerForSessionToken(token);

  return reply.code(200).send({ customer });
}

export function registerSessionRoute(app: FastifyInstance) {
  app.get("/auth/session", sessionHandler);
}
