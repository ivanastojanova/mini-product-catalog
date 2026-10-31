import type Database from "better-sqlite3";

import { signWebhook } from "./sign.js";

export const DELIVERY_TIMEOUT_MS = 3000;

type DeliverOptions = {
  webhookUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
  timeoutMs?: number;
};

export type DeliveryResult = { delivered: boolean; status?: number; error?: string };

/**
 * Sends one stored event to apps/api: the stored payload string, byte for byte,
 * with a fresh timestamp and signature each time (so re-sending the same event
 * is just a retry, and a captured request goes stale). One attempt only: the
 * result is recorded in `delivery_attempts` / `delivered_at` and returned,
 * never thrown, because a down receiver must not break the shopper's redirect.
 * A non-2xx answer counts as not delivered.
 */
export async function deliverEvent(
  sqlite: Database.Database,
  eventId: string,
  options: DeliverOptions,
): Promise<DeliveryResult> {
  const row = sqlite.prepare("SELECT payload FROM events WHERE id = ?").get(eventId) as
    | { payload: string }
    | undefined;
  if (!row) return { delivered: false, error: "unknown event" };

  const fetchImpl = options.fetchImpl ?? fetch;
  const timestamp = (options.now ?? (() => Math.floor(Date.now() / 1000)))();

  let result: DeliveryResult;
  try {
    const response = await fetchImpl(options.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "gateway-signature": signWebhook({ rawBody: row.payload, secret: options.secret, timestamp }),
      },
      body: row.payload,
      signal: AbortSignal.timeout(options.timeoutMs ?? DELIVERY_TIMEOUT_MS),
    });
    result = response.ok
      ? { delivered: true, status: response.status }
      : { delivered: false, status: response.status };
  } catch (error) {
    result = { delivered: false, error: error instanceof Error ? error.message : String(error) };
  }

  sqlite
    .prepare(
      "UPDATE events SET delivery_attempts = delivery_attempts + 1, delivered_at = CASE WHEN ? THEN unixepoch() ELSE delivered_at END WHERE id = ?",
    )
    .run(result.delivered ? 1 : 0, eventId);

  return result;
}
