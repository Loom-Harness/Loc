# P3 / F4 — the e2e payload gate, and the corpus sweep that proved it safe

Companion to the testability audit's **F4** and to packet **P3** of its fleet plan —
`docs/audits/2026-09-13-testability-audit.md` and
`docs/audits/2026-09-14-testability-fleet-plan.md`, which land on their own branch
(`claude/loom-testability-audit-36emx6`) and so are named here rather than linked.

The gate lives in `src/ir/validate/checks/e2e-route-checks.ts`; this file is the EVIDENCE
that it turns no valid model red.

## The defect, re-verified on fresh `main @ 9e03c0ff`

Seven deliberate defects in one `test e2e` body. Before: two diagnostics, for two
probes, and one of the two reported twice.

| probe | before | after |
|---|---|---|
| unknown operation `api.widgets.noSuchOperation(w)` | `loom.e2e-unknown-method` **and** `loom.e2e-unrouted-verb` | `loom.e2e-unrouted-verb` only |
| unknown aggregate `api.gadgets.create(…)` | `loom.e2e-unknown-aggregate` | unchanged |
| misspelled create key (`kode` for `code`) | silent | `loom.e2e-unknown-body-key` |
| misspelled operation key (`amt` for `amount`) | silent | `loom.e2e-unknown-body-key` |
| missing required create field | silent | `loom.e2e-missing-required-field` |
| wrong scalar type (`qty: "not-a-number"` for an `int`) | silent | `loom.e2e-body-type-mismatch` |
| read of a response field that does not exist | silent | `loom.e2e-unknown-response-field` |

Seven mistakes, seven diagnostics, one each.

## Why it matters more than a round trip

A NEGATIVE test passes for the WRONG REASON.
`expect(api.widgets.create({ kode: "A" })).toThrow(422)` is green because of the typo,
not because of the domain rule it claims to prove. During the audit,
`schedule(techId: …)` called with `{ technicianId: … }` generated, ran, and 422'd on an
unknown field — with `0 error(s), 0 warning(s)` at compile time.

## The sweep — done BEFORE the gate was written, re-run against the final code

Population: **all 425 tracked `.ddd`** (`git ls-files '*.ddd'`), less the one the repo's
own census pins as unparseable-by-design (`examples/sales-ui.ddd`, a design document
carrying a `.ddd` extension). The 15 multi-file project members that cannot parse
standalone were swept through the CLI's project loader (`ddd parse`, which follows
`import`) rather than skipped.

Every site the gate REACHES, by what it judges — this is the denominator that makes
"zero hits" mean something:

| what the gate judged | sites | hits |
|---|---|---|
| body keys against a create-input / parameter contract | **777** | 0 |
| create bodies reaching the required-field arm | **184** | 0 |
| operation bodies | **129** | 0 |
| literals against a declared SCALAR type | **671** | 0 |
| — `string` 312 · `int` 150 · `enum` 69 · `datetime` 46 · `bool` 31 · `money` 30 · `decimal` 15 · `long` 11 · `guid` 7 | | |
| enum literals resolved to a declared enum, checked for membership | **69** | 0 |
| response-field reads (`getById` 329, `create` 63) | **392** | 0 |

**Zero valid models turned red.** 1001 magic-call sites across 74 files carry a
`test e2e` body; 444 pass an object literal.

Per directory — "walked" counts files carrying at least one `api.`/`ui.` call site the
gate walks, derived from the IR rather than from a text search:

| directory | `.ddd` tracked | walked | hits |
|---|---|---|---|
| `test/fixtures/` | 79 | 52 | 0 |
| `web/src/examples/` | 64 | 12 † | 0 |
| `test/behavioral/` | 8 | 6 | 0 |
| `examples/` | 23 | 4 | 0 |
| `test/e2e/` | 218 | 1 | 0 |
| `eval-clinica/` | 18 | 1 | 0 |
| `journey/` | 5 | 0 | — |
| `docs/audits/models/` | 4 | 0 | — |
| `packages/` | 0 | 0 | — |

† 10 parse standalone and were swept in-process; the 2 ERP project members
(`erp/deploy.ddd` and its entry `erp/main.ddd`) through `ddd parse`.

### The inline half — `.ddd` fixtures embedded in test sources

Tracked `.ddd` is not the whole population: 66 `.ts` files under `test/` and `src/` carry a
`test e2e` inside a template literal, and the first sweep did not reach them. Extracting
every such literal (34 models; `${…}` holes substituted away) and validating each:

| | |
|---|---|
| inline models extracted | 34 |
| parsed and validated | 27 |
| not parseable after hole-substitution (parameterised harness templates, each exercised by the suite itself) | 7 |
| **hits** | **4 — all of them the firing-census fixtures added by this PR, which exist to fire exactly those four codes** |

The remaining coverage comes from the suite itself: the repo refuses to emit from a model
that fails IR validation (`generateSystemFiles`), so any inline fixture this gate reddens
fails its own test rather than passing silently. That is how the third defect below was
found.

### What the sweep DID find

**Three** inline fixtures in the repo's own tests sent a create body that omits a required
`int`. Two are NON-VACUITY controls in `test/ir/e2e-route-contract.test.ts` asserting
*zero diagnostics*:

```ts
await codesFor("Order with crudish", `let o = api.orders.create({ code: "c" })`)
// `Order` declares `code: string` AND `qty: int`
```

They proved the route exists while sending a payload that route answers 422 to. The third
is in `test/system/generated-vitest-projects-self-contained.test.ts`, whose *domain* test
twenty lines above already writes the complete body — `Order.create({ code: "c", qty: 3 })`
— while its e2e body omits `qty`. All three fixed here by supplying `qty`. **No shipped
model was affected.**

Two further tests pinned the double-report itself and now assert the surviving diagnostic:
`test/language/validation/validation.test.ts` ("rejects `api.<known>.<unknownVerb>`") and
`test/system/e2e-destroy-and-list.test.ts` (the NAMED-destroy case, where the routing
message is the one that actually says what to do).

### The shapes that must stay legal — each has a test

The sweep is what named these, and each has its own NON-VACUITY case in
`test/ir/e2e-payload-contract.test.ts`:

- a value object as a nested object literal (`price: { amount: 9.99, currency: "USD" }`);
- an enum as its wire STRING (`status: "Placed"` — the bare `Placed` stays
  `loom.e2e-unresolved-ref`'s business and is NOT re-reported here);
- a `datetime` as an ISO-8601 string (`openedAt: "2024-01-01T00:00:00Z"`);
- a `money("5.00")` literal, and a plain int for a `money`/`decimal`;
- an `x.id` reference — not a literal, so not judged;
- an optional field, a bare `bool` and an `= default` field all omitted;
- a find's query arguments, which carry an implicit `page`/`pageSize`/`sort`/`dir` set on
  top of the declared params (145 `all(...)` sites depend on it).

## What the gate deliberately does NOT check

A gate that guesses is worse than no gate. Each of these is a named limitation:

- **`find` / `list` / `all` / projection reads.** Their argument is a query string, not a
  body; their response is a per-cardinality envelope (`{items,total}` for a list find, a
  bare row for a unique-key one) this layer has no derivation for.
- **Non-literal values.** Only a LITERAL is judged, and only against a SCALAR type.
- **An explicit `null`.** Nullability is not decidable from `TypeIR` alone.
- **The `ui.` surface.** A `ui` body fills a FORM; its vocabulary is the page object's.
- **An `extends` subtype's response shape.** Inherited fields are an I2 concern and do not
  reach the subtype's own `fields`, so the whole aggregate is skipped rather than
  half-judged.

## One mistake, one diagnostic

`test-checks.ts` asks whether a verb NAME resolves; this file asks whether it ROUTES. For
a verb that is neither, both used to answer. The routing answer survives because it names
the FIX — for `destroy` on an aggregate with no canonical destroy it says *add
`with crudish`, or an unnamed `destroy { }`; a NAMED destroy is a domain command and gets
no DELETE route*, where "unknown method" can only list what else exists.

`test-checks.ts` now consults `routeContractWillReport`, a call INTO this file's own
decision rather than a second copy of the routing rule — a copy would drift and leave a
call with two diagnostics again, or with none.
