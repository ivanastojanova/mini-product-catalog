import { createHmac } from "node:crypto";

/**
 * Builds the `Gateway-Signature` header value: `t=<unix seconds>,v1=<hex>`,
 * where the HMAC-SHA256 covers `${t}.${rawBody}`. The body must be the exact
 * string that is sent. apps/api's `verifyWebhookSignature` is the other half;
 * the two are separate files in separate apps, and the same fixed test vector
 * in both test suites is what stops them drifting apart.
 */
export function signWebhook({
  rawBody,
  secret,
  timestamp,
}: {
  rawBody: string;
  secret: string;
  /** Unix seconds. */
  timestamp: number;
}): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
