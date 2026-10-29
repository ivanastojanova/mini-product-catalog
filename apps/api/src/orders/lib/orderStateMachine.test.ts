import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  ORDER_EVENTS,
  ORDER_STATUSES,
  isTerminal,
  targetOf,
  transition,
  type OrderEvent,
  type OrderStatus,
} from "./orderStateMachine.js";

// Written out independently of the implementation's table, so the test
// fails if someone loosens the table by accident.
const LEGAL: Array<[OrderStatus, OrderEvent, OrderStatus]> = [
  ["pending_payment", "pay", "paid"],
  ["pending_payment", "cancel", "cancelled"],
  ["pending_payment", "expire", "expired"],
  ["paid", "fulfil", "fulfilled"],
];

describe("transition", () => {
  it.each(LEGAL)("%s + %s -> %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it("rejects every (state, event) pair that is not in the legal list", () => {
    const isLegal = (from: OrderStatus, event: OrderEvent) =>
      LEGAL.some(([f, e]) => f === from && e === event);

    let illegalChecked = 0;
    for (const from of ORDER_STATUSES) {
      for (const event of ORDER_EVENTS) {
        if (isLegal(from, event)) continue;
        expect(() => transition(from, event), `${from} + ${event}`).toThrow(
          IllegalTransitionError,
        );
        illegalChecked += 1;
      }
    }

    // 5 states x 4 events = 20 pairs, 4 legal.
    expect(illegalChecked).toBe(16);
  });

  it("carries the offending state and event on the error", () => {
    try {
      transition("cancelled", "pay");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect((error as IllegalTransitionError).from).toBe("cancelled");
      expect((error as IllegalTransitionError).event).toBe("pay");
      expect((error as Error).message).toContain("cancelled");
    }
  });

  it("does not let a paid order be cancelled or expired (stock already sold)", () => {
    expect(() => transition("paid", "cancel")).toThrow(IllegalTransitionError);
    expect(() => transition("paid", "expire")).toThrow(IllegalTransitionError);
  });

  it("does not let an unpaid order be fulfilled", () => {
    expect(() => transition("pending_payment", "fulfil")).toThrow(IllegalTransitionError);
  });

  it("does not revive an expired or cancelled order by paying it", () => {
    expect(() => transition("expired", "pay")).toThrow(IllegalTransitionError);
    expect(() => transition("cancelled", "pay")).toThrow(IllegalTransitionError);
  });
});

describe("targetOf", () => {
  it.each(LEGAL)("the target of %s's event %s is %s, matching the transition table", (from, event, to) => {
    expect(targetOf(event)).toBe(to);
    expect(transition(from, event)).toBe(targetOf(event));
  });
});

describe("isTerminal", () => {
  it("is true for fulfilled, cancelled and expired", () => {
    expect(isTerminal("fulfilled")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("expired")).toBe(true);
  });

  it("is false for states that still accept events", () => {
    expect(isTerminal("pending_payment")).toBe(false);
    expect(isTerminal("paid")).toBe(false);
  });

  it("terminal states have no outgoing edge for any event", () => {
    for (const status of ORDER_STATUSES.filter(isTerminal)) {
      for (const event of ORDER_EVENTS) {
        expect(() => transition(status, event)).toThrow(IllegalTransitionError);
      }
    }
  });
});
