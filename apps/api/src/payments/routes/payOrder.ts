import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { WEB_ORIGIN } from "../../corsConfig.js";
import { db } from "../../db/client.js";
import { sweepExpiredOrders } from "../../orders/lib/expireStaleOrders.js";
import { getOrderDto } from "../../orders/lib/orderDto.js";
import { findOwnedOrderId } from "../../orders/lib/ownedOrder.js";
import { resolveRequester } from "../../orders/lib/resolveRequester.js";
import type { PaymentGateway } from "../lib/gatewayClient.js";
import { startPayment } from "../lib/startPayment.js";

type OrderParams = { publicId: string };

/** The storefront's locales (a deliberate small copy, like apps/cms: the apps are separate deploys). */
const LOCALES = ["en", "de"] as const;

type PayOrderOptions = {
  gateway: PaymentGateway;
  /** Defaults to GATEWAY_PUBLIC_URL, then GATEWAY_URL, then the local gateway. */
  getGatewayPublicUrl?: () => string;
  webOrigin?: string;
};

function defaultGatewayPublicUrl() {
  return process.env.GATEWAY_PUBLIC_URL ?? process.env.GATEWAY_URL ?? "http://localhost:4100";
}

/**
 * POST /orders/:publicId/pay?lang=en|de
 * Starts a payment for the requester's own unpaid order and returns where to
 * send the browser. Bodiless, like cancel. 404 for a missing or foreign order
 * (indistinguishable), 409 `not_payable` unless the order is `pending_payment`,
 * 502 when the gateway can't be reached. It never marks anything paid: only the
 * signed webhook does.
 */
export function createPayOrderHandler(options: PayOrderOptions) {
  const getGatewayPublicUrl = options.getGatewayPublicUrl ?? defaultGatewayPublicUrl;
  const webOrigin = (options.webOrigin ?? WEB_ORIGIN).replace(/\/+$/, "");

  return async function payOrderHandler(
    request: FastifyRequest<{ Params: OrderParams; Querystring: { lang?: string } }>,
    reply: FastifyReply,
  ) {
    const requester = await resolveRequester(request);
    sweepExpiredOrders(db, request.log);

    const orderId = requester.owner
      ? findOwnedOrderId(db, request.params.publicId, requester.owner)
      : null;
    if (orderId === null) {
      return reply.code(404).send({ message: "Order not found" });
    }

    const requested = request.query.lang;
    const lang = LOCALES.find((locale) => locale === requested) ?? "en";

    const result = await startPayment(
      db,
      options.gateway,
      {
        orderId,
        lang,
        gatewayPublicUrl: getGatewayPublicUrl(),
        returnUrl: `${webOrigin}/${lang}/orders/${encodeURIComponent(request.params.publicId)}`,
      },
      request.log,
    );

    switch (result.outcome) {
      case "started":
        return reply.code(200).header("Cache-Control", "no-store").send({ payUrl: result.payUrl });
      case "not_payable":
        return reply.code(409).send({
          code: "not_payable",
          message: `An order that is ${result.status.replace("_", " ")} can't be paid.`,
          order: getOrderDto(db, orderId),
        });
      case "gateway_error":
        return reply.code(502).send({ message: "The payment service is unavailable. Please try again." });
    }
  };
}

export function registerPayOrderRoute(app: FastifyInstance, options: PayOrderOptions) {
  app.post("/orders/:publicId/pay", createPayOrderHandler(options));
}
