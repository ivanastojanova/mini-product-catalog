/** Name of the httpOnly cookie carrying the raw session token. */
export const SESSION_COOKIE_NAME = "session";

/** Fixed session lifetime — does not extend on activity (simpler to reason about than sliding expiry). */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Shared cookie options for setting/clearing the session cookie in route handlers. */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
