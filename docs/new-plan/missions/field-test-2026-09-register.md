# `M-FT` — the 2026-09 field-test series, unmerged ids

*Written 2026-09-10 (Wave **C0.4** of [`../completion-waves-2026-09.md`](../completion-waves-2026-09.md)). Companion to [`../archive/FT-done.md`](../archive/FT-done.md), which reconstructs the 18 ids that merged.*

## What this file is, and what it deliberately is not

The `M-FT.*` series was minted in a **field-test session in early September 2026** — an end-to-end build of a real application against the shipping toolchain — and the missions were executed straight from those cards. **The cards themselves exist nowhere under `docs/`.** There is no plan file, no track entry, no audit that defines them; every reference in the repo is to a card someone was holding.

So the 13 ids below are recorded as **UNKNOWN-DEFINITION** and nothing else. Their content is not inferred, not guessed from the numbering, and not reconstructed from the gaps between their merged neighbours. Where a merged sibling *states* what an unmerged id owns, that sentence is quoted with its source; everything else is blank on purpose.

> **The owner holds the field-test notes.** Closing this file means pasting each card in, or declaring the id withdrawn. Anyone tempted to fill a row from context should not: an invented card is worse than an empty one, because the next agent cannot tell them apart.

## The 13

| id | status | what the repo actually knows |
|---|---|---|
| **M-FT.5** | UNKNOWN-DEFINITION | [#2746](https://github.com/Loom-Harness/Loc/pull/2746) (M-FT.7) names it as the owner of the **parameterless-operation affordance**: *"`Action` has no toast slot on any of the six frontends, and adding one means a `WalkerTarget` seam plus a template in every pack — that lands with M-FT.5, which owns the parameterless-op affordance in `forms.ts` and `designs/*/*/`."* |
| **M-FT.8** | UNKNOWN-DEFINITION | nothing — no PR, no branch, no citation anywhere in the repo |
| **M-FT.9** | UNKNOWN-DEFINITION | nothing |
| **M-FT.14** | UNKNOWN-DEFINITION | nothing |
| **M-FT.15** | UNKNOWN-DEFINITION | nothing |
| **M-FT.16** | UNKNOWN-DEFINITION | nothing |
| **M-FT.17** | UNKNOWN-DEFINITION | nothing |
| **M-FT.23** | UNKNOWN-DEFINITION | nothing |
| **M-FT.24** | UNKNOWN-DEFINITION | [#2744](https://github.com/Loom-Harness/Loc/pull/2744) (M-FT.31) names it as the owner of the **union wire shape**, and defers review-A D-7 (the OpenAPI union document) to it: *"the same document is re-shaped by the union WIRE change M-FT.24 owns. The two should land together, on all five emitters, in that mission."* |
| **M-FT.25** | UNKNOWN-DEFINITION | nothing |
| **M-FT.28** | UNKNOWN-DEFINITION | nothing |
| **M-FT.29** | UNKNOWN-DEFINITION | nothing |
| **M-FT.30** | UNKNOWN-DEFINITION | nothing |

## How the merged/unmerged split was established

Two independent passes, because the obvious one is wrong:

1. `git log origin/main --format='%s' | grep -o 'M-FT\.[0-9]*'` reports **16** merged ids. This is the number the completion plan was cut with, and it is short by two.
2. Listing every pull request whose **head branch** matches `claude/m-ft-` finds **18**. **M-FT.7** ([#2746](https://github.com/Loom-Harness/Loc/pull/2746) — "Errors keep their reason…") and **M-FT.10** ([#2737](https://github.com/Loom-Harness/Loc/pull/2737) — "F11 + D1: refuse the C# name collision…") carry the id on the branch only, never in the title or the commit subject.

**Count by branch, not by subject.** `docs/new-plan/waves/wave-2.md:44` already recorded `#2737 #2741 (M-FT.10 / M-FT.26 .NET)` — the mapping was written down once and then lost, because nothing indexed it.

A third pass (`"M-FT." in:body is:merged`) found no further ids, so the 13 above are genuinely absent from the merged record — not merely mis-titled.

## What happens to these ids

They are **not** live missions and must not be treated as a backlog: an id with no definition cannot be picked up, claimed, or estimated. They exist here so that

- the numbering is accounted for — a reader who meets `M-FT.24` in a PR body can find out what is and is not known about it;
- `test/system/unsupported-register.test.ts`'s one-heading-per-cited-id rule has somewhere to resolve any of them to, should the register ever cite one;
- and the count in [`../completion-waves-2026-09.md`](../completion-waves-2026-09.md) §1 can be re-derived rather than remembered.

When the owner supplies a card, give the id a real `## M-FT.n` heading in the owning track file (or record it as `declined`) and delete its row here.
