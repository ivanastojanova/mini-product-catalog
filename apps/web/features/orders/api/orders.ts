import type { Order } from "@/features/orders/types/order";
import { apiFetch, extractErrorMessage } from "@/shared/api/client";

type OrderResponse = { order: Order };

/**
 * One order, or `null` when apps/api answers 404. A missing order and one that
 * isn't yours look identical on purpose, so the page shows one "not found"
 * state for both. Any other failure throws.
 */
export async function getOrder(publicId: string): Promise<Order | null> {
  const response = await apiFetch(`/orders/${encodeURIComponent(publicId)}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not load your order."));
  }

  return ((await response.json()) as OrderResponse).order;
}

/** The logged-in customer's orders, newest first. apps/api answers 401 for guests and logged-out visitors. */
export async function listOrders(): Promise<Order[]> {
  const response = await apiFetch("/orders");

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not load your orders."));
  }

  return ((await response.json()) as { orders: Order[] }).orders;
}

/** Cancels an unpaid order and releases its stock. Deliberately bodiless and without Content-Type: Fastify answers 400 to that header on an empty body. */
export async function cancelOrder(publicId: string): Promise<Order> {
  const response = await apiFetch(`/orders/${encodeURIComponent(publicId)}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not cancel your order."));
  }

  return ((await response.json()) as OrderResponse).order;
}

/**
 * Starts (or resumes) a payment and returns the gateway's hosted page to send
 * the browser to. The order's amount is never sent: apps/api reads it from the
 * order. `locale` only decides which language page the shopper returns to.
 * The URL is checked before anything navigates to it.
 */
export async function startPayment(publicId: string, locale: string): Promise<{ payUrl: string }> {
  const response = await apiFetch(
    `/orders/${encodeURIComponent(publicId)}/pay?lang=${encodeURIComponent(locale)}`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not start your payment."));
  }

  const { payUrl } = (await response.json()) as { payUrl?: unknown };
  if (typeof payUrl !== "string" || !isHttpUrl(payUrl)) {
    throw new Error("Could not start your payment.");
  }

  return { payUrl };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
