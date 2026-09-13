# `M-FT` — the 2026-09 field-test series, merged ids

*Reconstructed 2026-09-10 (Wave **C0.4** of [`../completion-waves-2026-09.md`](../completion-waves-2026-09.md)) from the merged-PR record alone. **No definition document for this series exists anywhere under `docs/`** — the `M-FT.*` ids were minted in a field-test session whose notes the owner holds, and the missions were executed straight from those cards. Every heading below is therefore written from what its PR actually landed, not from the card it was given; the finding ids (`A1`, `S9`, `G7`, `D-12`, …) are the field-test / review-report references each PR cites, and this file does not restate them beyond what the PR body says.*

*Ids that appear in no merged PR are listed, as UNKNOWN-DEFINITION and nothing more, in [`../missions/field-test-2026-09-register.md`](../missions/field-test-2026-09-register.md). Do not infer their content from the numbering.*

**18 of 31 ids merged.** Two of them — **M-FT.7** ([#2746](https://github.com/Loom-Harness/Loc/pull/2746)) and **M-FT.10** ([#2737](https://github.com/Loom-Harness/Loc/pull/2737)) — carry the id **only on their branch name**, not in the PR title or the commit subject, so a `git log | grep -o 'M-FT\.[0-9]*'` sweep misses both and reports 16. They were found by listing every PR whose head branch matches `claude/m-ft-`. Ledger note for whoever re-counts this: **count by branch, not by subject.**

| id | PR | merged |
|---|---|---|
| M-FT.1 | [#2736](https://github.com/Loom-Harness/Loc/pull/2736) | 2026-09-09 |
| M-FT.2 | [#2749](https://github.com/Loom-Harness/Loc/pull/2749) | 2026-09-07 |
| M-FT.3 | [#2735](https://github.com/Loom-Harness/Loc/pull/2735) | 2026-09-07 |
| M-FT.4 | [#2761](https://github.com/Loom-Harness/Loc/pull/2761) | 2026-09-07 |
| M-FT.6 | [#2738](https://github.com/Loom-Harness/Loc/pull/2738) | 2026-09-09 |
| M-FT.7 | [#2746](https://github.com/Loom-Harness/Loc/pull/2746) | 2026-09-07 (id on the branch only) |
| M-FT.10 | [#2737](https://github.com/Loom-Harness/Loc/pull/2737) | 2026-09-07 (id on the branch only) |
| M-FT.11 | [#2739](https://github.com/Loom-Harness/Loc/pull/2739) | 2026-09-07 |
| M-FT.12 | [#2743](https://github.com/Loom-Harness/Loc/pull/2743) | 2026-09-07 |
| M-FT.13 | [#2740](https://github.com/Loom-Harness/Loc/pull/2740) | 2026-09-09 |
| M-FT.18 | [#2745](https://github.com/Loom-Harness/Loc/pull/2745) | 2026-09-07 |
| M-FT.19 | [#2750](https://github.com/Loom-Harness/Loc/pull/2750) | 2026-09-07 |
| M-FT.20 | [#2748](https://github.com/Loom-Harness/Loc/pull/2748) | 2026-09-07 |
| M-FT.21 | [#2747](https://github.com/Loom-Harness/Loc/pull/2747) | 2026-09-09 |
| M-FT.22 | [#2782](https://github.com/Loom-Harness/Loc/pull/2782) | 2026-09-07 |
| M-FT.26 | [#2741](https://github.com/Loom-Harness/Loc/pull/2741) | 2026-09-07 |
| M-FT.27 | [#2742](https://github.com/Loom-Harness/Loc/pull/2742) | 2026-09-09 |
| M-FT.31 | [#2744](https://github.com/Loom-Harness/Loc/pull/2744) | 2026-09-07 |

---

## M-FT.1 — Wire `== null` means absent — an omitted optional no longer 422s on Hono — `done` ([#2736](https://github.com/Loom-Harness/Loc/pull/2736), merged 2026-09-09)

**Findings:** A1 (blocker), the wire half of A2, D2.

`invariant estimate == null || estimate >= 0` on an optional field lowered to a zod refine rendering `==` as JS `===`; `nullish()` admits an *omitted* key, which arrives as `undefined`, so the refine was false and a `POST` without the field answered **422** on Hono while .NET and Python answered 201 for the same bytes. `src/generator/zod-refine.ts` now renders `==`/`!=` against the `null` literal as loose JS `==`/`!=` and keeps strict equality everywhere else; every single-field native chain also carries a human message instead of zod's `"Invalid input"`. New corpus fixture `absent-optional.ddd` (`backends: ALL`) with a node-captured wire golden puts the shape in the five-backend differential permanently. The cross-backend `"Invariant violated: <src>"` default was left alone on purpose — humanising it is a five-emitter change.

## M-FT.2 — A custom page over a zero-arg find doesn't type-check — and no generated web build would have told you — `done` ([#2749](https://github.com/Loom-Harness/Loc/pull/2749), merged 2026-09-07)

**Findings:** B1 (major), B2 (major).

The walker rendered a query bag only when the call site passed arguments, so a zero-parameter find emitted a bare call against a hook declared with a required parameter — `TS2554` on all four JS frontends, and `Object.entries(undefined)` inside `queryFn` had it ever run. The query parameter is now defaulted when the find has no parameters (Feliz and Flutter were already correct and are untouched; Svelte's default is gated on `!paged`). B2 is why it shipped: the generated project's `build` script was `vite build` alone and every web Dockerfile runs exactly `npm run build`, so neither a user's build nor the emitted container ever type-checked — now `tsc --noEmit &&` / `vue-tsc --noEmit &&` / `svelte-check &&` ahead of it. Two new gates: an **arity** comparison per frontend (stated as arity, not spelling), and a deployable-coverage guard that failed on its first run against a real gap — `showcase.ddd`'s `ops_web`, a whole generated React app nothing had ever type-checked.

## M-FT.3 — Regeneration prunes what it no longer emits — `done` ([#2735](https://github.com/Loom-Harness/Loc/pull/2735), merged 2026-09-07)

**Findings:** G1 (major), G2 (major).

`ddd generate` only ever ADDED, so renaming an operation left the old handler behind calling a method the aggregate no longer has. `.loom/manifest.json` (new, via the pure `src/system/manifest.ts`) records every path a run emitted, and the next run deletes a path the *previous* manifest lists and this run does not emit — narrow by construction: a hand-written file has no entry and is structurally unreachable, and migrations and `.loom/snapshots/` are protected because "not emitted this run" does not mean "stale" there. An absent or unreadable manifest degrades to *prune nothing*. G2 is the refusal that named no escape hatch: the rebaseline error now spells out both recoveries, and the gate proves the prescribed one actually recovers.

## M-FT.4 — One accurate syntax error instead of fifteen speculative ones — `done` ([#2761](https://github.com/Loom-Harness/Loc/pull/2761), merged 2026-09-07)

**Findings:** F3, F4, F6, F10, F13, F14. Diagnostics only — no grammar change, no emitted byte moved.

One unsupported operator inside a page body produced **15 errors**, none naming the cause, the first pointing at a correct line 17 lines earlier. After: one error, at the offending character. F4 stops after a lex/parse error and reports only the first (in an LL parser with resync every later parse error is speculative — 6 of 7 were). F3 re-parses from the losing alternative's name with the `BuilderCall` rule to recover the inner position. F6 replaces chevrotain's numbered token dump with a did-you-mean over the closed alternation sets, using optimal string alignment so a transposition survives in a short name. F10 drops a stderr warning that Loom's pre-link macro expander triggers by design; F13 and F14 correct two messages that described something the author never wrote. **The policy change — a document that does not parse is not validated — exposed ten fixtures across nine test files carrying a syntax error nobody had seen**, each passing only because the validators ran over the recovered tree.

## M-FT.6 — Sidebar merges scaffold defaults with custom pages — `done` ([#2738](https://github.com/Loom-Harness/Loc/pull/2738), merged 2026-09-09)

**Findings:** C1, C2, C4, E7.

A scaffolded ui plus one hand-written page with a `menu { … }` block produced a sidebar containing **only** that page; remove the block and the page became unreachable instead. A page-level `menu { … }` is now additive — same-named sections merge, a new one appends after the defaults, `order:`/`hidden:` still apply, and a default entry whose route a page already claims is dropped so the one-link-per-page frontends never list a page twice — while an explicit **ui-level** block still replaces wholesale. A custom page with no block gets a plain "Pages" link. C2 mints `loom.menu-link-unresolved`, which lists what IS linkable, mirrored off the scope provider's own `MenuLink` branch. E7 titles the app from the system rather than the deployable (feliz had it hardcoded). C4 turns the scaffolded `Home` into a launcher — one card per aggregate — instead of a description of the model in metamodel vocabulary.

## M-FT.7 — Errors keep their reason: `detail` on the wire, 409 on every backend, 501 for an unfilled extern — `done` ([#2746](https://github.com/Loom-Harness/Loc/pull/2746), merged 2026-09-07)

**Findings:** D1, D3, D4, D6 (+ reviews B and C: D1 / D12 / D13). **The PR title and commit subject carry no `M-FT` id — only the branch `claude/m-ft-7-errors-keep-reason` does.**

Every layer between a backend's RFC 7807 `detail` and the user's toast dropped it. The api clients extracted the message from an `"error"` key no Loom backend emits, so the branch was dead and `ApiError.message` was always `r.statusText`; `JSON.parse` was unguarded and ran *before* the `r.ok` check, so a non-JSON error body lost the status too. Fixed in `api/api-client.hbs` **and** its SvelteKit twin — the gate found the second copy, a single-frontend assertion would have shipped 3 of 4. A still-referenced delete is now 409 on all five backends: java's SQLSTATE 23503 arm shared a handler with the unique arm and the whole handler was gated on `hasUniqueKeys`, so a model with a cross-aggregate reference and no `unique (...)` key leaked a 500. An unimplemented `extern` operation answers **501** with its "write its body in …" hint instead of a generic 500. And a record-removing soft delete navigates away instead of re-reading the row it just put behind the read filter — detected by *body* (`isDeleted := true`), never by name, with `restore` as the control.

## M-FT.10 — Refuse the C# name collision, and scope the TPH writes by `kind` — `done` ([#2737](https://github.com/Loom-Harness/Loc/pull/2737), merged 2026-09-07)

**Findings:** F11, review-B D1. **The PR title and commit subject carry no `M-FT` id — only the branch `claude/m-ft-10-dotnet-name-collisions` does.**

`operation comment` beside `entity Comment` breaks the generated C#: a simple name in expression position resolves against the enclosing class's members first, so the member hides the type (CS0119; the field-shaped variant gives CS1061). New `loom.dotnet-name-collision`, scoped to contexts hosted by a `platform: dotnet` deployable, **refuses rather than renames** — an operation's name is also its route segment and its command/handler type names. The boundary was probed against C#'s own "Color Color" rule (§12.8.7.2), so `public Kind Kind` beside `enum Kind` still compiles. D1: TPH concrete repositories scoped every read by `kind` and neither `delete` nor the guarded `save` UPDATE, so `carRepo.delete(truckId)` deleted the truck — fixed on node and python, with the other three surveyed and found safe, and the existence probe deliberately left unscoped (it is a primary-key question about the shared table).

## M-FT.11 — Grammar: `key` as a field name, `if … else`, and `??` — `done` ([#2739](https://github.com/Loom-Harness/Loc/pull/2739), merged 2026-09-07)

**Findings:** F1, F2, F3 (operator half).

Three shapes the DSL rejected that a user would obviously write. `key` joins `CommonSoftKeywords` (and the `DOMAIN_WORD_FLOOR` so it cannot be re-stolen). The `if … { } else { }` statement lands as one new `StmtIR` arm plus a `StmtTarget.if` leaf on node/.NET/java/python, with its condition on a **restricted ladder** (`CondExpr`) rather than the full `Expression`, because `if active { helper() }` otherwise parses as a complete `BuilderCall` — and with two honest gates rather than a half-rendering: `loom.elixir-if-stmt-unsupported` (an Elixir `if` block's bindings do not escape it, so an assigning branch would compile clean and do nothing — the fix is missioned as M-T6.59) and `loom.if-stmt-page-body-unsupported`. `??` gets its own precedence band and desugars to the existing ternary IR, so no backend or frontend renderer learns anything.

## M-FT.12 — The CLI says what it knows: patch addresses, trace coverage, the real pack list, model-relative i18n, multi-file verify/snapshot — `done` ([#2743](https://github.com/Loom-Harness/Loc/pull/2743), merged 2026-09-07)

**Findings:** G3, G4, G5, G6, B4 + review-B D7. Six verbs, one shape: the CLI *had* the fact the user needed and printed something that withheld it.

`ddd patch` failed `target not found` while holding the complete address book it had just built — it now prints the accepted shape, the nearest addresses and the book. `ddd trace` was silent about a total miss (a bundled frame names the bundle, not the file the map is keyed by) and now prints a coverage verdict to stderr. `ddd breakpoints` listed whole-file fallbacks alongside the real answer; enclosing regions are dropped when a finer one maps the line. `ddd new --help` hand-listed 7 of 13 packs and rejected the other 6 outright — the list is now derived from the built-in pack registry, grouped by pack *format*. `ddd i18n`'s default paths are model-relative, not cwd-relative. `verify`/`snapshot` follow `import` like `parse`/`generate system` do. And `--json` no longer emits invalid JSON when a lazy Chevrotain ambiguity notice lands mid-payload.

## M-FT.13 — Generation defaults: lean compose, quiet Dockerfile, opt-in license, certs in every stage — `done` ([#2740](https://github.com/Loom-Harness/Loc/pull/2740), merged 2026-09-09)

**Findings:** G7, G8, G9, G10.

Four generation *defaults*, none of them a bug in what Loom emits. Observability (Prometheus + Jaeger **and** the per-backend OTLP env) moves to a generated `docker-compose.obs.yml` overlay — an overlay rather than `profiles:` because compose cannot gate a single `environment:` key, and moving the services alone would have left every backend exporting into a void. No emitted Dockerfile runs `npm ci` any more (no generator emits a lockfile, so it could only ever fail). Proxy CAs are copied before the first network call in **every** stage, which is what made elixir the one platform that could not build behind a TLS-terminating proxy. The Angular packs declare the Node range their own CLI demands. And `LICENSE` moves from `generate` to `ddd new`. **The most important thing in the PR is the interaction it found:** composed with #2735's prune, dropping the `LICENSE` emission deletes the user's own licence file on the first regen after upgrading — reproduced, then fixed by protecting the whole licence-shaped family from the prune.

## M-FT.18 — Chakra pack: the app shell is not applied, headings at body size, centred pages, dropped grid columns — `done` ([#2745](https://github.com/Loom-Harness/Loc/pull/2745), merged 2026-09-07)

**Findings:** S1; review-C D2, D4, D6 + section (c) items 1, 4, 10.

Seven template defects in `designs/chakra/{v2,v3}`, each of which renders *something* — which is why no gate caught them. `primitive-heading.hbs` compared the numeric `level` against string literals, so all three branches were dead and every heading rendered at body size as an `<h2>`; `primitive-stack.hbs` emitted a bare `<VStack>` (default `align="center"`), so the whole page shrink-wrapped and centred; `primitive-grid.hbs` hardcoded its columns and never read the author's spec; the shell had no `<header>` landmark at any desktop width; `gap={1}` was copied from MUI's 8px scale onto Chakra's 4px one; seven templates carried raw `gray.*` steps, making chakra the only pack of fifteen that would not follow a colour-mode switch; breadcrumb children were dropped into the list container with no item semantics. Verified by rendering both packs in chromium at 1366×860 and 390×800 and measuring.

## M-FT.19 — Flowbite (svelte) pack: invisible primary buttons, bleeding tables, unpadded cards, raw workflow labels — `done` ([#2750](https://github.com/Loom-Harness/Loc/pull/2750), merged 2026-09-07)

**Finding:** S2. Each defect measured in chromium against the **built** bundle, not inferred from templates.

Primary buttons computed to a transparent background with white text — flowbite-svelte's theme reaches for a *numbered* palette (`bg-primary-700`) while the pack's `@theme` defined only `--color-primary`, so the utility was never emitted and the button kept the one class that existed, `text-white`. The ramp is now derived `50…950` from `--loom-primary` via `color-mix(in oklab, …)`, so the DSL's `theme { primary: … }` still drives the pack. `<main>` is a flex item, so a wide table pushed the *document* sideways (`scrollWidth` 2520 at a 1366 viewport) — `min-w-0`. flowbite's `Card` base carries no padding at all. And svelte's `defaultNavSections` passed `wf.name`/`plural(a.name)` verbatim where react and vue humanise, so the sidebar read `closeProject`.

## M-FT.20 — MUI pack: vertical rhythm, heading scale, text-field labels, toolbar alignment, DataGrid header renderer — `done` ([#2748](https://github.com/Loom-Harness/Loc/pull/2748), merged 2026-09-07)

**Findings:** S3, S11, B10; review-C D3, D4 + section (c) items 1–3; review-B D4.

The MUI packs had **no vertical rhythm at all** (`Stack` defaults to `spacing = 0`, and the pack's own `primitive-group.hbs` remembered `gap={1}` while the stack did not), a toolbar with no `alignItems` so the action button stretched to the heading's height, a heading map that put the semantic level straight onto the display variant — inverting the scale at levels 5 and 6, which MUI themes larger than the pack-themed h4 — and text fields whose labels read as placeholders beside `Select`s that floated theirs. Plus **B10, fixed once for all 15 packs**: `String(col.columnDef.header ?? col.id)` as the column-visibility label serialised a TanStack render function — the selection column's — as the checkbox's own label. The replacement spelling is load-bearing in three ways the build lanes taught: not `instanceof Function` (not a Vue template global), not duck-typing (does not type-check against the declared union), and single quotes (vuetify splices it into a double-quoted attribute).

## M-FT.21 — Cross-pack spacing and chrome contract — `done` ([#2747](https://github.com/Loom-Harness/Loc/pull/2747), merged 2026-09-09)

**Findings:** S4, S5, S6, S7, S8, S10; review-C section (c), D4, D7, D8, D11.

One `.ddd` through the packs measured root `Stack` gaps of 0/8/12/16px, `Group` gaps of 4/8/12/16, card padding 16/16+24/24 — and **7 of 8 packs scrolled the document sideways at 390px**. `src/generator/_packs/spacing-contract.ts` + `docs/design-packs.md` §8a state the scale and the two rhythms over 16 governed concerns, and every React/Vue/Svelte/Angular pack resolves to it through a per-dialect resolver back to pixels. **The load-bearing rule is not the numbers: a pack must state its spacing explicitly** — inheriting a library default is what let four packs drift, and a library upgrade moves it again with no diff to review, so an unstated gap is a failure. Also fixed: a dropped `Container size:` on six packs, breadcrumb accessibility, malformed `package.json` in 7 of 13 packs (a Handlebars standalone-partial newline mismatch, in both directions — the new gate caught the mirror defect nobody had measured), and integer chart axes computed from the rows the chart is about to draw. **Ten waivers came true on rebase**, unprompted, when #2745 and #2748 merged.

## M-FT.22 — Optional fields on Angular and Svelte: FileRef imports, optional-VO guards, nullable form inputs — `done` ([#2782](https://github.com/Loom-Harness/Loc/pull/2782), merged 2026-09-07)

**Finding:** S9, corroborated independently by #2745 and #2750.

An optional field (`File?`, `Budget?`, `string?`, `int?`) made a generated frontend fail its own type-check — 3 errors on each Angular pack, 10 on each Svelte pack. Angular's `fieldInput` dispatched on the RAW field type, so every optional field fell to the plain-text fallback and a `File?` skipped its upload imports while the control was still typed `FormControl<FileRef | null>`. A read off an optional receiver now emits `p.budget?.amount` through a new `_frontend/optional-member.ts` seam on Angular, Svelte, React and Vue — **React and Vue emitted the identical dereference and passed only because `vite build` type-checks nothing**, which #2749 had just changed. Svelte's `FormValues<T>` strips the wire-level optionality that `createForm` seeds anyway; Angular's `wireTsType` maps the `File` primitive to `FileRef` on the response side only; `FileLink`'s two reads are offered to the target as optional reads, because Angular narrows no member chain across a signal call.

## M-FT.26 — .NET emitters: enum-typed value-object fields, orphan create validators, dead ambient kernel — `done` ([#2741](https://github.com/Loom-Harness/Loc/pull/2741), merged 2026-09-07)

**Findings:** review-D D-1 (blocker), D-2 (blocker), D-12.

`web/src/examples/erp/main.ddd` — the repo's flagship multi-file example — generated two .NET services that did not compile. `renderValueObject` built its `using` header only from the namespaces its rendered *expressions* reached and never looked at `vo.fields[].type`, so an enum-typed field emitted three unresolvable references (CS0246); `collectCsTypeUsings` is the type-side twin, collected rather than unconditional because CS8019 is fatal under `/warnaserror`. The DTO record and its validator asked different questions about whether a create exists, so an aggregate with no canonical create shipped an `AbstractValidator<Create<Agg>Request>` naming a record nobody wrote. And the whole root-level ambient kernel was emitted into every deployable — 26 files byte-identical modulo namespace across two services, and **D-1's blocker lived entirely in that dead code**. The prune answers reachability over the *emitted text* deliberately: a C# file cannot reference a type without naming it, whereas an IR walk would silently drop a live type the day a new emitter names one.

## M-FT.27 — Hono runtime hardening: sort whitelist, context typing, workflow failure logging, e2e project types — `done` ([#2742](https://github.com/Loom-Harness/Loc/pull/2742), merged 2026-09-09)

**Findings:** review D-2 (high), D-7, D-9, D-11, D-13, D-14.

`sortColumns[sort] ?? schema.x.id` is a bare index into an object literal, so it reaches `Object.prototype` and `??` guards neither — `?sort=constructor` bound a `Function` as the ORDER BY parameter and `?sort=__proto__` was a live **500**, confirmed against a running generated stack; the emitter's own comment asserted the safety property the code lacked. Two boundaries now: a declared `z.enum` on the contract (so the published OpenAPI names the accepted keys) and `Object.hasOwn` in the repository. Also: 218 identical 90-character casts around the Hono context replaced by one `declare module "hono"` block; `workflow_failed` added to the neutral `_obs` catalog and emitted at the right seam on four of five backends (**.NET is a recorded, pinned gap** — re-indenting its assembled handler body would silently drop every .NET workflow fragment from `--sourcemap`); the emitted `e2e/` project made to type-check for the first time for *any* system; `ETag`/`If-Match` finished (the header was parsed with a bare `Number()`, so a client echoing `"3"` correctly got a spurious 409); and 71 unencoded path-param interpolations routed through a new `seg()`.

## M-FT.31 — Artifacts and CLI parity: sequence participants, wire-spec enums, sourcemap size, generate warnings, Phoenix determinism — `done` ([#2744](https://github.com/Loom-Harness/Loc/pull/2744), merged 2026-09-07)

**Findings:** review-A D-8; review-D D-8, D-9, D-11, D-15. Review-A D-7 (the OpenAPI union document) deliberately deferred, with the analysis recorded: the defect is uniform across all five backends and is re-shaped by the union wire change M-FT.24 owns.

`generate system` is a pure function of its input again — `src/platform/elixir.ts` minted `SECRET_KEY_BASE` with `crypto.getRandomValues()` inside `composeService`, so regenerating in place always rewrote `docker-compose.yml` and **rotated the session key of a running dev stack**; it is now derived per (system, deployable). `.loom/sequence.mmd` declared its participants from a flat 3-kind loop while messages recursed over eleven, so lifelines were messaged and never declared — the participant set is now derived from the messages. `.loom/wire-spec.json` carried no enum constraints at all, so **removing an enum value — a breaking wire change — produced a byte-identical artifact**. `generate system` printed its AST warnings only inside an `errorCount > 0` branch and kept its own copy of the phase-⑦ printer, so it and `parse` disagreed about the same file in two ways. And `--sourcemap` inlined a complete copy of the source into every sidecar (763 KB against a 201 KB consolidated map); that is now opt-in behind `--inline-sources`.
