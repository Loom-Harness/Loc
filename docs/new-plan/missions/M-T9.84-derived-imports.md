# M-T9.84 — Imports derived from use

*Design note, 2026-10-04. Missions M-T9.84 (shared seam, census, python pilot) and M-T9.85–M-T9.88 (the other backends), in [`../T9-toolchain-health.md`](../T9-toolchain-health.md).*

## 1. The defect class

Each backend emitter writes a symbol's usage in one place and decides its import in another, through a hand-written predicate:

```ts
const usesDecimal = fields.some(isMoney);                // predicate, computed here …
lines(usesDecimal ? "from decimal import Decimal" : null, // … gates the import here …
      …,
      `    amount: Decimal`)                              // … and the usage is written here
```

Nothing ties the predicate to the usage. When a new render site spells `Decimal` and the predicate isn't updated, the import is missing and the file fails at the target compiler (F821 / TS2304 / CS0246 / `cannot find symbol`). When a render site is removed or made conditional and the predicate still fires, the import is unused (F401 / CS8019 / unused-import lint). The September 2026 merge log has ten-plus PRs that fixed one instance each: #3028 (a node domainService precondition, a .NET regex rule), #3060, #2939 (three TypeScript instances), #2881, #2925 (a Java mask mapper), #2786, #2991, #2741 (.NET VO usings built from expressions only), #2671 (two owners both emit the `decimal.js` import), #2869, #3029 ("import and usage keyed off different predicates"). One is still live on `main`: `test/fixtures/corpus/vo-regex-invariant.ddd` emits `re.search(...)` into the python `app/http/wire_models.py` without `import re`. `emit/http-models.ts` gates `import re` on `needsMoney`, which is the wrong predicate (`docs/audits/2026-09-29-fixture-shape-coverage.md`).

The fast suite can't see this class. It compares emitted text, and an unresolved name is a binder fact, not a text fact (`experience_gathered.md` §104). Only the opt-in compile legs see it, and only on corpus shapes that reach the broken site.

**Size of the class** (`test/system/import-predicate-census.test.ts`, measured on `main` @ `bce7f409`): about **285** predicated import sites in python, **230** in TypeScript (`src/generator/typescript` + `src/platform/hono`), **51** in Java, **26** in .NET and **2** in Elixir. Python also has its mirror collectors: `collectPyExprImports` / `addPyExprImport` and `visitPyTypeImports`. These re-derive "what will the renderer write" through a second walk, and they drift in the same way.

#2939 replaced one TypeScript candidate list with a scan of the rendered body against a closed vocabulary (`drizzle-imports.ts`). That fixed one module family. A body scan is still a guess about what the text means: it needs string and comment stripping, a `.`-boundary rule (money's `new Decimal(a).gt(…)` must not read as drizzle's `gt`), and it can't tell an imported `log` from a local `log`. Its binder gate (`test/system/emitted-symbol-binding.test.ts`) is the oracle this design reuses for TypeScript.

## 2. The mechanism: `ref(sym)` writes the usage and records the import in one step

```ts
// src/generator/_imports/symbol.ts — language-neutral
const DECIMAL = pyFrom("decimal", "Decimal");          // a typed symbol handle
const RE      = pyModule("re");                        // a whole-module import
const MONEY_M = pyFrom("app.http.wire_models", "Money", "MoneyModel"); // aliased

`    amount: ${ref(DECIMAL)}`                          // usage + import, one call
`${ref(RE)}.search(${pattern}, value)`
```

`ref(sym)` returns a **marker**: a private-use-area token (`py|decimal|Decimal|`) that carries the symbol. It doesn't return the final spelling. Each module is finalized exactly once, before it reaches the output map:

```ts
finalizePyModule(text)  // 1. collect every marker in the text → the used-symbol set
                        // 2. replace each marker with its spelling (alias ?? name ?? module)
                        // 3. render the import block from the used set (canonical order, §4)
                        // 4. put the block at the module's import slot (merging any not-yet-migrated hand-written import lines)
```

The import block is computed from the final text, so **an import exists iff a usage survived into the file**. The two can't disagree.

**Why a marker in the text and not a builder object threaded through the call graph.** The task brief described `ref(sym)` as "returns the spelling and records the import" on a per-module builder. The marker version keeps that contract, and it was chosen for three reasons that matter in this codebase:

1. **It composes with every string-returning helper as is.** `renderPyExpr`, `renderPyType`, the `ExprTarget` / `StmtTarget` leaf tables, `lines(...)` and `indent(...)` all return or accept plain `string`. A marker is plain string content, so a leaf in `render-expr.ts` can call `ref(DECIMAL)` with no new parameter. A threaded builder would need a `module` argument on every render function shared by five backends, and the shared `_expr` / `_stmt` dispatchers would have to carry it.
2. **Text that gets discarded leaves no import behind.** Emitters often render something and then drop it: they render a guard and keep it only if it is non-empty, or render two candidates and keep one. A builder that records on call would import the dropped candidate's symbols (F401). A marker that doesn't reach the final text records nothing.
3. **It closes the mirror collectors.** `collectPyExprImports` exists only because the renderer can't report what it wrote. When the renderer's leaf writes `ref(DECIMAL)`, the mirror has nothing left to do and is deleted. This removes a whole drift surface, not one instance.

**Spelling is context-free.** A symbol's spelling is `alias ?? name` (or `alias ?? last-module-segment` for a module import), fixed on the handle. So markers can also be resolved without import derivation (`spellMarkers(text)`). Places that need final text before the module is finalized, like source-map fragments (`SourceMapRecorder.fragment` locates a fragment by `indexOf` in the finished file), use `spellMarkers` on the fragment.

### Failure modes all fail closed (a throw at generate time, caught by the fast suite)

| situation | result |
|---|---|
| a marker reaches the backend's output map unresolved (an emitter forgot to finalize) | throw naming the path. A central guard runs over every file the backend returns. S1's write-once sink is the long-term home of this guard (§6). |
| two used symbols spell the same name (`app.domain.value_objects.Money` and `app.http.wire_models.Money`, neither aliased) | throw naming both. The fix is an aliased handle, written once next to the symbol table. |
| a used symbol's spelling collides with a name the module declares itself (`finalize(text, { declares })`) | throw. |
| a migrated module has markers but no import slot and no leading import block | throw. |

## 3. Per-language import syntax

Each language gets a small symbol-constructor set and its own block renderer. Everything else is shared: the marker codec, collection, spelling and the collision check.

| language | handles | block rendering | notes |
|---|---|---|---|
| python | `pyFrom(mod, name, alias?)`, `pyModule(mod, alias?)` | `from m import a, b` / `import m [as x]`. Canonical order is the ruff-isort default (§4). Lines longer than 100 wrap to the parenthesized one-per-line form. | Function-local (lazy) imports stay hand-written and are out of scope (they exist to break import cycles at runtime). |
| TypeScript | `tsNamed(spec, name, alias?)`, `tsDefault(spec, local)`, `tsNamespace(spec, local)`; `refType(sym)` for a type-position use | `import { a, type B } from "m"`. A name used only through `refType` renders `type B`, or the whole statement becomes `import type { … }` when every name is type-only. This replaces the hand `isValueUsed(n) ? n : \`type ${n}\`` sites. | Relative specifiers are computed from the importing file's path, so a handle names the *target module path* and finalize relativizes it. The binder gate from #2939 is the oracle. |
| .NET | `csType(ns, name)` | `using Ns;` per distinct namespace, ordered `System*` first (the existing convention) | A spelled-name collision across namespaces gets a `using Alias = Ns.Name;` from the handle's alias, or throws. Global usings (`GlobalUsings.cs`) stay a project-level file. A symbol whose namespace is one of them needs no line. |
| Java | `javaType(pkg, name)`, `javaStatic(pkg.Cls, member)` | `import pkg.Name;` / `import static pkg.Cls.m;` | Finalize knows the file's own package, and `java.lang` and same-package symbols render no import. Java has no import aliasing, so a collision spells the second symbol fully qualified. That is a spelling rule on the handle, not an allocation. |
| Elixir | `exAlias(Mod.Sub)` | `alias Mod.Sub` | The Elixir emitters mostly spell fully-qualified module names, which need no import (2 census sites). Lowest priority. |

## 4. Ordering

A derived block can't keep an emitter's hand-picked order, because there are no hand-written lines left to keep the order of. Today's python headers follow no single rule. On the corpus, 657 of the 2,198 python files with imports have a block that differs from isort order: `app.domain.paging` sorts before `app.db.schema`, `Order, Line` keeps declaration order, `typing` is grouped with third-party, and `main.py` emits `from app.auth.verifier import …` twice. So every backend gets **one canonical order per language**, chosen to match that language's standard tool so the target linter can act as the oracle:

- **python**: the ruff isort defaults. Sections are `__future__`, stdlib, third-party, first-party (`app`, `tests`). Within a section, `import x` statements come before `from x import` statements, and modules sort case-insensitively. Names follow order-by-type (CONSTANTS, then Classes, then functions). `as`-imports go on their own line. Lines over 100 characters wrap. The oracle is `ruff check --select I`, which must be clean on every generated file.
- **TypeScript**: Biome's `organizeImports` order (the repo's own linter). **.NET**: `System*` first, then alphabetical. **Java**: the google-java-format order (static imports first, then ASCII order).

**The reorder is a separate, mechanically verified step.** Canonicalization is not mixed into the derivation refactor. Each backend's migration starts with a slice that only routes every emitted file through the canonical block renderer. Its diff is verified by an **import-equivalence check**: for every emitted file, the body after the import block is byte-identical, and the *set* of `(module, name, alias)` imports is identical. Order, grouping, wrapping and the merging of duplicate lines are the only changes allowed. After that slice, every derivation slice is **byte-identical** against the canonicalized baseline, which is the repo's usual refactor gate.

## 5. Lint cleanliness and composition

- **F401 / CS8019 / unused import**: can't happen for a migrated symbol, because an import exists only for a marker that survived.
- **F821 / TS2304 / CS0246 / `cannot find symbol`**: can't happen for a migrated symbol, because the spelling is written through `ref` or not at all. An emitter that still writes the bare name is the remaining risk, and the census (§7) plus the compile legs cover it until the backend is fully migrated.
- **F811 / TS2300 (redefinition)**: the duplicate-spelling and `declares` checks throw before emission.
- **Mypy, `--strict`**: unaffected. The finalizer changes only import lines.
- **`lines(...)` / `indent(...)`**: unchanged. Markers are ordinary string content, and the module's import slot is a line written by `lines(...)` (`PY_IMPORTS` and so on).
- **The `exprImports` / `collect*ExprImports` / `collectCsExprUsings` / `visitPyTypeImports` mirrors**: deleted as their backend migrates. The renderer leaf writes `ref(...)` itself (`PY_TARGET.duration` writes `${ref(TIMEDELTA)}(days=…)`). These deletions are what remove the drift surface.
- **Mid-migration hybrid.** The finalizer merges the module's not-yet-migrated hand-written leading import lines with the derived set, de-duplicated. So a backend migrates one emitter at a time, and the byte-identical gate holds at every step.

## 6. Name allocation: none here

This seam **allocates no names.** Spellings come from the handle: the declared name, or a declared alias. A collision is a thrown error, not a renamed symbol. The sibling S1 work (write-once output sink, generated-name uniqueness, per-target reserved-identifier table) owns allocation. Where the two meet:

1. The `declares` set passed to `finalize` is a module's own top-level names. Once S1's per-target reserved-identifier table exists, `finalize` should also refuse a spelling on that table (an import named `type` in python, for example).
2. S1's write-once sink is the right long-term home for the "no unresolved marker reaches disk" guard. Until it lands, each backend's orchestrator runs that guard over its own output map.

## 7. The census ratchet

`test/system/import-predicate-census.test.ts` counts, per backend, the **predicated import sites**: source lines in `src/generator/<backend>/**` (plus `src/platform/hono/**` for TypeScript) where an import-statement string literal follows a conditional or collecting construct: `?`, `:`, `&&`, `||`, `=>`, `.push(`, `.add(`, `.unshift(`, or a line ending in `?` / `&&` / `||` / `=>` directly above. A literal that is a bare element of an unconditional `lines(...)` list isn't counted, since both halves of such a header are constant and can't drift. Each backend has a pinned **ceiling**. The count must **equal** it, so a migration that removes sites must lower the ceiling in the same PR. A stale ceiling fails just like a regression (the CLAUDE.md waiver ratchet).

The regex can't see every predicate. A predicate held in a variable (`const header = needs ? X : Y` assembled elsewhere) is counted where the literal sits, and a fully dynamic literal (`` `from ${mod} import …` ``) is still counted when it is conditional. It is a consistent measure of progress, not a proof of absence. Proof of absence comes from each backend's compile/lint leg (`ruff` F401/F821, the TypeScript binder gate, `dotnet build`, `javac`).

## 8. Migration plan

| mission | backend | census at design time | oracle | order |
|---|---|---:|---|---|
| **M-T9.84** | shared seam (`src/generator/_imports/`) + census + **python pilot** | 285 | `ruff check` (F401, F821, `--select I`) + `mypy --strict` on the corpus python leg | 1 |
| M-T9.85 | TypeScript (`src/generator/typescript`, `src/platform/hono`) | 230 | `emitted-symbol-binding.test.ts` binder gate, `test:tsc-corpus` | 2 |
| M-T9.86 | Java | 51 | `test:java-corpus` | 3 |
| M-T9.87 | .NET | 26 | `test:dotnet-corpus` | 4 |
| M-T9.88 | Elixir | 2 | `test:elixir-corpus` | 5 |

Each backend goes through the same four slices:

1. **Canonicalize.** Route every emitted file through the language's block renderer (the hybrid finalizer with no markers yet), and verify with the import-equivalence check (§4).
2. **Mirrors first.** Make the expression and type renderers' leaves write `ref(...)`, and delete the mirror collectors and the predicates that read them. This removes the most drift for the least churn.
3. **Emitter by emitter.** Replace each `cond ? "import …" : null` with `ref()` at the usage sites, add the module's import slot, delete the predicate, and lower the census ceiling. Each slice is byte-identical, except where the old predicate was wrong (the diff is the fix, and the PR names it).
4. **Close.** When the census reads 0, set the gate to "zero, forever". For python, optionally add `"I"` to the generated `ruff` `select`, so the corpus leg enforces the canonical order too.
