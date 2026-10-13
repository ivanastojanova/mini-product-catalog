import bcrypt from "bcrypt";

/** Deliberately slow (not sha256) — see docs/adr/0003-session-cookie-auth.md for why. */
const COST_FACTOR = 12;

/** Hash a plaintext password before storing it. Never store the plaintext. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST_FACTOR);
}

/** Compare a login attempt's plaintext against the stored hash. Constant-time under the hood. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
