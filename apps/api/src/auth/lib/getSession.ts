import { eq } from "drizzle-orm";

import { hashSessionToken } from "./session.js";
import type { AuthenticatedCustomer } from "../types.js";
import { db } from "../../db/client.js";
import { customers, sessions } from "../../db/schema.js";

/**
 * Resolves a raw session cookie token to the logged-in customer, or null if
 * the token is missing, unknown, or its session has expired. Does not delete
 * expired rows here — lazy cleanup happens on the next *successful* auth
 * action (register/login write a fresh row anyway); a stray expired row
 * sitting in the table until then is harmless since this lookup already
 * treats it as logged out.
 */
export async function getCustomerForSessionToken(
  token: string | undefined,
): Promise<AuthenticatedCustomer | null> {
  if (!token) {
    return null;
  }

  const [row] = await db
    .select({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(customers, eq(sessions.customerId, customers.id))
    .where(eq(sessions.id, hashSessionToken(token)))
    .limit(1);

  if (!row || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return { id: row.id, email: row.email, name: row.name };
}
