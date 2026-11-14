# D-LONG-AVG-DEFAULTS — `long` gets a declared 2^53 ceiling; projection `avg` over money is typed `money`

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** Two numeric rows whose proposed defaults were recorded but never
signed off: what is `long`'s contract, and what type does a query-time
projection's `avg` over a money column carry?

**Options (`long`).** (a) declare and enforce a 2^53 safe-integer ceiling now;
(b) upgrade the representation (BigInt / string wire) on node and python; (c)
leave it. **Options (`avg`).** (a) retype to `money`; (b) keep `decimal` and
document the divergence from the in-memory `avg`.

**Decision.** (a) and (a).

**Rationale (`long`).**

- Today node stores `long` as a JS `number`
  (`bigint(col, { mode: "number" })` in `src/generator/typescript/emit/schema.ts`;
  mikroorm `ts: "number"`) and python routes declared int/long sums through
  `float()` — both corrupt **silently** past 2^53, while .NET/Java/Elixir carry
  int64 exactly. There is no validator and no doc caveat.
- Aggregate overflow is three-way divergent for one `.ddd`: java's
  `((Number) x).intValue()` **wraps silently**, .NET's `(int)` cast **throws**
  (a 500), the rest pass the too-big value through. The unification takes .NET's
  behaviour: a value that does not fit is an ERROR. Java's silent wrap is the one
  shape that produces a wrong ANSWER instead of a failure.
- The ceiling is the honest floor at **S** cost: it converts silent corruption
  into a refusal today. The representation upgrade (b) is a wire change on two
  backends for a bound nobody has yet hit — it becomes a named follow-up mission
  only if the ceiling pinches.

**Rationale (`avg`).**

- `src/ir/lower/lower-projection.ts` stamps query-time `avg → decimal` even over
  a money column, so the mean of exact money crosses the wire as a float64 JSON
  number — while the **in-memory** `avg` of the same field types `money?`
  (`type-system.ts`) and ships the RS-12 four-decimal string. One word, two
  semantics, no gate.
- The retype is a lowering change, not five emitters: `aggregateCoercion`'s
  `isMoney` arm (`src/ir/util/projection-aggregate.ts`) already knows how to
  format money on all five backends.

**Consequences.** python's declared-int/long aggregates route through `int()`; a
`> 2^53` witness fixture proves the exact backends carry it and the ceiling
refuses on the others. The `avg` retype MOVES wire goldens, so it rides
D-DECIMAL-EXACT-MOMENT's single re-capture if both land in the same wave —
otherwise it carries its own reviewed re-capture, never a drive-by rebaseline.
Each arm is mutation-proved by file-copy revert.

**Unblocks.** M-T5.23 and M-T5.24 → wave **C2 packet 2f**.

**LANDED 2026-09-13** (PR [#2903](https://github.com/Loom-Harness/Loc/pull/2903)).
Both options (a) are implemented, and one thing the decision's text did not
anticipate is worth recording: the `avg` retype alone would have been **inert**.
The DECLARED projection row type is what every backend's coercion dispatches on
and nothing checked it, so an author could keep declaring `decimal` for a money
mean and keep the lossy float — the retype ships with
`loom.projection-aggregate-type-mismatch`, which also admits the one widening
(`int` → `long`) an author needs to opt out of the integral range refusal. The
`long` ceiling is enforced at the literal (`loom.integer-literal-imprecise`) and
at the node wire boundary; the residual — the four non-node backends still accept
past the ceiling and store exactly — is pinned in
`test/conformance/numeric-ingress-parity.test.ts` and belongs to
`D-NUMERIC-INGRESS-STRICT`, since closing it is either a representation upgrade
or a uniform ingress narrowing.

**Sources.** [`T5-language-core.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T5-language-core.md) M-T5.23,
M-T5.24; [`numeric-types-audit-2026-08-23.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/numeric-types-audit-2026-08-23.md)
F13, F14; RS-12; `src/ir/lower/lower-projection.ts`,
`src/ir/util/projection-aggregate.ts`, `src/generator/typescript/emit/schema.ts`.
