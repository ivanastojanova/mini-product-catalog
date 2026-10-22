import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { db } from "../../db/client.js";
import { customers, sessions } from "../../db/schema.js";
import { mergeCartOnAuth } from "../../cart/lib/mergeOnAuth.js";
import { verifyPassword } from "../lib/password.js";
import { generateSessionToken, hashSessionToken } from "../lib/session.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  sessionCookieOptions,
} from "../lib/sessionConfig.js";
import { validateLoginInput } from "../lib/validation.js";
import type { AuthenticatedCustomer } from "../types.js";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Same message regardless of which part was wrong — don't let a login attempt reveal whether an email is registered. */
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

/**
 * POST /auth/login
 * Body: { email, password }
 * On success: creates a session, sets the session cookie, and returns the
 * customer's safe (non-sensitive) fields. On failure: generic 401, same
 * message whether the email didn't exist or the password was wrong.
 */
export async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply,
) {
  const input = {
    email: asString(request.body?.email).trim().toLowerCase(),
    password: asString(request.body?.password),
  };

  const validationError = validateLoginInput(input);
  if (validationError) {
    return reply.code(400).send({ message: validationError.message });
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, input.email))
    .limit(1);

  if (!customer) {
    return reply.code(401).send({ message: INVALID_CREDENTIALS_MESSAGE });
  }

  const passwordMatches = await verifyPassword(input.password, customer.passwordHash);
  if (!passwordMatches) {
    return reply.code(401).send({ message: INVALID_CREDENTIALS_MESSAGE });
  }

  mergeCartOnAuth(request, reply, customer.id);

  const token = generateSessionToken();

  await db.insert(sessions).values({
    id: hashSessionToken(token),
    customerId: customer.id,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    userAgent: request.headers["user-agent"] ?? null,
    // Not captured yet — see sessionConfig.ts / ADR 0004 TBD notes.
    ipAddress: null,
  });

  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions,
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return reply.code(200).send({
    id: customer.id,
    email: customer.email,
    name: customer.name,
  } satisfies AuthenticatedCustomer);
}

export function registerLoginRoute(app: FastifyInstance) {
  app.post("/auth/login", loginHandler);
}
