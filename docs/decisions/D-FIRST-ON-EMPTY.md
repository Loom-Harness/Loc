# D-FIRST-ON-EMPTY — `first` is partial and fails on an empty collection; `firstOrNull` is the total form

**Status:** PINNED — APPLIED (wave C2 packet 2n).  RS-36 is minted in
[`conformance-semantics.md`](../conformance-semantics.md); ledger row `F2-EXPR-7`
is `done`.

**Question.** `.first` on an empty collection throws on three backends and yields
an `undefined`/`nil` typed as non-optional on two — which is the contract?

**Options.** (a) `first: T` is PARTIAL and fails on empty everywhere;
(b) `first` becomes `T?` (total), and every model reading `.first.x` must change;
(c) leave it per target.

**Decision.** (a). `first: T` keeps its non-optional type and **fails** on an
empty receiver on every target; `firstOrNull: T?` is the total form, and the
failure message names it.

**Rationale.**

- **(b) contradicts the declared signature.** `src/util/collection-ops.ts:23`
  already declares `first` as returning a non-optional `T`, and (b) would break
  every `lines.first.sku` in the language for a case authors can already express
  with `firstOrNull`.
- **The two degrading targets are the ones violating their own declared type.**
  node renders `${recv}[0]` (`src/generator/_expr/js-collection-ops.ts:67` →
  `undefined`) and elixir renders `List.first(${recv})` for **both** `first` and
  `firstOrNull` (`src/generator/elixir/render-expr.ts:905-906` — literally the
  same snippet), so a `string`-typed getter returns `nil`/`undefined` and the
  wrong value flows onto the wire or dies later somewhere that does not mention
  the collection. The three that fail — dotnet `.First()` (`:948`), java
  `.get(0)` (`:634`), python `[0]` (`:577`) — at least fail at the point of the
  mistake.
- **A failure at the read is diagnosable; a null that ships is not.** This is the
  same argument RS-34 makes for the absent-join case, reaching the opposite
  conclusion only because there the absent value has a MEANING (no joined row)
  and here it does not — the model asserted a first element exists.

**Consequences.** Mints **RS-36** in `docs/conformance-semantics.md` (RS-35 is
claimed by D-DECIMAL-EXACT-MOMENT in this batch). elixir moves `first` to `hd/1`
and keeps `List.first/1` for `firstOrNull`; node emits an explicit guard that
throws instead of `[0]`. The failure surfaces as the sanitized **500** RS-28
already governs — it is not a domain-floor 422, because the request was valid and
the model's assumption was not. The frontends follow the same rule under
`frontend-collection-op-unsupported` (wave C2 packet 2g) rather than degrading to
`undefined` in a page body; the seven emitters render the raise and the error
boundary shows it. The contract is pinned in `src/util/collection-ops.ts` the way
`src/util/intrinsics.ts` pins scalar edge behaviour, plus a per-backend arm test.

**Unblocks.** ledger row `F2-EXPR-7` → wave **C2 packet 2g** (frontend half:
M-T1.20).

**Sources.** [`targets-completeness-2026-08-30.ledger.json`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/targets-completeness-2026-08-30.ledger.json)
row `F2-EXPR-7` (its `fix` field poses exactly this fork);
[`conformance-semantics.md`](../conformance-semantics.md) RS-28, RS-34;
`src/util/collection-ops.ts`, `src/util/intrinsics.ts`, the five
`render-expr.ts` leaf tables and `src/generator/_expr/js-collection-ops.ts`.

**As built (wave C2 packet 2n).** Two things the ruling did not anticipate.
(1) The node guard could not be a ternary: `recv.length > 0 ? recv[0] : …`
emits the whole receiver CHAIN twice, and that table is shared with the four JS
frontend walkers, where the receiver can contain hook calls — so it is an arrow
IIFE taking the receiver as a parameter, and the "evaluated exactly once"
property is itself pinned. (2) The assertion that actually catches the elixir
shape is not "`first` raises" but "`first` and `firstOrNull` render
DIFFERENTLY": `List.first/1` reads as a plausible implementation of either op,
so a raise-only gate would have passed on the defect. The FRONTEND half named
in Consequences is vacuous today — `loom.frontend-collection-op-unsupported`
refuses every stdlib collection op in a page body — so the shared table's guard
is backend-reachable only; that is recorded in RS-36 rather than left as a
claim the frontends were changed.
