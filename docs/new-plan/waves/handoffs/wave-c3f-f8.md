# Wave C3F — packet F8: elixir Schemathesis triage

**Verdict.** The elixir Schemathesis cell **binds**: `discovery: true` and
`continue-on-error` are gone from `schemathesis.yml`. Measured locally on fresh
`main` (`4233416e6`) against `storefront-elixir` (29 operations, seed 20260811):

| | findings | error keys (`<op>::error:<type>`) | operations with an error |
|---|---|---|---|
| `main`, schemathesis 4.24.3 as CI installs it (`jsonschema-rs` 0.58.6) | 26 | 26 (14 `InvalidSchema` + 12 `AttributeError`) | 23 of 29 |
| `main`, `jsonschema-rs==0.49.1` pinned | 28 | 14 (`InvalidSchema`, `#/components/schemas/Money`) | 14 of 29 |
| this branch, pinned | **5, all waived** (W8 ×3, W37, W38) | **0** | **0 of 29** |

The other four legs, re-run on this branch with the pin: node 7 (W8), python 7
(W8), dotnet 7 (W8; W27 intermittent, no hit), java 17 (W8 ×7 + W35 ×10) — all
`clean`. Most of the 2026-10-05 inventory was the HARNESS, not the backend.

## Item → outcome

| # | item | outcome | where |
|---|---|---|---|
| 1 | 16 runtime errors on all five legs | **fixed.** schemathesis 4.24.3 leaves `jsonschema-rs` unpinned; 0.56.0 removed `CanonicalSchema.is_satisfiable`, which its generator calls, so every parameterised operation errored before sending — and the harness read only check results, so it counted those operations clean. Pinned `jsonschema-rs==0.49.1` (`pipx inject` in the workflow; the install line in `docs/testing.md`, `test/behavioral/README.md`, the `loom-test-suites` skill and the harness's own error hint), and `parseFindings` keys a `NonFatalError`/`FatalError` as `<op>::error:<type>`. Runtime proof: the same leg run on this branch with the unpinned binary now FAILS (35 findings, 28 of them `UNWAIVED <op>::error:AttributeError`) instead of reading clean; the node leg run the same way fails with 47 `UNWAIVED …::error:AttributeError` (on `main`'s harness both read clean) — the crash is in the fuzzer, so it hits every leg | `.github/workflows/schemathesis.yml`, `test/behavioral/schemathesis-core.mjs` |
| 2 | 14 schema errors (`Money` unresolvable) | **fixed.** A value-object property was a raw `%OpenApiSpex.Reference{}`, which OpenApiSpex never registers; it is now the VO's schema module, so `resolve_schema_modules` registers it. Corpus-wide dangling-`$ref` check added (non-vacuity: asserts the corpus emits raw refs at all, and the storefront emits a `Money` module) | `src/generator/elixir/vanilla/openapi-emit.ts`, `test/generator/elixir/vanilla-openapi-dangling-ref.test.ts` |
| 3 | harness fuzzed the LiveView pages | **fixed (harness half).** `--url` replaces the document's server URL, path included; phoenix publishes `servers: [{url: "/api"}]` with relative paths. `specServerBase` carries the server's path onto the booted origin. This one cause explains the `200 Undocumented Content-Type` ×7, the `/by_email`·`/by_owner` "shadowed by `/{id}`" CastErrors (the LiveView `show` route), TRACE→404 and DELETE→405. The emitter half (path-embed `/api`, M-T6.70) is **open PR #3108** (E9), unmerged; the harness works with either shape | `test/behavioral/schemathesis-core.mjs` |
| 4 | `POST /customers`/`/orders` → 405; `400 Missing Content-Type header` | **fixed.** `BodyParser` answered a parse failure with the PRE-parser `conn`; Bandit then re-drained an already-read body on the keep-alive socket and consumed the head of the next request (`OST /api/…`). The answer now sets `connection: close`. Comment avoids the sentinel word | `src/generator/elixir/vanilla/shell-emit.ts`, `test/generator/elixir/vanilla-body-parser-keepalive.test.ts` |
| 5 | find params reach the query unchecked | **fixed.** `__check_find_params/2` checks each declared param against its published type (string / uuid / int32 / long-safe / decimal·money / bool / datetime / enum; non-scalar `?x[]=` refused) and answers the declared 422 at `/<param>` before the gate and the query; one `__find_param_error/3` clause per kind used. The `validation_errors_response/2` gate in `index.ts` also turns on for checked finds. `vanilla-optional-find-404.test.ts`'s fixed-width slice is now the whole action, and its indentation-pinned assertion a regex | `src/generator/elixir/vanilla/find-controller.ts`, `index.ts`, `test/generator/elixir/vanilla-find-param-check.test.ts` |
| 6 | unknown query params on paged GETs | **by design (F9)** — `elixir` added to W8's backends | `test/behavioral/schemathesis-waivers.json` |
| 7 | F35: elixir persists a VO's raw wire map | **mission M-T6.89** (F1's changeset tree). Waived **W37** (`not_a_server_error`) + **W38** (`status_code_conformance`), elixir only, scoped to VO-bearing writes. **Ids deviate from the brief's W36/W37:** W36 is a retired rule (dotnet F18, #2764) and reusing it would collide in the register's history | `docs/audits/schemathesis-findings-2026-08.md` (F35), `docs/new-plan/T6-backend-parity.md` |
| — | binding | `discovery: true` + `continue-on-error` dropped; `docs/ci-gating.md` row rewritten; `loom-ci-gates` skill (no longer "discovery cell"; the schemathesis line no longer says Hono-only) and `loom-test-suites` skill updated; register's "elixir leg" section carries the triage table; follow-up slice 1 replaced (elixir on the shared fixtures) | |

## Mutation proofs (file-copy revert, failing assertion read)

- `openapi-emit.ts` reverted → both dangling-ref cases fail: storefront `[{path: …order_line_response.ex, ref: "Money"}, …]` (11 offenders); the corpus case fails too.
- `schemathesis-core.mjs` reverted → `keys a NonFatalError…` fails (`expected [] to deeply equal [ …(2) ]`), the three `specServerBase` cases fail (`specServerBase is not a function`).
- `shell-emit.ts` reverted → `expected -1 to be greater than -1` (no `connection: close` in the rescue).
- `find-controller.ts` + `index.ts` reverted → 3 of 4 fail: `by_name: expected 'def by_name(conn, params) do…' to contain 'case __check_find_params(…'`, the ordering assertion, and the helper-clause assertion. (The fourth, "no check on a param-less controller", passes both ways by design — it is the scope guard.)

## Runtime evidence (host-extracted `hexpm/elixir:1.18.4` toolchain, postgres 17)

- Keep-alive, one socket, malformed-JSON POST with its body in its own segment then a valid GET: before `400` then `HTTP/1.0 400 Bad Request` for the GET; after `400` + `connection: close`, socket closed.
- `GET /api/customers/by_email` (no param): before 500 (`ArgumentError: comparing record.email with nil`); after 422 `{pointer: "/email", message: "Required"}`. `?owner=zz`: before 400 (CastError); after 422 `/owner` "Expected UUID.".
- An app with a find per param kind (string, `Owner id`, int, long, decimal, money, bool, datetime, guid, enum, `string?`): `MIX_ENV=prod mix compile --warnings-as-errors` → "Generated app app"; booted, each kind answers 422 at its pointer for a malformed value and 200 for a well-formed one.
- F35: `balance: {"currency":"USD"}` → 500 `Decimal.decimal(nil)`; `"junk": 1` → 201 and stored; `"x\u0000": 1` → 500 22P05.

## Fence crossings

- `test/behavioral/README.md`, `docs/testing.md`, `.claude/skills/loom-test-suites/SKILL.md` — the install line (pin) and the "discovery cell" note.
- `src/generator/elixir/vanilla/index.ts` — one gate line (`contextsHaveCheckedFindParams`) for the `validation_errors_response/2` responder; not a changeset/validator emitter.
- `docs/new-plan/T6-backend-parity.md` + `README.md` counts — the M-T6.89 row. **M-T6.89** was the allocator's next free T6 id at mint time; sibling packets minting concurrently may collide — re-derive at fold.
- Not touched: the changeset / validator / decimal emitters (F1's) — F35 is handed to M-T6.89.

## Not done / for CI

- The nightly must confirm the elixir cell with `erlef/setup-beam` + hex direct (locally: the host-extracted toolchain, which reaches hex through the proxy fine).
- Query-projection params (`query-projections-emit.ts`, `findParamRead`) take the same unchecked path as finds did; storefront has none, so the leg cannot see it. Not changed here.
- Incidental: while booting, a `pkill -f phx.server` in this packet's shell may have stopped any OTHER host-run `mix phx.server` at that moment (none was found running afterwards). Later stops matched by working directory only.

## Gates

`npx tsc -b` ✓ · `node scripts/test-typecheck.mjs` ✓ · `npx biome ci .` ✓ · `npx vitest run test/generator/elixir` ✓ · `test/generator/elixir-vanilla` ✓ · `test/conformance` ✓ · `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` ✓ · `npx vitest run test/system test/ir --maxWorkers=2`: 7088 passed, 12 failed — **every failure a timeout or a crashed worker** (6× 30 s, 3× 120 s, 1× 300 s, 1× 600 s, 2 worker exits) on a host at load 20–33 shared by four packets; no assertion failed. Re-run: the six unit files (`diagnostic-firing-census`, `generation-defaults`, `page-ir`, `properties`, `projection-columnless-field`, `authz-emitted-census`) pass; `e2e-fixture-validation`'s `elixir-vanilla-build` case passes alone with a longer timeout. Not re-run (AST-only or node/react, none reads an elixir emitter): `ddd-source-census`, `emitted-unbound-identifiers` (react), `openapi-component-uniqueness-census` (its node case). The branch merges cleanly onto `origin/main` @ `e389606bb`.
