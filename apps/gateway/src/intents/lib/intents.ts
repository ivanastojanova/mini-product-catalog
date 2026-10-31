import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

import { findStoredResponse, hashRequest, storeResponse } from "../../idempotency/lib/idempotency.js";
import type { IntentInput } from "./validateIntentInput.js";

export const CREATE_INTENT_ENDPOINT = "POST /v1/payment_intents";

export type IntentStatus = "requires_payment" | "succeeded" | "failed" | "refunded";

export type IntentView = {
  id: string;
  status: IntentStatus;
  amountCents: number;
  currency: string;
  orderId: string;
  returnUrl: string;
  payUrl: string;
  createdAt: number;
};

export type CreatedIntent = { id: string; status: IntentStatus; payUrl: string };

export type CreateIntentResult =
  | { outcome: "created"; intent: CreatedIntent }
  | { outcome: "replayed"; intent: CreatedIntent }
  | { outcome: "key_reused_with_different_request" };

/** `pi_` plus 128 random bits. It is also the credential for the hosted pay page, so it must be unguessable. */
export function newIntentId(): string {
  return `pi_${randomBytes(16).toString("hex")}`;
}

export function payUrlFor(publicUrl: string, intentId: string): string {
  return `${publicUrl}/pay/${intentId}`;
}

/**
 * Creates an intent once per idempotency key. Looking the key up and inserting
 * the intent and the key happen in ONE synchronous transaction, so a retry (or
 * two at the same moment) can never create a second intent. The same key with
 * a different request is refused rather than silently answered with the first
 * intent. A replay returns the response as first given (its original status).
 */
export function createIntent(
  sqlite: Database.Database,
  options: { publicUrl: string; idempotencyKey: string; input: IntentInput },
): CreateIntentResult {
  const { publicUrl, idempotencyKey, input } = options;
  const requestHash = hashRequest([input.amountCents, input.currency, input.orderId, input.returnUrl]);

  return sqlite.transaction((): CreateIntentResult => {
    const stored = findStoredResponse(sqlite, idempotencyKey, CREATE_INTENT_ENDPOINT);
    if (stored !== null) {
      return stored.requestHash === requestHash
        ? { outcome: "replayed", intent: stored.response as CreatedIntent }
        : { outcome: "key_reused_with_different_request" };
    }

    const id = newIntentId();
    sqlite
      .prepare(
        "INSERT INTO payment_intents (id, amount_cents, currency, metadata_order_id, return_url) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, input.amountCents, input.currency, input.orderId, input.returnUrl);

    const intent: CreatedIntent = { id, status: "requires_payment", payUrl: payUrlFor(publicUrl, id) };
    storeResponse(sqlite, idempotencyKey, CREATE_INTENT_ENDPOINT, requestHash, intent);
    return { outcome: "created", intent };
  })();
}

export function getIntent(sqlite: Database.Database, publicUrl: string, id: string): IntentView | null {
  const row = sqlite
    .prepare(
      "SELECT id, status, amount_cents, currency, metadata_order_id, return_url, created_at FROM payment_intents WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        status: IntentStatus;
        amount_cents: number;
        currency: string;
        metadata_order_id: string;
        return_url: string;
        created_at: number;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    orderId: row.metadata_order_id,
    returnUrl: row.return_url,
    payUrl: payUrlFor(publicUrl, row.id),
    createdAt: row.created_at,
  };
}
