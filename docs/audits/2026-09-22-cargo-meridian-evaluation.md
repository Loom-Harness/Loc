# Meridian freight-forwarding adoption evaluation — findings register (ported)

> **Ported 2026-09-29** from the unmerged branch `claude/loom-platform-eval-mc2v5j` (`eb5f37db9 2026-09-22`), register `eval-cargo/`. The branch was never merged and is not meant to be: it carries generated trees. This page keeps the **findings and the repro sources only** — the generated output, the application models and the evaluation report stay on the branch ([browse it](https://github.com/Loom-Harness/Loc/blob/claude/loom-platform-eval-mc2v5j/eval-cargo)). Relative links in the ported text point at the branch.
>
> It is a snapshot: the verified-status section below is the 2026-09-28 re-verification against `main` @ `d2a0bc02` (repros re-run with `ddd parse` / `generate system`, emitted code read, no stack booted), updated 2026-09-29 with what has landed or been claimed since. The live plan is `docs/new-plan/` (this register's row is in `coverage.md`). Finding ids are this register's own; the same `F-0nn` means different defects in other registers.

An adoption spike: a 455-line freight-forwarding model (`meridian/main.ddd` on the branch) built end to end and compiled across targets. Findings F-001–F-013, two matrix twins (a Java F-010, a Python F-008) and adoption conditions C1–C7 (`EVALUATION-REPORT.md` on the branch). Distinct from the earlier `2026-09-10-freight-*` audit.

## Verified status (re-verified 2026-09-28, updated 2026-09-29)

### Since 2026-09-28

- **F-004** (gate on an event-sourced create): #3048 **merged** — item **#4** re-verified FIXED on main. The false `docs/language.md` sentence ("a hand-written `create` cannot carry its own gate") is corrected by the PR that ported this register (G8-01).
- **F-012** (drizzle journal renumbering): #3049 **merged** after this table was written; not re-verified here.
- **F-008-py** (python cross-context VO read *and* written as an opaque column): [#3060](https://github.com/Loom-Harness/Loc/pull/3060) still open.
- **C2** (node Dockerfile never runs `tsc --noEmit`): item **#19**, [#3085](https://github.com/Loom-Harness/Loc/pull/3085) (Wave A6).
- **F-006** diagnostic (a policy used from another context types as `unknown`): item **#39**, owner ruling **D9** — `loom.policy-out-of-scope` in eval-closure wave C3; sharing a policy/permission vocabulary → [M-T3.23](../new-plan/T3-security-governance.md).
- **F-002 residual** (ICU `plural`/`select` branch text lost in domain code): item **#38**, ruling **D8** — a warning in wave C6, rendering → [M-T5.46](../new-plan/T5-language-core.md).
- **F-011 residual** (demo `orgId` matches no `Org` row): item **#26**, wave C3.
- **Incidental** (a `crudish` field named like a `resource` → spurious `loom.lifecycle-body-dropped`): item **#17**, ruling **D7** (params and lets shadow resources), [#3093](https://github.com/Loom-Harness/Loc/pull/3093) (Wave B2).
- **#3033's "other `ctx.enums` consumers"** follow-up: M-T6.80.

### The 2026-09-28 re-verification

Column key: *register-status* is what the register itself said; *true-status* is what re-running it on `main` showed (FIXED-VERIFIED / OPEN-TRACKED / OPEN-UNTRACKED / DECLINED / WRONG-CLAIM / UNVERIFIABLE). "Items #N" elsewhere on this page are the evaluation-closure review's deduplicated item numbers.

Source: `origin/claude/loom-platform-eval-mc2v5j` → `eval-cargo/FINDINGS.md` (F-001…F-013, plus a cross-target compile matrix that adds a Java twin of F-010 and a Python twin of F-008), `eval-cargo/EVALUATION-REPORT.md` (adoption conditions C1–C7), `eval-cargo/repro/*.ddd`, `eval-cargo/meridian/main.ddd`. Evaluated at `86628b3f` on 2026-09-22. That makes 16 auditable items: 13 findings, 2 matrix twins, and C2. C1/C3/C4/C5 restate the findings; C6/C7 are governance.

Method: I re-ran every repro from a worktree of the ref with `node bin/cli.js parse|generate` on main and read the emitted code. I read the PR bodies of every PR that names a finding. For each fix I checked the landed commit and its test file. Docker was not run, so the runtime claims are checked statically.

#### Table

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-001 `route` reserved as field name, misdirecting parse error | Med (DX) | open | **FIXED-VERIFIED** | #3036 (d0a42555a) makes `route/type/index/user/link` field names legal. A repro with `route:` and `state:` fields now parses with 0 errors. | The systemic pass (all soft keywords, plus a keyword-then-`:` error that names the word) is claimed by draft #3063. |
| F-002 ICU format specs dropped; `{x, date}` does not compile | SILENT/High | open | **FIXED-VERIFIED** (compile half), plus a DECLINED/by-design residual and an **OPEN-UNTRACKED** sub-gap | #3039 (b86a5ed53). `icu.ddd` on main emits `get d(): string { return this._placedAt.toISOString(); }`. The PR proves this with tsc, dotnet, gradle and mypy. | Backends still drop the format: `m` → `this._total.toString()`, `p` → `String(this._qty)`, `sel` → `this._name`. That is intended: `docs/new-plan/archive/T1-done.md` §M-T1.11 says "a backend `derived` stays byte-identical … format dropped", and #3039 says the same. Left over: in domain code, a `plural`/`select` hole silently loses its authored branch text (`# items`, `VIP`), and nothing warns about it. |
| F-003 aggregate with no `create` exposes no POST, silently | Med | open | **FIXED-VERIFIED** | #3044 adds the `loom.aggregate-not-constructible` advisory. It fires on `ctor2.ddd`, `constructible.ddd` and `icu.ddd` on main. #3041 fixed the `api` row in `docs/language.md`. `docs/language-reference/03-domain-modeling.md:34` documents it. | It is shipped as a Suggestion, not a warning. That was chosen on purpose: 61 true hits, and a create-less aggregate is a legal design. |
| F-004 `denyByDefault` cannot gate a hand-written or ES `create`; ⊗ `eventLog` | High (blocks gen) | open | **OPEN-TRACKED** (#3048, ready, `blocked`). Also a **WRONG-CLAIM** in the register, and a WRONG-CLAIM now in docs on main | On main, `esgate2.ddd` (named ES create, no gate) → `loom.default-deny-ungated` error. The same create with `requires IsAdmin()` in the body → **0 errors**, yet node emits `if (!(currentUser.role === "admin")) throw new ForbiddenError(…)` into `domain/acct.ts` without importing either name. That is a silent TS2304, which #3048 §2 describes. The deny message still says "Add a `requires <expr>`" without saying where the gate goes (#3048 change 4 has not landed). | **Wrong claim 1 (register):** a state-based create *can* be gated. I added `create(name) { requires IsAdmin() }` to `denycreate.ddd` → 0 errors. **Wrong claim 2 (main docs):** `docs/language.md:1150`, written by #3041 from the register, says "a hand-written `create` cannot carry its own gate". That is false. The header-form error in `createreq.ddd` also misdirects ("a 'requires' gate belongs on the route that reaches it"). **Severity went up:** #3054 (M-T3.1) made `denyByDefault` the default. `esgate2.ddd` with the `enforcement:` line removed still errors, so every ES aggregate with a create in an `auth: required` deployable is now unbuildable by default until #3048 lands. |
| F-005 `tenancy by` does not reach aggregates in imported files | High | open | **FIXED-VERIFIED** | #3038 (e83d08a16). Test: `test/language/validators/tenancy-multifile.test.ts` (2/2 pass). My own 2-file repro (a root `subdomain` in `model/dom.ddd` imported by `main.ddd`) gives 0 errors, and the tenant filter is emitted in the repositories. | |
| F-006 `policy`/`permissions` scoped narrower than documented; poor diagnostic | Med | open | Docs half **FIXED-VERIFIED**. The scope limit is **documented design**. The diagnostic is **OPEN-UNTRACKED** | #3041: `docs/language.md:343` now says policies are context-level; `:272` says permissions are subdomain-local and mint distinct strings. `polscope.ddd` on main still reports `'requires' must be of type 'bool', got 'unknown'` (`src/diagnostics/messages.ts:1000`). | No mission for "policy not in scope here" wording, and none for sharing a policy/permission vocabulary across contexts or subdomains. The duplicate-permissions drift risk has no owner. |
| F-007 shared-kernel VO inside a local VO → Zod used before declared (react/vue/svelte) | SILENT | open | **FIXED-VERIFIED** | #3034 (de4b2fda1). `zodorder/c-all-frontends.ddd` on main: `CodeSchema` comes before `OuterSchema` in web, web_v and web_s. | |
| F-008 cross-context VO: migration SQL vs ORM disagree (node) | SILENT/runtime | open | **FIXED-VERIFIED** on node, dotnet and java | #3033 (1ac77cbbf) adds `enumPool`/`valueObjectPool` to migrations and routes. `voxctx.ddd` on main: node, java and dotnet all emit `spot_value TEXT` in both the migration and the ORM. Elixir uses `:map` on both sides (consistent). | #3033's body says other `ctx.enums` consumers may still filter locally ("mechanical follow-up"). Nothing tracks that. |
| F-008-py (matrix) python ORM `location_value` vs hydrator `row.location` | SILENT/runtime | matrix row | **OPEN-TRACKED** (draft #3060, Gap B) | `vox-python` on main, `away_repository.py`: the write is `"spot": aggregate.spot`, the read is `spot=row.spot`, and the schema is `spot_value`. Same-context `home_repository.py` is correct. | So the fix reached only some backends. #3060 says "the write half flattens correctly", but on main the **write is broken too** (`"spot": aggregate.spot`, `set_={"spot": …}`). #3060 should widen its claim. |
| F-009 node `domainService` precondition uses `DomainError` without importing it | SILENT | open | **FIXED-VERIFIED** | #3028 (bdafa1d6a). `svcproj.ddd` on main: `domain/services.ts` imports `{ DomainError } from "./errors"`. Test `domain-service-precondition-error-import.test.ts` also asserts the other 4 backends. | |
| F-010 select-only projection publishes an empty row schema (node TS2352) | SILENT | open | **FIXED-VERIFIED** | #3030 (c971bc664), fixed at the enrich level. On main, node emits `ByStatusRow = z.object({ st, n, tot })`. Test: `projection-select-only-wire-shape.test.ts`. | |
| F-010-java (matrix) projection record has no components | build fail | matrix row | **FIXED-VERIFIED** | On main, the java repro emits `public record ByStatusRow(St st, int n, String tot)`. | |
| F-011 generated Keycloak realm cannot satisfy the model (no role/org_id mapper, no permissions, demo has no attrs) | Med/operational | open | Mappers **FIXED-VERIFIED**. The permission roles are **DECLINED** (by design). The demo tenant is **OPEN-UNTRACKED** | #3027 (flat-path `claims:` hole). The realm generated for Meridian on main has `loom-claim-role→role` and `loom-claim-orgId→org_id`, and demo attrs `{role:[admin], orgId:[demo-org-id]}`. | The declared permissions (`shipping.bookCargo`, …) are still not realm roles. That is deliberate, per `src/system/index.ts:1086-1110`: authority claims are never seeded. Left over: the demo `orgId` `"demo-org-id"` matches no `Org` row, so the demo user still sees every tenant list empty. Stale draft #2948 covers the mappers and unmanaged-attribute policy, not this. |
| F-012 drizzle journal renumbers on insert → evolution skipped; provenance crash | HIGH/operational | open | **OPEN-TRACKED** (#3049, ready, `blocked`, `run-migration-e2e`) | On main, `src/generator/typescript/emit/migrations.ts:113` is still `when: versionToEpochMillis(row.version) + idx`. | Node only. #3049 argues EF, Flyway, Alembic and Ecto track migrations by identity. It also found that `migration-evolution-e2e`'s paths filter omitted the defective file. |
| F-013 .NET request validator uses `Regex` without its `using` | SILENT build fail | open | **FIXED-VERIFIED** | #3028 (`validator-emit.ts` Requests site now takes `usings`; test `request-validator-usings.test.ts`). The PR isolated the trigger the register could not: a VO riding an **operation param**. `regexsys.ddd` on main has `Regex.IsMatch` only in `Domain/ValueObjects/Code.cs`, which carries its using. | |
| C2 node Dockerfile should run `tsc --noEmit` before `tsup` | adoption condition | recommendation | **OPEN-UNTRACKED** | The emitted `api/Dockerfile` runs `npm run build` = `tsup` only. `typecheck` exists in `package.json` and nothing runs it. No mission or PR mentions it (grep of `docs/new-plan`, `docs/audits`). | The register says this is "the previous evaluations' condition C5, still open". It is still open, and it is the reason node TS errors ship. |

Not audited as findings: the elixir, feliz and flutter matrix cells are **UNVERIFIABLE** as the register itself records them (sandbox proxy, no SDK). C6/C7 (tags, second maintainer) are governance. C1/C3/C4/C5 are the conditions behind F-007/8/12/4. C1, "generate fails when its own output does not compile", has no mission; it is an architectural ask.

##### Session ids in the brief (not from this register)
- **"F-004: denyByDefault cannot gate a create"** is this register's F-004 → #3048 (open).
- **H1 "envForNode has no DomainServiceOperation arm"** comes from `docs/audits/2026-09-13-testability-audit.md` F1 (language half), not from Meridian. Still open on main (`grep -c isDomainServiceOperation src/language/type-system.ts` = 0). **OPEN-TRACKED** by #3040 (ready, blocked).
- **H2 "reading domainService derefs getById unguarded"** comes from the P6 handoff, not Meridian. **FIXED-VERIFIED** by #3035 (9eb9f0314): .NET adds a `?? throw AggregateNotFoundException` guard and elixir raises `Ecto.NoResultsError` in `render-expr.ts`, with tests in `domain-service-reading.test.ts` for dotnet and elixir. #3035 also reported, and did not fix, that `Owners.findById` in a reading body on .NET is CS1061. That is untracked (outside this register).

#### Incidental finding (new, not in register)
- A `with crudish` aggregate with a field that has the same name as a system `resource` (`st: string` plus `resource st {…}`) fails with a spurious `loom.lifecycle-body-dropped` error on crudish's own create. It looks like the create's `st := st` resolves to the resource. Repro: `min2.ddd` (fails) vs `min3.ddd` (resource renamed, passes) in `tmp-u-cargo/`. Untracked. The eval's `svcproj.ddd` never hit it because it had no `system`.

#### Register on main?
No. `eval-cargo/` exists only on the eval branch, and main has no mention of "Meridian", "eval-cargo" or the branch name. Its content survives on main only indirectly:
- in the fix commits and PR bodies ("found by building a freight-forwarding domain end to end": #3028, #3030, #3033, #3034, #3036, #3038, #3039, #3041, #3048, #3049);
- in docs `#3041` corrected.

`docs/audits/2026-09-10-freight-*.md` is an **earlier, different** freight audit. No `docs/new-plan` mission or register row cites F-001…F-013. The C2 recommendation, the F-006 diagnostic, the F-002 plural/select residual and the F-011 demo-tenant residual therefore exist nowhere on main.

#### PR state from this evaluation
- Merged: #3028 (F-009, F-013), #3030 (F-010), #3033 (F-008 node/java/dotnet), #3034 (F-007), #3036 (F-001), #3038 (F-005), #3039 (F-002 compile), #3041 (F-003/F-004/F-006 docs), #3027 (F-011 mappers; conformance-driven), #3044 (F-003 advisory; from a sibling claims eval).
- Open: **#3048** (F-004, ready, blocked; it touches the `docs/language.md` line #3041 added and explicitly defers to it), **#3049** (F-012, ready, blocked).
- Draft: #3060 (F-008 python twin), #3063 (reserved-keyword systemic).

#### Top problems
1. **F-004 got worse after the report.** #3054 made `denyByDefault` the default, so an event-sourced aggregate with a create is now unbuildable under default auth. A body `requires` on a *named* ES create passes validation and emits code that does not compile (`currentUser`/`ForbiddenError` not imported). The fix, #3048, is open and blocked.
2. **Main docs repeat the register's wrong claim.** `docs/language.md:1150` (via #3041) says a hand-written `create` cannot carry a gate. It can, as a first body statement. The deny diagnostic still does not say where the gate goes.
3. **F-012 is still live on main.** The first model evolution on node silently skips its migration, and crashes the boot when a model has `provenanced` fields. #3049 is ready but blocked.
4. **F-008 is fixed on only some backends.** Python still reads *and writes* a cross-context VO as an opaque column. #3060 is a draft whose claim understates the defect (it says the write half works).
5. **Untracked:** C2 (no `tsc` in the node Dockerfile, so every node type error ships), the F-006 scope diagnostic, the F-002 silent loss of plural/select text in domain code, and the F-011 demo tenant id that matches no registry row.

Recommendation: do not merge `eval-cargo/` wholesale (1153-file matrix output and a 455-line model). Port it as a short `docs/audits/2026-09-22-meridian-adoption.md` with a disposition table (this one), and add mission rows for the four untracked items plus the docs correction at `language.md:1150`.

## The register, as filed

*`eval-cargo/FINDINGS.md` on the branch, verbatim except that headings are demoted one level and relative links point at the branch.*

## Meridian evaluation — findings

Repo `Loom-Harness/loc` @ `86628b3f`, evaluated 2026-09-22.
Severity: **SILENT** = `parse`/`generate` report 0 errors, defect appears later (build or runtime).

| # | Severity | Title |
|---|---|---|
| F-001 | Medium (DX) | `route` is a reserved field name; parse error points at the *next* line and says "Expecting `}`" |
| F-002 | **SILENT / High** | ICU format specs in interpolation are dropped on the backend; `{x, date}` emits non-compiling TypeScript |

---

### F-001 — `route` cannot be used as a field name; the diagnostic misdirects

`route` is a keyword in the `api { }` body (`route GET "/x" -> handler`). Used as an
aggregate field name it is a parse error — but the error is reported on the **following**
line, as a generic "Expecting token of type '}'".

```ddd
aggregate Cargo {
  customer: Customer id
  route: RouteSpecification      // <- the real problem
  bookedAt: datetime
}
```
```
booking.ddd:29:5 error: Expecting token of type '}' but found `route`.
```
The message names `route` but frames it as a block-termination problem, so the natural
reading is "I have an unbalanced brace above". Cost me a wrong-line hunt.
Same defect class as the prior evaluations' `state` / `member` findings — a reserved-word
collision with no reserved-word diagnostic.

**Workaround:** rename the field (`routeSpec`).

### F-002 — ICU format specs are silently dropped; `{x, date}` emits code that does not compile

`docs/language.md` documents format suffixes on interpolation holes:
`{total, number, ::currency/USD}`, `{n, plural, one {# item} other {# items}}`,
`{at, date}`, `{n, number, ::percent}`, `{kind, select, …}`.

All five parse with **0 errors, 0 warnings** and all five are **dropped** by the node
emitter — the format, and in the `plural`/`select` cases the declared literal text, vanish:

| Source | Generated (node) |
|---|---|
| `` `{total, number, ::currency/USD}` `` | `this._total.toString()` |
| `` `{qty, plural, one {# item} other {# items}}` `` | `String(this._qty)` |
| `` `{qty, number, ::percent}` `` | `String(this._qty)` |
| `` `{name, select, vip {VIP} other {std}}` `` | `this._name` |
| `` `{placedAt, date}` `` | `this._placedAt`  ← **type error** |

The last one does not compile. `_placedAt` is a `Date`; the getter is declared `string`:

```
$ ddd parse icu.ddd        → 0 error(s), 0 warning(s).
$ ddd generate ts icu.ddd  → Wrote 27 file(s)
$ npm install && npx tsc --noEmit
domain/order.ts(34,21): error TS2322: Type 'Date' is not assignable to type 'string'.
```

Repro: `eval-cargo/repro/icu.ddd`.

**Impact.** A money label that silently renders `1234.5` instead of `$1,234.50`, and a
pluralisation whose text disappears, are wrong-output bugs a reviewer will not catch in a
diff. The `date` case is worse only in being noisy.

---

### F-003 — An aggregate with no `create` action silently exposes no creation endpoint

`docs/language.md` (the `api` row) says aggregates expose `all / byId / create / update / delete`.
In fact a create route is emitted only when the aggregate declares an unnamed `create(...)`
or `with crudish`. Without one you get `GET /{id}`, `GET /`, the operation routes — and no
way to create the record. `parse` reports **0 errors, 0 warnings**.

```
$ grep 'path:' ctor2-out/http/flat.routes.ts     # aggregate Flat: no create, no crudish
path: "/{id}"     path: "/{id}/finish"     path: "/"
```
Repro: `eval-cargo/repro/ctor2.ddd`. I hit this on both `Cargo` and `Invoice` in the real
model and only noticed by reading the emitted route table.

**Note the contrast:** if you *call* `Agg.create({…})` from a `test`, the compiler produces
an outstanding error explaining non-constructibility and what to do. The silent case is only
when you never call it.

### F-004 — `denyByDefault` cannot be satisfied for a hand-written or event-sourced `create`

**This blocks generation, and for event sourcing there is no workaround.**

`loom.default-deny-ungated` demands a `requires` gate on every reachable command, including
`Agg.create`. The grammar has no `requires` slot on `create`
(`src/language/ddd.langium:1930` — `'create' (name=ID)? '(' params ')' (audited?='audited')? '{'`):

```
$ cat createreq.ddd            # aggregate Thing { create(name: string) requires CanMake() { } }
createreq.ddd:5:26 error: Expecting token of type '{' but found `requires`.
```

So the diagnostic's own suggested fix — *"Add a `requires <expr>` (use `requires true` to
allow anonymous access)"* — **is not expressible**. `docs/language.md` likewise lists
`requires` as "a header clause on `operation` / `create` / `handle` / `find` / `projection`";
it is not accepted on `create`.

Escapes, by aggregate kind:

| Aggregate | Escape |
|---|---|
| state-based, hand-written `create` | replace with `with crudish(requires: P)` — works, but swaps your factory for the macro's and re-opens a generic `update` surface |
| **`persistedAs: eventLog`** | **none.** `crudish` is structurally rejected on an ES aggregate ("declares multiple 'create' actions" / "must not mutate 'this' directly"), and there is no `requires` on `create`. |

Net: **`enforcement: denyByDefault` and `persistedAs: eventLog` are mutually exclusive** —
an event-sourced aggregate may have a creation endpoint, or the recommended security
posture, not both. Proven three ways in `eval-cargo/repro/esgate{,2,3}.ddd`:

```
ES + create + denyByDefault   → 1 error, generation refused (ungateable)
ES + crudish(requires:)       → 3 errors (crudish incompatible with event sourcing)
ES with no create at all      → 0 errors — but the aggregate can never be created
```

### F-005 — `tenancy by` does not reach aggregates in imported files

Multi-file projects and multi-tenancy are both headline features; together they fail.
The identical model, split across an `import`, stops compiling:

```
# one file:  system { tenancy by user.orgId of Org; aggregate Doc with tenantOwned … }
→ 0 errors
# same model, aggregates moved to ./model/dom.ddd and imported:
model/dom.ddd:1:1 error: 'currentUser.orgPath' requires a 'tenancy by user.<claim> of
  <Registry>' declaration — … Add the tenancy line, or drop the 'orgPath' reference.
```
The tenancy line *is* present, in `main.ddd`. Moving it into the imported file is not
possible either — `tenancy` is not admitted at file root
(`Expecting token of type 'EOF' but found 'tenancy'`).

**Exact constraint** (`repro/ten-multi3`): every `tenantOwned` aggregate must live in the
*same file* as the `tenancy by` declaration. Unrelated files may still be imported. For a
multi-context domain this forces the whole domain into one file — mine went from four
files to one.

### F-006 — `policy` and `permissions` are scoped far narrower than documented

`docs/language.md` calls a named policy function "a reusable, **ambient** boolean
authorization predicate". It is context-local:

```
# policy IsAdmin() declared in context A, used from context B:
polscope.ddd:10:36 error: 'requires' must be of type 'bool', got 'unknown'.
```
`permissions { }` blocks are subdomain-local in the same way. Both must be copy-pasted into
every context/subdomain that references them — my consolidated model carries five policy
declarations **four times**.

Worse for `permissions`: the identifier lowers to `<lowercase-subdomain>.<name>`, so the
duplicated declaration is not the same permission. `permissions.routeCargo` declared in
`Shipping` and in `Operations` yields **two distinct runtime strings**
(`shipping.routeCargo`, `operations.routeCargo`), both of which the IdP must now grant.
Duplicating a security vocabulary across subdomains is precisely where drift becomes a
vulnerability.

Secondary: the diagnostic is one of the few poor ones — `'requires' must be of type 'bool',
got 'unknown'` reads as a type problem, not "no policy of that name is in scope here".

### F-007 — **SILENT**: a shared-kernel value object inside another value object emits out-of-order Zod schemas; react / vue / svelte do not compile

The shared kernel is the textbook place to put a type two contexts share. Put a root-level
`valueobject` inside a context-local `valueobject`, and the generated frontend references
the inner schema **before it is declared**:

```ts
// web_app/src/api/cargo.ts — generated, 0 errors reported
export const RouteSpecificationSchema = z.object({
  origin: UnLocodeSchema,          // ← line 9
  ...
export const UnLocodeSchema = z.object({ … });   // ← line 13
```
```
src/api/cargo.ts(9,11): error TS2448: Block-scoped variable 'UnLocodeSchema' used before its declaration.
src/api/cargo.ts(9,11): error TS2454: Variable 'UnLocodeSchema' is used before being assigned.
=> docker compose build web_app: "npm run build" exit code 2
```

Emission is in declaration order with context-local VOs first, so it is specifically the
**root-level → context-local** direction that inverts. Isolated in `repro/zodorder/`:

| Shape | Order emitted | Result |
|---|---|---|
| both VOs in the same context | `Inner`, `Outer` | compiles |
| inner VO at model root, outer in a context | `Outer`, `Code` | **TS2448 / TS2454** |

**Blast radius** — the three frontends that emit runtime Zod `const`s:

| Frontend | Emits | Affected |
|---|---|---|
| react | `export const XSchema = z.object(…)` | **yes** |
| vue | same | **yes** |
| svelte | same | **yes** |
| angular | `export interface XResponse` (hoisted) | no |

`ddd generate system` reports `0 error(s)`; the failure is a `docker compose build` away.
This is the defect class the previous evaluations named as their top blocker, in a new shape.

### F-008 — **SILENT / runtime-breaking**: a cross-context value object makes the migration SQL and the ORM schema disagree on column name *and* type

Referencing a `valueobject` declared in **another context** — the ordinary DDD shared-type
move — emits a database schema the generated ORM cannot read.

Same field, same run, two generated artifacts (`repro/voxctx.ddd`):

| Aggregate | Migration SQL | Drizzle ORM schema | Agree? |
|---|---|---|---|
| `Owner.Home.spot` (VO in the same context) | `"spot_value" TEXT NOT NULL` | `spot_value: text("spot_value")` | ✓ |
| `Consumer.Away.spot` (**VO from another context**) | `"spot" JSONB NOT NULL` | `spot_value: text("spot_value")` | ✗ **name *and* type** |

The database gets a JSONB column called `spot`; the ORM reads and writes a TEXT column
called `spot_value`, which does not exist. `ddd generate system` reports `0 error(s)`, both
files are valid TypeScript/SQL, and every compile-time gate passes — the disagreement is
only observable against a live database.

The same divergence is present in my real model (`Handling.CargoReceived.location`,
`Handling.CargoLoaded.location`, VO `UnLocode` declared in `Booking`).

#### F-007 + F-008 together: a shared value object has no correct home

| Where you declare the shared VO | react / vue / svelte build | migration ↔ ORM |
|---|---|---|
| model root (the documented shared kernel) | **fails — TS2448** (F-007) | consistent |
| inside one context, used from another | compiles | **diverges — runtime failure** (F-008) |

Both placements are documented as supported. Each breaks a different layer, and neither
is reported at generate time. The only shape that works is duplicating the value object
into every context that uses it, which defeats the point of a shared kernel.

### F-009 — **SILENT**: `domainService` precondition emits an unimported `DomainError`; the guard becomes a `ReferenceError` at runtime

A `domainService` operation with a `precondition` emits a `throw new DomainError(...)` into
`domain/services.ts`, which imports only `decimal.js`:

```ts
// domain/services.ts — generated, complete import list
import Decimal from "decimal.js";
export namespace Calc {
  export function quote(km: number, rate: Decimal): Decimal {
      if (!(km > 0)) throw new DomainError("Precondition failed: km > 0");   // ← never imported
```
```
domain/services.ts(7,40): error TS2304: Cannot find name 'DomainError'.
```

Runtime proof (`repro/svcproj.ddd`, executed with `tsx`):
```
ok: 20                                        # happy path fine
threw: ReferenceError | DomainError is not defined     # the guard path
```
So the declared business rule does not reject the input — it crashes the process path. A
`precondition` that should surface as **422 Unprocessable Entity** surfaces as **500**.

**Why it ships:** the generated `Dockerfile` builds with `tsup` (esbuild), which strips types
without checking them. `npm run typecheck` exists in the emitted `package.json` but nothing
runs it, so `docker compose build` succeeds on a project that `tsc --noEmit` rejects. This is
the previous evaluations' condition C5, still open.

### F-010 — **SILENT**: a query-time projection publishes an empty response schema

A `projection … { from X group by … select a = …, b = … }` emits its row schema with **no
properties**:

```ts
const OutstandingByStatusRow = z.object({
}).openapi("OutstandingByStatusRow");
...
return httpCtx.json(projected as z.infer<typeof OutstandingByStatusResponse>, 200);
```
```
http/query-projections.ts(63,27): error TS2352: Conversion of type '{ status: …;
  invoiceCount: number; outstanding: string; }[]' to type 'Record<string, never>[]'
  may be a mistake because neither type sufficiently overlaps with the other.
```

The runtime response is **correct** — I verified it against the booted stack:
```
GET /api/projections/outstanding_by_status
[{"status":"Issued","invoiceCount":1,"outstanding":"2500.0000"}]
```
but the **published contract is not**:
```
GET /openapi.json → components.schemas.OutstandingByStatusRow
{ "type": "object", "properties": {} }
```
Any client generated from this OpenAPI document sees a projection with no columns. Repro:
`repro/svcproj.ddd`.

### F-011 — the generated Keycloak realm cannot satisfy the model it was generated from

`ddd generate system` emits a working `keycloak` compose service with an imported realm — a
genuinely nice touch. But the realm is **not derived from the model's own auth configuration**:

| The model declares | The generated realm contains |
|---|---|
| `claims: { role: "role", orgId: "org_id", permissions: "realm_access.roles" }` | one `oidc-audience-mapper`, and no mapper for `role` or `org_id` |
| `permissions { bookCargo, routeCargo, invoiceRead, invoiceIssue, admin implies […] }` → runtime strings `shipping.bookCargo`, `finance.invoiceIssue`, … | realm roles `user`, `agent`, `admin` — none of the declared permissions |
| `tenancy by user.orgId of Org` | the `demo` user has no attributes at all |

So the bundled `demo` user gets a token with no `org_id` and no `role`. Against the stack as
shipped that user sees **every list empty** (the tenant filter matches nothing) and gets
**403 on every gated command**:

```
POST /api/cargos  → 403 {"title":"Forbidden","detail":"Forbidden: CanBook()"}
GET  /api/cargos  → 200 {"items":[],"total":0}
```

The generated code is correct — I confirmed it by provisioning Keycloak by hand (5 realm
roles, 2 protocol mappers, `unmanagedAttributePolicy: ENABLED`, per-user `org_id` matching
the `Org` row id). After that everything worked. But "boot the stack and it works" does not
hold for any model using roles, permissions or tenancy, and nothing in the output says so.

### F-012 — **HIGH / operational**: the first in-place model evolution silently skips its own migration, and crashes the boot if any field is `provenanced`

The migration journal keys each entry by `when = <module base timestamp> + <array index>`.
Inserting a migration **renumbers every later entry**, so the journal no longer agrees with
what the database recorded as applied.

Evolving my running system (added `notes: string?` and `priority: int = 3` to `Cargo`):

| tag | `when` in journal (after) | `created_at` recorded in DB (applied) |
|---|---|---|
| `20260101000000_shipping_initial` | 1767225600000 | 1767225600000 |
| `20260101500001_shipping_migrate` **(new)** | 1767405601001 | — |
| `20260102000000_operations_initial` | 1767312000**002** | 1767312000**001** |
| `20260103000000_finance_initial` | 1767398400**003** | 1767398400**002** |
| `20260104000000_platform_initial` | 1767484800**004** | 1767484800**003** |
| `29991231000000_provenance` | 32503593600**005** | 32503593600**004** |

Drizzle's migrator runs an entry only when `lastApplied.created_at < entry.when`. Two
consequences, both observed:

**1. The new migration is silently skipped.** Its `when` (1767405601001) is *lower* than the
highest applied value (32503593600004, the year-2999 provenance entry), so it never runs:
```sql
select column_name from information_schema.columns
 where table_schema='booking' and table_name='cargos' and column_name in ('notes','priority');
-- (0 rows)
```
The emitted SQL was correct — `ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3` then
`DROP DEFAULT`, exactly the safe pattern. It was simply never executed, with no error.

**2. If any field is `provenanced`, the API will not boot.** The provenance migration is
pinned to a year-2999 timestamp so it always sorts last, so it is *always* the entry whose
number increments — which makes it always newer than the recorded maximum, so it always
re-runs:
```
{"event":"migration_failed","error":"Failed query: ALTER TABLE \"billing\".\"invoices\"
  ADD COLUMN \"total_provenance\" JSONB NULL;"}
cause: error: column "total_provenance" of relation "invoices" already exists
Node.js v24.21.0     ← process exits; container never becomes healthy
```

The **first deploy is fine** — the whole chain applies in order against an empty database.
It is the second deploy, the first real evolution, that fails. That is the deploy where a
production database already has data in it.

Note the contrast with the *derivation* layer, which is genuinely careful: it refused an
unannotated rename (`drop [location_value] + add [location] … would DESTROY the renamed
column's data`), refused to re-baseline over an existing history, and refused a destructive
drop without `--allow-destructive`. The safety analysis is good; the journal's ordering key
is what breaks.

### F-013 — **SILENT**: .NET wire validators call `Regex.IsMatch` without `using System.Text.RegularExpressions`

A value-object invariant using `.matches(...)` is lifted into a FluentValidation request
validator that never imports the regex namespace:

```csharp
// Application/Cargos/Requests/CargoRequestValidators.cs — complete using list
using FluentValidation;
...
        RuleFor(x => x).Must(x => Regex.IsMatch(x.Value, "^[A-Z]{5}$"))
```
```
/src/Application/Cargos/Requests/CargoRequestValidators.cs(21,35):
  error CS0103: The name 'Regex' does not exist in the current context
=> dotnet build FAILED
```
The **domain** emitter gets this right — `Domain/ValueObjects/UnLocode.cs` does emit
`using System.Text.RegularExpressions;`. Only the wire-validator emitter forgets. Same
missing-import class as F-009 (node). Reproduced in `matrix/out/api_dotnet` from the
evaluation model; I did not isolate a smaller trigger.

---

## Cross-target compile matrix

One model (`eval-cargo/matrix/main.ddd`, 420 lines), one `generate system`, **1153 files**
across 11 deployables, `0 error(s)` reported. Then compiled each with its own toolchain:

| Target | Toolchain | Result | Cause |
|---|---|---|---|
| **node** (Hono) | `tsc --noEmit` | ❌ **FAIL** (3 errors) | F-009 (`DomainError` unimported), F-010 (empty projection schema) |
| **dotnet** (ASP.NET) | `dotnet build /warnaserror` | ❌ **FAIL** | F-013 (`Regex` missing `using`) |
| **java** (Spring Boot) | `gradle testClasses bootJar` | ❌ **FAIL** | F-010 twin — projection row emitted as a **record with no components**, then constructed with 3 arguments |
| **python** (FastAPI) | `ruff` ✓ + `mypy --strict` | ❌ **FAIL** (2 errors) | F-008 twin — ORM row declares `location_value`, hydrator reads `row.location` |
| **elixir** (Phoenix) | `mix compile` | ⚠️ not evaluated | environment: hex.pm returns `503` to Erlang's TLS stack through this sandbox's proxy (a *documented* Loom wrinkle with a documented workaround, `LOOM_HEX_MIRROR`) |
| **react** | `vite build` | ✅ pass | |
| **vue** | `vite build` | ✅ pass | |
| **svelte** | `vite build` | ✅ pass | |
| **angular** | `ng build` | ✅ pass | (host Node v22.22.2 is one patch below Angular CLI's v22.22.3 floor — **environment**; passes in a `node:24` container) |
| **feliz** (F#/Fable) | `dotnet fable` | ⚠️ not evaluated | no .NET SDK on host |
| **flutter** | `flutter analyze` | ⚠️ not evaluated | environment: Dart's `pub.dev` TLS fails through the proxy |

**4 of the 4 backends I could compile do not compile.** The three that fail hard (dotnet,
java, python) fail on ordinary modelling: a regex invariant, a `group by` projection, a
cross-context value object. The node failure is the most dangerous of the four, because its
own Dockerfile builds with `tsup`/esbuild and ships the broken code anyway.

Java is worth singling out: the **same** projection defect is a soft `tsc` error on node and
a hard compile failure on Java, which is what "one model, five backends" means in practice —
a single emitter gap costs you a whole target.

## Repro sources

*Every `.ddd` repro the register cites, copied from the branch. They are kept here as text so the repo-wide `.ddd` census does not treat deliberately-broken models as fixtures; copy one to a `.ddd` file to run it.*

### `eval-cargo/repro/constructible.ddd`

```ddd
context Ctor {
  enum S { Draft, Done }

  // A: guarded invariant over a containment — the ordinary "rule applies later" shape.
  aggregate WithGuard {
    status: S immutable = Draft
    contains lines: Line[]
    invariant lines.count > 0 when status == Done
    entity Line { note: string }
    operation finish() { status := Done }
  }

  // B: identical, minus the invariant.
  aggregate NoGuard {
    status: S immutable = Draft
    contains lines: Line2[]
    entity Line2 { note: string }
    operation finish() { status := Done }
  }

  repository A for WithGuard { }
  repository B for NoGuard { }
}
```

### `eval-cargo/repro/createbody.ddd`

```ddd
context CreateBody {
  event Opened { thing: Thing id, at: datetime }
  aggregate Thing {
    name: string
    tier: int
    create(name: string, tier: int) {
      precondition name.length > 0 message "name is required"
      precondition tier >= 1 && tier <= 3
      emit Opened { thing: id, at: now() }
    }
  }
  repository R for Thing { }
}
```

### `eval-cargo/repro/createreq.ddd`

```ddd
context CreateReq {
  policy CanMake(): bool = currentUser.role == "admin"
  aggregate Thing {
    name: string
    create(name: string) requires CanMake() { }
  }
  repository R for Thing { }
}
```

### `eval-cargo/repro/ctor2.ddd`

```ddd
context Ctor2 {
  enum S { Draft, Done }
  // C: flat aggregate, no containment, no crudish, no explicit create.
  aggregate Flat {
    name: string
    status: S immutable = Draft
    operation finish() { status := Done }
  }
  // D: flat + explicit create action.
  aggregate Explicit {
    name: string
    status: S immutable = Draft
    create(name: string) { }
    operation finish() { status := Done }
  }
  // E: flat + crudish.
  aggregate Crud with crudish {
    name: string
  }
  repository R1 for Flat { }
  repository R2 for Explicit { }
  repository R3 for Crud { }
}
```

### `eval-cargo/repro/ctor3.ddd`

```ddd
context Ctor3 {
  enum S { Draft, Done }
  // Guarded invariant + explicit create. The guard means a fresh (Draft) instance
  // can never violate it, so the aggregate IS satisfiable from the create input.
  aggregate Guarded {
    status: S immutable = Draft
    contains lines: Line[]
    invariant lines.count > 0 when status == Done
    entity Line { note: string }
    create(status: S) { }
    operation finish() { precondition lines.count > 0  status := Done }
  }
  repository R for Guarded { }
  test "construct a draft" for Guarded {
    let g = Guarded.create({ status: Draft })
    expect(g.status).toBe(Draft)
  }
}
```

### `eval-cargo/repro/denycreate.ddd`

```ddd
system DenyCreate {
  user { id: guid, role: string, permissions: string[] }
  auth {
    oidc { issuer: env("OIDC_ISSUER") clientId: "x" }
    enforcement: denyByDefault
  }
  subdomain S {
    context C {
      policy IsAdmin(): bool = currentUser.role == "admin"
      aggregate Thing {
        name: string
        create(name: string) { }          // <- no gate surface in the grammar
        operation rename(n: string) requires IsAdmin() { name := n }
      }
      repository R for Thing { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000, auth: required }
}
```

### `eval-cargo/repro/denycrud.ddd`

```ddd
system DenyCreate {
  user { id: guid, role: string, permissions: string[] }
  auth {
    oidc { issuer: env("OIDC_ISSUER") clientId: "x" }
    enforcement: denyByDefault
  }
  subdomain S {
    context C {
      policy IsAdmin(): bool = currentUser.role == "admin"
      aggregate Thing with crudish(requires: IsAdmin) {
        name: string
        operation rename(n: string) requires IsAdmin() { name := n }
      }
      repository R for Thing { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000, auth: required }
}
```

### `eval-cargo/repro/esgate.ddd`

```ddd
system ES {
  user { id: guid, role: string, permissions: string[] }
  auth { oidc { issuer: env("OIDC_ISSUER") clientId: "x" } enforcement: denyByDefault }
  subdomain S { context C {
    policy IsAdmin(): bool = currentUser.role == "admin"
    event Opened { a: Acct id, owner: string }
    aggregate Acct persistedAs: eventLog with crudish(requires: IsAdmin) {
      owner: string
      create open(owner: string) { emit Opened { a: id, owner: owner } }
      apply(e: Opened) { owner := e.owner }
    }
    repository R for Acct { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  resource el { for: C, kind: eventLog, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st, el], port: 3000, auth: required }
}
```

### `eval-cargo/repro/esgate2.ddd`

```ddd
system ES {
  user { id: guid, role: string, permissions: string[] }
  auth { oidc { issuer: env("OIDC_ISSUER") clientId: "x" } enforcement: denyByDefault }
  subdomain S { context C {
    policy IsAdmin(): bool = currentUser.role == "admin"
    event Opened { a: Acct id, owner: string }
    aggregate Acct persistedAs: eventLog {
      owner: string
      create open(owner: string) { emit Opened { a: id, owner: owner } }
      apply(e: Opened) { owner := e.owner }
    }
    repository R for Acct { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  resource el { for: C, kind: eventLog, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st, el], port: 3000, auth: required }
}
```

### `eval-cargo/repro/esgate3.ddd`

```ddd
system ES {
  user { id: guid, role: string, permissions: string[] }
  auth { oidc { issuer: env("OIDC_ISSUER") clientId: "x" } enforcement: denyByDefault }
  subdomain S { context C {
    policy IsAdmin(): bool = currentUser.role == "admin"
    event Opened { a: Acct id, owner: string }
    aggregate Acct persistedAs: eventLog {
      owner: string
      apply(e: Opened) { owner := e.owner }
    }
    repository R for Acct { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  resource el { for: C, kind: eventLog, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st, el], port: 3000, auth: required }
}
```

### `eval-cargo/repro/icu.ddd`

```ddd
context IcuProbe {
  aggregate Order {
    total: money
    qty: int
    placedAt: datetime
    name: string
    derived m: string = `{total, number, ::currency/USD}`
    derived p: string = `{qty, plural, one {# item} other {# items}}`
    derived d: string = `{placedAt, date}`
    derived pct: string = `{qty, number, ::percent}`
    derived sel: string = `{name, select, vip {VIP} other {std}}`
  }
}
```

### `eval-cargo/repro/polscope.ddd`

```ddd
system P {
  user { id: guid, role: string }
  subdomain S1 { context A {
      policy IsAdmin(): bool = currentUser.role == "admin"
      aggregate X with crudish { n: string }
      repository RX for X { }
  } }
  subdomain S2 { context B {
      aggregate Y { n: string
        operation touch() requires IsAdmin() { n := "x" } }
      repository RY for Y { }
  } }
  storage primary { type: postgres }
  resource sa { for: A, kind: state, use: primary }
  resource sb { for: B, kind: state, use: primary }
  deployable api { platform: node, contexts: [A, B], dataSources: [sa, sb], port: 3000, auth: required }
}
```

### `eval-cargo/repro/regexcs.ddd`

```ddd
context RegexCs {
  valueobject Code {
    value: string
    invariant value.matches("^[A-Z]{5}$")
  }
  aggregate Thing with crudish { code: Code }
  repository R for Thing { }
}
```

### `eval-cargo/repro/regexcs2.ddd`

```ddd
context RegexCs2 {
  valueobject Code {
    value: string
    invariant value.matches("^[A-Z]{5}$")
  }
  valueobject Route {
    origin: Code
    destination: Code
  }
  aggregate Thing with crudish { spec: Route }
  repository R for Thing { }
}
```

### `eval-cargo/repro/regexsys.ddd`

```ddd
system RegexSys {
  subdomain S { context C {
    valueobject Code { value: string  invariant value.matches("^[A-Z]{5}$") message "must be 5 uppercase letters" }
    valueobject Route { origin: Code  destination: Code  invariant origin != destination }
    aggregate Thing with crudish { spec: Route }
    repository R for Thing { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable apiDotnet { platform: dotnet, contexts: [C], dataSources: [st], port: 8080 }
}
```

### `eval-cargo/repro/svcproj.ddd`

```ddd
context SvcProj {
  enum St { Draft, Done }
  aggregate Bill with crudish {
    st: St immutable = Draft
    amount: money
  }
  repository R for Bill { }
  // (1) domainService whose operation carries a precondition
  domainService Calc {
    operation quote(km: int, rate: money): money {
      precondition km > 0
      return rate * km
    }
  }
  // (2) query-time projection with a group-by + aggregates
  projection ByStatus {
    from Bill as b
    group by b.st
    select st = b.st, n = count(), tot = sum(b.amount)
  }
}
```

### `eval-cargo/repro/ten-single.ddd`

```ddd
system T {
  user { id: guid, role: string, orgId: string }
  tenancy by user.orgId of Org
  subdomain S {
    context C {
      aggregate Org with tenantRegistry, crudish { name: string  derived display: string = name }
      aggregate Doc with tenantOwned, crudish { title: string }
      repository RO for Org { }
      repository RD for Doc { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-cargo/repro/votpc.ddd`

```ddd
system VoTpc {
  subdomain S { context C {
    valueobject Code { value: string }

    // 1. plain aggregate with a single-field VO
    aggregate Plain with crudish { spot: Code }

    // 2. TPC inheritance: abstract base + concrete subtype with a single-field VO
    abstract aggregate Base inheritanceUsing: ownTable {
      label: string
      derived display: string = label
    }
    aggregate Sub extends Base { spot: Code }

    // 3. TPH inheritance
    abstract aggregate BaseT inheritanceUsing: sharedTable {
      label: string
      derived display: string = label
    }
    aggregate SubT extends BaseT { spot: Code }

    repository RP for Plain { }
    repository RS for Sub { }
    repository RT for SubT { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-cargo/repro/votpc2.ddd`

```ddd
system VoTpc2 {
  subdomain S { context C {
    valueobject Plainvo  { value: string }
    valueobject WithInv  { value: string  invariant value.matches("^[A-Z]{5}$") }
    valueobject WithDer  { value: string  derived label: string = value }
    valueobject WithBoth { value: string  invariant value.matches("^[A-Z]{5}$")  derived label: string = value }

    aggregate A1 with crudish { f: Plainvo }
    aggregate A2 with crudish { f: WithInv }
    aggregate A3 with crudish { f: WithDer }
    aggregate A4 with crudish { f: WithBoth }
    repository R1 for A1 { }
    repository R2 for A2 { }
    repository R3 for A3 { }
    repository R4 for A4 { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
```

### `eval-cargo/repro/voxctx.ddd`

```ddd
system VoXCtx {
  subdomain S1 { context Owner {
    valueobject Code { value: string }
    aggregate Home with crudish { spot: Code }     // same-context use
    repository RH for Home { }
  } }
  subdomain S2 { context Consumer {
    aggregate Away with crudish { spot: Code }     // CROSS-context use
    repository RA for Away { }
  } }
  storage primary { type: postgres }
  resource s1 { for: Owner, kind: state, use: primary }
  resource s2 { for: Consumer, kind: state, use: primary }
  deployable api { platform: node, contexts: [Owner, Consumer], dataSources: [s1, s2], port: 3000 }
}
```

### `eval-cargo/repro/zodorder/a-same-context.ddd`

```ddd
system A {
  subdomain S { context C {
    valueobject Inner { value: string }
    valueobject Outer { a: Inner  b: Inner }
    aggregate Thing with crudish { spec: Outer }
    repository R for Thing { }
  } }
  ui U with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
  deployable web { platform: react, targets: api, ui: U, port: 3001 }
}
```

### `eval-cargo/repro/zodorder/b-root-inner.ddd`

```ddd
import "./inner.ddd"
system B {
  subdomain S { context C {
    valueobject Outer { a: Code  b: Code }
    aggregate Thing with crudish { spec: Outer }
    repository R for Thing { }
  } }
  ui U with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
  deployable web { platform: react, targets: api, ui: U, port: 3001 }
}
```

### `eval-cargo/repro/zodorder/c-all-frontends.ddd`

```ddd
import "./inner.ddd"
system B {
  subdomain S { context C {
    valueobject Outer { a: Code  b: Code }
    aggregate Thing with crudish { spec: Outer }
    repository R for Thing { }
  } }
  ui U  with scaffold(subdomains: [S]) { }
  ui UV with scaffold(subdomains: [S]) { framework: vue }
  ui US with scaffold(subdomains: [S]) { framework: svelte }
  ui UN with scaffold(subdomains: [S]) { framework: angular }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
  deployable web  { platform: react,   targets: api, ui: U,  port: 3001 }
  deployable webV { platform: vue,     targets: api, ui: UV, port: 3002 }
  deployable webS { platform: svelte,  targets: api, ui: US, port: 3003 }
  deployable webN { platform: angular, targets: api, ui: UN, port: 3004 }
}
```

### `eval-cargo/repro/zodorder/inner.ddd`

```ddd
valueobject Code { value: string }
```
