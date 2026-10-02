# ADR 0001: Monorepo content/commerce split (apps/web + apps/cms)

**Status:** Accepted

**Date:** 2026-10-01

## Context

The original take-home embedded Payload CMS inside the single Next.js app (`npm run dev` ran both the storefront and the CMS admin in one process, sharing one `node_modules`, one `payload.config.ts` at the repo root, and the Next.js Local API for all CMS reads). The README's own "Production architecture" section already flagged this as a convenience tradeoff: *"In production I'd prefer a monorepo (`apps/web`, `apps/cms`): separate deploys, self-hosted CMS, storefront still owns `POST /api/revalidate`... triggered by webhook instead of an in-process hook."*

We're now extending this project specifically to practice e-commerce backend concepts: auth, cart, checkout, orders, and a mock payment gateway. Two architectural questions had to be answered before any of that could start:

1. Should the CMS stay embedded, or become a real separate service?
2. Should the commerce domain (customers, carts, orders, payments) live inside Payload's `Users`/custom collections, or be entirely separate from the CMS?

## Decision

Split into an npm-workspaces monorepo with two independently runnable Next.js apps:

- **`apps/cms`** — Payload (still Next.js-hosted, since Payload 3 requires a Next.js host), SQLite (`apps/cms/payload.db`), owns *only* catalog content: `Products`, `Media`, and the `Users` collection used purely to gate `/admin`. Serves REST + GraphQL on port 3001.
- **`apps/web`** — the storefront + BFF. Fetches products from `apps/cms` over real HTTP (`fetch` against Payload's REST API — see `apps/web/shared/cms/client.ts`), never the Payload Local API. Owns the transactional/commerce domain (customers, carts, orders, payments) entirely separately from Payload — this is a deliberate bounded-context split, not just a process split: content and commerce have different consistency needs, different auth models, and different write patterns. Serves on port 3000.

Orchestration: npm workspaces only (`workspaces: ["apps/*"]` in the root `package.json`), no Turborepo. Both apps can be started independently (`npm run dev:cms`, `npm run dev:web`) or together (`npm run dev`).

Cache invalidation changes from an in-process `revalidateTag` call (impossible once Payload and Next.js are different processes) to a webhook: Payload's `afterChange`/`afterDelete` hooks on `Product` now POST to apps/web's existing `POST /api/revalidate` endpoint. See ADR 0002 for the detail on why this is its own ADR.

## Alternatives considered

- **Keep embedded, design as if separate** — write the Local API calls as if they went over HTTP, but keep one process for lower setup overhead. Rejected: the user explicitly wants to exercise connecting a separate frontend to a separate backend, and a *simulated* boundary doesn't force you to confront real problems (cross-origin images, env var wiring per service, webhook delivery failure handling) the way an actual network boundary does.
- **Full Turborepo setup** — adds a task runner with caching and pipeline dependencies. Rejected for now: two apps don't need build orchestration yet; npm workspaces alone keeps the mental model simple while still giving dependency hoisting. Revisit if a third app (e.g. a standalone mock-payment-gateway service in Phase 5) makes the build graph worth caching.
- **Commerce domain as Payload collections** (`Orders`, `Payments` alongside `Products` in apps/cms) — rejected because it conflates "content I edit in an admin UI" with "transactional state written by application code during checkout," which have very different access-control and consistency requirements. Keeping commerce entirely in apps/web (its own database, reached from day one — see ADR to come in Phase 2) means the storefront's auth system doesn't depend on Payload's auth internals at all, which is also what makes "hand-rolled JWT auth decoupled from Payload" a coherent decision rather than an arbitrary one.

## Consequences

**Easier:**
- Each app can be deployed, scaled, and reasoned about independently — closer to how a real headless-CMS + commerce-engine architecture works.
- apps/web's `shared/cms/types.ts` hand-written REST shapes make the CMS boundary explicit; swapping Payload for a different CMS later only touches that one file + `shared/cms/client.ts`.
- Forces confronting real distributed-system problems early (webhook delivery, cross-origin media) instead of discovering them later.

**Harder / new tech debt accepted:**
- **Locale config duplication**: `apps/cms/i18n/locales.ts` and `apps/web/shared/i18n/locales.ts` are now two separate files with the same two locale codes. Acceptable at 2 locales; if locales grow or drift becomes painful, promote to a published workspace package (e.g. `packages/i18n`).
- **Cross-origin media**: Payload returns relative media URLs (`/api/media/file/...`); apps/web must prefix with `CMS_API_URL` (`features/products/lib/mappers.ts`) and `next.config.ts` needs `images.remotePatterns` pointed at the CMS origin. In local dev this also required `images.dangerouslyAllowLocalIP: true` since Next's image optimizer blocks proxying to private/loopback IPs by default (SSRF guard) — harmless here since the only private-IP origin we ever point at is our own apps/cms, but worth remembering if additional private-IP origins are ever added.
- **Turbopack root**: npm workspaces hoist `next` to the monorepo root `node_modules`; both apps' `next.config.ts` must set `turbopack.root` to the monorepo root (not their own app directory), or Turbopack can't resolve the hoisted `next` package.
- **CMS availability coupling**: apps/web's SSR pages now depend on apps/cms being reachable over HTTP at request/build time (previously an in-process function call). `notifyRevalidate` in apps/cms is written to swallow failures (webhook target down) rather than fail the CMS write — see ADR 0002.
- **No shared TypeScript types**: apps/web deliberately cannot `import` apps/cms's generated `payload-types.ts` anymore (different npm workspace, and treating the CMS as a third-party service on principle). Any CMS schema change requires manually updating `apps/web/shared/cms/types.ts` — a real cost, same one you'd pay against any third-party headless CMS.

## Related

- `apps/web/shared/cms/client.ts`, `apps/web/shared/cms/types.ts` — the REST boundary.
- `apps/cms/lib/notifyRevalidate.ts`, ADR 0002 — the webhook that replaces in-process revalidation.
- `package.json` (root) — workspace + script orchestration.
- README.md "Production architecture" (original take-home write-up) — the tradeoff this ADR formalizes.
