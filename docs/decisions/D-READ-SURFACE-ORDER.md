# D-READ-SURFACE-ORDER — projection masking first, then the two small gates, then the system-read construct

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** M-T3.15 has sat at `plan (awaiting sequencing sign-off)` while its
premise moved under it — in what order do its remaining items land?

**Options.** Masking first; the system-read construct first; the two small
security gates first.

**Decision.** In this order: **(1) re-verify the mission body against the merged
head** — #2523 landed the read-gate slice and #2766 moved more of it; **(2)
projection masking** (the `loom.field-mask-projection-source` launder, what is
left of root cause B); **(3) the two small, independent, security-relevant items
in the same wave** — gating the workflow-instance reads and the
`commandHandler`/`queryHandler` route gate; **(4) the system-read construct
last**, as its own mission.

**Rationale.**

- **Masking is what other work waits on.** Whether `sensitive-wire-unsupported`
  becomes M-T3.8 phases 2–4 or a recorded `scope` decision depends on whether a
  gated projection can carry `mask unless` at all — and that is a row in wave C2
  packet 2f. Masking first unblocks a drain; masking second means a second wave.
- **The launder is a security bug wearing documentation clothes.**
  `loom.field-mask-projection-source` makes gated projections and `mask unless`
  mutually exclusive, and *its own remedy points authors back at the ungated CRUD
  routes*. That should not sit behind a new-surface design.
- **The system-read construct is the only item that ADDS surface.** Under the
  standing owner directive (gaps and bugs outrank architectural improvements,
  which outrank new surface area) it goes last — and it is cheaper once masking
  has settled what a compiler-owned read may return.
- **(1) is not ceremony.** The mission header already says "premise partly
  stale", and two of its four root causes have been closed by merged PRs. The
  RUNBOOK requires the re-verification before any of (2)–(4).

**Consequences.** M-T3.15's status line carries this order, and the two small
gates may be split into their own headings if the wave needs the tree fence. If
the re-verification in (1) finds masking already resolved, the order collapses to
(3) then (4) and this tag is amended, not ignored.

**Unblocks.** M-T3.15 → wave **C6**; and the `sensitive-wire-unsupported` row in
wave **C2 packet 2f**.

**Sources.** [`T3-security-governance.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T3-security-governance.md)
M-T3.15; [`M-T3.15 plan`](https://github.com/Loom-Harness/Loc/issues/3347);
PRs #2523, #2766; `src/diagnostics/messages.ts`
`loom.field-mask-projection-source`.
