import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export type Outcome = "succeed" | "succeed_twice" | "decline";

export type SettleResult =
  | { outcome: "settled"; eventId: string; sends: number; returnUrl: string }
  | { outcome: "already_settled"; returnUrl: string }
  | { outcome: "not_found" };

export function newEventId(): string {
  return `evt_${randomBytes(16).toString("hex")}`;
}

/**
 * Applies the shopper's choice on the hosted page. In ONE transaction it moves
 * the intent out of `requires_payment` and records the single event that
 * describes it. An intent that already left `requires_payment` (a double click,
 * a back-button resubmit) creates nothing, so one payment can never produce two
 * different events. `sends` is how many times the event should be delivered:
 * "succeed_twice" re-sends the SAME event id, which is exactly what a retrying
 * gateway does and what apps/api must treat as a duplicate.
 */
export function settleIntent(
  sqlite: Database.Database,
  intentId: string,
  outcome: Outcome,
  now: number = Math.floor(Date.now() / 1000),
): SettleResult {
  return sqlite.transaction((): SettleResult => {
    const intent = sqlite
      .prepare(
        "SELECT id, status, amount_cents, currency, metadata_order_id, return_url FROM payment_intents WHERE id = ?",
      )
      .get(intentId) as
      | {
          id: string;
          status: string;
          amount_cents: number;
          currency: string;
          metadata_order_id: string;
          return_url: string;
        }
      | undefined;

    if (!intent) return { outcome: "not_found" };
    if (intent.status !== "requires_payment") {
      return { outcome: "already_settled", returnUrl: intent.return_url };
    }

    const succeeded = outcome !== "decline";
    const eventId = newEventId();
    const payload = JSON.stringify({
      id: eventId,
      type: succeeded ? "payment_intent.succeeded" : "payment_intent.payment_failed",
      created: now,
      data: {
        object: {
          id: intent.id,
          amount: intent.amount_cents,
          currency: intent.currency,
          metadata: { orderId: intent.metadata_order_id },
        },
      },
    });

    sqlite
      .prepare("UPDATE payment_intents SET status = ?, updated_at = unixepoch() WHERE id = ?")
      .run(succeeded ? "succeeded" : "failed", intent.id);
    sqlite
      .prepare("INSERT INTO events (id, type, intent_id, payload) VALUES (?, ?, ?, ?)")
      .run(eventId, succeeded ? "payment_intent.succeeded" : "payment_intent.payment_failed", intent.id, payload);

    return {
      outcome: "settled",
      eventId,
      sends: outcome === "succeed_twice" ? 2 : 1,
      returnUrl: intent.return_url,
    };
  })();
}
