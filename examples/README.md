# `examples/` — fixture and showcase DSL inputs

These `.ddd` files are the **stable source inputs consumed by the test
suite, the CLI smoke scripts, the reference docs and the CI build
matrices**, plus a few showcase models. Treat them as fixtures: keep them
stable and minimal. Further playground examples, curated for breadth and
surfaced in the playground dropdown, live under `web/src/examples/`.

| File | What it covers |
|---|---|
| `quickstart.ddd` | the minimal `Acme` system used by the README quickstart |
| `acme.ddd` | the full multi-deployable system: generator/system/IR tests, `elixir-vanilla-build.yml`, `generated-react-build.yml`, parsing, capture-baseline (prose companion: `acme.md`) |
| `acme-order-explicit.ddd` | hand-written equivalent of `scaffold aggregates: Order`; `order-explicit-equivalence`, `scaffold-expander` |
| `sales.ddd` | `generator-ts` tests, `smoke-runtime.mjs`, npm mirror |
| `banking.ddd` | generator tests |
| `inventory.ddd` | nested parts, explicit `ids guid` override |
| `roster.ddd` | `generated-build` (TS tsc + tsup); `X id[]` join tables and `this.<refColl>.contains(...)` queries |
| `sales-ui.ddd` | `docs/page-metamodel.md` &mdash; **historical prototype, does not parse** (target syntax for the discussion; see its header) |
| `provenance.ddd` | `provenanced` fields and the runtime trace SDK (`docs/provenance.md`) |
| `showcase.ddd` | the whole-surface conformance fixture; the design-pack matrix in CI |
| `vue-showcase.ddd` | the acme system with a `platform: vue` frontend (Vuetify pack) |
| `svelte-shop.ddd` | a themed system with a Svelte frontend |
| `document.ddd` | the three saving shapes: relational, `document`, `embedded` |
| `event-sourcing.ddd` | an event-sourced ledger aggregate (`apply` folds over an event stream) |
| `lifecycle.ddd` | canonical CRUD lifecycle via `crudish` (hard-delete paths) |
| `timers.ddd` | `timerSource` — time as an event source |
| `seeding.ddd` | database seeding, top-level context form |
| `tasks-vanilla.ddd` | plain Phoenix + Ecto on `platform: elixir` |
| `json-primitive.ddd` | the `json` primitive across every backend |
| `money-primitive.ddd` | the `money` primitive and decimal arithmetic |
| `value-collections.ddd` | `<VO>[]` value-object collections (child table / array column) |
| `operation-return-dotnet.ddd` | exception-less operation returns on the .NET backend |
| `paged-dotnet.ddd` | the paged list read on the .NET backend |
