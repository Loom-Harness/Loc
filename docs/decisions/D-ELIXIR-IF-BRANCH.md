# D-ELIXIR-IF-BRANCH — the four refused `if`-branch shapes on Phoenix are a declared limit of the linear body renderer, not a per-target gap

**Status:** superseded for the `if` statement by the owner ruling on #3463 item 4 (2026-10-21): model validity must not depend on the target backend.  `loom.elixir-if-stmt-unsupported` is gone.  Lowering puts every early `return` in branch-total form (`src/ir/util/if-normal-form.ts`) for all five backends, and the Phoenix operation renderers split an `if` whose branches decide a persist, guard, `emit` or provenanced write into one complete body per path (`src/generator/elixir/vanilla/op-tree.ts`); `opHasProvSite` now looks inside branches on every backend.  The rationale below still describes the statement `match` (`loom.elixir-match-stmt-unsupported`).
Previously: applied — the proposed default took effect 2026-09-24 (merged to `main` 2026-09-22 in #2970; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2m, which was asked to build the four sub-shapes
`loom.elixir-if-stmt-unsupported` still refuses or re-class them.

**Question.** Wave C2 packet 2a made the `if` STATEMENT render on the vanilla
Phoenix backend (`src/generator/elixir/vanilla/if-stmt-emit.ts`, M-T6.59) and
narrowed the gate to four `#slug` sub-shapes: `#return-in-branch`,
`#guard-in-branch`, `#event-sourced` and `#branch-statement`. Are those four a
residue a sweep can drain, or the shape of the surface?

**Options.** (a) build all four; (b) re-class the code `scope` with the owning
mission named; (c) leave it a `gap` row and let the next packet re-measure.

**Decision.** (b). The code KEEPS its name, its four messages and every arm that
fires. What changes is the claim about who closes it: the register row becomes
`scope` and stays pointed at **M-T6.59**, which is the mission that owns the
Phoenix body renderer. Each surviving sub-shape needs a change to HOW a Phoenix
operation body is built, not another emitter arm — and three of the four are not
even elixir-local.

**Rationale, one sub-shape at a time.** Each was re-derived on this head, not
inherited from 2a's note.

- **`#return-in-branch` is a list-level transform.** Elixir has no early exit, so
  a `return` inside a branch means restructuring every statement that FOLLOWS
  the `if` into the other arm of a `case` — the linear renderers emit one Elixir
  expression per `StmtIR`, in order, and the sourcemap collector
  (`statementSubRegions`) zips that same-length, same-order list. It is already
  ALLOWED where it is expressible: `elixirIfRefusal(stmts, "value")` admits it
  in a tail-value body (a `domainService` operation, a pure `function`) via
  `returnsAreTailOnly`, which is the half that renders today.
- **`#guard-in-branch` would change a status code.** The op path HOISTS top-level
  `requires`/`precondition` into a leading `with :ok <- ensure(…)` chain that
  answers 403/422. A nested guard has nothing to hoist into, so it would have to
  `raise` — a 500 where the other four backends answer 403/422. A wire
  divergence is strictly worse than the refusal, and fixing it properly means
  giving the Phoenix op path a non-hoisted guard form: a body-renderer change.
- **`#event-sourced` is a different body model.** An ES command body is not
  rendered as a statement sequence at all: `eventsourced-emit.ts` sorts it into
  `with`-clauses, `let`s and one `events = […]` list. A conditional `emit` has
  no position in that shape. Rendering it means giving ES commands a statement
  spine — the same body-renderer change, on the other body kind.
- **`#branch-statement` is a CLOSED branch vocabulary, and its two sharpest
  members live OUTSIDE `src/generator/elixir/**`.** The emitters decide an
  operation's supporting machinery by scanning its TOP-LEVEL statements, and two
  of those scans cannot simply "walk deeper":
  - a conditional `emit` renders, but the host module's `require Logger` comes
    from `contextEmitsEvent` (`vanilla/context-emit.ts:857`), and — the part a
    deeper walk does not fix — the S5a persist-then-dispatch restructure cannot
    hoist a CONDITIONAL emit past the commit, so a phantom event would fire on a
    failed write. Ordering, not detection.
  - a PROVENANCED write in a branch is decided by `opHasProvSite`
    (`src/ir/util/prov-id.ts:49`), which is TARGET-NEUTRAL and scans
    `op.statements` one level deep for every backend. Deepening it changes what
    node / .NET / java / python put in provenance-flush mode too, so it is a
    cross-backend change that a packet fenced to `src/generator/elixir/**` must
    not make unilaterally (hand-off, §6b of this packet's note).

  The vocabulary is closed (fail-closed) deliberately: a NEW `StmtIR` kind is
  refused in a branch rather than silently admitted by an allowlist nobody
  updated.

**Consequences.** `loom.elixir-if-stmt-unsupported` becomes `kind: "scope"` in
`src/diagnostics/unsupported-register.ts` and keeps `mission: "M-T6.59"`;
`MAX_OPEN_GAPS` drops by one. No emitter change, no message change, no arm
removed — every one of the four keeps firing with the advice it carries today.
The `opHasProvSite` deepening is recorded as a cross-backend hand-off rather
than done here.

**Unblocks.** `loom.elixir-if-stmt-unsupported` → `scope` (wave **C2 packet
2m**); M-T6.59 stays open and owns the body-renderer question.

**Sources.** `src/ir/validate/checks/if-stmt-checks.ts` (`elixirIfRefusal`,
`BRANCH_VOCABULARY`); `src/generator/elixir/vanilla/if-stmt-emit.ts`;
`src/generator/elixir/vanilla/eventsourced-emit.ts`; `src/ir/util/prov-id.ts`;
[`T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.59.
