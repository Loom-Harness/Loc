# Wave C3F · packet F4 — cross-backend wire value contracts (re-run)

Branch `claude/c3f-f4`, base `main` @ `4233416e6` (#3110). Never pushed. Plan row: [`../wave-c3f.md`](../wave-c3f.md) §Packets, "F4". Inputs: the D-table of [`wave-c3-3d-promote.md`](wave-c3-3d-promote.md), [`../../T6-backend-parity.md`](../../T6-backend-parity.md) M-T6.86–88. The first run of this packet was lost with its container; everything below was redone and re-measured on this base.

**Verdict.** Every item is fixed on every backend it names, with a gate that fails without it and a booted behavioural proof. Three new contracts are written down (RS-39 numeric ingress, RS-40 the message-less rule sentence, RS-41 string intrinsic units), one ruling minted (`D-MESSAGELESS-DEFAULT`, `proposed`), M-T6.86 / M-T6.87 (rule half) / M-T6.88 closed, and four missions minted for what the work found and did not own (M-T6.89–92).

## 1. Item → outcome

| item | outcome | fix (where) | gate | mutation → failing assertion |
|---|---|---|---|---|
| **D10** `substring` units | **fixed**, all five | one snippet per language in `src/generator/_expr/code-point.ts` beside the `.length` ones (`[...s].slice(…).join("")`, `string.Concat(s.EnumerateRunes().Skip().Take())`, `s.codePoints().skip().limit().collect(…)`, `List.to_string(Enum.slice(String.to_charlist(s), …))`); python's slicing already is. `js-intrinsics.ts` is shared with the JS frontends, which follow | value table rows `string_substring_astral` (expected now `"😀b"`), new `string_substring_astral_from`; `corpus/intrinsics` derived `middle` | revert node/java/.NET renderers → 6 rows fail (`string_substring_astral` + `_from` × node, java, dotnet) |
| **D11** .NET `ß` | **fixed** | `ToUpperInvariant().Replace("ß", "SS", StringComparison.Ordinal)` (`dotnet/render-expr.ts`); catalogue contract in `src/util/intrinsics.ts` now says full mapping for `ß`, platform mapping for ligatures / polytonic Greek | value row `string_upper_eszett` (named divergence deleted); `corpus/intrinsics` derived `shout` | revert → `string_upper_eszett` fails on dotnet |
| **D13** python message-less invariant | **fixed** | `python/emit/wire-constraints.ts`: every model-level rule raises a `PydanticCustomError` (type `invariant` when message-less, so no code) through `ValidationError.from_exception_data` with the `pickErrorPath` loc — no "Value error, " prefix, pointer `/name` | `test/conformance/message-less-rule-message.test.ts`; `corpus/intrinsics` blank-name probe restored | revert → "python: a message-less model-level invariant raises a typed error at its field" (`not to contain 'raise ValueError("Invariant violated'`) |
| **D22** .NET/Dapper `"12,50"` | **fixed** | `WireFormatException.IsMoneyGrammar` (a hand loop of node's `^-?[0-9]+(\.[0-9]+)?$`, `dotnet/emit/common.ts`) gates the parse, whose style is now `AllowLeadingSign \| AllowDecimalPoint` (`dotnet/dto-mapping.ts`) | `dotnet/wire-numeric-ingress.test.ts` now pins the STYLE and the gate on every `decimal.TryParse` (≥ 5 sites), not just TryParse's presence; `numeric-ingress-parity` dotnet seam; `corpus/wire-ingress` `reprice("12,50")` | revert `dto-mapping.ts` → 2 fail: "create action guards…" and "the money parse admits node's grammar only" (`expected 'NumberStyles.Number' not to match …`) |
| **D23** int32 range | **fixed**, one contract: 422 + `errors[]` at the field, message `Integer out of range` (`INTEGER_RANGE_MESSAGE`, `src/util/numeric-range.ts`) | node: int32 `.min/.max` carry it (`hono/v4/routes-builder.ts`); python: `Int32` / `Int32Param` raise it from `_int32` (`http-models.ts`); java: `HttpMessageNotReadableException` arm finds Jackson's `InputCoercionException`, reads the field path off the exception (`java/emit/api.ts`); .NET: `Int32RangeJsonConverter` (new, `dotnet/emit/integer-range.ts`) names an integer LITERAL that does not fit, `ValidationProblem` answers it at the field before the malformed-body 400; elixir: op-param guard sends it bare | `numeric-ingress-parity` probe 6 (one test per backend); `int32-wire-bound.test.ts`; `corpus/wire-ingress` `restock(±3000000000)` | revert each backend's emitter → exactly that backend's probe-6 test fails (5/5) |
| **M-T6.86** message-less rule on .NET/Java/Elixir | **fixed, closed** | .NET `.WithMessage(singleFieldMessage)` on each FluentValidation arm (`dotnet/validator-emit.ts`); java passes it to `patternCheck` (`java/emit/validator.ts`); elixir lifts every wire-translatable precondition, messaged or not, to `{:validation_failed, …}` with no code (`elixir/vanilla/denial.ts`) + a code-less `render_wire_error/1` clause (`problem-details-emit.ts`) | four `M-T6.86` waivers deleted from `test/_helpers/wire-waivers.ts` (registry empty); `message-less-rule-message.test.ts` derives node's sentence set from node's emitted routes | revert the four emitters → .NET / java / elixir / python tests fail (4/4, each naming the missing sentence) |
| **M-T6.87** default sentence | **ruled + fixed (rule half), closed** — `D-MESSAGELESS-DEFAULT` (`proposed`, 48 h default), RS-40 | as M-T6.86 + D13 | as above | as above |
| **M-T6.87** missing-required half | **split → M-T6.89** (open, needs a ruling): node's sentence for it is zod's, zod-major-specific and per JSON type, so "node's sentence" cannot be applied by fiat | — | — | — |
| **M-T6.88** java nested payload pointer | **fixed, closed** | java `to<Vo>` / `to<Payload>` mappers take the path they sit at (`wireToDomain(…, base)`, `java/emit/wire.ts`, `workflow.ts`, `service.ts`); the payload wire record gets `@NotNull` / `@Valid` / boxing. **Found while booting**: elixir had the same leaf pointer plus Ecto's "is invalid" — its workflow now checks a payload's money against node's grammar and refuses at `/c/amount` (`elixir/vanilla/workflow-execution-emit.ts`) | `test/conformance/nested-payload-pointer.test.ts`; `corpus/workflow-command-payload` malformed `c.amount` probe | revert java `wire.ts`+`workflow.ts` and elixir's emitter → 3/3 fail |
| elixir NUL → 400 | **not the same seam — minted M-T6.91**: the four 422 backends also disagree on the MESSAGE (`Invalid input` / `The Name field must not contain a NUL character.` / `must not contain a NUL character` / `Value error, must not contain…`), so it needs one sentence first | — | — | — |
| `intrinsics` `"   "` probe | **restored**; golden node-minted. **elixir diverges** on it (`can't be blank`, D14) until packet F1's D14 fix folds — expected, not waived | — | — | — |
| #3094 (`string(datetime)` canonical) | no overlap: the PR carries no files | — | — | — |

## 2. Wire goldens moved (all node-minted with `LOOM_WIRE_UPDATE=1`)

| golden | why |
|---|---|
| `wire-ingress.json` | +3 refusals (seq 4–6): `reprice("12,50")` → `Invalid decimal: "12,50"`; `restock(±3000000000)` → `Integer out of range` at `/n` |
| `workflow-command-payload.json` | +1 refusal (seq 3): `c.amount: "1.2.3"` → `Invalid decimal: "1.2.3"` at `/c/amount`; later seqs renumbered |
| `intrinsics.json` | +`middle` / `shout` on every Product read; the blank-name 422 (`Invariant violated: name.trim().length > 0` at `/name`); the astral (`"😀b"`) and `ß` (`"STRASSE"`) creates |
| `validation-messages.json` | unchanged — the four legs now match it without waivers |

## 3. Runtime evidence (booted, this container)

Toolchains: JDK 25 + Gradle 9 and .NET SDK 10 lifted out of `gradle:9-jdk25` / `mcr.microsoft.com/dotnet/sdk:10.0` into `/opt`, elixir from `/opt/elixir-toolchain`; postgres `f4-pg` on :55434, one database per leg. Maven Central answered 429 once mid-run (a java `gradle test produced no results`); the re-run resolved.

Final run, all four cases on every wire-gated leg (`node run*.mjs wire-ingress validation-messages workflow-command-payload intrinsics`); node and python re-run on the merged-`main` head:

| leg | wire-ingress | validation-messages | workflow-command-payload | intrinsics |
|---|---|---|---|---|
| node (oracle) | ✓ golden | ✓ | ✓ | ✓ |
| mikroorm | ✓ golden | ✓ golden | ✓ golden | ✓ golden |
| python | ✓ golden | ✓ golden | ✓ golden | ✓ golden |
| dotnet (EF) | ✓ golden | ✓ golden | ✓ golden | ✓ golden |
| dapper | ✓ golden | ✓ golden | ✓ golden | ✓ golden |
| java | ✓ golden | ✓ golden | ✓ golden (re-run alone: the batch run's boot hit "port never listened" at load ≈ 50) | ✓ golden |
| elixir | ✓ golden | ✓ golden | ✓ golden | api ✓; **1 wire divergence**, expected: `#2 POST /api/products $.errors[0].message — golden "Invariant violated: name.trim().length > 0" ≠ "can't be blank"` (D14, packet F1) |

Before the fixes, on the same legs: `.NET`/`dapper` accepted `reprice("12,50")`; java and .NET answered `restock(3000000000)` with 400; elixir answered the nested payload probe `"is invalid"` at `/amount` and failed `mix compile --warnings-as-errors` on the first cut of its guard (an underscored binding read back — caught here, fixed); `validation-messages` passed on dotnet / dapper / java / elixir only through the four `M-T6.86` waivers, now deleted.

Elixir's `substring` change is not distinguishable on an astral character (one grapheme = one code point there); it is pinned by the renderer spelling tests and RS-41's contract, and differs from the old grapheme count only on combining sequences.

## 4. Fence crossings

- `src/generator/elixir/vanilla/workflow-execution-emit.ts` (payload money guard, M-T6.88's elixir half) — not F1's changeset tree, not F8's router/controller tree.
- `src/generator/elixir/vanilla/problem-details-emit.ts` — one added `render_wire_error/1` clause (the code-less entry). F8 owns openapi/router; this is the 422 rendering seam.
- `src/generator/_expr/js-intrinsics.ts` is shared by the React/Vue/Svelte/Angular page expressions, so their `substring` follows RS-41 too. Feliz / Flutter are untouched (M-T6.90).
- Not touched, minted instead: elixir's create/update changeset messages for message-less rules (M-T6.92 — F1's `changeset-emit.ts`).

## 5. Missions minted (T6; ids from `next-mission-id.mjs` at 89 — siblings may collide, renumber on fold)

- **M-T6.89** a missing required field's sentence (the split-out half of M-T6.87; needs a ruling).
- **M-T6.90** Feliz / Flutter count `length` and `substring` in UTF-16 units.
- **M-T6.91** NUL in a plain string: elixir 400, four messages elsewhere.
- **M-T6.92** elixir's changeset answers Ecto's text for a message-less single-field rule.

## 6. Gates

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | clean |
| `npx biome ci .` | clean |
| `npx vitest run test/generator/{dotnet,java,python,elixir,elixir-vanilla,hono,_expr,typescript,react,vue,svelte,angular}` | all pass (two typescript tests timed out at load ≈ 50 in the batch and pass alone) |
| `npx vitest run test/conformance` | 4919/4928 in the batch; the 9 failures were all timeouts (corpus-mutation ×5, behavioural-coverage ×2, frontend-showcase flutter, sentinels) — each passes when re-run alone |
| `npx vitest run test/ir` | 3977 / 3977 |
| `npx vitest run test/system` | 3316 / 3369 in the batch. `archived-docs-fence` caught three archived links not re-rooted — fixed, 10/10. `diagnostic-firing-census` + `mission-counts` pass re-run. `ddd-source-census` (its own 300 s budget, took 351 s) and `e2e-fixture-validation`'s `elixir-vanilla-build` case (its own 120 s budget, took 127 s) **time out at load ≈ 50 and were not seen green here** — no assertion failed in either; the three changed corpus fixtures each `ddd parse` with 0 errors. CI must confirm both. |
| `LOOM_EXPR_VALUES_REQUIRE=all npx vitest run test/generator/_expr/expr-value.test.ts` (node, python, java, dotnet all executed) | 198 / 198 |
| `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` | up to date |
| `test/conformance/semantics-spec-sync` | regenerated (`UPDATE_SEMANTICS_SPEC=1`), in sync |
