export type IntentInput = {
  amountCents: number;
  currency: string;
  orderId: string;
  returnUrl: string;
};

export type ValidationResult =
  | { ok: true; input: IntentInput }
  | { ok: false; message: string };

const MAX_AMOUNT_CENTS = 99_999_999;
const MAX_ORDER_ID_LENGTH = 100;
const MAX_URL_LENGTH = 2048;

/**
 * Checks the body of `POST /v1/payment_intents`. The return URL is compared by
 * parsed origin, not by prefix: `http://localhost:3000.evil.com` and
 * `http://localhost:3000@evil.com` both start with the allowed text but point
 * somewhere else.
 */
export function validateIntentInput(body: unknown, allowedReturnOrigin: string): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body must be a JSON object" };
  }

  const { amountCents, currency, orderId, returnUrl } = body as Record<string, unknown>;

  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    return { ok: false, message: `amountCents must be an integer between 1 and ${MAX_AMOUNT_CENTS}` };
  }

  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, message: "currency must be a 3-letter uppercase code" };
  }

  if (typeof orderId !== "string" || orderId === "" || orderId.length > MAX_ORDER_ID_LENGTH) {
    return { ok: false, message: `orderId must be a non-empty string of at most ${MAX_ORDER_ID_LENGTH} characters` };
  }

  if (typeof returnUrl !== "string" || returnUrl.length > MAX_URL_LENGTH || !isAllowedReturnUrl(returnUrl, allowedReturnOrigin)) {
    return { ok: false, message: "returnUrl must be a URL on the allowed return origin" };
  }

  return { ok: true, input: { amountCents, currency, orderId, returnUrl } };
}

function isAllowedReturnUrl(value: string, allowedOrigin: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === allowedOrigin;
  } catch {
    return false;
  }
}
