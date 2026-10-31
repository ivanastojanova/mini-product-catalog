/**
 * What apps/api needs from the payment provider. An interface so the event
 * handling can be tested without HTTP, and so the provider could be swapped
 * (apps/gateway is a mock of one).
 */
export type PaymentGateway = {
  /** Creates (or, for a repeated `idempotencyKey`, finds) a payment intent. Resolves to the intent's id only; apps/api builds the pay URL itself. */
  createPaymentIntent(input: {
    amountCents: number;
    currency: string;
    orderId: string;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  /** Refunds the full amount of a succeeded payment. Idempotent per `idempotencyKey`. */
  refund(input: { paymentIntentId: string; idempotencyKey: string }): Promise<{ id: string }>;
};

type HttpGatewayConfig = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

const REQUEST_TIMEOUT_MS = 5000;

/**
 * HTTP client for apps/gateway's `/v1/*` API. Config is read per call, so a
 * missing key fails that one call (a refund stays `refund_pending`) instead of
 * stopping the server from booting. Throws on any non-2xx.
 */
export function createHttpPaymentGateway(config: HttpGatewayConfig = {}): PaymentGateway {
  const fetchImpl = config.fetchImpl ?? fetch;

  function settings() {
    const baseUrl = (config.baseUrl ?? process.env.GATEWAY_URL ?? "http://localhost:4100").replace(/\/+$/, "");
    const apiKey = config.apiKey ?? process.env.GATEWAY_API_KEY;
    if (!apiKey) {
      throw new Error("GATEWAY_API_KEY is not set");
    }
    return { baseUrl, apiKey };
  }

  return {
    async createPaymentIntent({ idempotencyKey, ...body }) {
      const { baseUrl, apiKey } = settings();

      const response = await fetchImpl(`${baseUrl}/v1/payment_intents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Gateway payment intent failed: ${response.status}`);
      }

      const result = (await response.json()) as { id?: unknown };
      // The id ends up in a URL we hand to the browser, so only a plain token is accepted.
      if (typeof result.id !== "string" || !/^pi_[A-Za-z0-9]{1,100}$/.test(result.id)) {
        throw new Error("Gateway payment intent response had no valid id");
      }

      return { id: result.id };
    },

    async refund({ paymentIntentId, idempotencyKey }) {
      const { baseUrl, apiKey } = settings();

      const response = await fetchImpl(`${baseUrl}/v1/refunds`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ paymentIntentId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Gateway refund failed: ${response.status}`);
      }

      const result = (await response.json()) as { id?: unknown };
      if (typeof result.id !== "string" || result.id === "") {
        throw new Error("Gateway refund response had no id");
      }

      return { id: result.id };
    },
  };
}
