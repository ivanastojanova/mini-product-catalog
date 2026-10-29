export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "expired",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_EVENTS = ["pay", "cancel", "expire", "fulfil"] as const;

export type OrderEvent = (typeof ORDER_EVENTS)[number];

/**
 * The whole state machine as data: for each state, the events it accepts and
 * where they lead. A state with no entries is terminal. Anything not listed
 * here is illegal. `paid → refunded` is deliberately absent (no refund flow yet).
 */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  pending_payment: { pay: "paid", cancel: "cancelled", expire: "expired" },
  paid: { fulfil: "fulfilled" },
  fulfilled: {},
  cancelled: {},
  expired: {},
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly event: OrderEvent,
  ) {
    super(`Cannot apply "${event}" to an order that is ${from}`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * The state each event leads to. Every event has exactly one target, which is
 * what lets `applyTransition` recognise a replay (already there) and treat
 * it as a no-op instead of an error.
 */
export function targetOf(event: OrderEvent): OrderStatus {
  switch (event) {
    case "pay":
      return "paid";
    case "cancel":
      return "cancelled";
    case "expire":
      return "expired";
    case "fulfil":
      return "fulfilled";
  }
}

/**
 * Pure: the status an order moves to when `event` happens in state `from`.
 * Throws `IllegalTransitionError` for any move the table doesn't allow, so
 * a bug (or a late webhook) can't push an order somewhere it shouldn't be.
 * Knows nothing about the DB; the transaction that persists the move and
 * adjusts stock lives in `applyTransition`.
 */
export function transition(from: OrderStatus, event: OrderEvent): OrderStatus {
  const to = TRANSITIONS[from][event];

  if (to === undefined) {
    throw new IllegalTransitionError(from, event);
  }

  return to;
}

/** A terminal order accepts no further events. */
export function isTerminal(status: OrderStatus): boolean {
  return ORDER_EVENTS.every((event) => TRANSITIONS[status][event] === undefined);
}
