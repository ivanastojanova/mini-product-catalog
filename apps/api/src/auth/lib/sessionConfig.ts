/** Name of the httpOnly cookie carrying the raw session token. */
export const SESSION_COOKIE_NAME = "session";

/** Fixed session lifetime — does not extend on activity (simpler to reason about than sliding expiry). */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Shared cookie options for setting/clearing the session cookie.
 * `sameSite: "lax"` works for apps/web <-> apps/api in local dev because
 * SameSite only cares about scheme + registrable domain, not port — both
 * are `localhost`. Revisit if the two apps ever deploy to genuinely
 * different registrable domains (see ADR 0004).
 */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
