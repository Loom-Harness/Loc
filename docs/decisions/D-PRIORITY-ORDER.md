# D-PRIORITY-ORDER — target gaps and bugs outrank architecture, which outranks new surface area

**Status:** owner directive, 2026-08-10 (restated 2026-08-24 and 2026-09-10).

**Decision.** Gaps in implementations (a feature missing on a target) and bugs
come first, architectural improvements second, new surface area third.
Structural risks are P1 by default: silent data loss, silent or crashing parity
failures, security defaults, the un-abstracted persistence axis, and
nightly-only feedback.

**Why.** "A smaller platform whose claims all hold beats a wider one with
hollow cells."

**Consequence.** This is the triage rule for issue priority labels.
