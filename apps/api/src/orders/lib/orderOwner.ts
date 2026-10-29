/**
 * Who an order belongs to: a logged-in customer, or the guest browser holding
 * the raw `order_token` whose SHA-256 is `tokenHash`. Shared by order creation,
 * idempotent replay and (later) every order read/cancel, so "is this yours?" has
 * exactly one definition.
 */
export type OrderOwner =
  | { kind: "customer"; customerId: number }
  | { kind: "guest"; tokenHash: string };

export function orderBelongsTo(
  order: { customerId: number | null; guestTokenHash: string | null },
  owner: OrderOwner,
): boolean {
  if (owner.kind === "customer") {
    return order.customerId !== null && order.customerId === owner.customerId;
  }
  return order.guestTokenHash !== null && order.guestTokenHash === owner.tokenHash;
}
