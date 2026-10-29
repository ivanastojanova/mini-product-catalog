/** Name of the httpOnly cookie carrying a guest browser's raw order token. */
export const ORDER_COOKIE_NAME = "order_token";

/** Guest order access lasts this long after the last order is placed or viewed; also the cookie's maxAge. */
export const ORDER_COOKIE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** How long an unpaid order holds its stock. */
export const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

/**
 * Reservation TTL, read per call so a dev can shorten it with
 * `RESERVATION_TTL_SECONDS` (e.g. 30) to click-test expiry. An unset, zero,
 * negative or non-numeric value falls back to the 15-minute default rather
 * than creating orders that expire instantly.
 */
export function reservationTtlMs(): number {
  const seconds = Number(process.env.RESERVATION_TTL_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RESERVATION_TTL_MS;
}
