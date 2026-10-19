import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { hashPassword } from "@/features/auth/lib/password";
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  sessionCookieOptions,
} from "@/features/auth/lib/sessionConfig";
import { generateSessionToken, hashSessionToken } from "@/features/auth/lib/session";
import { validateRegisterInput } from "@/features/auth/lib/validation";
import type { AuthenticatedCustomer } from "@/features/auth/types/auth";
import { db } from "@/shared/db/client";
import { customers, sessions } from "@/shared/db/schema";

type RegisterRequestBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * POST /api/auth/register
 * Body: { email, password, name }
 * On success: inserts the customer, creates a session (auto-login), sets the
 * session cookie, and returns the customer's safe (non-sensitive) fields.
 */
export async function POST(request: Request) {
  let body: RegisterRequestBody;
  try {
    body = (await request.json()) as RegisterRequestBody;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const input = {
    email: asString(body.email).trim().toLowerCase(),
    password: asString(body.password),
    name: asString(body.name).trim(),
  };

  const validationError = validateRegisterInput(input);
  if (validationError) {
    return NextResponse.json(
      { message: validationError.message },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, input.email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { message: "Email already registered" },
      { status: 409 },
    );
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

  const token = generateSessionToken();

  await db.insert(sessions).values({
    id: hashSessionToken(token),
    customerId: customer.id,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    userAgent: request.headers.get("user-agent"),
    // Not captured in local dev — no reverse proxy sets x-forwarded-for here.
    // TBD before deploying somewhere that does.
    ipAddress: null,
  });

  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions,
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return NextResponse.json(
    {
      id: customer.id,
      email: customer.email,
      name: customer.name,
    } satisfies AuthenticatedCustomer,
    { status: 201 },
  );
}
