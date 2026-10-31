import { createHmac, timingSafeEqual } from "node:crypto";

/** A captured webhook stops being replayable after this long (Stripe's default). */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  | "missing_header"
  | "malformed_header"
  | "stale_timestamp"
  | "bad_signature";

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureFailure };

type VerifyInput = {
  /** The exact bytes the gateway signed. Re-serialized JSON would not match. */
  rawBody: string;
  /** `Gateway-Signature` header value: `t=<unix seconds>,v1=<hex hmac>`. */
  header: string | undefined;
  secret: string;
  /** Current time in unix seconds; a parameter so tests don't depend on the clock. */
  now: number;
  toleranceSeconds?: number;
};

/**
 * Verifies a Stripe-style webhook signature: HMAC-SHA256 over `${t}.${rawBody}`.
 * Pure on purpose, so every rejection path is testable without a server. The
 * reason code is for logs and tests only; the HTTP response must not reveal
 * which check failed. Several `v1` entries are accepted (any one matching
 * passes), which is what lets a secret be rotated without downtime.
 */
export function verifyWebhookSignature({
  rawBody,
  header,
  secret,
  now,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}: VerifyInput): SignatureResult {
  if (header === undefined || header.trim() === "") {
    return { ok: false, reason: "missing_header" };
  }

  const parsed = parseHeader(header);
  if (parsed === null) {
    return { ok: false, reason: "malformed_header" };
  }

  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`).digest("hex"),
  );

  const matches = parsed.signatures.some((candidate) => {
    const candidateBytes = Buffer.from(candidate);
    // timingSafeEqual throws on unequal lengths, so a short or long value is rejected first.
    return candidateBytes.length === expected.length && timingSafeEqual(candidateBytes, expected);
  });

  return matches ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) return null;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "t") {
      if (!/^\d{1,15}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}
