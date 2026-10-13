import { randomBytes, createHash } from "node:crypto";

/** Raw bytes of entropy for the cookie value — large enough that guessing is infeasible. */
const TOKEN_BYTES = 32;

/** Generate a new raw session token (goes in the cookie — never stored directly). */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hash a raw session token for storage/lookup. Fast hash is fine here — unlike passwords, the input already has 256 bits of entropy, so there's nothing for an attacker to brute-force even with a fast hash. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
