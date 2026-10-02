# ADR 0002: Webhook-based cache revalidation (replacing the in-process hook)

**Status:** Accepted

**Date:** 2026-10-01

## Context

Before the monorepo split (ADR 0001), a Payload `Product` write triggered an `afterChange`/`afterDelete` collection hook that called `revalidateTag` **directly**, in-process, because Payload and the Next.js storefront shared one runtime (`shared/cms/revalidateProductCache.ts` imported `next/cache` straight from a Payload hook). This only works when both are the same process — `next/cache`'s `revalidateTag` is a Next.js server runtime API, not a network-callable one.

Once `apps/cms` and `apps/web` became separate processes (ADR 0001), that import became structurally impossible: `apps/cms` has no Next.js cache to invalidate, and `apps/web`'s cache lives in a process `apps/cms` can't reach except over the network.

The storefront already had a `POST /api/revalidate` endpoint from the original take-home (secured with `REVALIDATE_SECRET`, documented in the README as the manual/webhook purge path) — it was previously a *secondary* path alongside the in-process hook, used for manual curl/demo purges. It now needed to become the *only* path.

## Decision

`apps/cms`'s `Product` collection hooks (`afterChange`, `afterDelete`) now call `notifyRevalidate()` (`apps/cms/lib/notifyRevalidate.ts`), which does an authenticated `fetch()` POST to `${WEB_APP_URL}/api/revalidate` with `Authorization: Bearer ${REVALIDATE_SECRET}`. This is exactly the shape of a real third-party CMS webhook — apps/cms doesn't know or care that apps/web uses Next.js's tag-based cache internally; it just notifies "this slug changed."

apps/web's `/api/revalidate` route is unchanged in its own logic (still validates the Bearer/`x-revalidate-secret`, still calls `revalidateProductCache` → `revalidateTag`) — only its caller changed, from an in-process function call to an HTTP request.

Failure handling: `notifyRevalidate` **swallows** fetch failures (logs a warning, does not throw). A CMS content write must never fail because the storefront happens to be down — that would make the CMS admin unusable whenever the storefront is deploying, restarting, or just not running (e.g. during `npm run seed`, which calls `payload.update()` with `context: { disableRevalidate: true }` specifically to skip this entirely during seeding).

## Alternatives considered

- **Keep polling / time-based ISR only** — drop tag-based invalidation, rely on `revalidate: N` seconds. Rejected: this was already rejected in the original take-home (README: *"Time-based ISR alone would leave content stale and wouldn't show CMS-driven freshness"*) and that reasoning doesn't change just because the processes split.
- **Message queue (e.g. Redis pub/sub, SQS) between apps/cms and apps/web** — more realistic for a high-traffic production system where webhook delivery needs retries/dead-letter handling. Rejected for now as over-engineering for this exercise's scale; flagged in the original README's "Tradeoffs / next steps" table (*"Revalidation under load: `expire: 0` → Stale-while-revalidate; queue + retries for webhooks"*) as a legitimate future step, not a now step.
- **apps/web polls apps/cms for changes** — simpler to implement (no inbound webhook endpoint needed on apps/web), but reintroduces the staleness window ISR-with-polling always has, and doesn't teach the webhook-signature/push pattern we'll want anyway for Phase 5's payment gateway webhook.

## Consequences

**Easier:**
- apps/cms and apps/web are now fully decoupled at the process level — this is the realistic shape of CMS webhook integration (e.g. how a real Contentful/Sanity webhook would call back into a storefront).
- The pattern directly rehearses what Phase 5 (mock payment gateway) needs: an authenticated webhook POST, with the caller not caring about the receiver's internal cache/state mechanism.

**Harder / tradeoffs accepted:**
- **No retry on webhook failure.** If apps/web is unreachable when a product is saved, that revalidation is silently dropped — the page will simply stay stale until the next write or a manual `curl` purge (still supported, unchanged). Acceptable for a learning exercise; a production system would want at-least-once delivery (retry with backoff, or a queue).
- **No webhook signature verification yet.** The Bearer/`x-revalidate-secret` check is a shared-secret check, not a signed-payload check (no HMAC, no replay protection). This is consistent with the original take-home's existing auth model for this endpoint and is proportionate for a cache-purge trigger (worst case of a replay: an extra cache miss) — but Phase 5's payment webhook will need real HMAC signature verification + idempotency, specifically because payment events are not safe to replay or spoof the way a "please recheck this slug" ping is. Don't copy this endpoint's auth model for the payment webhook.
- **Two services must agree on `WEB_APP_URL`/`REVALIDATE_SECRET`** at deploy time — one more pair of env vars to keep in sync across apps/cms and apps/web, versus zero when it was in-process.

## Related

- `apps/cms/lib/notifyRevalidate.ts` — the webhook sender.
- `apps/cms/collections/Product.ts` — the hooks that call it.
- `apps/web/app/api/revalidate/route.ts`, `apps/web/app/api/revalidate/route.test.ts` — the receiver + its auth tests.
- `apps/web/shared/cms/revalidateProductCache.ts` — unchanged tag-selection logic.
- ADR 0001 — the process split that necessitated this change.
