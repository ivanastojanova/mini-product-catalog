---
name: code-review
description: Review a change before commit, PR or handoff, with the project's specific risk checks (money in integer cents, auth/ownership, stock transactions, idempotency, cache tags, server/client boundary, i18n). Use whenever implementation is considered complete, after a build-order step, before marking a PLAN item done, when asked to review a diff or "does this look right", or when tests/lint pass but the change touches auth, money, stock, payments, caching or a user-facing flow.
---

# Code Review

Tests prove what they assert; review looks for what they don't. In this repo the expensive bugs live in a few known places: money arithmetic, authorization, stock transactions, webhook/idempotency handling, cache invalidation, and the server/client boundary. AGENTS.md asks for a review before implementation is considered complete.

The human is learning this codebase. Explain findings so they can verify them; don't just hand over a verdict.

## 1. Scope the change

- `git status --short`, `git diff`, `git diff --staged`; `git log --oneline -5` for intent.
- Read the spec section / ADR / `docs/PLAN.md` item the change claims to implement. A change that does more than the item says is a finding in itself.
- If the diff is large, say so and review it in slices rather than skimming everything.

## 2. Run the gates

Do not review by reading alone if the commands are available:

- Typecheck: `npx tsc --noEmit` in the affected app(s).
- Lint: `npm run lint --workspace=apps/<app>` (or root `npm run lint`).
- Tests: `npm test`, or the affected workspace.
- For user-facing flows, click through in the browser, in EN and DE. If the servers are not running or you cannot click, record it under "not verified" rather than implying it works.

Passing tests are evidence about the assertions, not the feature. Read the assertions that cover the risky lines.

## 3. Risk review

### Money

- Integer cents everywhere; conversion from a CMS price happens once (`toMinorUnits`), never repeatedly.
- Totals, currency and titles are computed server-side; never accepted from the request body.
- Mixed currencies are rejected, not summed.
- Prices are snapshotted at order creation; price drift is shown deliberately.
- Display formatting uses cents-aware helpers (`formatMoney`), not a major-unit formatter.

### Auth and authorization

- A valid session beats a guest cookie; the rule lives in one place.
- Ownership is checked on every read and write; missing and not-yours both return `404` so existence is not revealed.
- Tokens/cookies: `httpOnly`, appropriate `SameSite`, hashed at rest where the repo already does it (session and guest tokens).
- Guest IDs/tokens are never trusted from a URL alone.
- Secrets stay server-side; `server-only` modules are not imported into client components; only genuinely public config uses `NEXT_PUBLIC_`.
- Webhook signatures are verified over the raw body before parsing; idempotency is insert-first and transactional. Note the known gaps recorded in ADR 0010 (no retries, one signing secret, no rate limiting) so you don't "review in" a guarantee the design does not make.

### Stock and order state

- Reservation is a conditional update, not read-then-write.
- All lines of an order are reserved/released in one transaction; a short line rolls back the rest.
- No `await` inside a `better-sqlite3` transaction (it is synchronous and must not span async work).
- Expired holds are swept before any availability/read path that depends on them.
- `applyTransition` remains the only writer of `orders.status`; replaying an edge is safe.

### Caching and freshness

- CMS-driven reads use the right tag and are invalidated by the webhook, not by a local `revalidateTag` in apps/cms.
- Volatile data (stock, carts, orders) is never cached in a shared cache.
- No user-specific data leaks into a cached response.
- A new cache key cannot be minted at will by untrusted input (the filtering `q`/price case).

### Boundaries and Next.js 16

- `params`/`searchParams` are awaited; `proxy.ts` is the middleware equivalent.
- apps/web calls apps/cms and apps/api over HTTP; no Payload Local API or generated Payload types.
- Domain code lives under `features/<domain>/` with the repo layout; it is not dumped into `features/products`.
- `"use client"` only where hooks/state/browser APIs are needed; no server-only code pulled into a client bundle.

### i18n and accessibility

- Every new UI string exists in EN and DE; no hard-coded copy.
- Money/date formatting uses the locale.
- Controls have accessible names; interactive custom components keep keyboard and label behaviour; disabled/error states are announced.

### Tests

- Money- and security-critical changes ship tests in the same change, not a follow-up.
- Tests cover the failure path and the boundary (last unit, expired hold, wrong owner, duplicate webhook), not only the happy path.
- New pure helpers have unit tests; new UI is covered by a click-through, since the repo has no component-test setup.

### Docs

- ADR written if the change makes an architectural decision (`architecture-decisions` skill).
- Spec/PLAN/README reflect the new state; no stale "not yet built" claims.
- Disclosure review: no local paths, container names, credentials or environment values.

## 4. Mutation-check the risky guards

When the change protects money, stock, authorization or idempotency, verify that the tests actually fail when the guard is removed. The repo does this manually (there is no mutation runner):

1. Identify the guard (ownership check, `WHERE on_hand - reserved >= :q`, replay check, transaction boundary, cache `no-store`).
2. Break it deliberately in the working tree.
3. Run the focused suite and confirm the expected test fails.
4. Revert the break and rerun.

If the test still passes, the test is weak — fix the test. Some mutants are equivalent (behaviour is also protected elsewhere); say so explicitly instead of forcing a change.

## 5. Report

Lead with findings, ordered by severity. For each: file and line, what happens, why it matters, and how to verify or fix.

- **Must fix** — correctness, security, money, data loss, broken invariant.
- **Should fix** — edge-case bug, missing test for a risky path, boundary leak, stale docs.
- **Nits** — naming, style, comment wording.

Then state:

- **Verified** — commands run and their result, suites, click-through performed.
- **Not verified** — anything you could not run, and why.

If the change is clean, say so with the evidence. Do not invent findings to look thorough, and do not approve something you could not test while implying you did.

## 6. Fixing during review

Do not silently rewrite a change under review. The repo's working style is one small piece at a time and the human wants to understand the fix. Report first; if asked to fix, keep the change minimal and explain it. Ask before introducing a new dependency or changing a public shape.
