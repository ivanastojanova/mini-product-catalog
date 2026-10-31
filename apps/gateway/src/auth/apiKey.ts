import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * True when `header` is exactly `Bearer <apiKey>`. Both sides are hashed first
 * so the comparison is constant-time and length differences leak nothing.
 */
export function isAuthorized(header: string | undefined, apiKey: string): boolean {
  if (apiKey === "" || typeof header !== "string") return false;

  const match = /^Bearer (.+)$/.exec(header);
  if (match === null) return false;

  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(apiKey).digest();
  return timingSafeEqual(given, expected);
}

/** Fastify hook for every `/v1/*` route. Same 401 whether the header is missing, malformed or wrong. */
export function requireApiKey(apiKey: string) {
  return async function requireApiKeyHook(request: FastifyRequest, reply: FastifyReply) {
    if (!isAuthorized(request.headers.authorization, apiKey)) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
  };
}
