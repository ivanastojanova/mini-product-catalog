import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

import { findStoredResponse, hashRequest, storeResponse } from "../../idempotency/lib/idempotency.js";

export const REFUND_ENDPOINT = "POST /v1/refunds";

export type RefundView = { id: string; paymentIntentId: string; amountCents: number };

export type RefundResult =
  | { outcome: "created"; refund: RefundView }
  | { outcome: "replayed"; refund: RefundView }
  | { outcome: "intent_not_found" }
  | { outcome: "not_refundable"; status: string }
  | { outcome: "key_reused_with_different_request" };

export function newRefundId(): string {
  return `re_${randomBytes(16).toString("hex")}`;
}

/**
 * Refunds the full amount of a succeeded intent, once. One transaction covers
 * the idempotency lookup, the refund row and the intent's move to `refunded`.
 * - Same key, same request: the original refund again.
 * - Same key, different request: refused.
 * - A NEW key for an intent that is already refunded: still the original refund
 *   (the unique `intent_id` means money can only go back once).
 * - An intent that never succeeded: not refundable, nothing is written.
 */
export function refundIntent(
  sqlite: Database.Database,
  options: { idempotencyKey: string; paymentIntentId: string },
): RefundResult {
  const { idempotencyKey, paymentIntentId } = options;
  const requestHash = hashRequest([paymentIntentId]);

  return sqlite.transaction((): RefundResult => {
    const stored = findStoredResponse(sqlite, idempotencyKey, REFUND_ENDPOINT);
    if (stored !== null) {
      return stored.requestHash === requestHash
        ? { outcome: "replayed", refund: stored.response as RefundView }
        : { outcome: "key_reused_with_different_request" };
    }

    const intent = sqlite
      .prepare("SELECT id, status, amount_cents FROM payment_intents WHERE id = ?")
      .get(paymentIntentId) as { id: string; status: string; amount_cents: number } | undefined;
    if (!intent) return { outcome: "intent_not_found" };

    const existing = sqlite
      .prepare("SELECT id, amount_cents FROM refunds WHERE intent_id = ?")
      .get(intent.id) as { id: string; amount_cents: number } | undefined;
    if (existing) {
      const refund = { id: existing.id, paymentIntentId: intent.id, amountCents: existing.amount_cents };
      storeResponse(sqlite, idempotencyKey, REFUND_ENDPOINT, requestHash, refund);
      return { outcome: "replayed", refund };
    }

    if (intent.status !== "succeeded") return { outcome: "not_refundable", status: intent.status };

    const refund = { id: newRefundId(), paymentIntentId: intent.id, amountCents: intent.amount_cents };
    sqlite
      .prepare("INSERT INTO refunds (id, intent_id, amount_cents) VALUES (?, ?, ?)")
      .run(refund.id, intent.id, refund.amountCents);
    sqlite
      .prepare("UPDATE payment_intents SET status = 'refunded', updated_at = unixepoch() WHERE id = ?")
      .run(intent.id);
    storeResponse(sqlite, idempotencyKey, REFUND_ENDPOINT, requestHash, refund);
    return { outcome: "created", refund };
  })();
}
