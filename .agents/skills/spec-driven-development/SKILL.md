---
name: spec-driven-development
description: Plan a phase or feature in docs/specs/, settle scope with the human, and build it in small independently testable steps tracked in docs/PLAN.md. Use when starting a new phase or feature, turning requirements into a design, deciding what is in and out of scope, writing or updating a spec, changing course mid-phase, or when a request is too large to implement as one small change.
---

# Spec-Driven Development

This repo builds in phases. A phase is designed in `docs/specs/000N-<name>.md`, built in small pieces that can each be run or clicked, and tracked in `docs/PLAN.md`. The spec is the working contract for the phase; an ADR records a decision that outlives it; PLAN is the index and the session handoff.

Read `docs/PLAN.md` first. It carries the current status and exactly what is done/next, so context is not lost between sessions ([AGENTS.md](../../../AGENTS.md)).

## 1. Orient before writing

- Read `docs/PLAN.md` (phase table, handoff, open TBDs, future fixes).
- Read the closest existing spec (`docs/specs/`) and the ADRs it links.
- Check whether this needs a spec at all. One function, one endpoint extension or a small fix does not; use the existing design and the working-style rules. A spec is for work with a shape to settle: data model, API contract, flows, authorization, failure modes.
- If the request is ambiguous, ask. The repo values a short conversation over a large speculative design.

## 2. Settle the scope with the human

Write down the answers, not just the questions:

- What problem does this solve, and what does "done" look like?
- What is explicitly in scope and out of scope? "Left out on purpose" is a valid decision.
- What is deferred because it needs its own phase or sign-off (email service, a new dependency, a real search service)?
- Which tradeoffs have real consequences? Present the options with costs and a recommendation. Never silently choose a dependency, ORM, hashing/auth mechanism, payment shape or library — AGENTS.md requires asking.
- What is the smallest end-to-end, clickable version? Prefer that over a technically complete but invisible slice.

Capture this in a **Settled decisions** table, the pattern used in specs 0003/0004/0006.

## 3. Write the spec

File: `docs/specs/000N-<short-name>.md`. Use the shape the existing specs use:

1. **Title, Status, Phase, Related** — status is `Draft`, `In progress` or `Done`; link the specs/ADRs this builds on.
2. **Context** — why this phase exists, the project's real constraints (separate deploys, cookie scoping, no background-job infrastructure at the moment, learning-project budget), and what prior phases left behind.
3. **Settled decisions** — the table from step 2.
4. **Numbered Decisions** — one section per real choice. For each: the decision, the reasoning, and the alternative not taken. This is where the design lives.
5. **Data model / API shapes** — tables, columns, constraints, request/response, error codes, cookie names and attributes. Be concrete enough to implement from.
6. **Flows and edge cases** — happy path plus the cases that cause bugs: expiry, replay, duplicate delivery, last unit, foreign owner, mixed currency, retry after a lost response.
7. **Module changes** — which feature folders/files in apps/web, which routes/lib in apps/api or apps/gateway.
8. **Testing requirements** — name the money- and security-critical parts that must ship with tests in the same change; name the pure helpers that get unit tests.
9. **Out of scope** — explicit.
10. **Build order** — numbered, each step independently runnable or clickable, smallest visible win first, user-facing flow early (AGENTS.md). A step should be reviewable on its own.
11. **Open questions** — only real ones, each with options and who decides. Resolve them before building through them.

Design rules that recur here:

- Money is integer cents; state the currency rule and where conversion happens.
- Identity and authorization: who can do what, and what an unauthorized caller sees (`404`, not `403`, where existence is sensitive).
- Name every state and every legal transition. Prefer one writer for status changes.
- Enumerate refusal codes; "handle errors" is not a design.
- Say what happens when a dependency is down or a response is lost.
- Record accepted limitations instead of hiding them.
- Cache rules: what is cached, under which tag, what invalidates it, and what must never be cached.

## 4. Build in the spec's order

- Do not implement past an unresolved decision with real tradeoffs; ask.
- One small piece at a time: write it, run typecheck/lint/tests, let the human click or curl it, then move on. Do not deliver a whole phase as one diff.
- Tick the build-order item and update the `docs/PLAN.md` handoff as each piece lands, so a new session can pick up.
- If reality diverges from the spec, update the spec in the same change, usually as an **As built** section that says what changed and why. Code and spec must not drift silently.
- If a decision turns out to outlive the phase or is expensive to reverse, write the ADR now via the `architecture-decisions` skill.
- Security/money-critical code ships with tests in the same change, and the risky guards are mutation-checked (the `code-review` skill describes the manual check).

## 5. Close the phase

- [ ] Every build-order item is ticked, or explicitly deferred with a reason.
- [ ] Risky logic has tests; weak tests were mutation-checked.
- [ ] Browser click-through done in EN and DE for user-facing flows; anything not clicked is stated as such.
- [ ] Spec status is `Done`; `docs/PLAN.md` phase row and handoff updated; README roadmap updated.
- [ ] ADRs written and linked; superseded decisions noted in the new ADR.
- [ ] Open TBDs moved into `docs/PLAN.md`, not lost.
- [ ] Disclosure review of all changed docs (`documentation-hygiene`).

## Anti-patterns

- A spec that is a wishlist with no build order.
- Decisions with no alternatives, or alternatives that are strawmen.
- Building the whole phase, then asking for a click-through.
- A new dependency chosen inside implementation without asking.
- Leaving the spec or PLAN stale after a divergence.
- Using a heavyweight spec for a one-line change.
- Copying implementation detail into the spec that the code already states better; the spec explains intent and contracts.
