import type { DbHandle } from "../../inventory/lib/inventoryRepo.js";
import { applyPaymentEvent } from "./applyPaymentEvent.js";
import type { GatewayEvent } from "./gatewayEvent.js";
import type { PaymentGateway } from "./gatewayClient.js";
import { requestRefunds } from "./requestRefunds.js";

type Log = {
  error: (object: unknown, message: string) => void;
  warn: (object: unknown, message: string) => void;
  info: (object: unknown, message: string) => void;
};

/**
 * The webhook's event handler: apply the event in one transaction, and only
 * after it has committed ask the gateway to refund anything that must go back.
 * A refund problem is logged inside `requestRefunds` and never fails the
 * webhook, because the event itself was handled correctly.
 */
export function createEventProcessor(db: DbHandle, gateway: PaymentGateway) {
  return async function processEvent(
    event: GatewayEvent,
    rawBody: string,
    log: Log,
  ): Promise<{ duplicate: boolean }> {
    const result = applyPaymentEvent(db, event, rawBody, log);

    if (result.status === "duplicate") {
      log.info({ eventId: event.id }, "duplicate payment event ignored");
      return { duplicate: true };
    }

    log.info({ eventId: event.id, outcome: result.outcome, note: result.note }, "payment event processed");
    await requestRefunds(db, gateway, result.refundPaymentIds, log);
    return { duplicate: false };
  };
}
