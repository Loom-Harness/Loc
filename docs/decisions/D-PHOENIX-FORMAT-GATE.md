# D-PHOENIX-FORMAT-GATE — the generated-Elixir `mix format` gate is declined permanently; Dialyzer is unscheduled

**Status:** applied — the proposed default took effect 2026-09-16 (merged to `main` 2026-09-14 in #2907; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** M-T6.3 has deferred the `mix format` / Dialyzer CI gates over
generated Phoenix output twice, each time with the same reasoning and no ruling.
Wave C2 packet 2a was told to decide rather than defer a third time. Does Loom
ever run `mix format --check-formatted` (or Dialyzer) over the projects it
emits?

**Options.** (a) activate `mix format --check-formatted` as a per-PR gate and
teach the emitters to satisfy it; (b) activate it nightly-only, accepting a red
nightly until (a) is done; (c) decline the format gate permanently and close the
mission; (d) decline the format gate and schedule Dialyzer instead.

**Decision.** **(c).** `mix format --check-formatted` is **never** run over
generated output, in any tier. Dialyzer and Credo over generated output are
**unscheduled** — not deferred, not owned by a mission; anyone who wants either
opens a new mission carrying its own evidence that it finds a class of defect
the compile gate does not. M-T6.3 closes on this ruling; its slice-1 work (the
`.formatter.exs` that scopes the OpenApiSpex subtree out) stays, because it is
emitted config a human running `mix format` by hand benefits from — it is not a
gate.

**Rationale.**

- **The measurement is already done and it is not close.** M-T6.3's own
  source-grounded scoping (2026-07-21, real `mix format` in the `hexpm/elixir`
  image, the api_spec subtree excluded) found an **irreducible ~250-diff-line /
  20-file structural residual** — blank-line insertion, `case`-clause
  consistency, un-wrapping the emitter's own pre-wraps — that `line_length`
  plateaus against (447 → 253 diff-lines between 98 and 200, then flat) and that
  no other configuration reaches, because `mix format` is deliberately
  non-configurable: no per-rule toggles, no `# format: off` regions.
- **So the only close is teaching ~10 emitters the formatter's rules**, which is
  an L grind whose result is *brittle in the worst direction*: an all-or-nothing
  gate that any future Elixir-emitter edit can break, re-checkable only through
  the slow docker + hex-mirror loop. That is a gate whose expected cost is
  dominated by false alarms on unrelated changes.
- **The payoff is cosmetic, and the non-cosmetic property is already gated.**
  Generated Elixir compiles `mix compile --warnings-as-errors` clean in
  `elixir-vanilla-build.yml`; that catches unused bindings, undefined
  references, and unreachable clauses — everything about the output a reader
  depends on. Nobody hand-edits a generated `.ex`, which is the only situation
  where a formatting standard earns its keep.
- **Deferring again is worse than declining.** A mission parked with "reassess
  if a cheaper mechanism appears" is a standing invitation to re-derive the same
  measurement; two agents have now paid for it. A named decline stops that, and
  is trivially reversible — if Elixir ever ships an ignore-region directive, the
  new mission opens with a one-line premise instead of a re-scoping.
- **Dialyzer is a different question and gets a different answer.** It finds
  real type errors rather than cosmetics, so "declined" would be wrong — but on
  GENERATED code its candidate findings are emitter bugs, and the compile gate
  plus the per-backend boot legs already reach most of them. A PLT build per run
  is not free. It has no evidence behind it today, so it gets no mission; it
  gets the same treatment as any unproposed gate.

**Consequences.** M-T6.3 moves to `archive/T6-done.md` with this tag as its
evidence. No workflow gains a `mix format` step, and a future agent finding
unformatted generated Elixir should cite this tag rather than open a row. The
reusable measurement tooling the scoping produced (the real-formatter diff loop:
`startHexMirror` → `generate system` → `mix format` with `import_deps` resolved
→ diff) stays described in the archived mission, so reversing the ruling starts
from a recipe rather than from scratch.

**Unblocks.** M-T6.3 → wave **C2 packet 2a** (closed by this ruling, no code).

**Sources.** [`T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.3 and
its two deferrals; [`vanilla-phoenix-gaps.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/vanilla-phoenix-gaps.md)
§7; [`static-analysis-followups.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/static-analysis-followups.md)
Slices 1–2; `src/generator/elixir/vanilla/shell-emit.ts`
(`renderVanillaFormatterExs`).
