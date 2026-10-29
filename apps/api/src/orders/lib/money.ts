/**
 * The one place a CMS price (a float in major units, e.g. euros) becomes
 * integer minor units (cents). Everything stored on an order is integer cents
 * so totals never accumulate float error. Rounds to the nearest cent, and
 * throws on values that can never be a real price instead of charging for them.
 */
export function toMinorUnits(price: number): number {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    throw new RangeError(`Invalid price: ${String(price)}`);
  }

  return Math.round(price * 100);
}
