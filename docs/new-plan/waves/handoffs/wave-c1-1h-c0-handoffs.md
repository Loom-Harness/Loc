# Wave C1 — packet 1h hand-off: the five Wave C0 hand-offs

*Branch `claude/c1-1h-c0-handoffs` (5 commits on `main` + Wave C0, merged in from `claude/loom-review-planning-adz0n4` for 0.2e's `run-java.mjs` daemon change). Every row verified by GENERATING on this tree first; two of the five turned out to be a different defect than the note described, and both are written up as what they actually are.*

## Row table

| row | source | disposition | evidence |
|---|---|---|---|
| 1 · c7 hono browser pino envelope | `wave-c0-playground-conformance.md` | **fixed + gated** | the emitted `obs/log.ts` carried no `browser` block; measured against the real `pino/browser.js` 10.3.1 |
| 2 · elixir E5 `dir=""` arithmetic crash | `wave-c0-schemathesis.md` | **fixed + gated**, and it is NOT the paging reader | the crash is a scaffolded list page calling `list_<agg>s(<a filter's value>)` |
| 2b · the other five elixir clusters | same | **triaged, 2 missions minted** | E1 waiver · E2/E3/E4 all downstream of one base-path mismatch |
| 3 · java workflow primitive-param boxing | `wave-c0-schemathesis.md` follow-up 2 | **fixed + gated + corpus fixture** | `TopUpRequest(int qty, …)` vs its own `RequiredSet` |
| 4 · Gradle daemon on the java corpus/build legs | `wave-c0-behavioral-java.md` follow-up 1 | **2 of 3 applied, 3rd refused with a reason** | measured ~3.9x locally in `gradle:9-jdk25` |
| 5 · `ashPhoenix` in `.claude/skills/**` | `wave-c0-plan-hygiene.md` "flagged, out of fence" | **fixed** | 3 files; the 2 remaining strings are the deliberate record |

---

## Row 1 — the generated hono backend's browser-mode pino envelope (c7)

**Reproduced** on this tree: `node bin/cli.js generate system examples/acme.ddd` → `catalog_web/obs/log.ts` has no `browser` key at all.

pino's browser build reads `opts.browser.formatters`, never the top-level `formatters` the generated file sets, and without `browser.asObject` it takes the bare `write.apply(proto, args)` path — so a per-request child logger calls `console.info({request_id}, {event, …})`: two arguments, no `level`, no `ts`. Wave C0 fixed the CONSUMER (`web/src/util/log-line.ts`); this is the producer.

Now emitted (`src/platform/hono/v4/observability-builder.ts`; hono v5 reuses v4's emitters, so both packages are fixed):

```ts
browser: {
  asObject: true,
  formatters: {
    level: (label) => ({ level: label }),
    log: (line) => { const rest = { ...line }; delete rest.time; return { ts: new Date().toISOString(), ...rest }; },
  },
},
```

The `log` formatter exists because browser.js keys its timestamp `time` and fills it from the TOP-LEVEL `timestamp`, which on this backend is the node build's serialized `,"ts":"…"` fragment — unusable as a value.

**Measured against the real `pino/browser.js` (10.3.1, the v5 pin), same child logger:**

```
BEFORE  console.info argc=2  {"request_id":"req-1"} {"event":"request_end","method":"GET",…}
AFTER   console.info argc=1  {"ts":"…Z","level":"info","request_id":"req-1","event":"request_end",…}
```

Gate `test/platform/hono/observability-browser-envelope.test.ts` (3 cases) does not spell-check a string: it slices the emitted `browser` literal out of the source, evaluates it, and runs the two emitted formatters against the exact intermediate object browser.js's `asObject()` builds. The emitted literal is deliberately annotation-free so it stays valid JS for that.

*Mutation proof* (file-copy revert): the `browser` block deleted from the emitter → all 3 fail on `AssertionError: obs/log.ts emits a \`browser:\` pino option block: expected -1 to be greater than -1`.

Also refreshed: `test/fixtures/baseline-output/catalog_web/obs/log.ts` (the only file the fix drifts).

**No corpus fixture.** `obs/log.ts` is emitted unconditionally for every hono project (`emit.ts:1100`), so every existing node-platform fixture already carries the shape; a new `.ddd` would pin nothing new.

---

## Row 2 — elixir E5: the crash is not in the paging reader

**Verify-first changed the answer.** The note reads `GET /wallets?page=1&pageSize=1&dir=` → `ArithmeticError :erlang.-("", 1)`, which points at `page_param`/`offset = (page - 1) * page_size`. On this tree that path is sound: `page_param` (`vanilla/page-param.ts`) parses `""` to the default and 422s an out-of-range value, and every controller call site goes through it. The crash is somewhere else entirely.

**Actual root cause.** `scaffoldList` builds the list region as a `match` — one arm per bar-eligible repository `find`, falling back to the paged `all`. The HEEx walker recorded one `QueryBinding` per arm but dropped WHICH read the arm named, and `handle_params` emitted `list_<agg>s(<that arm's args>)` for all of them:

```elixir
case PhoenixApp.Storefront.list_wallets(socket.assigns.by_owner_owner) do
```

`defdelegate list_wallets(page \\ 1, page_size \\ 20, …)` makes that arity legal, so the filter's unset `""` landed in `page` and `list/4` opened with `offset = ("" - 1) * page_size`. **Every load of a scaffolded Phoenix list page with a filter bar 500s** — in a browser, not only under the fuzzer.

Second half of the same bug: the arms were UNGATED, so all of them ran on every `handle_params` into the same assign and the last write won. The filter bar could not work even with the call fixed — and the filter read only reached the repository because it ran with its own unset value.

Fix: `QueryBinding` gains `retrieval` (→ `<find>_<agg>`, the context function `context-emit.ts` already emits) and `gate` (the enclosing `match` arm's condition, handler-position, carrying the negation of every earlier arm so `cond`'s first-match-wins holds).

```elixir
socket =
  if (socket.assigns.by_owner_owner != "") do
    case PhoenixApp.Storefront.by_owner_wallet(socket.assigns.by_owner_owner) do
…
socket =
  if (!(socket.assigns.by_owner_owner != "")) do
    case PhoenixApp.Storefront.list_wallets(socket.assigns.page_num, 10, …) do
```

An unfiltered list page is byte-identical (no gate, no rename) — pinned as its own case.

Gate `test/generator/elixir/scaffold-list-filter-find-call.test.ts` (6 cases), sibling of `scaffold-list-find-all-arity.test.ts` (same defect class: a call site nothing compared against its `defdelegate`), and it makes that comparison explicitly.

*Mutation proofs* (file-copy revert):
- `readFn` forced back to `list_<agg>s` → 3 failures, first `expected [ 'list_orders', 'list_orders' ] to deeply equal [ 'by_code_order', 'list_orders' ]`.
- the `gate` wrapper disabled → 2 failures, first `expected 'def handle_params(…' to match /if \(socket\.assigns\.by_code_code !=…/`.

### The other five clusters — triage

Static, on the emitted `storefront-elixir` tree; the cell was not re-booted (needs docker + hex + postgres), so each row says what it rests on.

| cluster | shape | disposition |
|---|---|---|
| E1 `TRACE` → 501 ×29 | below the app — the web server refuses the method before any route | **waiver shape**, on any backend |
| E2 non-uuid `{id}` → `Ecto.Query.CastError` ×7 | the CONTROLLER guards it (`plug :__cast_path_id` → 422); the LiveView detail route does not (`get_wallet(socket.assigns.id)` straight into `Repo.get/2`) | **defect** → **M-T6.71** (open, P2) |
| E3 undeclared success content-type ×7 | LiveView answers `text/html` for a path the contract describes as JSON | **harness shape**, see below |
| E4 wrong-verb 405 ×6 | the router's `match :*, "/*path"` catch-all answers 404 where the others 405 | **harness shape**, same cause |
| E5 | above | **fixed** |

**E3 and E4 share one cause, and it is the cell's real finding.** `vanilla/openapi-emit.ts:827` emits `servers: [%Server{url: "/api"}]` and the router mounts the API under `scope "/api"`. Elixir is the **only** backend that declares a `servers` entry — node/python/dotnet/java publish none. The harness passes schemathesis `--url http://127.0.0.1:<port>` (`schemathesis-core.mjs:171`), which REPLACES the server base, path included, so every fuzzed request loses `/api` and lands on the LiveView/HTML scope. That is also how E5 was reachable over HTTP at all. Minted as **M-T6.70** (open, P1, ⚠ verify-first) with the two candidate fixes; until one lands the cell is not making statements about the elixir API surface and must stay `discovery: true`. **The elixir cell is not made binding here** — as the C0 note asked.

---

## Row 3 — java workflow primitive params (RS-26)

**Reproduced:** `workflow topUp { create(qty: int, flag: bool, note: string) }` emitted

```java
public record TopUpRequest(int qty, boolean flag, @NotNull String note) {}
new RequiredSet("TopUpRequest", List.of("flag", "note", "qty"))
```

— the contract publishing three required fields the DTO could enforce one of. C0's F32 left the primitives unboxed on the reasoning that "a PRIMITIVE component gets no `@NotNull` — it can never be null". True of the annotation, wrong about the conclusion: the fix is to BOX so the annotation has a null to test, which is what `dto.ts` already does for an operation's params. Unboxed, a missing key bound to `0`/`false` and the workflow ran on a value the caller never sent.

Now: `public record TopUpRequest(@NotNull Integer qty, @NotNull Boolean flag, @NotNull String note)`. Already-reference-typed params (decimal → `BigDecimal`, datetime → `String`, enums, `@Valid MoneyRequest`) unchanged; an OPTIONAL param stays unannotated; the aggregate CREATE body keeps its own inverse rule (absence there means the declared default, RS-6) and the test pins that so the two cannot be collapsed later.

Gate `test/generator/java/workflow-primitive-param-boxing.test.ts` (5 cases) also cross-checks every field the emitted `RequiredSet` publishes against a component whose type can actually be null.

*Mutation proof* (file-copy revert): boxing removed →
- `expected [ '@NotNull String holder', …(8) ] to include '@NotNull Integer qty'`
- `flag is published required but its type \`boolean\` cannot be null: expected 'b' to be 'B'`

(The second assertion was added *because* the first mutation run showed the contract cross-check passing on `@NotNull int qty` — a check that did not reach the thing it named.)

**Corpus fixture** `test/fixtures/corpus/workflow-primitive-params.ddd` + manifest row (`backends: ALL`): the shape no fixture carried, with every param kind in one `create`, so all five compile legs build it. Signed into `gate-ledger.test.ts`'s `BEHAVIOURAL_ABSENT` with its reason — the question is what a body OMITS, and a `test e2e` workflow call is type-checked against the declared params, so an absent required field is not expressible there.

`wire-boundary-null-skip.test.ts`'s F32 case asserted the superseded rule and is rewritten here, per the waiver-ratchet convention.

---

## Row 4 — the Gradle daemon on the java corpus/build legs

**Measured, not projected.** A generated `core-domain` java project, built back to back inside ONE `gradle:9-jdk25` container (the image the pairwise leg uses), warm dependency cache, `clean` between runs:

```
--no-daemon   21.3 / 17.4 s
daemon         6.0 /  4.1 / 4.9 s
```

~3.9x, matching 0.2e's ~4.1x on a different fixture and a different harness; `gradle --status` showed ONE daemon serving all seven builds.

`corpus-java-build.test.ts` and `generated-java-build.test.ts` now share `test/e2e/support/gradle.ts` — 0.2e's exact flags, spelled once (a differing `-Dorg.gradle.jvmargs` forks a second daemon and hands the cold-start cost straight back), plus `stopGradleDaemon()` in an `afterAll`.

**`pairwise-corpus-java.test.ts` keeps `--no-daemon`, with the reason in the file.** It runs each fixture in its own `docker run --rm`, so a daemon dies with the container that started it and the next fixture has nothing to reuse; the whole win comes from one daemon serving many projects. Making that leg benefit means reusing one long-lived container across fixtures — a different change with a different failure mode (build state leaking between fixtures), not a flag swap.

The 20-minute cap on `java-build.yml` is **not** retightened: 0.2e's sizing rule wants a recorded p95 over >= 10 post-change runs. The measurement is in the workflow header for whoever tightens it. `test/e2e/support/gradle.ts` added to `java-build.yml` and `corpus-build.yml` trigger paths so a change to the shared invocation reaches the gates it governs.

---

## Row 5 — `ashPhoenix` under `.claude/skills/**`

Three files, and two of them built guidance on the dead name: `design-pack-author` told an author to copy `designs/ashPhoenix/v3` as "the ONLY HEEx pack" and described its layout as "`SHARED_PRIMITIVES` core + `SHARED_SHELL`". Both halves are wrong — `ls designs/` gives `coreComponents/v3` and `daisyui/v1`, and `REQUIRED_PRIMITIVES.heex` is literally `{ core: [], shell: HEEX_SHELL }` because LiveView has one component convention (the walker emits `<.button>`-style calls inline, so a HEEx pack owns the SHELL surface, not call-site primitive templates). Rewritten from `required-primitives.ts` + both `pack.json`s, and pointed at `heex-design-pack.test.ts`, which fails a new pack that copies an existing one.

`language-feature-developer`'s pack list corrected the same way (it also missed primeng/spartanNg, and that Feliz/Flutter have no `.hbs` pipeline).

The two remaining `ashPhoenix` strings under `.claude/skills/` are `parity-auditor`'s, and they **stay**: that file records that the pack no longer exists and offers the string as a grep for other frozen-era prose. It just worked.

---

## Handed off

| # | finding | where |
|---|---|---|
| h1 | the elixir cell's base-path mismatch (E3/E4, and E5's reachability) | **M-T6.70**, `docs/new-plan/T6-backend-parity.md` |
| h2 | a non-UUID id in a LiveView route raises `Ecto.Query.CastError` (500) where the controller answers 422 (E2) | **M-T6.71**, same file |
| h3 | `phoenix/README.md` still says the shared HEEx slot is read "for a HEEx-format pack (currently only `ashPhoenix`)" and that "the ashPhoenix pack ships its shell files directly" — the same stale name, one directory outside row 5's fence | out of fence (`.claude/skills/**` only); one-line docs fix |
| h4 | `pairwise-corpus-java.test.ts` can only get the ~4x by reusing one container across fixtures | reason recorded in the file; own slice |
| h5 | the java-build cap (20 min) is now oversized by ~4x on the tier step, but the sizing rule wants >= 10 post-change runs | re-derive with `node test/behavioral/ci-budget-report.mjs` |

## Gates (this tree)

`npx tsc -b` clean · `node scripts/test-typecheck.mjs` OK (182 files / 470 errors, unchanged, src/ clean) · `npm run lint` 0 errors / 21 pre-existing warnings · `node docs/build.mjs` OK · `node scripts/mission-counts.mjs --write` (README region rewritten; `mission-counts.test.ts` 6/6).

Suites: `test/platform/hono` + `test/generator/elixir` + `test/generator/java` **293 files / 1800 tests** green · `test/generator/typescript` + `test/generator/_obs` + `test/playground` green in the row-1 sweep (207 files / 2051) · `test/system` + `test/conformance/corpus-coverage` + `test/playground` **207 files / 3698 tests** green (incl. `gate-ledger`, `pr-gate`, `workflow-path-coverage`, `local-run-mapping`, `merge-queue-readiness`, `diagnostic-catalog`, `mission-counts`) · the three java compile legs load and skip cleanly without `LOOM_JAVA_BUILD=1` (127 skipped).

`actionlint` on the two edited workflows: only the three pre-existing SC2016/SC2086 infos on the untouched failure-summary step.

**Not run here** (needs a booted stack): the elixir Schemathesis cell, the java compile legs, and the playground e2e that row 1 ultimately serves. Row 1's envelope was proven against the real `pino/browser.js` instead; row 2's two halves were proven by reading the emitted Elixir against the emitted `defdelegate`s, which is the comparison the bug survived by nobody making.
