# Loom decisions log

Pinned decisions referenced by the design corpus in
[`docs/old/proposals/`](https://github.com/Loom-Harness/Loc/tree/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals) and the implementation plans. Each
entry has a stable **D-tag** that proposals cite when their grammar
or semantics depends on the outcome. Tag scope:

- **PINNED** — decided; downstream proposals may rely on it.
- **OPEN** — recommended answer recorded in the proposal/plan, not
  ratified by the maintainer.

When a proposal's body conflicts with a PINNED decision here, the
decision wins; the proposal text needs a rewrite (tracked per entry
under "Affects").

Decision tags were introduced by the original
[`proposals/global-implementation-plan.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/global-implementation-plan.md)
("Decisions to pin before any grammar edit"; that plan was rewritten
2026-06-10 — this log is now the sole home of the tags) and are
elaborated in the per-proposal docs.

## Where the decisions live

Each decision is one file in [`decisions/`](decisions/), named after its tag:
`decisions/<D-TAG>.md`, whose first line is `# <D-TAG> — <title>`.  A new
decision is a new file, so two changes that each pin a decision never edit the
same lines.  The site renders the directory's index from those headings.
