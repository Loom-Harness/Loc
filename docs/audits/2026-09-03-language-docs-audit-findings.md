# Language-docs audit 2026-09-03 — the code-side findings register

*Scope: the defects surfaced while re-verifying every claim in the language surface docs
(`docs/language.md`, `docs/page-metamodel.md`, `docs/language-reference/**`) against the code
on `main` @ `651388d`. The audit itself was docs-only, so nothing here was fixed *by the audit* —
this is the hand-off list. Snapshot-in-time; re-verify on fresh `main` before picking one up.*

> **Status 2026-09-06 — Wave 1 is drained, and it corrected this register in six places.**
> Four packets landed as PRs [#2786](https://github.com/lemmit/Loc/pull/2786),
> [#2787](https://github.com/lemmit/Loc/pull/2787), [#2788](https://github.com/lemmit/Loc/pull/2788),
> [#2789](https://github.com/lemmit/Loc/pull/2789). **Every one of them re-verified its findings on
> fresh `main` (`59d283b3`) before writing code, and five of the seven turned out to differ
> materially from what was written here** — wrong diagnosis (F5), wrong anchor (F8), wrong target
> (F9 on Flutter), too broad (F3 on React), or larger than recorded (F7). Those corrections are
> folded into the rows below, marked **Corrected**, and three new findings (F48–F50) came out of the
> same work. The lesson is the one the register's own preamble already carried, now with evidence:
> **⚠ verify-first is not ceremony.** A finding written from a symptom is a lead, not a diagnosis.
> Waves 2–7 remain unstarted.

Twelve auditors each walked one doc packet, tracing every claim to the file that proves it.
When a doc and the code disagreed, the doc was corrected — **unless the code was the thing
that was wrong**, in which case the behaviour was documented honestly and the defect landed
here. That boundary is why this register exists: 47 findings, none of them speculative, each
with a file:line anchor and a reproduction.

**What makes this list unusual:** the docs were the instrument. Reading a chapter forces you
to exercise the *surface* — every keyword, every argument spelling, every backend tab — rather
than the paths the test suite already covers. Most of these are shapes that parse clean,
validate clean, and then break at emission; the compile-tier gates never see them because no
fixture writes them.

## The shape of the list

| Class | Count | Drained | What it means |
|---|---|---|---|
| **P0 — silent miscompile or crash** | 12 | 9 | Valid `.ddd`, zero diagnostics, then a crash or output that cannot compile. |
| **P1 — silent drop** | 8 | — | Valid `.ddd`, zero diagnostics, and a declared thing is missing from the output. |
| **P2 — cross-backend divergence** | 7 | — | The same source means different things on different targets, undeclared. |
| **P3 — diagnostic-catalog hygiene** | 11 | — | Codes raised but uncatalogued, messages that contradict the gate, dead gates. |
| **P4 — per-feature doc drift** | 12 | — | Docs outside this audit's scope that contradict the code. |

*50 findings now, not 47: Wave 1's compile gates turned up three more of the same shapes
(F48–F50). P0 is 12 because F48 and F49 joined it already fixed, and F50 joined it open.*

The dividing line that matters is P0/P1 versus P2. A P2 is a *decision the docs can carry*:
Phoenix maps a value object to a `:map` column, and the reference can say so. A P0/P1 is not
documentable — it is the "silent gap" shape `parity-auditor` exists to convert into an honest
`loom.*` gate or a fix.

---

## P0 — validates clean, then crashes or emits code that cannot compile

**F1. `match` over a union in a domain body crashes codegen on all five backends.**
`src/generator/_stmt/target.ts:160` throws `variant-match statement is frontend-only; it must
not reach the <X> backend`. No IR check covers `variant-match` outside a page —
`src/ir/validate/checks/store-checks.ts` only handles the page case. `ddd parse` reports
`0 error(s)`; `ddd generate system` throws on node, dotnet, java, python and elixir alike.
Non-exhaustive arms are likewise unchecked. *Either the statement lowers on the backends or a
`loom.*` gate rejects it; an internal throw is neither.*

**F2. A guarded optional receiver loses its lowering on four of five backends.**
`src/language/validators/types.ts:281` explicitly sanctions `x != null ? x.trim() : …` as *the
fix* for `loom.intrinsic-nullable-receiver` — and then the guarded call is emitted verbatim
instead of through the host idiom. From `note2: string?`, `derived safeNote = note2 != null ?
note2.toUpper() : "none"` emits `this._note2.toUpper()` (node), `this.note2.toUpper()` (java),
`self._note2.to_upper()` (python), `record.note2.to_upper()` (elixir) — none compile. .NET
emits `ToUpper()`, which compiles but is culture-sensitive where an unguarded receiver gets
`ToUpperInvariant()`. The optional receiver is not unwrapped in the intrinsic arms of
`src/ir/lower/lower-expr.ts` the way `checkIntrinsicCalls` unwraps it. *The validator
recommends a form that does not work.*
> **Drained — [#2788](https://github.com/lemmit/Loc/pull/2788) (W1.1 / M-T5.26).** Reproduced
> exactly as written, on all five. Cause: `applySuffixToRecv` stamped the `method-call`'s
> `receiverType` as the **`optional` wrapper**, and every backend's intrinsic dispatch keys off
> `receiverType.kind === "primitive"`, so the guarded call never reached the snippet table and fell
> out of the bottom of `renderMethodCall` verbatim. `unwrapGuardedIntrinsicReceiver` now unwraps one
> level under exactly the validator's three conditions, applied at **both** typing paths
> (`applySuffixToRecv` and `inferSuffixType`) so a `let` bound inside a guard types like the inline
> expression. **Two consequences the register missed:** the catalogue **result type** also fell back
> to its `string` default on an `optional` (`let d = ts.startOfDay()` in a guard bound `string`), and
> the `isCollectionOp` disambiguation broke (a guarded `s.contains(x)` on a `string?` read as a
> *collection* op). **The .NET half was misread here as a second opinion about culture:** the
> `ToUpper()` was just `renderMethodCall`'s `${recv}.${upperFirst(member)}(…)` fallback firing
> because the table had not been consulted at all. `ToUpperInvariant()` is the only domain-position
> spelling; `ToUpper()` survives only in `CS_INTRINSIC_QUERY_RENDERERS`, where EF Core cannot
> translate the Invariant form and the SQL `upper()` it maps to is culture-free anyway. No .NET
> behaviour change was needed.

**F3. `toast(...)` emits an undefined symbol on React.** An action body or `Action { …, then:
toast("x") }` renders `toast("Draft saved");` into the page or component TSX with no import and
no definition anywhere in the generated project. Svelte emits `src/lib/toast.svelte.ts`;
elixir maps to `put_flash`; React has no handling in `src/generator/react/**`. The generated
app does not type-check.
> **Corrected + drained — [#2786](https://github.com/lemmit/Loc/pull/2786) (W1.2 / M-T1.28).**
> **Narrower than recorded.** React *does* handle toast on the **realtime-handler** path
> (`realtime-handlers-builder.ts` + each pack's `realtime-toast` micro-template) — that half of the
> finding is misattributed, and #2732 widens exactly that path, not this one. What is genuinely
> broken and untouched by #2732 is the **action-body / `Action { …, then: … }`** path, where
> `toast(...)` falls through walker-core's generic call arm (`${stmt.name}(${args});`) the way
> `navigate(...)` did before it got its own arm → TS2304. Fixed by emitting `src/lib/toast.ts` and
> importing it where the IR (not a text scan) says the effect is used — chakra v2's form templates
> bind their own `const toast = useToast()` in the same page, and a ui declaring an `extern function
> toast(...)` owns the name. The module self-mounts, because React's `App.tsx`/`main.tsx` are
> design-pack templates under `designs/**`. **Follow-up:** routing the effect through each pack's
> native notification widget needs a `renderToast` seam on `WalkerTarget` plus a walker-core arm —
> Wave 2's tree. **And see F50: Svelte has the identical defect**, on a target this packet excluded.

**F4. `for` / `if let` in an aggregate body is ungated and emits garbage.**
`src/ir/lower/lower-stmt.ts` has no arm for `ForStmt`/`IfLetStmt` outside a workflow and no
validator rejects them: `operation touch() { for n in notes { owner := n } }` reports
`0 error(s), 0 warning(s)` and emits `this.<unknown>();`.

**F5. `seed <AbstractBase> { … }` outside a dataset block crashes the lowerer.**
`seed Party { name: "x" }` dies with `TypeError: Cannot read properties of undefined (reading
'fields')` in `lowerSeed` (`src/ir/lower/lower.ts`) before `loom.seed-abstract-aggregate` can
fire. The same model written as `seed default { Party { … } }` reports the diagnostic
correctly.
> **Corrected + drained — [#2789](https://github.com/lemmit/Loc/pull/2789) (W1.4 / M-T5.27).**
> **The diagnosis above is wrong, and the correction matters.** This is not an ordering problem and
> `loom.seed-abstract-aggregate` is not involved at all. The grammar is
> `Seed: 'seed' (dataset=ID)? (raw?='raw')? '{' rows+=SeedRow* '}'` — so `Party` is consumed as the
> **dataset name**, and `name` becomes a *row's* aggregate reference with no `value=ObjectLit` at the
> `:`. The pipeline had **already produced the two correct diagnostics** for this source
> (`loom.parse-error` "Expecting token of type '{' but found `:`" and `loom.linking-error` "Could not
> resolve reference to Aggregate named 'name'") — and `lowerSeed`, dereferencing the error-recovered
> row, threw them away and printed a stack trace over them. `lowerSeed` was **the one lowerer that
> trusted the AST type over parse recovery**; every other parse-error shape in the language lowers
> fine. Fixed by lowering a recovered row to zero fields. That reframes the finding from "a gate runs
> too late" to "a lowerer discards diagnostics the pipeline already had" — a different class, and one
> worth grepping for elsewhere.

**F6. `generate system` crashes on a valid ui-e2e body.**
`expect(<create-result>.<field>).toHaveText("…")` inside `test e2e … against <frontend>`
validates clean, then throws `expect requires a matcher` from `renderExpectStmt`
(`src/system/expect-stmt.ts:21`, via `src/system/ui-e2e-render.ts:217`). Binding the read with
`getById` first works.
> **Drained — [#2789](https://github.com/lemmit/Loc/pull/2789) (W1.4 / M-T5.27).** The fork
> ("lower it, or gate it") resolved as **both**, because either alone leaves the finding half-drained.
> *Make it work:* the lowering does have the information — `let ord = ui.orders.create({…})` binds
> `{ id }` and the aggregate is known at the create call — so a create-result local now reads exactly
> like a `getById` one, re-navigating via `.goto()` for the same reason `getById` does. The plain-value
> fallback used to emit a property read against an object with no such property, silently; it reads the
> DOM now too. *Gate the residual:* a locator matcher can still be handed something that is not a page
> read (`expect(ord.id).toHaveText(…)`, a literal, an api-test matcher), so new code
> **`loom.locator-matcher-receiver`** raises at the source span, via `diagMessage`.
> **Consolidation debt, recorded deliberately:** the gate re-derives the renderer's handle rule at the
> AST layer (`checkExpectMatcher` in `src/language/validators/match.ts`) rather than sharing it. Its
> proper home is `validateE2ETest` in `src/ir/validate/checks/test-checks.ts`, which already walks
> these statements with resolved IR — **W3.1 / W4.1's tree**; widening into it would have been the
> exact collision the wave protocol exists to prevent. The mutation proof makes the case for
> consolidating: under the *renderer* mutation the validator still passed the source and the renderer
> crashed — gate and renderer are independent, and neither alone covers this finding.

**F7. The python typed api-client emits an invalid annotation for a `File?` field.**
`src/generator/python/api-client.ts:88` appends `| None` to an already-optional rendered type
and never imports `FileRef`: the generated `app/resources/api_clients.py` contains
`spec: FileRef | None | None` inside a `pydantic.BaseModel` — an undefined name at import time.
> **Corrected + drained — [#2787](https://github.com/lemmit/Loc/pull/2787) (W1.3 / M-T6.53).**
> **Bigger than recorded — the missing import had nothing to import.** `app/domain/file_ref.py` is
> not even *emitted* into the caller project, because that emission was gated on the deployable's
> **own** contexts declaring a File field; a `FileRef` import would have dangled. The fix is
> therefore two-part: render the annotation from the unwrapped type and apply `| None` once from
> either channel (`WireField.optional` or an `optional`-wrapped `TypeIR`), *and* emit the shared
> `file_ref.py` when the api client needs it (`/files` routes stay gated on `hasFileField`, so the
> caller gets the TypedDict without upload endpoints it has no object store for). **Why this
> shipped:** *no python-build fixture reached the typed in-system api client at all.* The new
> `api-client-file.ddd` closes that hole — `ruff` and `mypy --strict` now walk this path forever.

**F8. A block-form Elixir function whose parameter is used only inside a `let` does not
compile.** `bodyUsesParam` (`src/generator/elixir/vanilla/function-emit.ts:162`) underscores
the head parameter (`def fee(%Order{} = record, _q)`) while the body reads `q`.
> **Corrected + drained — [#2787](https://github.com/lemmit/Loc/pull/2787) (W1.3 / M-T6.53).**
> **The anchor is one level off, and the `let` framing is wrong.** `bodyExprs` *does* have a `let`
> arm — a param read directly in a `let` is fine, and the existing `shippingFor` test pins exactly
> that and passes on `main`. The real hole is **`walkExpr` in
> `src/generator/elixir/domain/predicates.ts`**, which had no arm for `list`, `match` or `convert`,
> so a read *nested inside one of those* is invisible to `exprUsesParam`: `xs = [q, 2, 3]`,
> `cond do q > 1 -> …`, and `"x" <> to_string(q)` (from `"x" + q`, which lowers to `convert`) all
> produce `** (CompileError) undefined variable "q"`. `function-emit.ts:162` is only the call site.
> Fixed by adding the three arms and making `walkExpr` **exhaustive with a `never` check**, so the
> next `ExprIR` kind is a typecheck error rather than a silent under-report — which caught a fourth
> missing arm (`i18nFormat`) on the spot. **And see F49**, a third instance of the same class that
> the new compile fixture found immediately.

**F9. A `derived` that reads a store field emits an unbound identifier on React and Flutter.**
`store Cart persist: local { state { count: int = 0 } }` + `derived count: int = Cart.count`
emits `const count = useMemo(() => count, []);` (`src/generator/react/walker/page-shell.ts:248`
and the component twin at `:979`) — the store receiver is dropped and no subscription is
hoisted. Renaming the derived proves it is a drop, not shadowing: `derived itemCount = Cart.count`
emits `const itemCount = useMemo(() => count, []);` with `count` undeclared. Flutter interpolates
the same bare identifier. `loom.unresolved-page-ref` covers refs in rendered slots only, not
`derived` initialisers.
> **Corrected + drained — [#2786](https://github.com/lemmit/Loc/pull/2786) (W1.2 / M-T1.28).**
> **React is exactly as reported. Flutter is not.** Flutter does *not* "interpolate the same bare
> identifier" — `derivedResolvableOnPage` refused a store-field ref outright, so the derived was
> dropped **whole** and the body read rendered the walker's give-up comment
> (`const SizedBox.shrink() /* ref: itemCount */`). It compiles: a silent drop, not a build break —
> a P1 shape wearing a P0 label, and it belongs to the same fail-open dispatch-predicate family
> Wave 2 exists to fix (see "Cross-cutting reading" §1), not to this one. On React the cause is as
> written: the derived's `WalkContext` carried no `usedStores` map, so `recordStoreUse` no-oped and
> the shell never hoisted the selector — **and it hides whenever the body happens to read the same
> member, which is why every existing store test passed over it.** Fixed on both, page shell and
> component twin; on Flutter the store bindings also had to move **above** the derived `final`s,
> because Dart is not hoisted. Two Flutter tests had been using a store-reading `derived` as their
> *guaranteed-to-degrade* vehicle — they move to the magic route `id`, the remaining page-shell-only
> binding. **And see F50: Svelte drops the store receiver in the same breath.**

**F48. An Elixir ternary in non-terminal position is a syntax error.** *(Found 2026-09-06 by W1.1's
compile gate; drained in the same PR, [#2788](https://github.com/lemmit/Loc/pull/2788).)*
`ELIXIR_TARGET.ternary` rendered the bare keyword-list form, and Elixir's `if` swallows everything up
to the enclosing terminator — so a ternary that is not the last entry of its container does not
parse: `"safeNote" => if not is_nil(record.note2), do: …, else: "none",` →
`** (SyntaxError) unexpected expression after keyword list`. It has **nothing to do with optionals**;
reproduced from a model with no optional type anywhere (`derived pick: string = title.length > 3 ?
title : "x"` followed by any second `derived`). It hit every wire map whose ternary-valued `derived`
is not last, and every ternary passed as a non-final argument, and stayed invisible because the
fixtures that exercised it happened to put the ternary last. The leaf now self-parenthesizes, as the
Python leaf already did. *A fixture that only ever exercises a construct in terminal position is not
covering it.*

**F49. The Elixir pure-core function emitter hardcodes its receiver binding while its facade twin
underscores an unused one.** *(Found 2026-09-06 by W1.3's new compile fixture; drained in the same
PR, [#2787](https://github.com/lemmit/Loc/pull/2787).)* `renderPureFunction`
(`src/generator/elixir/vanilla/domain-core-emit.ts`) always emitted `record`, so a function reading
only its params compiled on the context module and failed on the schema module:
`warning: variable "record" is unused` ×3 → `Compilation failed due to warnings while using the
--warnings-as-errors option`. Third instance of F8's class — **two copies of one rule, one of them
updated** — which is the argument for the exhaustiveness check F8's fix introduced.

**F50. Svelte has the F3 and F9 defects too, and neither is drained.** *(Found 2026-09-06 by W1.2,
out of its declared tree — [#2786](https://github.com/lemmit/Loc/pull/2786) fixes React and Flutter
only.)* Svelte emits `src/lib/toast.svelte.ts` and then **never imports it into the page** — the
mirror image of React's F3, which had the import site and no module. And its `derived` drops the
store receiver in the same breath: `const itemCount = $derived(count);`, with `count` unbound. Same
two shapes, third frontend, no gate on either. **Unowned — no wave packet claims it**; the natural
home is alongside M-T1.28's siblings once Wave 2's `renderToast` seam exists.

---

## P1 — a declared thing silently vanishes from the output

**F10. A page whose `body:` is a bare `match` is dropped entirely on React and Svelte.**
No file, no route, no diagnostic. `isWalkableLayoutBody`
(`src/generator/_walker/walker-core.ts:367`) admits only `call` and `ternary`, though the walker
has full `match` arms. **Vue emits the same page correctly** — so one `.ddd` renders differently
per frontend. Wrapping in `Stack { match { … } }` emits it. Found independently by three
auditors; `page-metamodel.md` §7/§12 documented `body: match` as the wizard pattern.

**F11. `DestroyForm { of: <record> }` degrades to a comment on every target with no
diagnostic.** `of:` is resolved through `ctx.aggregatesByName`
(`src/generator/_walker/primitives/forms.ts:137`), so a `QueryView` binding renders
`DestroyForm(of: p): aggregate not found`. The delete button silently disappears.

**F12. A method call in a `KeyValueRow` value slot silently degrades.**
`KeyValueRow { "Note", note.toUpper() }` emits `{/* unsupported expr: method-call */}` — the
value vanishes — while `Text { note.toUpper() }` emits `note.toUpperCase()`. `emitKeyValueRow`
(`src/generator/_walker/primitives/text.ts:299-338`) routes the value through element-position
`walk`, which has no method-call arm.

**F13. `handle` and named `create` are lowered but no backend emits an entry point.**
`src/ir/lower/lower-workflow.ts:124-174` fills `WorkflowIR.handlers`/`.creates`,
`test/ir/workflow-handle.test.ts` pins the lowering, and `loom.duplicate-handler`
(`messages.ts:310`) promises a `route -> Ctx.<handle>` is meaningful — but no emitter reads
`wf.handlers` for an entry point. A workflow with `handle retry(...)` plus
`api { route POST "/fulfil/retry" -> C.retry }` produces no route on node or dotnet, and no
routes file at all.

**F14. Elixir drops a part-level `check`.** `entity Line { qty: int check qty > 0 }` produces a
`changeset/2` that only `cast`s `[:sku, :qty]` — no `validate_number`. Root-level
`check`/`invariant` do emit one; node/dotnet/java/python all enforce the part-level form.

**F15. Elixir drops a guarded single-field invariant from the changeset entirely.**
`residualInvariants` (`src/generator/elixir/vanilla/changeset-invariant-emit.ts`) and the native
path in `changeset-emit.ts` both exclude it, so nothing enforces it. Silent under-enforcement.

**F16. Elixir drops a `derived` that reads another `derived` from the wire.**
`derivedRenderable` (`src/generator/elixir/vanilla/wire-serialize.ts`) omits it from
`serialize/1` while the other four backends ship it — a wire-shape divergence with no gate.

**F17. Flutter silently drops `extern` components.** Renders
`const SizedBox.shrink() /* unknown layout component: X */` with no validator, where the other
frontends have an extern hatch.

---

## P2 — undeclared cross-backend divergence

**F18. Java ignores `ignoring` for principal filters.** `jpqlWhere`
(`src/generator/java/emit/repository.ts:361-392`) ANDs `principalClause` unconditionally with no
`bypassAll`/`bypassCaps` check (`bypassAll` appears only at `:637`, the impl-side Hibernate
wrapper). Both `find allRows(): Order[] ignoring *` and `ignoring tenantScoped` still emit
`where (e.tenantId = :#{@currentUserAccessor.user()?.tenantId()})`. node/python/elixir drop the
conjunct; dotnet emits `IgnoreQueryFilters`. Contradicts the comment at
`src/generator/java/capability-filter.ts:26-29`, which claims parity with node. The
fail-direction is safe — Java over-restricts rather than leaking — but the same `.ddd` returns
a different row set on Java than on the other four backends, and an operator reading the docs
would conclude the bypass took effect.

**F19. Java renders a guarded invariant on the wire without its guard.** `buildChecks`
(`src/generator/java/emit/validator.ts:366-395`) calls `renderJavaExpr(inv.expr, …)` with no
`!(guard) ||` implication, which node/.NET/python all emit. `invariant note.length > 0 when
taxRate > 0` becomes an unconditional check, so Java 422-rejects a request that is legal when
`taxRate == 0`.

**F20. Elixir maps a value object to a `:map` column while every other backend splits it.**
`total: Money` produces `total_amount` + `total_currency` on node/dotnet/java/python and
`add :total, :map` on Ecto — contradicting the "one DDL for everyone" invariant.

**F21. `envelope` is five-way inconsistent.** The repository layer has `Envelope<T>` on dotnet
and java, node/dotnet/java/python routes return the bare response, and elixir's controller
returns a JSON array.

**F22. HEEx `Image` and `Icon` read only a named `src:` / a `svg:` literal.**
`renderImage` (`src/generator/elixir/heex-primitives.ts:1510`) and `renderIcon` (`:2151`)
ignore the positional spelling every other target renders: `Image { "/logo.png", alt: … }`
emits `<img alt>` with no `src`, and `Icon { name: "check" }` an empty span.

**F23. The HEEx `WorkflowForm` emits a placeholder instead of the workflow's params.**
A single `<.input field={@form[:_placeholder]}>` (`heex-primitives.ts:388`) where React emits
the real field set.

**F24. Elixir drops a private-operation call with only a comment.** `confirm` renders
`_ = nil  # vanilla: bare call to 'recompute' (no callable target); record unchanged` — compile-clean,
behaviourally absent, and the only signal is a comment in generated code.

---

## P3 — diagnostic catalog hygiene

The catalog gate (`test/system/diagnostic-catalog.test.ts`) fails on an inline literal, a
mis-keyed message and an orphan entry — but it evidently does not reach the IR check leaves,
which is how F25 and F26 survive.

| # | Finding | Anchor |
|---|---|---|
| **F25** ✅ | `loom.function-block-impure` is raised live with an inline message and has **no catalog entry**. Confirmed: FIVE inline template literals. Hidden from the gate by shorthand `message` syntax, not by the gate's reach — see analysis item 3. Fixed in W4.1 as five `#`-slug variants; the `where` lead was dropped too (it duplicated `source`, which the gate's own invariant refuses). | `src/ir/validate/checks/structural-checks.ts:1243`; referenced from `validators/structural.ts:327`, `types.ts:809` |
| **F26** ✅ | The `when`-gate-references-op-param check raises an inline message with **no `code` at all**. Fixed in W4.1 as `loom.when-references-op-param`. The row understates it: this is one instance of a 130-site class — see F55. | `src/language/validators/statements.ts:110-118` |
| **F27** | `loom.scaffold-filter-param-unsupported`'s text contradicts its own gate: it says the bar renders `string`, `int`, `long`, `<X> id` and that `bool`/`datetime`/`guid` "have no input at all". Since #2699 all three render. The gate reads the correct set; only the message lies — and its stale twin sits in a comment. | `messages.ts:2308-2315`; `ui-checks.ts:1097-1099` |
| **F28** | `loom.flutter-primitive-unsupported`'s text names FileUpload as "the one deferred primitive", but `FLUTTER_UNRENDERED_PRIMITIVES` is now **empty**, so the gate can never fire and the message names a primitive that renders. | `messages.ts:1624`; `src/util/flutter-deferred-primitives.ts` |
| **F29** | `loom.filter-bypass-unsupported` is unreachable — `FILTER_BYPASS_FAMILIES` holds all five families — and its text still names three backends as "the honoring backends". Dead gate or a missing family; the wording is wrong either way. | `system-checks.ts:2712`; `messages.ts:1832-1842` |
| **F30** ✅ | `loom.projection-event-unkeyed` interpolates `proj.correlationField`, which is `undefined` for the keyless case it fires on: *"…has no 'undefined' field to route by."* Confirmed verbatim. **Message-only, as recorded** — refusing a keyless fold is intentional and documented (`10-repositories-and-queries.md`: a keyless projection is the query-time aggregation, not a fold), so the fix is a `#singleton` variant that asks for `keyed by` rather than for a field nobody can name. | `projection-checks.ts` `validateHandlers` ~:90 |
| **F31** | `loom.scaffold-unexpanded`'s message blames "walker-primitive-expander", a pass that no longer exists, and names `view` as a resolvable target. | `messages.ts:783` |
| **F32** | Grammar and IR comments name `loom.workflow-function-block-body` as the gate for block-bodied workflow functions. The code does not exist, nothing raises it, and such helpers generate correctly on all five backends. | `ddd.langium:1456`; `loom-ir.ts:1311` |
| **F33** | A comment cites `loom.intrinsic-not-queryable`, which does not exist. | `src/util/intrinsics.ts:57` |
| **F34** | A comment says `loom.spurious-effect-marker` is raised by the validator. No such code exists; a stray `await` is a parse error instead. | `src/ir/lower/lower-expr.ts:1080` |
| **F35** | `extern_handlers_registered` is in the observability catalog but no backend emits it — an orphan entry. | `src/generator/_obs/log-events.ts` |

**F55 (found while fixing W4.1). 119 validator errors carry no `loom.*` code at all.**
The catalog's three invariants only see a site that attaches a code, so an
`accept("error", "<inline literal>", { node, property })` with no `code:` key is invisible to
all of them — that is F26's real shape, and F26 is not one site but a class. Counted on
`9f89a009d` across `src/language/validators/**` + `ddd-validator.ts`: **195** `accept` sites
carry a code, **119 errors and 11 warnings** do not. Those 130 diagnostics cannot be looked up
in the reference, linked from the playground's Problems pane, asserted on by a test, or
referred to in a bug report — the user sees prose and nothing else. The IR check leaves are
clean (every one of their diagnostic literals carries a code), so this is purely the Langium
`accept` surface. Too large for a ratcheting waiver inside W4.1; it wants its own mission,
which should decide per site whether the diagnostic deserves a code or the check deserves
deleting.

**F36. Two `system` blocks with no top-level members pass validation.**
`composition.ts:120-137` only fires when a top-level member must fold; there is no direct
"exactly one system" gate, and `generate system` writes only root artefacts.

---

## P4 — per-feature docs that contradict the code

Outside this audit's scope (it covered the language surface docs only), found in passing and
each verified:

| # | Doc | Drift |
|---|---|---|
| **F37** | `docs/capabilities.md` | Lists four built-ins (no `tenantRegistry`), presents `versioned` as opt-in when the expander applies it by default, and names the **removed** per-backend codes `loom.node-stamp-unsupported` / `-python-` / `-elixir-`. |
| **F38** | `docs/inheritance.md` | Claims Java and .NET emit a polymorphic base reader (neither does) and that the base emits no Ecto schema (under TPH it does); uses the legacy `phoenix` platform literal; omits five shipped codes. |
| **F39** | `docs/auth.md` | The dev-stub note says only Hono carries an array claim and that a permission gate "fails closed on four of five backends" — #2717 fixed the emitters and the prose was never corrected. Its `curl` example sends raw JSON where every stub base64-decodes. Its named-policy example puts `permissions { … }` in a `context`; the block is a `Subdomain` member (proven parse error). |
| **F40** | `docs/tenancy.md` | Writes `crossTenant aggregate Plan` (prefix); the grammar puts `crossTenant` in the header region after the name — proven parse error. |
| **F41** | `docs/actions.md` | Says `loom.missing-effect-marker` is "a warning during the Stage-2 ramp"; the check raises `severity: "error"` (`ui-checks.ts:2320`). |
| **F42** | `docs/observability.md:20` | States the emitted JSON `level` is `"warn"` on every backend; the generated Elixir `LogFormatter` stringifies `:warning` (`elixir/shell/runtime.ts:136`). |
| **F43** | `docs/resources.md` | Names `loom.resource-unknown-verb`; the catalog ships `loom.resource-verb-invalid`. |
| **F44** | `docs/macro-api.md` | Lists the stdlib path as `stdlib/<name>/*.macro.ts` (most are flat or under `scaffold/`); missing the `api` target and `apiVersion`. |
| **F45** | `docs/scaffold-macros.md` | No `scaffoldHandlers` / `scaffoldApi` / `scaffoldPaged` / `scaffoldPagedApi` sections, though chapter 22 now cross-links it as authoritative. |
| **F46** | `CLAUDE.md` | Says "~55 primitives"; `WALKER_LAYOUT_PRIMITIVES` holds 56. |
| **F47** | `docs/build.mjs` | Uses `marked` with no heading-id slugger, so `<h2>`s render without `id`s and **every** `](#…)` in every chapter is dead on the Pages build. They work on GitHub's renderer, which is why nobody noticed. |

---

## Cross-cutting reading

Three patterns account for most of the P0/P1 list, and each suggests a gate rather than 17
individual fixes:

1. **The walker's dispatch predicates fail open.** `isWalkableLayoutBody` (F10),
   `emitKeyValueRow`'s element-position `walk` (F12), `DestroyForm`'s aggregate lookup (F11),
   Flutter's extern hatch (F17) — each returns a comment or `false` on a shape it does not
   recognise, and nothing downstream notices a page or element never got emitted. A
   "the walker declined to render this" signal, raised once, would convert all four into
   honest diagnostics.

2. **Lowering has arms the validators assume exist.** `variant-match` off a page (F1),
   `for`/`if let` off a workflow (F4), the optional-receiver unwrap (F2), the store receiver in
   a `derived` (F9). The IR admits a node the emitters cannot consume, and the layering means
   nobody owns the check. *Wave 1 drained F2 and F9 and found the pattern is broader than
   "a missing arm": F2 was a **type stamped one wrapper too wide**, so the arm existed and was
   never reached, and it silently took the result type and the collection-op disambiguation with
   it. F5 turned out to be a fourth variant again — **a lowerer that discards diagnostics the
   pipeline already produced**. The unifying defect is that a lowering pass trusts a shape
   (an AST type, a `receiverType`) instead of checking it, and has no way to say so.*

   A concrete, cheap generalisation came out of F8: **make the walk exhaustive with a `never`
   check.** Doing that to one Elixir predicate walker turned the next missing arm into a
   typecheck error and immediately surfaced a fourth (F49 is the same rule's un-updated second
   copy). Every hand-rolled `ExprIR`/`StmtIR` walk outside the shared `_expr`/`_stmt` dispatchers
   is a candidate.

3. **The catalog gate has two blind spots — neither of them the IR leaves.** F25 and F26 are
   exactly the defect class `test/system/diagnostic-catalog.test.ts` was written to prevent.
   This item originally blamed the gate's *reach*, which is wrong: it has walked
   `src/ir/validate/checks/` all along. **Corrected on `main` @ `9f89a009d`** — the two
   survivals have two different causes, both of them in the scanner:

   * **Shorthand property syntax.** `sitesIn` collected only `ts.isPropertyAssignment`, so
     `diags.push({ severity: "error", code: "…", message, source })` — `message` shorthand —
     was never recorded as a site at all, and all three invariants passed vacuously over it
     (F25). Exactly two sites in the whole scanned surface were hidden this way.
   * **A blanket forwarding exemption.** `isForwardedParam` skipped any site whose message is
     a parameter of the enclosing function, on the assumption that its call sites are
     themselves scanned. That holds for `loweringDiag` in `src/api/evolve.ts`; it does not
     hold for a *local* helper, whose callers word the message inline. The predicate fired on
     **zero** sites, so it had never been exercised. It now retargets to the helper's own
     in-file call sites instead of exempting.

   Both were fixed in W4.1, and the extended gate fails on unmodified `main` naming all five
   `loom.function-block-impure` sites by line.

Per `CLAUDE.md`: mutation-prove each gate before trusting it — revert the fix with a file copy,
never `git checkout -- <path>`, and confirm the assertion that fails is the one under test.

---

## Wave 1 postscript (2026-09-06) — what draining seven findings taught

- **⚠ verify-first earned its label.** Five of seven findings differed from what is written above:
  F5's diagnosis was wrong outright, F8's anchor pointed at the call site rather than the defect,
  F9 was misattributed on Flutter, F3 was too broad on React, F7 was larger than recorded. Every
  packet re-verified on fresh `main` before writing code, and every one of those corrections came
  out of that step. A finding written from a symptom is a lead; the anchor in the row is where the
  auditor stopped looking, not necessarily where the bug lives.
- **The compile gate finds what the assertion cannot.** F48 and F49 were found by *running the
  target toolchain over generated output* (`mix compile --warnings-as-errors`, `mypy --strict`) —
  neither would have been caught by any string assertion, because both are shapes that render
  plausibly and fail one layer out. F7's whole existence traces to the absence of one fixture: **no
  python-build fixture reached the typed in-system api client at all.**
- **Follow-ups Wave 1 opened, none of them yet owned:** the `renderToast` seam on `WalkerTarget`
  (F3's proper fix, Wave 2's tree); consolidating `loom.locator-matcher-receiver` into
  `validateE2ETest` (F6, W3.1/W4.1's tree); **F50** (Svelte's F3+F9 twins, unclaimed by any packet).
- **Process:** the four packets ran in one container against one working tree and committed onto
  each other's branches until they rescued themselves into separate worktrees. Wave packets that
  run in one container need **a worktree per packet, not just a branch per packet** — and, on this
  box, no more than two concurrent packets, because five parallel vitest runs OOM the cgroup and
  turn every timing assertion into a coin flip (Wave 1 lost roughly an hour to reading contention
  timeouts as real failures).
