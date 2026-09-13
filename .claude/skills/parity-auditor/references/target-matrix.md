# Target matrix — the registry→matrix map and per-axis gate index

The roster every parity audit is built on, derived from the live registry, plus a
per-feature-axis index pointing at the authoritative validator gate set for each
row. **Always re-read the cited files on fresh `main` — this doc is a map, not the
source of truth. The gate sets move; the line numbers especially drift.**

> **Rewritten 2026-09-10** (Wave C0.4 of `docs/new-plan/completion-waves-2026-09.md`).
> The previous revision was frozen at **four frontends** and cited the **`ashPhoenix`**
> HEEx pack, which no longer exists. Two whole targets — **Feliz** (F#/Fable/Elmish)
> and **Flutter** (Dart/Riverpod) — were missing from the roster entirely, which is
> the worst shape a parity map can be in: an audit built on it would report a matrix
> with two columns silently absent. It also carried the retired
> `elixir { foundation: vanilla }` clause and five `PlatformSurface` hooks that were
> removed with the reserved-stub cull. Every table below was re-derived from the
> code named in its own cells.

## Contents
- [1. The target roster (from the registry)](#1-the-target-roster-from-the-registry)
- [2. The corpus backend keys (the test matrix)](#2-the-corpus-backend-keys-the-test-matrix)
- [3. Where the gates live](#3-where-the-gates-live)
- [4. Per-axis gate index — backends](#4-per-axis-gate-index--backends)
- [5. Per-axis gate index — frontends](#5-per-axis-gate-index--frontends)
- [6. The design-pack roster](#6-the-design-pack-roster)
- [7. Registers that hold the live gap counts](#7-registers-that-hold-the-live-gap-counts)

---

## 1. The target roster (from the registry)

The single source of truth is `src/platform/registry.ts` — the `platforms`
`Record<Platform, PlatformSurface>` map and the `inTreeBackends`
`DiscoveredBackend[]` array (backends resolve by `family@version`, so the set can
grow via packages under `packages/backend-*`). `src/platform/surface.ts` defines
the `PlatformSurface` contract each carries (`emitProject` / `composeService` /
`needsDb` / `defaultPort` / `mountsUi`).

**THE MATRIX IS FROZEN.** Owner decision 2026-07-17: there will be no more
backends and no more frontends (`docs/audits/direction-review-2026-07.md`, and
track T10 whose every heading is `frozen`). A parity audit is therefore over a
**closed** 5 × 6 set — an unimplemented cell is a gap to drain, never a target to
add.

### Backends (domain-logic, 5 families)

| Family | `platform:` id | Versions registered | Stack |
|---|---|---|---|
| Hono / TS | `node` | `node@v5` (default, zod 4 / TS 6) + `node@v4` (zod 3 / TS 5, pinnable) | Hono + Drizzle |
| .NET | `dotnet` | `dotnet@v10` | ASP.NET + EF Core + Mediator |
| Java | `java` | `java@v1` | Spring Boot + Spring Data JPA |
| Python | `python` | `python@v1` | FastAPI + SQLAlchemy 2 |
| Phoenix | `elixir` | `elixir@v1` | LiveView + **plain Ecto/Phoenix** (the only emission) |

`node` is the only **versioned-package** backend (`src/platform/hono/vN/`); the
other four are thin `src/platform/<name>.ts` surfaces over
`src/generator/<name>/`. The legacy `phoenix`/`phoenixLiveView` and `fastapi`
aliases were retired — `elixir` and `python` are the only spellings.

**The `foundation:` axis is GONE.** The Ash foundation was removed in favour of
plain Ecto/Phoenix, and the knob was removed with it — `elixir { foundation: … }`
**no longer parses at all**. So `elixir` is one column, not a foundation split;
event-sourcing, `shape: document` and provenance all ship on it. Historical Ash
mentions survive in `docs/old/plans`, `docs/audits` and `docs/old/proposals` as
the migration record, not as current behaviour.

### Frontends (6, and the HEEx render path is the elixir backend's own)

| Frontend | `platform:` | Generator | Walker target | Default pack | Walker core |
|---|---|---|---|---|---|
| React | `react` (+ `static` alias) | `src/generator/react/` | `react/walker/tsx-target.ts` | `mantine@v7` | shared `walkBody` |
| Vue | `vue` | `src/generator/vue/` | `vue/walker/vue-target.ts` | `vuetify@v3` | shared `walkBody` |
| Svelte | `svelte` | `src/generator/svelte/` | `svelte/walker/svelte-target.ts` | `shadcnSvelte@v1` | shared `walkBody` |
| Angular | `angular` | `src/generator/angular/` | `angular/walker/angular-target.ts` | `angularMaterial@v1` | shared `walkBody` |
| **Feliz** | `feliz` | `src/generator/feliz/` | `feliz/feliz-target.ts` (emits **F#**, not JSX) | none — `feliz/pack.ts` is procedural | shared `walkBody` |
| **Flutter** | `flutter` | `src/generator/flutter/` | `flutter/flutter-target.ts` (emits **Dart**) | none — `flutter/pack.ts` is procedural | shared `walkBody` |
| Phoenix HEEx | (the `elixir` backend's LiveView render path) | `src/generator/elixir/` | `elixir/heex-target.ts` | `coreComponents@v3` | **parallel** `heex-walker-core.ts` |

Defaults read off each generator's `deployable.design ?? …` (react `index.ts:159`,
vue `:152`, svelte `:128`, angular `DEFAULT_DESIGN`, elixir `index.ts:77`).

**SIX targets consume the shared walker core** (`src/generator/_walker/walker-core.ts`,
`walkBody`) through the `WalkerTarget` seam — including Feliz and Flutter, which
emit F# and Dart rather than markup and ride the walker through the seam object.
**Phoenix HEEx does NOT use `walkBody`** — it runs a parallel engine
(`heex-walker-core.ts`) because LiveView's output topology diverges (inline
lambdas vs hoisted `handle_event` clauses, `.map` vs `for`-comprehensions,
ternary vs `if`-block children); `heexTarget` is mainly a conformance shim. It
dispatches off the *same* `WALKER_PRIMITIVES` table, so there is no second
primitive list to drift.

**Feliz and Flutter are the two that per-pack gates structurally cannot see.**
Neither has a `.hbs` pack pipeline: each self-hosts through its own toolchain
(`dotnet fable` + vite / the Flutter SDK) and each hosts only its own framework,
where react/vue/svelte/angular are static-bundle hosts that dispatch by the ui's
`framework:` via `src/platform/frontend-dispatch.ts` (a react host can serve a
`framework: vue` bundle). **This is the single most productive place to look for
a silent gap**, because the per-pack build matrices that catch drift on the four
static-bundle frontends do not run over these two at all. Flutter additionally
builds native Android/iOS from the same Dart source via its Makefile
(`make apk`/`ipa`), which compose does not serve.

`static` shares the React surface (it is React's UI-only deployable alias).

## 2. The corpus backend keys (the test matrix)

`test/fixtures/corpus/backends.ts` is the canonical machine-readable key set the
compile/generation tiers iterate — reuse it instead of hand-listing:

```ts
BACKENDS = ["node", "dotnet", "java", "python", "vanilla"]
PLATFORM_CLAUSE = {
  node: "node", dotnet: "dotnet", java: "java", python: "python",
  vanilla: "elixir",            // <- a BARE clause; `foundation:` no longer parses
}
```

The `vanilla` key is a historical *name* for the elixir column, not a foundation
selector — `PLATFORM_CLAUSE.vanilla` is the bare string `"elixir"`. A
platform-agnostic corpus `.ddd` writes `platform: __PLATFORM__`; the harness swaps
the token (see `references/silent-vs-honest-gap.md` §run-it for the harness API).

## 3. Where the gates live

The validator is the contract. The files that hold the cross-backend gate sets:

- **`src/ir/validate/checks/system-checks.ts`** — the bulk: persistence,
  inheritance, capability filters, provenance, audit, event-sourcing.
- **`src/ir/validate/checks/structural-checks.ts`** — payload/query surface:
  unions, generic carriers, the `when` gate, exception-less returns.
- **`src/util/platform-axes.ts`** — `PLATFORM_SAVING_SHAPES` (the `shape: …`
  capability map), read by both the validator and the generator persistence
  adapters.

Each gate is a `const FOO_BACKENDS = new Set([...])` (or `Partial<Record<Platform,
…>>`) literal, consulted by a `validate…Support` / `validate…Backend` fn wired
into `validateLoomModel` in **`src/ir/validate/validate.ts`** (a thin orchestrator
over ~17 leaf modules under `checks/`). To re-derive the whole index on fresh
`main`:

```
rg -n "_BACKENDS|_CAPABLE|_FAMILIES|new Set\(\[" \
   src/ir/validate/checks/system-checks.ts src/ir/validate/checks/structural-checks.ts
rg -n "validate\w+Support|validate\w+Backend" src/ir/validate/validate.ts
```

> `structural-checks.ts` carries a raw NUL byte (M-T9.53), so `grep` treats it as
> binary and prints `Binary file matches` instead of the line. Use `grep -a` or
> `rg`, or you will read "no gates here" off a file full of them.

## 4. Per-axis gate index — backends

Each row: the feature axis → the named gate set + the file it lives in. **Read the
current set membership; do not trust the membership below — it is a fresh-main
snapshot that will drift.** The membership column is a 2026-09-10 reading.

| Feature axis | Gate set / fn | File | Membership then |
|---|---|---|---|
| Event-sourced storage `persistedAs: eventLog` | `EVENT_SOURCING_BACKENDS` | `system-checks.ts` | all 5 |
| TPH inheritance `inheritanceUsing: sharedTable` | `TPH_CAPABLE` | `system-checks.ts` | all 5 |
| TPC inheritance `inheritanceUsing: ownTable` | (universal — no gate) | — | — |
| `shape: document` / `shape: embedded` | `PLATFORM_SAVING_SHAPES` → `validateSavingShapeSupport` | `platform-axes.ts` / `system-checks.ts` | per-platform map |
| Discriminated unions (`A or B` / `T option`) | `SUPPORTED_UNION_BACKENDS` | `structural-checks.ts` | all 5 |
| Generic carriers (`paged<T>`, `envelope<T>`) | `SUPPORTED_PAGED_BACKENDS` | `structural-checks.ts` | all 5 |
| `when` canCommand gate + `can_<op>` query | `SUPPORTED_WHEN_BACKENDS` | `structural-checks.ts` | all 5 |
| Exception-less returns (`op(): X or NotFound`) | `SUPPORTED_RETURN_BACKENDS` | `structural-checks.ts` | all 5 |
| Capability `filter` (relational / principal / non-relational) | `DOMAIN_FAMILIES` → `validateContextFilterSupport` | `system-checks.ts` | all 5 (`loom.context-filter-unsupported`) |
| Provenanced fields | `PROVENANCE_BACKENDS` | `system-checks.ts` | all 5 |
| Per-operation `audited` | `AUDIT_OP_BACKENDS` | `system-checks.ts` | all 5 |
| Audited **lifecycle** (`audited create`/`destroy`) | `AUDIT_LIFECYCLE_BACKENDS` | `system-checks.ts` | all 5 |

**A full-membership set is a LATENT SEAM, not a shipped feature × target claim.**
Most of these read "all 5" now, which means the code that names the gap can only
fire when *no* backend deployable hosts the context — the register calls that a
latent row, and `src/diagnostics/unsupported-register.ts` says so per row. Do not
report a latent row as a live gap, and do not report the absence of one as
coverage: a target inside the set can still be silently wrong, which is what the
runtime tiers are for.

**Watch for the elixir capability branch.** Some gates read
`FOO_BACKENDS.has(p) || (p === "elixir" && elixirFooCapable)`. With the foundation
axis gone this resolves to one `✓ elixir` / `✗ elixir` cell. Read the actual `||`
clause, do not assume.

**Watch for the silent-gap pattern.** A target *absent* from a gate set is only
honest if the emitter also errors. The historical 🔴 (backend audit finding F1)
was Python absent from the capability-filter set *and* the Python generator never
consuming `contextFilters` → a silent correctness hole. That one is fixed on fresh
`main`, which is itself the proof that you must re-read rather than trust this doc.

## 5. Per-axis gate index — frontends

Frontend parity is enforced (or not) at four layers — audit them in this order
(per `docs/audits/frontend-parity-audit-2026-06.md` §Method):

1. **Validator surface** — `src/language/walker-stdlib.ts`, re-exporting the name
   sets from `src/util/walker-primitive-names.ts` (the closed set of ~55 page
   primitives the validator accepts; a page that type-checks here is legal against
   *any* target). Pinned by `walker-stdlib-completeness.test.ts`.
2. **Walker-target contract** — `src/generator/_walker/target.ts` (`WalkerTarget`:
   the required + optional framework-shaped seams — state read/write, helper
   imports, navigation, api-call lowering, `match` rendering, plus the markup
   seams). A frontend reaches parity by implementing the required seams; optional
   seams are *intended* idiom divergence (Angular forks all forms into Reactive
   Forms), not gaps.
3. **Primitive dispatch table** — `src/generator/_walker/registry.ts`
   (`WALKER_PRIMITIVES`): each primitive carries a `tsx` renderer and *optionally*
   a `heex` one. `test/generator/elixir/heex-parity.test.ts` freezes the TSX-only
   set, so a TSX-only addition fails CI until you write the `heex` renderer or pin
   the name with a reason.
4. **Pack required-set gate** — `src/generator/_packs/required-primitives.ts`
   (`REQUIRED_PRIMITIVES`, keyed `PackFormat | "flutter" | "feliz"`): the load-time
   check that a pack ships every template its format needs.

**`REQUIRED_PRIMITIVES.heex` is `{ core: [], shell: HEEX_SHELL }` — and that is
not a hole.** HEEx packs own **no per-call-site primitive templates**: LiveView has
one component convention, so the walker emits design-neutral markup plus
`<.button>` / `<.table>` / `<.input>` / `<.modal>` component calls inline, and the
entire design vocabulary lives in the **shell** surface — `core-components` (the
function-component library every page renders through, → `core_components.ex`),
the layouts (`main` → `root.html.heex`, `app-shell` → `app.html.heex`,
`sidebar`(+`-entry`) → `sidebar.ex`), the `theme` token CSS, and the assets
pipeline (`assets-css` / `assets-js` / `tailwind-config` / `package-json` →
`assets/`, built into `priv/static/assets`). A HEEx pack with call-site primitive
templates would be dead weight — the walker never dispatches into them. That the
two HEEx packs genuinely diverge is gated by
`test/generator/elixir/heex-design-pack.test.ts`.

The classic frontend **silent gap** is a *seam between layers 1 and 4*: a primitive
the validator accepts (layer 1) that is absent from a pack's required set (layer 4)
and whose `tsx` emitter calls `pack.render(...)` with no `templates.has` guard — so
it passes validation but **crashes codegen** on the pack that lacks the template.
The `Section`/`Sticky` finding (frontend audit finding 1) is the canonical example;
the fix is to ship the `.hbs` and add the name to the required set, so the
load-time gate names the pack instead of crashing mid-generation.

**The Feliz/Flutter analogue of layer 4** is not a pack manifest — both are
procedural (`src/generator/feliz/pack.ts`, `src/generator/flutter/pack.ts`), so an
unrendered primitive shows up as a give-up comment rather than a load-time refusal.
The registers that hold those are `src/util/flutter-deferred-primitives.ts`
(`FLUTTER_UNRENDERED_PRIMITIVES`) and the `KNOWN_FLUTTER_GAPS` freeze in
`test/generator/flutter/parity-freeze.test.ts`.

## 6. The design-pack roster

Read it off `BUILTIN_PACK_FORMATS` + `BUILTIN_PACK_LATEST` in
`src/util/builtin-formats.ts` — a single source both pack loaders and the validator
consult, so it cannot drift from what actually loads. **13 families, 17 versions**
as of 2026-09-10; the bareword `design: <family>` resolves to the `LATEST` entry.

| Format | Families (→ bareword default) |
|---|---|
| `tsx` (React) | `mantine` → v9 (v7 pinnable) · `chakra` → v3 (v2) · `mui` → v7 (v5) · `shadcn` → v4 (v3) |
| `vue` | `vuetify` → v3 · `shadcnVue` → v1 |
| `svelte` | `shadcnSvelte` → v1 · `flowbite` → v1 |
| `angular` | `angularMaterial` → v1 · `primeng` → v1 · `spartanNg` → v1 |
| `heex` | **`coreComponents` → v3** (baseline, the Phoenix core-components layer) · **`daisyui` → v1** |

**`ashPhoenix` NO LONGER EXISTS.** It was the HEEx pack's old name (unrelated to
the removed Ash *foundation*) and has been replaced by the two above. Any doc, test
or audit still naming it is stale — that string is a useful grep for finding other
frozen-era prose.

`primeng` and `spartanNg` **ship** (they are in `BUILTIN_PACK_FORMATS`, and
`pack-spacing-contract.test.ts` measures all 15 pack versions it covers) — the old
"grammar-reserved but unshipped" note was wrong. Feliz and Flutter have no `.hbs`
pack pipeline at all, so they appear in no row of this table.

## 7. Registers that hold the live gap counts

Never hand-count a gap. §1 of `docs/new-plan/completion-waves-2026-09.md` lists
every register with the file that computes it; the ones a parity audit reads:

| What | Where |
|---|---|
| Every honest `loom.*-unsupported` row, classified `gap` / `scope` / `seam` | `src/diagnostics/unsupported-register.ts`; the pin is `MAX_OPEN_GAPS` in `test/system/unsupported-register.test.ts` |
| Flutter form-field freeze | `KNOWN_FLUTTER_GAPS`, `test/generator/flutter/parity-freeze.test.ts` |
| Flutter unrendered primitives | `FLUTTER_UNRENDERED_PRIMITIVES`, `src/util/flutter-deferred-primitives.ts` |
| HEEx parity pins | `KNOWN_HEEX_GAPS`, `test/generator/elixir/heex-parity.test.ts` |
| Deferred user-component shapes (feliz / angular / flutter) | the `loom.user-component-deferred-target` pins |
| Cross-target ledger, per row and priority | `docs/audits/targets-completeness-2026-08-30.ledger.json`, counted by `node scripts/ledger-counts.mjs` |
| Which feature × target cells are compile-only vs runtime-proven | the gate ledger, `LOOM_LEDGER_REPORT=1` over `test/_helpers/gate-ledger.ts` |
| Cross-pack spacing / chrome deviations | `KNOWN_DEVIATIONS` + `KNOWN_STRUCTURAL_DEVIATIONS`, `test/generator/_packs/pack-spacing-contract.test.ts` |

Each of these is a **ratchet**: an entry asserts the target still fails, so a fix
must delete its entry in the same PR. A stale entry fails the gate — which means a
register that is green is telling you something, and a register you had to widen
is telling you more.
