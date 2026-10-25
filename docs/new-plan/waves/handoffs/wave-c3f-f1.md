# Wave C3F — packet F1 hand-off (elixir runtime values)

Branch `claude/c3f-f1`, built on `origin/main` @ `4233416e6` (after #3093 and #3110),
then merged with `origin/main` @ `e389606bb` (#3102; no overlap with this packet).
Fence: `src/generator/elixir/vanilla/` changeset / value-object / decimal /
projection / serializer emitters. Nothing under the router, openapi, controller
or plug emitters (F8's) was touched.

## Outcome

| item | defect (3d repro) | outcome |
|---|---|---|
| **D14** | a whitespace-only string answers "can't be blank" before the invariant runs | **fixed** (mechanism shared with D16). A string column is cast with `empty_values: []`, so `"   "` stays a string and `invariant name.trim().length > 0` runs: elixir now answers 422 at `/name` from the rule. The `intrinsics` `"   "` probe is **left held for F4**: run locally with the probe restored, elixir's one remaining divergence is the message-less sentence (`must satisfy: name.trim().length > 0` vs node's `Invariant violated: …`), which is M-T6.87 / `D-MESSAGELESS-DEFAULT`, not this item. |
| **D16** | a messaged check tripped by `""` → 500 | **fixed**. On fresh `main` the 500 had become a 422 with Ecto's `can't be blank` and no `code`; now `Name is required` + `msg.izdgzf` at `/name`, matching node. Probe restored in `corpus/validation-messages`. |
| **D17** | a messaged VO invariant omits `errors[].code` | **already fixed on `main`** by `6fd92c046` (C3 3g's D4b — `__loom_tag_codes` in the value-object module). Confirmed at runtime: with every F1 emitter reverted to `main`, the restored `sku: { code: "G" }` probe matched node's golden on the elixir leg. Probe restored. |
| **D19** | a joined `decimal` in a query-time projection serialised as `"2.5"` | **fixed**. A projection's per-row `decimal` select goes through `__decimal_num/1`, now ONE shared definition in `numeric-codec.ts` (`elixirDecimalNumHelper`) that `wire-serialize.ts` also uses. Probe restored in `corpus/datetime-wire` (`fee` / `venueFee`: present 2.5, absent join `null`). RS-24 provenance line added in `docs/conformance-semantics.md`. |
| **D24** | a malformed money inside a value object on create is accepted | **fixed**. New emitter `changeset-ingress.ts`: `__loom_decimal_ingress/3` checks every money/decimal leaf of a value-object field (nested value objects too) with node's grammar and answers `Invalid decimal: "1.2.3"` at `/best/price`. Probe restored in `corpus/wire-ingress`. |
| **D25** | a malformed top-level money on crudish create/update answers Ecto's "is invalid" | **fixed** by the same guard: top-level money/decimal columns, on both `base_changeset/2` and `update_changeset/2`; Ecto's own cast error is replaced, not doubled. A blank OPTIONAL top-level decimal stays absent (a LiveView form posts `""`). Probes restored (create + update). |

Also found and fixed while restoring D17's probe: a **blank value-object string leaf
was accepted** on elixir (`sku: { code: "" }` → 201). The value object's schemaless
changeset cast `""` to nil, and every length/format validator skips nil. The
value-object module now re-casts its string leaves with `empty_values: []` too.
New probe in `corpus/validation-messages`.

### What changed in the emitted code

- `<agg>_changeset.ex` (only when the aggregate has a string column / a decimal
  leaf; an aggregate with neither is byte-identical):
  - `@string_fields`, `@required_strings`; `cast(attrs, @all_fields -- @string_fields)`
    then `cast(attrs, @string_fields, empty_values: [])`; `validate_required(@required_fields -- @required_strings)`
    then the nil-only `__require_present(@required_strings)`. The update seam
    mirrors it (its own `@update_string_fields` / `@update_required_strings`
    only when the update-editable string set differs).
  - `@decimal_ingress [{[:price], false}, {[:best, :price], false}]` and
    `|> __loom_decimal_ingress(attrs, @decimal_ingress)` right after the casts.
- `<vo>.ex`: `@string_fields` and the split cast.
- query-time projection modules: `__decimal_num(...)` on a `decimal` select.

## Mutation proofs

Unit (`test/generator/elixir/wire-ingress-changeset.test.ts`, 7 tests), each
emitter swapped for its `origin/main` copy by file copy, then copied back:

| reverted file | failing tests |
|---|---|
| `changeset-emit.ts` | "casts string columns with empty_values: [] …", "guards every top-level decimal column and every value-object decimal leaf", "answers node's text and grammar …" (3 of 7) |
| `valueobject-emit.ts` | "re-casts a value object's string leaves the same way" (1 of 7) |
| `query-projections-emit.ts` | "routes a decimal select through __decimal_num/1 …", "shares one __decimal_num/1 definition …" (2 of 7) |

Runtime (elixir behavioural leg, node goldens), restored probes in place:

| mutation | result |
|---|---|
| `changeset-emit.ts` + `valueobject-emit.ts` + `query-projections-emit.ts` reverted to `main` | `validation-messages`: `#2 POST /api/products` `$.errors[0].message` golden `Name is required` ≠ elixir `can't be blank`, and `$.errors[0].code` absent (D16). `datetime-wire`: `expected "2.5" to be 2.5` (D19). `wire-ingress`: `expected the call to reject, but it resolved` on the value-object create (D24). |
| only the top-level paths dropped from `decimalIngressPaths` | `wire-ingress`: `#4 POST /api/products` and `#6 POST /api/products/{id}/update` `$.errors[0].message` golden `Invalid decimal: "1.2.3"` ≠ elixir `is invalid` (D25). |
| `valueobject-emit.ts` reverted | `validation-messages`: `expected the call to reject, but it resolved` on `sku: { code: "" }`. |

## Runtime evidence

Host toolchain: Elixir 1.18.4 / OTP 27 lifted from `hexpm/elixir:1.18.4-erlang-27.3.4-debian-bookworm-20260610-slim`
(pulled through `mirror.gcr.io`; Docker Hub answered 429), Postgres 16 sidecar.
`run-elixir.mjs` compiles with `--warnings-as-errors`.

| leg | cases | result |
|---|---|---|
| elixir | `wire-ingress`, `validation-messages`, `datetime-wire` | all pass, **0 divergences** (6 pre-existing M-T6.86 waivers on `ship`/`retag`) |
| elixir | the FULL leg (every corpus feature + shared system, 82 cases) | 175 passed, 0 failed, 24 skipped (authz arms a dev-stub cannot express); 80 cases compared to golden, **0 divergences**. `policy-deny` timed out booting under a load average of ~25; re-run solo it passes and matches its golden. After the `origin/main` merge, the new `python-reserved-words` fixture also passes with 0 divergences. |
| node (oracle, PGlite) | same | pass; goldens re-minted with `LOOM_WIRE_UPDATE=1` — only these three goldens moved |
| python | same | pass, 0 divergences |
| mikroorm | same | pass, 0 divergences |

Not run locally (no JDK 25 / .NET SDK on the host): **java, dotnet, dapper** — CI's
`behavioral-e2e-{java,dotnet,dapper}` must confirm the three re-minted goldens. The
3d hand-off measured the VO-code, create/update-money and VO-money probes as
node-conforming on those legs; the new probes they have not seen are the blank
`name: ""` (messaged check), the blank `sku.code` leaf and the joined `fee`.

## Fence crossings

- `test/fixtures/corpus/{wire-ingress,validation-messages,datetime-wire}.ddd`,
  their goldens, one `manifest.ts` note, `test/_helpers/wire-waivers.ts` (a
  comment that named `ship`/`retag` by seq number, which moved).
- `docs/conformance-semantics.md` RS-24 (trigger + provenance).
- Pins updated for the split cast: `test/generator/elixir-vanilla/slice2-crud-write.test.ts`,
  `test/generator/elixir-vanilla/created-at-changeset.test.ts`.

## Gates

- `npx tsc -b` — clean. `node scripts/test-typecheck.mjs` — OK. `npx biome ci .` — clean.
- `npx vitest run test/generator/elixir test/generator/elixir-vanilla test/generator/create-input-optionals.test.ts test/conformance`
  — 274 files / 6300 tests; the one failure (`created-at-changeset.test.ts`, a
  `cast(attrs, @all_fields)` pin) is updated in this branch and re-run green.
- `npx vitest run test/system test/ir --maxWorkers=2` — 459 files passed; 7 files
  reported failures, every one `Test timed out` (the shared host ran at a load
  average of 20–28) or a worker OOM exit. Re-run solo: `crudish-cross-document-vo-param`,
  `model-exprs-completeness`, `page-ir`, `emitted-unbound-symbols`,
  `generation-defaults`, `playground-storybook-examples` pass;
  `diagnostic-firing-census` passes (566/566) with `--max-old-space-size=6144`
  (the default heap exits the worker mid-file); `ddd-source-census` passes (5/5) once the load dropped.
  The three edited fixtures parse with 0 errors on all five platforms.
- No mission rows touched, so `mission-counts --check` was not needed.
