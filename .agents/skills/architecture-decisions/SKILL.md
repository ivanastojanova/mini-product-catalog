---
name: architecture-decisions
description: Record significant technical decisions as numbered ADRs in docs/adr/, using the project template, with real alternatives and honest consequences. Use when a choice spans modules, changes a data model, API contract, auth/money/stock/payment behaviour, adds a dependency or service, is expensive to reverse, supersedes an earlier decision, or when the user asks to compare approaches, choose a library/mechanism, or explain why something is built this way.
---

# Architecture Decisions

Some decisions deserve a durable record. An ADR is not a changelog and not a copy of the spec: it captures **why** a choice was made, **what else was on the table**, and **what it costs**. In this repo every phase/major decision gets a numbered file in `docs/adr/`, written as part of the same change that implements it ([AGENTS.md](../../../AGENTS.md)).

## Decide whether it is an ADR

Write an ADR when the decision:

- crosses a module, app or service boundary;
- changes a data model, API contract, URL shape, or the meaning of stored data;
- touches auth, money, stock/reservations, payments or personal data;
- adds or removes a dependency, service, database or background job;
- is hard or expensive to reverse, or will be asked about again ("why is stock not in the CMS?");
- reverses part of an earlier ADR.

Do **not** write one for a local implementation detail, naming, formatting, or a decision that the phase spec already settles — link the spec instead. If the decision has real tradeoffs and the spec does not settle it, it is probably both a spec decision and an ADR; write the spec section and link the ADR.

When in doubt, ask the human. Per AGENTS.md, they want to choose tradeoffs themselves; silently picking the common default is the failure mode.

## Workflow

1. **Read the context first:** `docs/PLAN.md`, the phase spec in `docs/specs/`, and the ADRs it links. The new ADR must connect to them, not float free.
2. **Settle the tradeoff with the human.** Present the real options, each with its cost, plus a recommendation. Include the cheapest/"do nothing" option and the option the project would outgrow. Do not present a strawman.
3. **Number it:** next free integer in `docs/adr/`, four digits, kebab-case title, e.g. `0011-server-side-catalog-filtering.md`.
4. **Start from the template:** `docs/adr/0000-template.md`. Keep its sections.
5. **Write it in the same change as the code.** If the code already landed, write it before the phase is marked done; do not backfill months later.
6. **Update the indexes:** the phase row and handoff in `docs/PLAN.md`; the README roadmap if the decision is user-visible; the spec's status/related links.
7. **Apply documentation hygiene** (the `documentation-hygiene` skill): everything here is project-level, never the developer's machine.

## What a good ADR looks like in this repo

- **Context** — the constraints that turned this into a decision, not a feature recap. Link the prior ADR/spec that created the constraint.
- **Decision** — numbered, specific enough that a reviewer can check the code against it. State the invariants, not just the technology.
- **Alternatives considered** — each one: what it is, and the concrete reason it was not chosen. The best ADRs here name the tempting shortcut and explain the cost (see ADR 0007, 0011).
- **Consequences** — split into what gets easier, what gets harder/accepted debt, and **triggers to revisit** ("if the catalog needs pagination, move the stock filter into the data layer"). This is the most valuable section; a consequences list with only benefits is a red flag.
- **Related** — links to ADRs, the spec, and the implementing code paths.

Good models already in the repo: `0007` (inventory/reservation), `0008` (guest orders and the ADR 0005 reversal), `0011` (server-side filtering).

## Immutability and supersession

An ADR records the decision as it was made. Do not rewrite an old decision to match today's code. If the project changes course:

- write a new ADR, link the old one, and say exactly what it reverses;
- leave the old ADR readable (the repo pattern is ADR 0008 noting the part of ADR 0005 it reverses);
- update `docs/PLAN.md`/README links so people find the newer one.

Status values: `Proposed`, `Accepted`, `Superseded by ADR-00YY`, `Deprecated`. Add a date.

## Anti-patterns

- An ADR that restates the spec with no tradeoff.
- "We chose X because it is popular/modern" with no project-specific reason.
- Missing the option that was actually considered.
- Consequences that ignore the debt the decision creates.
- Editing a frozen ADR's decision after the fact.
- Local paths, container names, ports, credentials or environment values in an ADR.
- Writing the ADR after the phase is closed, as an afterthought.

## Checklist

- [ ] This is an architectural decision, not a spec detail.
- [ ] The human chose the tradeoff (or explicitly delegated it).
- [ ] Next number, template sections intact, status + date set.
- [ ] At least two real alternatives, each with why not.
- [ ] Consequences include costs and a trigger to revisit.
- [ ] Links to spec/ADRs/code resolve.
- [ ] `docs/PLAN.md` (and README if user-facing) updated.
- [ ] Disclosure review: no machine-specific or sensitive detail.
