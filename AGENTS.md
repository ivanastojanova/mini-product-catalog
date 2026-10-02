# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Keep this file current as architecture decisions land — see `docs/adr/` for the detailed rationale behind each one.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This project uses Next.js 16, which has breaking changes vs. earlier major versions — APIs, conventions, and file structure may differ from training data. Before writing Next.js code, check `node_modules/next/dist/docs/` (or https://nextjs.org/docs) for the current behavior. Notable differences already encountered in this repo:

- `middleware.ts` was renamed to `proxy.ts` (see `apps/web/proxy.ts`).
- Route/page `params` is a `Promise`, not a plain object — always `await params`.
- Turbopack is the default dev bundler; `next.config.ts`'s `turbopack.root` must point at wherever `node_modules/next` actually resolves (important in this npm-workspaces monorepo — see `docs/adr/0001-monorepo-content-commerce-split.md`).
<!-- END:nextjs-agent-rules -->

## Project shape

Two deployable Next.js apps in an npm workspaces monorepo:

```
apps/
  cms/   Payload CMS — catalog content only (Products, Media, Users/admin auth).
         SQLite, own payload.db. Serves REST/GraphQL on :3001.
  web/   Storefront + BFF — commerce domain lives here (customers, cart, orders,
         payments once built). Talks to apps/cms over real HTTP, never the
         Payload Local API. Serves on :3000.
docs/adr/   One Markdown file per significant architectural decision.
```

Why split this way, and why content vs. commerce specifically: `docs/adr/0001-monorepo-content-commerce-split.md`.

## Conventions to follow

### Feature module layout (apps/web)

Every domain (`products`, and future `cart`, `checkout`, `orders`, `auth`) gets its own folder under `apps/web/features/<domain>/`:

```
features/<domain>/
  api/         Typed functions wrapping fetch() (client) or server-only HTTP calls to apps/cms (server).
  components/  Presentational + "use client" interactive components, co-located per feature.
  hooks/       TanStack Query wrappers (useQuery/useMutation). Optimistic updates live here.
  lib/         Pure helpers: formatters, mappers (external shape → storefront DTO), cache tag names.
  queries/     Centralized query-key factory — hooks never hardcode array keys.
  types/       Hand-written storefront-facing types, decoupled from any external schema.
```

Do not dump new domain logic into `features/products`. Mirror this structure for each new domain.

### Server/client boundary

- `"use client"` at the top of any file using hooks/state/browser APIs. Everything else defaults to a Server Component.
- Server-only modules that must never leak into a client bundle (e.g. `apps/web/shared/cms/client.ts`) import the `server-only` package as a tripwire.
- apps/web never imports Payload's generated types or Local API — see `apps/web/shared/cms/types.ts` for the hand-written REST response shapes it depends on instead. This is intentional: apps/web treats apps/cms like any third-party headless CMS.

### i18n

- No i18n library. `apps/web/shared/i18n/locales.ts` is the single source of truth for the storefront's locale list; `apps/cms/i18n/locales.ts` is a small, intentionally duplicated copy (the two apps are separate deploys now — see ADR 0001).
- Component copy is hand-rolled `Record<Locale, {...}>` dictionaries co-located in the component file. Keep doing this until the copy surface genuinely outgrows it (login/checkout flows are the likely tipping point — flag it rather than silently introducing a library).

### Caching

- CMS-driven content (`getProducts`, `getProduct`) is cached with `unstable_cache` + tags (`products`, `product:{slug}`), invalidated via `revalidateTag`.
- Because apps/cms and apps/web are separate processes, cache invalidation is webhook-based: apps/cms's collection hooks POST to apps/web's `POST /api/revalidate` (Bearer or `x-revalidate-secret`, see `REVALIDATE_SECRET`). Do not try to call `revalidateTag` from inside apps/cms — it has no Next.js cache to invalidate.

### Style

- Double-quote strings, semicolons, trailing commas (follow existing files — no Prettier config exists, match surrounding code).
- `type` over `interface` for hand-written types; Payload's generated types use `interface` (irrelevant now that apps/web doesn't import them).
- One-line `/**/` JSDoc above exported functions explaining *why*, not *what*.
- Ask before adding a new dependency, especially anything that duplicates an existing pattern (e.g. an i18n library, a different data-fetching library, a UI kit).

## Testing

Vitest lives in `apps/web` (`npm run test --workspace=apps/web`, or `npm test` from root). Money-critical and security-critical logic (auth, cart totals, order state transitions, payment webhook verification) must ship with tests in the same change, not retrofitted later.

## ADRs

Every phase/major decision gets a numbered file in `docs/adr/` using `docs/adr/0000-template.md`. Write the ADR as part of the same change that implements the decision, not after.
