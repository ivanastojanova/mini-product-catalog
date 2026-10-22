/** Name of the httpOnly cookie carrying the raw guest-cart token. */
export const CART_COOKIE_NAME = "cart_token";

/** Guest carts expire this long after their last write; also the cookie's maxAge. */
export const GUEST_CART_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
