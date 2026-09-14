# Sweep fix plan — re-check against fresh `main`, then an Opus fleet

Re-verified against `main` @ `9e03c0ff` (233 commits after the sweep's
`619708fd`), toolchain reinstalled and rebuilt. Method: regenerate each
committed repro and grep the emitted source for the exact defect signature
(`sweep/reverify.mjs`, `sweep/reverify2.mjs` — both committed and re-runnable),
plus a real build+render re-check for the one finding whose source signature is
weak evidence on its own.

---

## 1. What is still a bug

**18 of 19 re-checkable findings still reproduce. One is fixed.**

| # | finding | status on `9e03c0ff` | evidence |
|---|---|---|---|
| F-002 | `decimal` compare in a repository `find` (node) | **STILL** | `heavierThan(limit: number)` → `gt(numeric-col, limit)`; drizzle types numeric as `string` |
| F-003 | `money` workflow param → missing `FormState` export (svelte) | **STILL** | imported by 1 page, never exported from `$lib/api/workflows` |
| F-004 | `string[]` → `FormControl(null)` (angular) | ✅ **FIXED** | now `new FormControl<string[]>([], { nonNullable: true })` |
| F-005 | `currentUser` row filter → unbound Ecto var (elixir) | **STILL** | bare `current_user` in the `where:` |
| F-006 | custom `find` → dangling Riverpod providers (flutter) | **STILL** | `thingAllProvider`, `thingHeavierThanProvider` used, never defined |
| F-007 | two forms on one page → duplicate bindings | **STILL** | 2 `useForm` calls both bound to `const form` in one scope |
| F-008 | mantine `Chart` unbalanced JSX braces (v7+v9) | **STILL** | emits `yAxisProps={{{ … }}` |
| F-009 | `toast()` in an action body | **STILL** (4 frontends) | react ✅ · **vue/svelte/angular/elixir: unresolved symbol** · flutter HONEST refusal |
| F-010 | vue `DestroyForm` binds `onDeleteProduct`, declares `deleteProduct` | **STILL** | 1 undeclared handler |
| F-011 | svelte `DestroyForm` emits `useDeleteProduct(() => )` | **STILL** | 1 empty arrow body |
| F-012 | angular input `error:` string literal breaks the attribute | **STILL** | nested `"` inside `[attr.aria-invalid]="…"` |
| F-013 | shadcnVue raw `<img>` → build-time asset import | **STILL** | `<img src="/logo.png">` in an SFC template |
| F-014 | primeng `[options]="["…"]"` | **STILL** | nested `"` inside the attribute |
| F-015 | HEEx component children → duplicate `title=` attribute | **STILL** | `title={…} title={…}` on the component call |
| F-016 | `.loom-icon` emitted by 15 packs, defined by 5 | **STILL** | missing in chakra v2/v3, mantine v7/v9, mui v5/v7, shadcn v3/v4, shadcnVue v1, vuetify v3 |
| F-018 | unknown `Button variant:` silently → `ghost` | **STILL** | `filled` and `wombat` both emit `variant="ghost"` |
| F-023 | bare-name `match` arm mis-parses, error points at `else` | **STILL** | same misdirected message |
| F-024 | `CodeBlock` pulls highlight.js from a public CDN | **STILL** | 1 emitted file references `cdn.jsdelivr.net` |
| F-025 | `decimal` → JSON number, `money` → string | **STILL** | `z.number()` vs `moneySchema` in the same route file |
| F-026 | .NET `#line` embeds the absolute `.ddd` path | **STILL** | 1 file per domain type |
| F-029 | Phoenix `Decimal.mult` on floats → 500 on every read | **STILL** | `Decimal.mult` emitted, zero `from_float` guards |
| F-030 | elixir workflow answers `202`+body, others `204` empty | **STILL** | node/dotnet/python = `204 empty`, elixir = `202/accepted+body` |
| F-031 | `mui@v5` renders a blank error boundary | **STILL** | **re-built and re-rendered on `main`**: build PASS, 4 DOM nodes, React #130 present |

**Honest-by-design, not bugs to fix** (but real capability gaps to track):
F-020 angular drops component children (inline comment in the emitted HTML),
F-021 feliz defers operation-dispatching components, F-022 HEEx refuses
`OperationForm` inside a component. All three still behave exactly as documented.

**Not re-verified this pass** (need a render or a pack sweep, deferred to the
fleet's own gates): F-017 badge full-width, F-019 spartanNg phone sidebar,
F-027 i18n key churn, F-028 elixir dependency advisories.

---

## 2. Why no gate caught any of this — fix these or it all comes back

Three structural holes. Every wave below closes one as it goes.

**Hole A — the render gate asserts nothing.** The emitted per-pack smoke spec
(`src/generator/_frontend/smoke-spec.ts:51`) asserts:

```ts
await expect(page.locator("body")).toBeVisible();
```

`<body>` is visible when React rendered *only an error boundary*. That is
precisely why `mui@v5` (F-031) is green on `generated-react-build`,
`react-e2e`, and every other gate in the repo while shipping a blank app — and
why the giant unsized icon (F-016) and the un-collapsing sidebar (F-019) are
invisible too. **One assertion change catches the whole class.**

**Hole B — the corpus has 76 fixtures and none of them carry the constructs
that broke.** The per-backend compile gates are real and they work; they were
simply never pointed at a `decimal` comparison in a `find`, a `money` workflow
param, two forms on one page, a `toast()` action body, an input `error:` with a
string literal, or a component invoked with children. Each fix below lands its
repro as a corpus fixture in the same PR.

**Hole C — the behavioral/wire-golden differential did not flag F-030.** Five
backends, one answer key, and yet elixir answers `202`+body to a workflow where
the other four answer `204` empty. Either the elixir leg does not exercise
workflows or there is a stale waiver. Worth one agent's investigation on its
own, because that differential is supposed to be exactly this check.

---

## 3. The fleet

**Model: Opus for every agent** — these are emitter-semantics changes across a
one-directional pipeline with a live merge queue; the failure mode of a cheaper
model here is a plausible-looking patch that moves the defect rather than fixing
it, which costs more than it saves.

**Wave width is governed by the CI budget, not by agent availability.** The org
runner pool is ~20 slots and a merge-queue candidate fans out to 22 wired gates;
`docs/ci-gating.md` is the authority. So independent one-line fixes are
**batched into one PR**, not split across a heroic number of agents. Ten agents
across five waves, never more than three PRs in flight.

**Every agent follows the repo's own rules, non-negotiably:**
1. `git fetch origin main && git switch -c <branch> origin/main` — fresh base, always.
2. **Open the draft PR first**, before writing code, naming the finding IDs and
   the files it will touch. That is the claim ticket; check open drafts first.
3. Fix **and** gate in the same PR. **Mutation-prove the gate**: revert the fix
   with a file copy (never `git checkout --`, per `experience_gathered.md` §84),
   show the gate fails, restore, show it passes. State the result in the PR body.
4. Run the matching gate locally (`docs/testing.md` reverse index). Never push to
   watch a check's verdict.
5. Mark ready only when green.

---

### Wave 1 — the render blind spot (2 agents, parallel)

The only wave that must go first: it makes every later render fix provable.

**A1 · `mui@v5` blank app + harden the smoke gate** — F-031, Hole A
- Files: the React shell's icon import site, `src/generator/_frontend/smoke-spec.ts`
- Fix the deep CJS default import (`@mui/icons-material/<Icon>`) that Vite
  resolves to a module object on v5. Then strengthen the emitted smoke spec:
  **no uncaught console error**, and the page rendered its own content (its
  heading / a non-trivial node count), not merely a visible `<body>`.
- Mutation proof: restore the old import → the hardened smoke must fail on
  `mui@v5` and pass on `mui@v7`.
- Expect fallout: the hardened assertion will also light up F-016 and F-019.
  That is the point — but it means **A1 must land with A2**, or land the
  assertion scoped to the packs already clean and widen it in Wave 2.
- Gate: `generated-react-build`, `react-e2e` (`LOOM_REACT_E2E_PACK=mui@v5`).

**A2 · pack CSS contract: `.loom-icon` and inline-display width** — F-016, F-017
- Files: `designs/*/*/theme.hbs` **only** (10 packs) — deliberately disjoint from A1.
- Add the `.loom-icon` / `.loom-icon svg` sizing rule the 5 correct packs already
  have; give `Badge`/`EnumBadge` an inline width contract so they stop stretching
  to the full column inside a `Stack`.
- Mutation proof: remove the rule from one pack → A1's hardened smoke (or a new
  per-pack CSS-contract test) fails for that pack.
- Gate: `test:contrast` sibling + the per-pack build gates.

---

### Wave 2 — pack template one-liners (1 agent, one PR)

**B1 · three independent pack template escapes** — F-008, F-013, F-014
- `designs/mantine/v{7,9}/primitive-chart.hbs` (one brace too many),
  `designs/shadcnVue/v1` image template (raw `<img>` → the pack's image
  component, so Vue's `transformAssetUrls` leaves it alone),
  `designs/primeng/v1` select template (escape the options expression).
- Three different pack directories, zero collision — one agent, one PR, one CI
  fan-out instead of three. F-008 in particular is a one-character fix on the
  **CLI's default pack**, so it is the best effort-to-impact ratio in the sweep.
- Gate: `generated-{react,vue,angular}-build` with those packs in the matrix.

---

### Wave 3 — frontend emitter defects (2 agents, parallel)

**C1 · port the react `toast` wiring to the four frontends that lack it** — F-009
- `react/toast-runtime.ts` + `uiUsesToastEffect` is the working reference; vue,
  angular and elixir emit nothing, and svelte emits `$lib/toast.svelte.ts` but
  never imports it into the page. One pattern, four targets — **one agent, one
  PR**, so the four end up with the same design and one reviewer.
- Gate: corpus fixture with a `toast()` action body, compiled on all six frontends.

**C2 · per-framework emitter bugs** — F-003, F-006, F-010, F-011, F-012, F-015
- svelte (`FormState` export, empty-arrow `DestroyForm`), vue (`onDelete*`
  handler name), angular (attribute escaping for `error:`), elixir/HEEx
  (duplicate `title=` on a component call), flutter (emit the `<agg>All` /
  `<agg><Find>` providers `reads.dart` skips).
- Six defects, five directories, no overlap with C1's files — but C1 touches
  vue/svelte/angular/elixir index emitters, so **C2 rebases onto C1** rather than
  racing it. If that serialisation is too slow, split C2 into C2a (svelte+vue)
  and C2b (angular+elixir+flutter) and run both after C1 lands.
- Gate: one corpus fixture per defect; the per-frontend build gates.

---

### Wave 4 — shared walker and backends (3 agents, parallel)

**D1 · two forms on one page** — F-007
- Shared form emission hoists both forms' bindings into one component scope.
  Affects react, vue and svelte, so fix it at the shared seam, not three times.
- Gate: corpus fixture with `CreateForm` + `WorkflowForm` on one page.

**D2 · validate `Button variant:` values** — F-018, plus the doc drift
- Add a `loom.*` diagnostic for an unrecognised *value* (the validator already
  rejects unknown argument *names*). Then fix
  `docs/language-reference/16-ui-walker-primitives.md`, which documents
  `variant: "filled"` — a value that is not in the supported set and silently
  renders a borderless text button.
- Gate: `diagnostic-catalog.test.ts` entry + a validator test.

**D3 · elixir backend trio** — F-005, F-029, F-030
- All three are the Phoenix backend and two of them touch serialization, so one
  agent, sequenced: bind `current_user` in Ecto queries → guard decimal
  arithmetic in `serialize/1` with `Decimal.from_float` (or keep the value a
  `Decimal` end-to-end) → align the workflow response with the other four
  backends' `204`. Then chase **Hole C**: why the wire-golden differential did
  not already fail on F-030.
- Gate: `behavioral-e2e-elixir` + the wire-golden differential, boot-verified
  with the `generated-stack-verifier` skill (compile-green is not enough here —
  F-029 is invisible until a real read).

---

### Wave 5 — policy, and closing the coverage hole (2 agents)

**E1 · the `decimal` wire policy** — F-025 · *needs a human decision first*
- `money` crosses the wire as a precision-preserving string; `decimal` crosses as
  an IEEE double. Two decimal types, two policies, undocumented. Changing it is a
  wire-contract change across five backends and six frontends — so this agent
  **writes the options and the blast radius and stops**, rather than picking.

**E2 · the long tail** — F-023, F-024, F-026, F-027, F-028
- Grammar: a bare-`NameRef` `match` arm (at minimum, a diagnostic that points at
  the arm instead of at `else` two lines later). `CodeBlock`'s public-CDN
  dependency (vendor it, or make it opt-in and say so). .NET `#line` pragmas →
  repo-relative paths, which also makes .NET output reproducible. The i18n key
  churn and the elixir advisory notice are notes, not necessarily changes.

**Running through every wave — Hole B.** Each agent lands its repro from
`sweep/repro/` as a `test/fixtures/corpus/` fixture in the same PR, with the
manifest entry. That is what stops the next sweep from finding the same class
again, and it is cheap because the repro files already exist and already parse.

---

## 4. Sequencing at a glance

```
Wave 1  A1 mui@v5 + harden smoke gate        ─┐ must land together
        A2 pack CSS contract (.loom-icon…)   ─┘ (A1's gate fails without A2)
           ↓
Wave 2  B1 three pack template one-liners      (independent, cheapest win)
           ↓
Wave 3  C1 toast wiring → 4 frontends
           ↓  (C2 rebases on C1 — shared index emitters)
        C2 per-framework emitter bugs          (or C2a/C2b in parallel)
           ↓
Wave 4  D1 two-forms seam ─┬─ parallel, disjoint files
        D2 variant gate    │
        D3 elixir trio    ─┘
           ↓
Wave 5  E1 decimal wire policy (decision memo, no code)
        E2 long tail
```

Never more than three PRs in flight, so the merge queue stays inside its checks
timeout and the fan-out fits the runner pool.

## 5. If you only fund one wave

**Wave 1 + B1.** That is three PRs and it buys: the CLI's default pack stops
emitting unparseable TSX, `mui@v5` stops shipping a blank app, icons stop
rendering 900px tall on ten packs — and the render gate stops being blind, which
is what let all of it ship in the first place.
