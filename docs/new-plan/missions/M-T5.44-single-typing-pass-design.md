# M-T5.44 — One typing pass (design)

> **Status: DESIGN — slice 1 of 4.** Claim PR [#3148](https://github.com/Loom-Harness/Loc/pull/3148).
> Measuring instruments: [#3125](https://github.com/Loom-Harness/Loc/pull/3125) (the let-binding
> census) and this mission's shadow-mode differential (slice 2). Coordinates with
> [#3133](https://github.com/Loom-Harness/Loc/pull/3133) (fail-closed: `unknown` at codegen is an
> error), which owns the refusal policy; this mission owns producing one honest type per node.

## Problem

The front end types every expression **two to three times**, by hand-kept copies:

| # | checker | where | result type | consumers |
|---|---|---|---|---|
| A | `typeOf` + `envForNode` | `src/language/type-system.ts` (~2.4k LOC) | `DddType` (AST-anchored) | AST validators (phase ④), LSP hover / completion / definition |
| B | `inferExprType` + `memberType` + `binaryResultType` + B's own `stepInto` | `src/ir/lower/lower-expr.ts` | `TypeIR` (name-keyed) | `let` local types, receiver typing, literal promotion, string-convert wrapping, repo-let types |
| B′ | the types `lowerExpr` / `applySuffixToRecv` / `resolveNameRef` thread while lowering | same file | `TypeIR` stamped on `ref.type`, `member.receiverType/memberType`, `binary.leftType/resultType`, … | every backend |

B and B′ already disagree **with each other**: `inferExprType` is a second inference pass that the lowering
arm's threaded `recvType` does not feed. Examples: `1 + price` infers `int` but lowers `money`, and
`Agg.create(…)` infers `entity` but its method-call result lowers `string`. A, B and B′ also each build
their own environment: `envForNode`, the inline env `validators/statements.ts` threads, and the lowering
`Env` with `withLocal`.

September's defects in this class: #3078 (IR and language member sets diverged), #2788 (optional-receiver
unwrap disagreement), #2907 (`this.x` lowers differently from bare `x`), #3039 (fix landed at the wrong
layer), #3040 / #3064 / #2884 (a missing env arm makes a type `unknown`, and `unknown` silently suppresses
every gate), plus #2943, #2968 and #2920. ~79 comments in `src/ir/lower/` call the code a "mirror". One,
`repo-read.ts:425`, says it mirrors `repositoryMethodType` but doesn't (`findById` is optional on one side
and bare on the other). Another, `type-system.ts:702`, says `??` "mirrors `inferExprType`", but A joins
with the fallback and B ignores it.

### Measured (prototype differential, `main` @ `bce7f409`)

Every expression `lowerExpr` lowers across the tracked fleet (`git ls-files '*.ddd'` minus the one
unparseable design doc): **195 429** (AST node, lowering env) observations. For each one, A
(`typeOf(e, envForNode(e))`) is compared with B (`inferExprType(e, env)`) in #3125's key space.

| class | count | share |
|---|---|---|
| agree | 76 969 | 39.4 % |
| A `unknown`, B `string` fallback: **nobody knows** | 112 883 | 57.8 % |
| A `unknown`, B typed: **the gate is off** | 5 327 | 2.7 % |
| B `string` fallback, A typed (113 are `null`) | 171 | 0.1 % |
| both concrete, different | 79 | — |

The 57.8 % is the headline. On most expressions neither checker knows the type, and both fail open:
A by suppressing, B by inventing `string`. (A's share is an upper bound, because validators that thread an
inline env see a little more than `envForNode` does. The 60.9 % `unknown` that `unknown-cascade-census`
measured over `examples/` is the same finding.) Slice 2 replaces this prototype with the real pass and
three-way numbers.

### The divergence catalogue (construct by construct)

These are the structural causes. Each row is a rule the new pass must decide **once**.

| topic | A | B / B′ |
|---|---|---|
| fallback | `unknown` (suppresses downstream) | `primitive string` (passes downstream) |
| kinds | `aggregate` / `entity` / `payload` / `userclaim` distinct; **no `union` / `none` / `genericInstance`**: `A or B` resolves to `A`, `T option` to `T`, `T paged` to `T` | everything record-shaped is `entity{name}` (aggregate, part, event, payload, workflow, projection, `__User__`, `__ResourceHandle`); has unions and generics |
| `extends` members | own members only | walks `memberOwnerChain` |
| sensitivity | propagated (members, arithmetic, ternary, narrowing) | `TypeIR.sensitivity` exists, but **no expression path sets it** |
| `null` | `optional(never)` | `string` |
| ternary | `ternaryJoin(then, else)` + tag union | then-branch only |
| `??` | `join(head minus optional, fallback)` | head minus optional (fallback ignored) |
| ternary null-narrowing | yes (simple paths, impure-call guard) | none. Intrinsic calls unwrap one `?` unguarded |
| ill-typed arithmetic / money mix | `unknown` | left operand type |
| list / object / match / await | `unknown` (no arm) | first element / `string` / first arm / inner |
| `this` / `id` in workflow and projection | `unknown` | entity / `id(guid)` |
| enum values, `permissions.x`, resource handles, stores, api ops, top-level / stdlib fns | mixed. Mostly `unknown` in A; top-level fns typed in A but **`string` in B** | the reverse |
| `sum` over `int` | `int` | `decimal` (emission-load-bearing; see "Semantic type vs representation") |
| `findById` | bare aggregate | `T?` |
| `xs.count` as a member (no parens) | `int` | B′ `memberType` = `string` (B′'s `stepInto` has no array arm) |
| scalar intrinsic without parens (`s.trim`) | `unknown` | typed |
| `this.fn()` / `this.op()` | `unknown` | B `string`, B′ the return type |
| lambda clashing with an outer name | **not rebound** (`envForNode` skips it) | shadows correctly |
| binders | no workflow / projection state, if-let / for / match bindings, handler params (#3130), unit-`test` lets (#3092), e2e lets | `locals` cover these, but `test e2e` lowers with an empty scope (`string` defaults) |

### The environment builders (five, not one)

| builder | where | what it misses |
|---|---|---|
| `envForNode` (+ `addTypedLets`) | `type-system.ts:1910` | rebuilds per query; top-level lets only (never inside `if` / `for` / `match`); no aggregate `create` / `destroy` params, command / query handler, test, `ProjectionOn`, store / action / page state / page `derived`, criterion alias, variant-arm / if-let / for bindings, block-form lambda lets, non-collection-op row lambdas |
| `envForAggregate` / `envForPart` / `envForValueObject` | `validators/_shared.ts:55-101` | VO members carry **no sensitivity tags** (`envForNode` attaches them) |
| `checkStatement` threading | `validators/statements.ts:237` | `if` / `for` / `match` / `if let` fall through `return env`: nested bodies are never walked |
| `checkFunctionBlock` / `checkIfStmt` | `validators/types.ts:1199` | the only language walker that scopes nested blocks |
| lowering `Env` + `withLocal` | `lower-types.ts:68`, ~60 construction sites across `lower*.ts` | complete binders, but `test e2e` lowers with an empty scope; carries non-typing state (`criterionArgs`, `refAliases`, `rowElem`, `serviceRepos`, …) in the same object |

Type consumers: ~60 language sites (validators + 7 LSP providers). About 30 of them suppress their
diagnostic on `unknown`; the per-file count is pinned by `unknown-cascade-census`. ~25 lowering sites read
`inferExprType` / `memberType` / `pathType` / `thisTypeOf`.

## Goal

**One typing pass.** Each expression and statement is typed exactly once, by an elaboration over the AST with
one environment model. The AST validators and the LSP read its results, and lowering **copies** them into
`TypeIR` instead of re-inferring. `unknown` is an explicit state carrying a cause, never a silent pass.

## Design

### D1. Where it lives: `src/language/typing/`

The pass reads linked AST (`isX` guards from `src/language/generated/ast.js`, Langium cross-refs), so it is
a **language-layer** module. `src/ir/lower/` already value-imports `src/language/` (`money-literal.ts`,
`macro-origin.ts`). That is a forward edge, so `pipeline-layering.test.ts` allows lowering to import the pass
with no pin. The pass names `TypeIR` only through `import type` (exempt, exactly as `type-system.ts` already
does with `PrimitiveName`).

The pass needs three **ir-layer value modules** whose data is pure. Each moves to `src/util/` in the slice
that first needs it, never imported upward:
- `src/ir/resource-verbs.ts` (verb result types)
- `src/ir/stdlib/unions.ts` (`variantTag`)
- `src/ir/stdlib/generics.ts` (ctor registry)

Layout:

```
src/language/typing/
  ty.ts          — the type representation (D2) + constructors + toTypeIR (D3)
  decl-index.ts  — one by-name declaration index over the compilation unit (D5)
  binders.ts     — the declarative binder table: container → what it binds (D4)
  elaborate.ts   — the walk: synth / check over each body root, fills the cache
  rules/         — one file per construct family (literals, names, members, calls, collections, statements)
  index.ts       — typeAt(node), scopeAt(node), expectedAt(node), unknownCauseAt(node)
```

### D2. One type representation: `Ty` (AST-anchored superset)

`Ty` keeps A's AST anchoring, because the LSP, `stepIntoNode`, go-to-definition and sensitivity all need the
declaration and not its name. It adds everything only B can express:

```ts
type Ty =
  | { kind: "primitive"; name: PrimitiveName }
  | { kind: "id"; target: Aggregate | EntityPart | Workflow | Projection }
  | { kind: "enum"; ref: EnumDecl }
  | { kind: "valueobject"; ref: ValueObject }
  | { kind: "record"; shape: RecordShape }   // ⟵ aggregate / part / event / payload / workflow / projection / principal / resource-handle / store
  | { kind: "array"; element: Ty }
  | { kind: "optional"; inner: Ty }
  | { kind: "union"; variants: Ty[] }        // ⟵ new to the language side (`A or B`, `T option`, exception-less ops, union finds)
  | { kind: "none" }
  | { kind: "generic"; ctor: GenericCtorName; arg: Ty }
  | { kind: "slot" } | { kind: "action"; arg?: Ty }
  | { kind: "any" } | { kind: "never" }
  | { kind: "unknown"; cause: UnknownCause; at?: AstNode };
// every arm also carries `sensitivity?: SensitivityTags`

type RecordShape =
  | { of: "aggregate"; ref: Aggregate } | { of: "part"; ref: EntityPart }
  | { of: "event"; ref: EventDecl } | { of: "payload"; ref: PayloadDecl }
  | { of: "workflow"; ref: Workflow } | { of: "projection"; ref: Projection }
  | { of: "principal"; ref: UserBlock | undefined } | { of: "resource"; ref: ResourceDecl }
  | { of: "store"; ref: StoreDecl };
```

- **`record` unifies A's four kinds and B's name-probed `entity`.** Member lookup dispatches on
  `shape.of`, so the collision B has today (an event and an aggregate sharing a name, resolved by probe
  order) cannot happen. Member lookup walks `extends` (B's rule; A's own-members-only rule is the bug).
- **`unknown` carries a cause:** `unresolved-name`, `unbound-in-container`, `no-rule`,
  `contextual-lambda`, `ill-typed-operands`, `cycle` or `parse-broken`. `unknown` is never a fallback
  value standing in for a type. Every `unknown` has a cause, and a census counts them by cause.
  **#3133 decides which causes are refusals at codegen.** This pass makes that policy possible to state,
  and doesn't duplicate it.
- **`DddType` survives the migration as an adapter, not a parallel checker.** `toDddType(Ty)` gives
  not-yet-migrated validators the exact view they see today: `union` collapses to its head variant (what
  `resolveTypeRef` does now), `record` splits back into `aggregate` / `entity` / `payload` / `userclaim`,
  and workflow, projection and resource records become `unknown`. So moving a validator onto the shared
  cache is a no-op for its diagnostics until its family's cutover deliberately widens it.

### D3. Lowering copies: `toTypeIR(Ty): TypeIR` (total, lossless onto `TypeIR`)

`Ty` carries strictly more than `TypeIR`, so the projection is a function with no lookups:

- `record` becomes `entity{name}`, the principal `entity{"__User__"}`, a resource `entity{"__ResourceHandle"}`.
- `id` becomes `id{targetName, valueType}`, with `valueType` read off the target's `ids` clause (lower-types' rule).
- `union` / `none` / `generic` map 1:1.
- `unknown` becomes `primitive string` **during cutover only**. That keeps bytes identical, and it is
  counted: the ratchet (D9) pins the count shrink-only, and #3133's gate turns causes into refusals.

Lowering never computes a type. Each site that needs one reads `toTypeIR(typeAt(astNode))`. The sites are
`ref.type`, `member.receiverType` / `memberType`, `method-call.receiverType`, `binary.leftType` /
`resultType`, `let.type`, `convert.from`, match `subjectType`, `repo-let.returnType` and lambda param types.

### D4. One environment model: scopes built by the elaboration walk, from a declarative binder table

Today's env builders reconstruct scope **per query** from the node upward (`envForNode`, O(depth) per node,
re-typing every let each time). They enumerate containers by hand, so the arm someone forgot fails open
(#3040 / #3064 / #2884, and #3130 / #3092 adding arms now). The replacement:

- **The elaboration walks each *body root* once, top-down**, threading a persistent scope chain
  (`Scope = { parent, bindings: Map<string, Binding> }`) through statements in order. Lets, if-let,
  `for`, match-arm bindings and lambda params bind as encountered and shadow correctly. That fixes A's
  lambda-clash bug. Body roots: operation, create, destroy, apply, function, domain-service op, find,
  workflow create / handle / on, command / query handler, projection `on`, invariant, derived, criterion,
  retrieval, policy fn, page / component / action / store / ui function, unit `test`, `test e2e`, and
  field defaults.
- **What a container binds is data**: `BINDERS: Record<BodyRootType, (root) => Binding[]>`, holding
  `this`, `id`, members (incl. inherited), params, event param, candidate alias (`of T as o`), workflow or
  projection state fields, page params and store fields. Adding a container is a table row.
- **Completeness is test-enforced, from the grammar.** A reflection-driven census (the
  `print-completeness` pattern) asserts that every grammar rule that can transitively contain an
  `Expression` sits under a `BINDERS` row. A new container with no row fails CI. This is the gate that
  makes the missing-env-arm class extinct rather than drained.
- `scopeAt(node)` is the scope at that point, read from the cache, never rebuilt. `envForNode` becomes a
  thin adapter over it during migration (so its LSP callers keep working), then is deleted.
- **Lowering-only rewrites are not typing environment.** `criterionArgs` (criterion inlining),
  `refAliases` (absence-match aliasing) and `rowElem` substitute already-lowered IR. They stay in the
  lowering `Env`, but the *types* they carry come from `typeAt` of the argument or subject node, not from
  re-inference.

### D5. Name resolution: one declaration index over the compilation unit

A resolves by-name lookups (aggregate, VO, criterion, policy fn, domain service, repository, top-level fn)
against the enclosing context only. B adds module-global indexes installed by `lowerProject`
(`ambientDeclIndex`, `setAmbientEnumIndex`, `setTopLevelFnIndex`). These are module-global state, and they
make the two sides answer differently for a cross-file shared-kernel VO or a root enum.

`DeclIndex` is **derived from the set of documents in the compilation unit**, and nothing installs it:
- For the CLI and lowering: the documents `lowerProject` receives (the import closure).
- For the validators and LSP: the same closure, computed from the Langium workspace
  (`LangiumDocuments` + the import graph `ddd-scope.ts` already walks).

Resolution order is fixed and written once: locals, then container members, then context, then root of
the same document, then the cross-document ambient kernel, then the stdlib prelude. Macro-built `TypeRef`s
whose cross-reference did not link resolve by `$refText` through the same index. The prototype found that
the language side types these as `unknown` (e.g. `crudish` update params: `unknown?` vs `id:Location?`),
so every gate on a macro-synthesised parameter is off today.

### D6. Bidirectional elaboration: `synth` and `check(expected)`

Several of lowering's "re-inferences" are really **expected-type** decisions made at the parent:
- literal promotion: `lowerExprInContext`, `promoteMoneyOperands` (`1 + price` is money)
- enum-value retargeting: `retargetEnumValue` / `retargetCallArgs`
- lambda param typing: from the collection receiver, an `action(arg)`, or a slot
- empty-list element type, and `null` against a target

The pass has two modes. `synth(e)` returns e's own type. `check(e, expected)` is used where the parent
dictates (assignment target, typed param / arg, binary operand partner, derived prop, field default, lambda
in a collection op). The cache keeps both per node: `typeAt(e)` (elaborated, post-coercion) and
`expectedAt(e)`. Then `1 + price` has `typeAt(1) = money`, and lowering's promotion becomes "emit the literal
at `typeAt`". The money-promotion mirror of the validator (`lower-expr.ts:261`) goes away.

### D7. Semantic type vs. emission representation

Some of B's "types" are emission choices, not types. Examples:
- `sum` over `int` gives `decimal`, because every backend renders the numeric fold that way.
- `null` in a `??` condition pins `rightType: string`.
- `string(agg)` becomes `.display`.
- holes in a string concat get wrapped in `convert`.

Merging these into the type system is how the copies drifted. The rule: **the pass computes the semantic
type, and lowering applies named representation rules on top**. Each one is a small, documented function
in `src/ir/lower/repr.ts` (e.g. `foldResultRepr(semanticTy)`), keyed off `typeAt`. Representation rules may
change bytes **only** in a PR that says so. Where a rule turns out to be a semantic bug (not a choice), the
fix lands in the pass and its diff is stated.

### D8. Cache: derived, not stamped (CLAUDE.md "derive, don't stamp")

The results are a **memo of a pure function** of (linked AST, `DeclIndex`). Nothing is written onto AST or
IR nodes as a denormalized field.

- `WeakMap<AstNode, NodeTypes>` per typing session. Elaboration is lazy per body root: the first
  `typeAt(n)` elaborates n's whole body root and fills every node in it. Total work is O(nodes), versus
  `envForNode`'s O(nodes × depth × lets).
- **Invalidation story:**
  - Langium builds fresh AST nodes on every reparse, so stale keys die with their nodes.
  - The session also keys on the `DeclIndex` identity. A `DocumentBuilder.onBuildPhase(Linked)` listener
    drops the session when any document in the closure changes, because a sibling file's edit can change
    a by-name lookup.
  - The CLI/lowering session is created by `lowerProject` over the same closure and discarded with it.
- The IR's `TypeIR` fields (`receiverType`, …) are *not* a new stamp. They are the existing IR contract
  ("backends never re-resolve"), and the input the backends cannot re-derive. Only their source changes.

### D9. Macro-expanded AST and multi-file

- **Macros.** Expansion (phase ②) runs before linking, and emits ordinary final AST ("macros emit final
  AST, not sentinels"). Expanded nodes elaborate exactly like authored ones. Nodes with no `$cstNode` key
  by identity, and their diagnostics anchor via `macro-origin.ts` as today. The one macro-specific
  obligation is D5's `$refText` fallback for unlinked synthesized type refs.
- **Multi-file.** Typing is per compilation unit, never per file. The validators type a document inside
  its closure's `DeclIndex`, so a validator and lowering see the same declarations. #3125's
  `fragment-not-lowered` rows (a multi-file fragment parsed alone) disappear once the differential parses
  projects as units.

### D10. LSP and completion consumers

`membersOfType`, `stepIntoNode`, `calleeSignature`, hover, definition, semantic tokens, completion and
`member-refs` all take `DddType` with AST refs today. They move to `Ty` by the same adapter, so they keep
working at every step:
- hover, completion and definition call `typeAt(node)` / `scopeAt(node)` instead of
  `typeOf(e, envForNode(e))`;
- `membersOfType(Ty)` gains the record shapes A could not express (workflow / projection state, store
  fields), which is a completion improvement;
- `stepIntoNode` walks `extends` like member lookup does.

LSP behaviour only widens, and `test/language/lsp/*` must stay green unchanged except for deliberate
additions.

### D11. Ratchet: a second inference path cannot reappear (slice 4)

`test/system/single-typing-pass-census.test.ts` adds three checks:
1. Over `src/ir/lower/**` and `src/language/validators/**`, no function takes an `Expression` /
   `PostfixSuffix` / `TypeRef` and returns `TypeIR` / `DddType` / `Ty`, except in `src/language/typing/**`
   and the named `repr.ts` rules. It uses the TypeScript-AST scan pattern of `ir-walk-census`, with
   `standing` / `deferred` waivers that expire.
2. The names `inferExprType`, `inferSuffixType`, `binaryResultType`, `memberType` and `envForNode` do not
   exist.
3. The `unknown`-by-cause counts over the fleet are shrink-only.

## Plan

| slice | PR | content | gate |
|---|---|---|---|
| 1 | this (#3148) | this note + mission row | docs |
| 2 | shadow mode | `src/language/typing/` complete for every family. A `lowerExpr` observer hook (additive, behaviour-free). `test/system/typing-differential.test.ts`: for every expression in the fleet (corpus, e2e fixtures, examples, `web/src/examples`, journey, eval repros, **plus inline `.ddd` in test files** via `inline-ddd-source-census`'s extractor), compare the new pass with A **and** with B. Classify each disagreement as `new-pass-bug` (fixed in the PR), `A-defect` / `B-defect` (filed or fixed), or `deliberate` (D7 representation). Pin the counts shrink-only. | neither old checker changes; numbers reported |
| 3a | cutover | **literals and operators**: literals, unary, binary (incl. money / temporal / concat), `??`, ternary, template, conversion, `null` | corpus byte-identical (the M-T5.21 snapshot: 395 cells / 5 backends + frontend snapshot over `examples/` + `web/src/examples/`), fleet diagnostic snapshot identical except stated fixes, differential shrinks |
| 3b | cutover | **names and member access**: NameRef, `this`, `id`, records (incl. `extends`), optional receivers / `?.`, principal, `permissions.x`, enum values | same |
| 3c | cutover | **calls and builders**: free calls (fn / op / top-level / stdlib / VO ctor / duration), `BuilderCall`, `Agg.create`, domain service, repository reads, resource verbs, api ops, stores | same |
| 3d | cutover | **lambdas, collection ops, intrinsics** | same |
| 3e | cutover | **statements and lets**: let, if-let, for, match bindings, assignment path types. `addTypedLets` and the inline `statements.ts` env go away | same |
| 3f | cutover | **workflow / handler / projection / test bodies**: repo-let, factory-let, `test e2e` scope | same |
| 4 | cleanup | delete `typeOf` / `envForNode` / `inferExprType` / mirrors / `toDddType`; land D11 | ratchet mutation-proven |

**Each cutover PR:**
1. switches validator **and** lowering consumers of that family to `typeAt` / `toTypeIR(typeAt)`;
2. deletes the old arms in both checkers;
3. lands its family's fixes from the differential as stated, deliberate diffs (diagnostic or byte),
   never silently.

The claim PR's body names the family mid-migration, so other agents add new type rules in the right place:
in `src/language/typing/rules/<family>.ts` once that family has cut over, and in both old places (as
today) before.

**In-flight PRs touching these files** are ported into the pass as they land, after a sync before every
slice: #3130 (handler params / lets), #3092 (unit-test arm), #3093, #3131 / #3103 (`isSystem`), #2949, #3114
and #3096. Rule-carrying arms such as #3130's become `BINDERS` rows.

## Decisions taken (defaults, overridable)

Where A and B disagree semantically, this is the pass's rule, **validator-visible**. Bytes change only
where a cutover PR states it:

| rule | decision | why |
|---|---|---|
| ternary / `??` | join (A) | then-branch-only typing is unsound (`c ? 1 : 2L`) |
| `null` | `optional(never)` (A) | `string` is B's fallback, not a type |
| `extends` members | inherited (B) | A's own-only lookup is a false `unknown` |
| unions / option / generics | kept (B) | A's collapse to the head variant hides `NotFound` |
| `findById` | `T?` (B, `repo-read.ts`) | it is a nullable read on every backend |
| `sum` over `int` | semantic `int`, representation `decimal` (D7) | keeps bytes, makes the choice explicit |
| ternary null-narrowing | kept (A), validator-visible. Lowering reads the **un-narrowed** type for `receiverType` until 3b measures the emission effect | narrowing is a typing fact; whether a backend may drop a null check is a representation decision |
| ill-typed operands | `unknown{ill-typed-operands}` (A) | B's "left operand" is a guess |

None of these is a user-owned fork: each picks the side that is not a fallback. Any that turns out to
change emitted bytes is stated in its cutover PR.
