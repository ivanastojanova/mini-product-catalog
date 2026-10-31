import type { IntentView } from "../../intents/lib/intents.js";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

const STYLE = `body{font-family:system-ui,sans-serif;max-width:26rem;margin:3rem auto;padding:0 1rem;color:#18181b}
h1{font-size:1.25rem}.card{border:1px solid #d4d4d8;border-radius:.75rem;padding:1.25rem}
.amount{font-size:2rem;font-weight:600;margin:.25rem 0 1rem}.muted{color:#71717a;font-size:.875rem}
button{display:block;width:100%;margin-top:.6rem;padding:.7rem;border-radius:.5rem;border:1px solid #18181b;font-size:1rem;cursor:pointer;background:#fff}
button.primary{background:#18181b;color:#fff}a{color:#18181b}`;

function layout(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock payment gateway</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** The hosted page for an open intent. Every interpolated value is escaped; the intent id is also in a URL, so it is only ever used as an `action` path after escaping. */
export function renderPayPage(intent: IntentView): string {
  const action = `/pay/${encodeURIComponent(intent.id)}`;
  return layout(`<h1>Mock payment gateway</h1><p class="muted">Test mode. No real money moves.</p>
<div class="card"><div class="muted">Order ${escapeHtml(intent.orderId)}</div>
<div class="amount">${escapeHtml(formatAmount(intent.amountCents, intent.currency))}</div>
<form method="post" action="${escapeHtml(action)}">
<button class="primary" name="outcome" value="succeed">Pay</button>
<button name="outcome" value="succeed_twice">Pay (webhook delivered twice)</button>
<button name="outcome" value="decline">Decline card</button>
</form></div>`);
}

/** Shown instead of the buttons once an intent has left `requires_payment`. */
export function renderFinishedPage(intent: IntentView): string {
  const label: Record<string, string> = {
    succeeded: "This payment was completed.",
    failed: "This payment was declined.",
    refunded: "This payment was refunded.",
  };
  return layout(`<h1>Mock payment gateway</h1><div class="card"><div class="muted">Order ${escapeHtml(intent.orderId)}</div>
<div class="amount">${escapeHtml(formatAmount(intent.amountCents, intent.currency))}</div>
<p>${escapeHtml(label[intent.status] ?? "This payment is closed.")}</p>
<a href="${escapeHtml(intent.returnUrl)}">Back to the shop</a></div>`);
}

export function renderNotFoundPage(): string {
  return layout(`<h1>Mock payment gateway</h1><p>Payment not found.</p>`);
}
