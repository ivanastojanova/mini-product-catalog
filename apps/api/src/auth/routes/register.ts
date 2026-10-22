import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { db } from "../../db/client.js";
import { customers, sessions } from "../../db/schema.js";
import { mergeCartOnAuth } from "../../cart/lib/mergeOnAuth.js";
import { hashPassword } from "../lib/password.js";
import { generateSessionToken, hashSessionToken } from "../lib/session.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  sessionCookieOptions,
} from "../lib/sessionConfig.js";
import { validateRegisterInput } from "../lib/validation.js";
import type { AuthenticatedCustomer } from "../types.js";

type RegisterBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * POST /auth/register
 * Body: { email, password, name }
 * On success: inserts the customer, creates a session (auto-login), sets the
 * session cookie, and returns the customer's safe (non-sensitive) fields.
 */
export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
) {
  const input = {
    email: asString(request.body?.email).trim().toLowerCase(),
    password: asString(request.body?.password),
    name: asString(request.body?.name).trim(),
  };

  const validationError = validateRegisterInput(input);
  if (validationError) {
    return reply.code(400).send({ message: validationError.message });
  }

  const existing = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, input.email))
    .limit(1);

  if (existing.length > 0) {
    return reply.code(409).send({ message: "Email already registered" });
  }

  const passwordHash = await hashPassword(input.password);

  const [customer] = await db
    .insert(customers)
    .values({
      email: input.email,
      passwordHash,
      name: input.name,
    })
    .returning();

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

  return reply.code(201).send({
    id: customer.id,
    email: customer.email,
    name: customer.name,
  } satisfies AuthenticatedCustomer);
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/register", registerHandler);
}
