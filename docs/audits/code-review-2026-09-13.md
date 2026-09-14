# Code review audit — 2026-09-13

*Independent review of `main` @ `619708fd`. Scope: what a long run of agent-authored, CI-gated,
green-and-merge PRs has left behind. Evidence is measured on the tree, not read from other audits
or status docs. Prioritised backlog at the end.*

## Verdict

**The code is in good shape; the *verification and suppression layers* are where things slipped.**

`tsc -b` is clean, Biome is clean-modulo-warnings, type hygiene is unusually good (24 `as any` and
zero `@ts-ignore` in 331k lines), money/decimal and SQL-identifier handling are correctly
centralised, and the src delete-rate over the last 60 PRs is a healthy 55% of the add-rate. The
architecture the repo claims — one-directional pipeline, shared `ExprTarget`/`StmtTarget`/
`WalkerTarget` seams, per-entry ratcheted allowlists — is real and mostly enforced.

What did not hold is the *meta* layer the repo built to protect itself. Three failure shapes recur:

1. **Time-boxed deferrals became permanent.** A waiver written as "in-flight, PR #2736 owns this
   file this wave" is still suppressing a check months after #2736 merged, because the ratchet can
   detect a stale *site* but not an expired *reason*.
2. **Gates that don't reach what they name.** Five per-backend compile gates path-trigger on one
   shared generator seam (`_expr`) and none of the other fifteen — so the dispatcher every backend
   compiles through can change with no backend ever compiled.
3. **The test suite only ratchets upward.** Tests are added at 21× the rate they are deleted, and
   two-thirds of all assertions are substring matches against generated text.

None of these is a bug today. All three are the mechanism by which a bug lands undetected tomorrow.

---

## Measurements

| | |
|---|---|
| `src/` (excl. `generated/`) | 330,878 lines · 31.8% comment lines |
| `test/` | 375,906 lines · 2,108 test files |
| `docs/` | 425 files · 141,870 lines (~43% of `src`) |
| Workflows / npm scripts | 67 / 114 |
| Generator by target | elixir 43k · dotnet 35k · java 28k · python 22k · ts 15k · hono 14k |
| Assertions | 40,463 `expect()`; 26,620 (65.8%) are `toContain`/`toMatch`/`not.toContain` |
| Last 60 PR merges | 26 files, +1,628/−466 each |
| — `src/` | +27,747 / −15,131 (delete rate **55%**) |
| — `test/` | +30,765 / −1,421 (delete rate **4.6%**) |
| — `docs/` | +20,693 |
| `npm audit` | 6 vulnerabilities: 2 high, 3 moderate, 1 low — fix available |
| Dead exports | 52 never referenced anywhere · 417 exported but used only in their own file |

---

## P0 — verification is claiming coverage it doesn't have

### P0-1. 23 of 114 IR-walk-census waivers are expired process fences

`test/system/ir-walk-census.test.ts` carries 114 waivers over hand-rolled `ExprIR`/`StmtIR`/
`WorkflowStmtIR` dispatches — the defect class CLAUDE.md names as `#2720`/`#2705`/`M-T6.50`. They
group under seven shared reason constants:

| reason | count |
|---|---|
| `CLOSED_PREDICATE` | 42 |
| `THROWING_DISPATCHER` | 31 |
| `INFLIGHT_2736` / `INFLIGHT_2729` / `INFLIGHT_2742` | 12 |
| `HOTSPOT_SPLIT_REASON` | 11 |
| `TRAVERSAL_TIME_BOXED` | 6 |
| `SHALLOW_CHILD_BUILDER` | 4 |
| `DELEGATES_TO_SANCTIONED_WALKER` | 3 |

The 12 `INFLIGHT_*` waivers say *"do not edit its hunks — PR #2736/#2729/#2742 owns this file this
wave."* All three merged (`90c7e2f2`, `dcb956f8`, `9133a3d6`). The 11 `HOTSPOT_SPLIT_REASON`
waivers defer to "the 2.6 hotspot-split", which also landed. **23 waivers now permanently suppress
a check for a reason that stopped being true.**

The ratchet cannot see this. It asserts only that a waived site still exists and is still
non-exhaustive — both still true — so the entries never fail and never get revisited.

> **Fix.** Give every waiver an expiry input the ratchet can evaluate: a `blockedBy: "#2736"` field
> that fails once that PR is merged, or a `reviewedOn` date that fails after N days. Then drain the
> 23. Cheap, mechanical, and it converts a class of silent debt into a failing test.

### P0-2. 42 waivers were classified by heuristic, never verified

`CLOSED_PREDICATE`'s own reason text is the finding:

> *"Classified by default-arm shape, **not individually re-verified per kind** this packet;
> follow-up drain"*

42 sites were waived by pattern-matching the shape of their `default:` arm, on the assumption that
an unhandled kind falls through to a safe generic value. Nobody diffed their case sets against the
current `ExprIR`/`StmtIR` kind lists. That assumption failing *is* the M-T6.50 class — a
`currentUser` hidden in a `match` arm, a domain-service call inside an `if-let`.

A further 31 (`THROWING_DISPATCHER`) are waived because their failure is loud. For a *generator*,
"loud" means codegen throws at `ddd generate system` time on a valid `.ddd` — the repo's own
definition of a **silent gap** (crashes on valid input) rather than an honest one (a `loom.*`
diagnostic). Those 31 belong in the parity backlog, not in a waiver file.

> **Fix.** Two separate drains. (a) For the 42: script the case-set diff against `walk.ts`'s kind
> enumeration and either migrate or convert to `never`-checked — this is mostly mechanical. (b) For
> the 31: prove each vocabulary complete, or replace the `throw` with a `loom.*` diagnostic so the
> gap is honest.

### P0-3. Shared generator seams have no backend compile gate

The five per-backend compile gates enumerate their `paths:` filters. Here is which shared
`src/generator/_*/` dirs each one watches:

```
java-build             _expr
dotnet-build           _expr
python-build           _expr
hono-build             _expr
elixir-vanilla-build   _expr _frontend
corpus-elixir-build    _expr
behavioral-e2e-java    _expr          (also enumerated, also only _expr)
```

Nothing watches `_stmt/`, `_workflow/`, `_type/`, `_payload/`, `_numeric/`, `_i18n/`, `_trace/`.
These are not per-target files — they are, by construction, the code every backend shares:

- `_stmt/target.ts` — the 11-arm `StmtIR` dispatcher all five backends' leaf tables plug into
- `_workflow/stmt-target.ts` — the `WorkflowStmtIR` spine for Hono/.NET/Java/Python
- `_payload/union-wire.ts` — *the single source of truth* for the tagged-union wire shape; all five
  backends are in `SUPPORTED_UNION_BACKENDS`
- `_type/target.ts` — the `TypeIR` dispatcher over TS/C#/Java/Python

`corpus-build` carries a broad `src/generator/**` and is the only per-PR gate that fires on these —
and **it does not cover Elixir**, which lives in the separately-enumerated `corpus-elixir-build`.
So a change to `_payload/union-wire.ts` compiles no Elixir project, on any gate, on any PR. Elixir
is the largest backend in the tree (43k LOC).

Worse, the gate meant to prevent exactly this — `test/system/workflow-path-coverage.test.ts` —
explicitly *exempts* shared seams:

> *"The generator's shared seams (`_walker`, `_expr`, `_frontend`, ...) are deliberately NOT
> required: those are genuinely per-target, and requiring them would produce false positives"*

The rationale is inverted. `src/generator/java/**` is per-target; `src/generator/_stmt/**` is the
opposite of per-target — that is what the leading underscore means in this repo.

> **Fix.** Extend `GENERATION_PATH` to require every `src/generator/_*/` directory reachable in the
> workflow's own transitive import closure (the test already computes that closure). Or adopt the
> pattern `generated-react-build.yml` already uses — broad `src/**` with explicit per-backend
> negations — which is immune to this by construction.

### P0-4. OIDC `aud` validation is off by default, and `node` cannot turn it on

When a `.ddd` declares `auth { oidc { … } }` without `audience:`:

| backend | emitted behaviour |
|---|---|
| python | `audience=_AUDIENCE, options={"verify_aud": _AUDIENCE is not None}` — `os.environ.get("OIDC_AUDIENCE")` |
| java | `System.getenv("OIDC_AUDIENCE")` |
| dotnet | `Environment.GetEnvironmentVariable("OIDC_AUDIENCE")` |
| ~~elixir~~ **CORRECTED** | ~~env-overridable, with an explicit documented `OIDC_AUDIENCE=""` opt-out~~ — **wrong, see below** |
| **node / hono** | `jwtVerify(token, jwks, { issuer: ISSUER })` — **no audience term, no env path** |
| **elixir** | **no audience term, no env path** — every construct sits behind `auth.oidc.audience ? … : ""` |

> **Correction (2026-09-14, found by Wave CR1 packet CR1-b).** The elixir row above was wrong, and
> wrong in the direction that understates the finding. `renderOidcVerifier` gates *every* audience
> construct — `audience/0`, `aud_present?/1`, and the `add_claim("aud", …)` validator — behind
> `auth.oidc.audience ? … : ""`, so with no `audience:` declared elixir emits **no audience check at
> all**, exactly like node. The audit read the `envOrDeclared("OIDC_AUDIENCE", …)` call and inferred
> an env path without noticing that call only appears in the *declared* branch. **The divergence was
> two backends, not one.** Both are fixed in CR1-b; the table is left visible rather than rewritten,
> because how the error was made — reading a call site without checking which branch reaches it — is
> the same mistake this audit attributes to the waiver register in P0-2.
>
> CR1-b also found a **residual divergence P0-4 did not name**: `OIDC_AUDIENCE=""` is an opt-out on
> node and elixir only. dotnet, java and python read the empty string as a *declared* audience of
> `""` and reject every token. Fail-closed, so not a security hole — but a deployment footgun, and a
> one-line fix per backend. Recorded, not fixed, in `docs/new-plan/waves/handoffs/wave-cr1-b.md`.

Two problems, in order of severity:

1. **Divergence.** The same `.ddd` deploys with enforceable audience validation on four backends and
   an unenforceable one on the fifth. An operator who sets `OIDC_AUDIENCE` in compose gets isolation
   everywhere except node, with no error and no log line.
2. **Silent default.** On all five, an undeclared audience means any token the issuer minted for
   *any* client is accepted. There is no `loom.*` diagnostic for this — `grep -r audience
   src/language/validators src/ir/validate src/diagnostics/messages.ts` returns nothing.

The verification itself is sound everywhere (`jose` + remote JWKS, python pins an RS/ES algorithm
allowlist, `.NET` uses `JsonWebTokenHandler` — no `alg:none` or HS256-confusion exposure). This is
about the default and the divergence, not the crypto.

> **Fix.** (a) Add the `OIDC_AUDIENCE` env fallback to `src/platform/hono/v4/auth-emit.ts` so all
> five agree. (b) Add a `loom.auth-oidc-no-audience` warning when `oidc` is declared without
> `audience:`. (c) Add an audience row to the OIDC e2e legs — the four `*-oidc-e2e` workflows
> already boot a real IdP.

---

## P1 — accumulating debt with a clear drain

### P1-1. Two e2e suites (677 lines) can never run

| file | gate | set by |
|---|---|---|
| `test/e2e/embed-react-elixir.test.ts` (268 L) | `LOOM_EMBED_E2E_PHOENIX=1` | nothing |
| `test/e2e/auth-gate-ui-e2e.test.ts` (409 L) | `LOOM_AUTH_GATE_E2E=1` | nothing |

Both are `describe.skipIf(!ENABLED)`. Neither variable appears in any workflow, any npm script, or
any helper. `embed-react-elixir.test.ts` documents itself as *"reuses the phoenix-obs-e2e.yml
workflow's …"* — a workflow that no longer exists (it is now `elixir-vanilla-obs-e2e`), so the
suite was orphaned by a rename and nothing noticed.

There are 101 `skipIf` sites in `test/`; these two are the ones with no reachable setter.

> **Fix.** One test: every `process.env.LOOM_*` read used as a skip gate must be set by some
> `package.json` script or `.github/workflows/*.yml`. Zero-tolerance, not a ratchet — the tree is at
> two. Then wire or delete these two.

### P1-2. The test suite only ratchets upward

Two numbers, both from the last 60 PR merges:

- `test/` grew **+30,765 / −1,421** — a 4.6% delete rate, against `src/`'s 55%.
- 65.8% of all 40,463 assertions are `toContain` / `toMatch` / `not.toContain` against generated
  source text.

Substring assertions on emitted text are cheap to write and nearly free to add, which is exactly
why an agent-authored PR adds several and removes none. They are also the weakest assertion in the
building: they break on formatting, and they pass on code that compiles to nothing. The gates that
prove the generated code *works* — compile legs, behavioral wire-goldens, the runtime e2e tiers —
are the ones that are expensive and path-filtered.

`test/system/gate-ledger.test.ts` already establishes the drain authority ("a `toContain` test may
go when its cell is watched by something stronger") and already computes the strongest-gate matrix.
The authority exists; it is not being exercised, and nothing measures the string tier's size.

> **Fix.** Put a *count* ratchet on the per-target string tier, seeded at today's number and only
> allowed to fall. Then run the gate-ledger drain as a standing chore: for each cell watched by a
> compile-or-stronger gate, delete its string tests. This is the one item here that pays back in
> CI minutes as well as in review load.

### P1-3. Dependency vulnerabilities, fix available

```
ip-address  <=10.3.0   HIGH   3 advisories — SSRF / trust-boundary bypass
                              (leading-zero octet decoding, CIDR-suffix
                              special-use suppression, IPv4-mapped/NAT64
                              misclassification)
qs          2.2.5-6.15.3  MODERATE  array-limit bypass, DoS via isBuffer
```

Both transitive, both fixable with `npm audit fix`. Also pending: TypeScript 7, vitest 5,
`@vitest/coverage-v8` 5, langium 4.4, chalk 6 — each its own major, none urgent.

### P1-4. 52 dead exports; 417 exports that should be module-private

52 exported symbols are referenced nowhere in the repo — not in `src/`, `test/`, `web/`, `scripts/`,
`packages/`, or their own file. The telling ones:

- `src/generator/java/index.ts: generateJava` (line 264) — a public entry point superseded by
  `generateJavaForContexts` (line 280) and left in place
- `src/cli/new-templates.ts` — all five `REACT_/SVELTE_/VUE_/ANGULAR_/LIVEVIEW_DESIGN_PACKS`
  constants; `main.ts` calls `designPacksForFormat` directly
- `src/generator/_expr/target.ts: LambdaExpr, ObjectExpr` — dead types in the core contract file
- `src/generator/sql-reserved.ts: PG_RESERVED_IDENT_WORDS` — the word list; consumers use the
  `isReservedIdent` predicate

A further 417 are exported but referenced only inside their defining module — a public surface
~4× wider than it needs to be, which is what makes the layering tests' job hard.

This is the same class as the callerless `constructionSeededDefaults` removed in **#2897** two days
ago, which means it is recurring and being found by hand.

> **Fix.** Add `knip` (or equivalent) to the lint job. It catches both categories, and it is the
> only item on this list that removes future manual sweeps rather than performing one.

### P1-5. `biome ci` passes with 23 warnings

`npm run lint` exits **0** while reporting 23 findings — 18 unused imports, 3 unused variables, and
some `useOptionalChain` nits, in `src/` as well as `test/`. Every one is auto-fixable. Because the
gate is green, they accumulate; because they are in source files that other agents read as
examples, they propagate.

> **Fix.** `npm run lint -- --error-on-warnings` (or promote the rules to `error` in
> `biome.json`), after a single `--write` pass. The `Stop` hook already runs this command, so the
> enforcement point exists.

---

## P2 — worth deciding on, not worth rushing

### P2-1. Comment mass in the hot path

31.8% of `src/` is comment lines — **105,196 lines**. Concentrated in exactly the files that are
hardest to change:

| file | comment % | lines |
|---|---|---|
| `src/generator/_walker/target.ts` | 76.6% | 1,689 |
| `src/platform/surface.ts` | 73.1% | 320 |
| `src/ir/types/loom-ir.ts` | 58.8% | 4,416 |
| `src/generator/_walker/walker-core.ts` | 54.0% | 2,866 |

For a contract file like `target.ts` or `surface.ts` a high ratio is defensible — the comment *is*
the contract. What is not defensible is the content: these comments carry PR numbers, packet names,
wave history, and "the version it replaces was partly FALSE and is quoted at the bottom". That is a
decision log living in the hot path, and it goes stale silently because nothing gates it.

> **Fix.** Keep the contract prose; move the archaeology (PR/packet/wave references, superseded
> rationale, correction records) to `docs/decisions.md` and link it. No gate needed — just a
> convention line in CLAUDE.md.

### P2-2. Documentation is 43% the size of the source

425 markdown files, 141,870 lines, growing +20,693 lines per 60 PRs (~345 lines of docs per PR).
`docs/old/` alone is 69,188 lines of explicitly frozen record. The index (`docs/README.md`) cannot
realistically keep 425 files honest, and CLAUDE.md already warns readers away from most of them.

> **Fix.** Decide whether `docs/old/` is a record or a graveyard. If it is a record, move it out of
> the built site and out of grep range (`docs/archive/`, excluded from `docs/build.mjs`). If it is
> a graveyard, delete it — git has it.

### P2-3. Parity gates that can never fire

Most `*_SUPPORTED` sets in `src/ir/validate/checks/` are now 5-of-5:

```
PAGED_QH_SUPPORTED, PROJECTION_QT_SUPPORTED, PROJECTION_AGG_SUPPORTED,
PROJECTION_GROUPBY_SUPPORTED, SUPPORTED_PAGED_BACKENDS, SUPPORTED_RETURN_BACKENDS,
SUPPORTED_UNION_BACKENDS, SUPPORTED_WHEN_BACKENDS, PROVENANCE_BACKENDS,
AUDIT_OP_BACKENDS, AUDIT_LIFECYCLE_BACKENDS, INTEGRATION_BACKENDS
```

Their diagnostics are unreachable for any shipping platform. Two genuine gaps remain and should be
kept: `PROJECTION_DOCUMENT_AGG_SUPPORTED` (no java) and `AUDITED_RETURNING_UNSUPPORTED` (node).

This is good news — parity really did close — but the drained sets are now maintained code, test
fixtures and catalog entries that gate nothing. Worth a deliberate keep-or-delete pass rather than
leaving them to be re-read by every future contributor.

### P2-4. `packages/` is publish-shaped, not publish-tested

Five of six workspaces are single-file re-exports. `backend-hono-v5` is 2 files / 118 lines that
call `makeHonoPlatform(BACKEND_PINS)` from `../v4/index.js`; v4 is 20 files / 13,749 lines. The
`fs-discovery.ts` out-of-tree-backend path is therefore never exercised against a backend that
genuinely lives outside `src/`.

That may be exactly the intent ("publish-shaped", not published). Worth stating explicitly in
`docs/platforms.md` so the next contributor does not read the layout as a working plugin system.

---

## Suggested order

| # | Item | Effort | Why first |
|---|---|---|---|
| 1 | **P0-3** shared-seam path filters | S | One test + a few workflow edits; closes a live blind spot on the largest backend |
| 2 | **P1-3** `npm audit fix` | XS | Two high-severity advisories, one command |
| 3 | **P0-1** waiver expiry + drain 23 | S | Mechanical; converts silent debt into a failing test |
| 4 | **P1-5** lint warnings → errors | XS | One `--write` pass, then the hook enforces it |
| 5 | **P1-1** unreachable-gate test | S | Two files; the gate prevents the next rename orphan |
| 6 | **P0-4** OIDC audience | M | Security default + a real cross-backend divergence |
| 7 | **P1-4** `knip` in lint | M | Removes a recurring manual sweep (#2897 was one) |
| 8 | **P0-2** drain 42+31 census waivers | L | The real work; script the case-set diff first |
| 9 | **P1-2** string-tier ratchet + drain | L | Biggest long-term payoff; needs the ledger drain to become a chore |
| 10 | **P2-1/2/3/4** | — | Decide, then do in one pass each |

## Method

`tsc -b` (clean) · `biome ci` (exit 0, 23 warnings) · `vitest run` · `npm audit` · path-filter
extraction across all 67 workflows · reason-constant census of `ir-walk-census.test.ts` ·
`git log --merges` churn split over the last 60 PR merges · a reachability scan of every exported
symbol in `src/` against `src/` + `test/` + `web/` + `scripts/` + `packages/` + `bin/` · targeted
reads of the five OIDC emitters, `sql-pg.ts`, `money-scale.ts`, and `applyPolicyDenies`.

Not covered: runtime behaviour of the generated stacks (no Docker tiers were booted), the
playground/`web` package, and the design packs.
