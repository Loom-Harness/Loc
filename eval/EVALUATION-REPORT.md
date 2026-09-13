# Loom — adoption evaluation

**Question:** should we build our next product (**Commons**, a customer community
platform) on Loom, and under what conditions?

**Method:** a time-boxed spike. I built my own application incrementally
(`eval/commons/`, 320 `.ddd` lines), ran it against a real Postgres and a real
OIDC provider, regenerated it onto every advertised target and compiled what I
could, evolved it against a populated database, and attacked it from outside.
Every claim below is backed by a command in `eval/EVAL-LOG.md` and a finding in
`eval/FINDINGS.md`. I read the maintainers' internal material only in Phase 6,
after the empirical work was done.

**Repo:** `Loom-Harness/loc` @ `bcd25e3e`. Evaluated 2026-09-13.

---

## 1. Recommendation

### **Pilot only.** Do not build Commons on Loom yet.

Not "do not adopt" — there is real engineering here, and on several axes it is
better than what we would build ourselves. But three things block production
commitment today, and all three are checkable:

1. **Four of the eleven targets do not compile the model I wrote**, each from an
   ordinary shape, with `parse` and `generate` green: a value object declared in
   another context (F-001), a field named `state` (F-015), a field named
   `member` (F-022), a `Tag id[]` (F-016), `mask unless` on Java (F-020), a
   `for` loop in a reactor (F-013/F-021). Build red minutes later — or, worse,
   build green and the defect reaches runtime (F-014).
2. **The recommended security posture cannot be expressed.** `denyByDefault` +
   `permissions` + a frontend crashes the generator (F-005), and `denyByDefault`
   does not gate list reads anyway (F-006). Commons' entire social graph would
   be enumerable by any signed-in account.
3. **Bus factor 1.** One human name in the entire visible commit history (the
   clone is shallow, so this is a ~3-week window, not the project's age); 669 of
   810 commits in that window authored by `Claude <noreply@anthropic.com>`. A
   single-maintainer project with an unusually high change rate.

### What would move it to *Adopt with conditions*

Each is a specific, checkable gate. I would re-run this spike against them.

| # | Condition | How we check it |
|---|---|---|
| C1 | F-001, F-014, F-015, F-016, F-020, F-021, F-022 fixed **and** each has a regression test that fails when reverted | Re-run `eval/repro/*.ddd`; ask for the test names; confirm they're in the per-PR tier, not a nightly |
| C2 | `renderGateExpr` no longer throws — every page-gate call site routes through `tryRenderGate` (the contract their **own** test already asserts) | `eval/repro/F005-ui-gate-crash.ddd` + a `find all() requires <policy>()` generates clean on react/vue/svelte/angular |
| C3 | `enforcement: denyByDefault` gates the auto-`findAll` list route, or refuses to compile without an explicit per-aggregate decision | The 8× `200` in F-006 becomes `403` |
| C4 | A **compile gate** for every target on every PR, plus a **per-target reserved-word map** | Ask to see the CI config; confirm `tsc --noEmit` / `dotnet build` / `gradle testClasses` / `mix compile` / `ng build` / `dotnet fable` / `flutter analyze` all run on generated output for one corpus model containing a shared VO, a field named `state`, a field named `member`, an `X id[]` and a `for`-loop reactor |
| C5 | Generated node backend type-checks in its own Dockerfile (`tsc --noEmit` before `tsup`) | F-014's broken output must fail `docker compose build` |
| C6 | A second maintainer with commit rights, or a written continuity plan | `git shortlog -sn` shows ≥2 humans over a quarter |
| C7 | A data-preserving path for moving an aggregate between contexts | `migration "m" { C.Thing -> D.Thing }` or equivalent emits `ALTER TABLE … SET SCHEMA` |

C1–C5 are weeks of work for someone who knows the codebase. C6 is a business
decision and is the one I would weight highest.

### What would move it to *Do not adopt*

If, on re-evaluation, the SILENT count has not fallen — if fixing these seven
surfaces three more of the same shape — then the defect class is structural
(one emitter per target, no shared conformance oracle over ordinary model
shapes) and no amount of individual bug-fixing closes it.

---

## 2. Claim verification matrix

Every claim is quoted verbatim from `README.md` unless marked otherwise.

| # | Claim | Grade | Evidence |
|---|---|---|---|
| 1 | "The speed of no-code. The keys to the codebase." | **Partial** | Speed is real: 320 `.ddd` lines → 225 files / ~26k lines, generated in 2.4s, booted in ~70s. "Keys to the codebase" is true only in the read/fork sense — see #3. |
| 2 | "All the speed of no-code" | **Verified** | 5→40 aggregates: 3.9s→6.6s, flat. 86:1 line amplification. §4. |
| 3 | "the keys to the codebase" / "full ownership of every line that's generated" | **Partial** | You own it like a build artifact. Hand-edits are **silently clobbered** on regenerate; `.loomignore` pins a file but then it goes permanently stale with no detector. **F-008** |
| 4 | "Zero vendor lock-in" | **Partial** | Real: output is plain Hono/EF/Ecto/FastAPI/Spring, MIT-granted, no runtime dependency on Loom. But the *modelling* lock-in is total — leaving means owning 26k–56k lines you didn't write. §8 exit cost. |
| 5 | "No scaling cliff" | **Verified (compile-time)** / **Unverified (runtime)** | Generation is flat to 40 aggregates. I did not load-test the generated app; the read model's single-table ceiling (**F-002**) is an architectural scaling constraint, not a performance one. |
| 6 | "No drift between layers" | **Contradicted** | The generator emitted an e2e suite calling routes it did not generate (**F-003**, 3/3 tests fail with 405). The supported customisation hatch manufactures permanent API↔DB drift (**F-008**). |
| 7 | "Five backends from one source … **Identical API contracts**" | **Partial** | *Identical* is verified where both run: node vs python returned **byte-identical JSON** on a 10-field aggregate incl. money scaling, enum casing, ISO timestamps and a derived VO. *Five* is not, on my model: **node, python and elixir compile** (elixir clean under `--warnings-as-errors`), **dotnet and java do not** (F-015; F-020 + F-021), and elixir needs the fan-out reactor removed to generate at all (F-013). One boundary divergence: `long` = 2⁵³+1 → node 422, python 201. |
| 8 | "Six frontends … The page DSL is identical; only the rendering changes" | **Partial** | **Four of six compile** from one model: react, vue, svelte, and flutter (`flutter analyze`: 0 errors, 0 warnings). **Angular** fails on any `X id[]` (**F-016**). **Feliz** fails on a field named `member` (**F-022**) — rename it and it builds a real 894 kB bundle, so the frontend works and the emitter lacks a reserved-word map. |
| 9 | "Thirteen design packs … swap any time" | **Unverified** | I exercised `mantine` end-to-end and generated with the default. I did not build ≥3 packs; **not tested**. |
| 10 | "Pick per deployable. Switch any time." (per-deployable runtime) | **Verified** | One system, 4 backends + 5 frontends, 1148 files, one command. Two frontends on one backend and two backends in one system both generate and (for node+dotnet, node+python) boot together. |
| 11 | "Browser playground … visual system builder … live preview" | **Unverified** | Requires `cd web && npm install`; I did not stand it up. **Not tested.** |
| 12 | "Built-in traceability … `ddd verify` rolls results into per-requirement Definition-of-Done verdicts" | **Partial** | The chain works (2/2 VERIFIED, good `verification.md`). But it needs a hand-written results adapter, the join is a stringly-typed `(suite, name)`, and **it exits 0 when nothing is verified** (**F-017**). |
| 13 | "LLM-safe by construction … Validation gates catch hallucinated fields … **before any code is emitted**" | **Contradicted** | A missing required field in a construction is caught for every value-object name **except `Money`** — the name used in the README, the language reference and four examples (**F-014**). Emitted `new Money(x)` against a 2-arg constructor; `tsc` rejects it; the Docker build ships it anyway. |
| 14 | "the CLI emits a `LICENSE` file at the output-directory root" (§License) | **Contradicted** | `ddd generate` emits none. `ddd new` does. The vendor's own `docs/tools.md:110` says "`ddd generate` writes none of these". **F-007** |
| 15 | "Generated end-to-end tests against the live stack" | **Contradicted** | On the README's own example: 3 failed / 3. **F-003** |
| 16 | "`docker compose up -d` → everything running on ports 3000/8080/4000/3001" | **Partial** | True after working around F-001. 3 of 4 services healthy; elixir blocked by a sandbox hex/TLS issue (environment). |
| 17 | Storage matrix: "search `elastic` / `meilisearch`" (`docs/language.md:235`) | **Contradicted** | Declarable as a `storage`, but **no resource `kind` accepts it** (all 9 tried). `docs/resources.md`, named as the home of the matrix, contains no occurrence of "search". **F-010** |
| 18 | "1,300+ test files / 9,000+ tests … CI matrix … backends compiled against real toolchains" | **Partial** | The suite is real and the diagnostics it produces are excellent (9/10 adversarial cases). But six ordinary-model SILENT defects survived it, and none appear in the maintainers' own 135-row gap ledger. **F-019** |

---

## 3. Target matrix

One model (`eval/commons/breadth.ddd`, 320 `.ddd` lines → 1148 files, `generate`
exit 0). **Compiles** = a real toolchain. **Boots**/**wire** = a live container
against Postgres.

> **Second pass.** My first pass marked java / elixir / feliz / flutter
> "unverified — sandbox proxy". `docs/tools.md` documents a working recipe for
> each of the four **by name**, including two sections titled for exactly the
> TLS-fingerprinting failure I hit (§624 `LOOM_HEX_MIRROR`, §666 Java, §912
> frontends, §944 Flutter). Using them: **two of the four passed and two failed
> with real, new S1 defects.** The rows below are the corrected results.

### Backends

| Backend | Generates | Compiles | Boots | Wire-identical |
|---|---|---|---|---|
| **node** (Hono) | ✅ | ✅ | ✅ healthy | ✅ reference |
| **python** (FastAPI) | ✅ | ✅ image built | ✅ healthy | ✅ **byte-identical to node** |
| **elixir** (Phoenix) | ❌ **crash** on the fan-out workflow (**F-013**); ✅ without it | ✅ **`mix compile --warnings-as-errors` exit 0** on the full Commons domain, via the documented hex mirror | not booted | not compared |
| **dotnet** (ASP.NET) | ✅ | ❌ `CS0102`/`CS0542` — field named `state` (**F-015**) | ✅ on a model without that field | not compared |
| **java** (Spring Boot) | ✅ | ❌ **two defects**: `mask unless` emits no `import java.util.Objects` (**F-020**); the fan-out reactor emits an undeclared repo, a bogus `run(<predicate>)` call and a wrong record accessor (**F-021**) | — | — |

### Frontends

| Frontend | Generates | Compiles | Boots |
|---|---|---|---|
| **react** | ✅ | ✅ | ✅ healthy (Commons `web`) |
| **vue** | ✅ | ✅ image built | not booted |
| **svelte** | ✅ | ✅ `svelte-check found 0 errors and 0 warnings` | not booted |
| **flutter** | ✅ | ✅ **`flutter analyze`: 0 errors, 0 warnings** (153 `info` lints, so `analyze` still exits 1) | not booted |
| **angular** | ✅ | ❌ `TS2322`/`TS2345` on any `X id[]` (**F-016**) | — |
| **feliz** (F#/Fable) | ✅ | ⚠️ **both** — fails on the Commons model (invalid F#: a field named `member`, an F# keyword, emitted verbatim into a record — **F-022**; plus the **F-021** workflow arm). Rename that one field and `dotnet fable` + vite **build a real 894 kB bundle, exit 0**. So Feliz works; the emitter has no reserved-word map. | not booted |

**What I actually sampled, stated plainly.** Eleven targets generated from one
model, all eleven compile-tested, **none left unverified**.

- **Seven compile the Commons model as written:** node, python, elixir, react,
  vue, svelte, flutter.
- **Four do not:** dotnet, java, angular, feliz — each from an ordinary model
  shape, each with `parse` and `generate` green.
- **Three of those four are one field or one construct away from compiling.**
  Rename `state` → dotnet builds; rename `member` → **feliz builds a real
  894 kB bundle**; drop the fan-out reactor → **elixir compiles
  `--warnings-as-errors` clean**. Only angular's `X id[]` and java's two defects
  need emitter work rather than a model rename.

**The headline number changed in the second pass, and in both directions.**
First pass: 2 broken / 5 compiled / 4 unverified. Second pass: **4 broken / 7
compiled / 0 unverified.** Elixir and Flutter turned out to be *passes* I had
written off; java and feliz turned out to be *failures* I had excused. The
correction that matters: **"unverified" is not a neutral row** — mine was hiding
two passes and two S1 defects in equal measure, and I should have looked for the
vendor's own recipe before recording it.

**The defect shape is now unmistakable.** Six of the ten S1 defects are one
pattern: **a name or a construct that is legal in Loom and fatal in the target
language, emitted verbatim with no escaping and no gate.**

| Model shape (all legal `.ddd`) | Target it breaks |
|---|---|
| value object declared in another context | dotnet, react, vue, svelte, angular (F-001) |
| field named `state` | dotnet — collides with the nested `State` class (F-015) |
| field named `member` | feliz — reserved F# keyword (F-022) |
| value object named `Money` | node — skips construction validation (F-014) |
| reference collection `X id[]` | angular (F-016) |
| `for x in Repo.run(C(...))` in a reactor | elixir crash, java + feliz non-compiling (F-013, F-021) |

Five distinct targets, one root cause class: **emitters that interpolate model
identifiers into target syntax without a reserved-word map or a post-emit
compile check.** That is a structural finding, not six unrelated bugs, and it is
what condition **C4** (a per-target compile gate over a corpus of ordinary
shapes) exists to catch.

## 4. What using it is actually like

### Phase 0 — cold start

The install is genuinely clean: `npm install` runs the whole `prepare`
lifecycle in 28 seconds and `node bin/cli.js --help` works immediately. No
version wrangling, no missing generated parser. Better than most toolchains.

Then I copied the README's own Quick Example into a file. It parsed. It
generated 226 files in 1.6 seconds. And it did not build, because the example
declares `valueobject Money` inside `context Orders` while `Product` lives in
`context Products`, and the .NET emitter writes the `MoneyResponse` record into
only the first context's namespace (**F-001**). The React frontend failed the
same way (`Cannot find name 'MoneySchema'`). Hoisting `Money` to the model root
fixed both.

**Time to first running app by an outsider: ≈95 minutes**, of which ~35 was my
sandbox's proxy and registry limits and ~35 was F-001. On a clean network, with
F-001 known: **≈10 minutes**. That number is real and it is the product's best
argument.

Then I ran the e2e suite the generator emitted. 3 failed out of 3 — it POSTs to
`/api/products`, which the same compilation declined to emit (**F-003**).

### Phase 1 — modelling Commons

This is where Loom is at its most impressive and its most limiting, often on the
same page.

**What went in directly** (first or second try): aggregates, entity containment,
value objects with invariants, enums, optional and collection types, derived
fields, pure functions, operations with preconditions, events, repositories and
custom finds, cross-aggregate and **self**-references (the arbitrarily-deep
comment tree is just `parent: Comment id?`, and the emitted schema has the
correct self-FK), `unique (a, b)` natural keys, capabilities (`auditable`,
`softDeletable`), the `crudish` macro, `permissions` with an `implies` closure,
`requires` gates, `mask unless`, OIDC config, channels, a transactional workflow
with a reactor, multi-context systems, three deployables, i18n.

**What went in awkwardly:**
- *Notification fan-out.* A keyed fold can't fan one event to N rows, so it
  became a workflow reactor looping over followers — which forces a persisted
  saga instance with a correlation field per post. It works; it is heavier than
  the domain needs. (And it is the shape that crashes Elixir — F-013.)
- *Authorization gates.* The permission model had to be flattened to
  `currentUser.role == "literal"` at list reads and workflow reads, because the
  permission-based form crashes the generator (**F-005**). Two gate dialects in
  one file.
- *Search.* "Search across posts" is `title.startsWith(q)`. `.contains` is
  refused; the advertised search stores can't be bound (**F-010**).

**What could not be said at all** — this is the real output of the phase:

| Requirement | Diagnostic | Consequence |
|---|---|---|
| Home feed: "posts from people I follow, newest first" | `loom.projection-where-not-queryable` | No read whose selectivity lives in a *related table*. Must be denormalised into a materialised feed with write-time fan-out. **F-002** |
| Group-only post visibility | `loom.criterion-not-selectable` | Authorization filters are single-table predicates. Group membership must be copied onto the post. **F-012** |
| Substring / full-text search | `loom.find-where-not-queryable` | Prefix match on one column, or an out-of-model search service. **F-010** |
| Rate limiting on posting and reporting | no surface at all | Hand-written middleware in a `.loomignore`-pinned file → permanent drift (**F-008**), or a proxy in front. |
| Move an aggregate to the right context, later | `DROP TABLE` | Context boundaries are expensive to change. **F-009** |

The pattern is consistent and worth stating once: **Loom's query and
authorization languages are single-table predicate languages.** Anything whose
truth lives one join away must be denormalised into the row being read, and you
must maintain that denormalisation yourself. For a social product — feeds,
group visibility, follower fan-out — that is most of the interesting reads.
It is not a bug; it is the ceiling, and the diagnostics are honest about it.

**GDPR erasure** worked better than expected. Scrubbing PII in place on the
`Member` row keeps every FK valid, so comment trees survive and the row *is* the
tombstone. And `mask unless` is correctly enforced on the audit-history
endpoint, with generated code that explains *why* it drops the change entry
rather than redacting it ("a redacted-but-present entry would still disclose
that it changed, when, and by whom"). That is thoughtful security engineering,
generated.

### Phase 5 — evolution

The best part of the product, with one gap.

Additive change on a populated database: correct, safe SQL (nullable add;
`NOT NULL` via `DEFAULT` then `DROP DEFAULT`), applied, data preserved. A rename
was **auto-detected** and emitted as `RENAME COLUMN` — `mathematician` survived.
An *ambiguous* rename (drop 2, add 1) was **refused**, with the exact ledger
syntax to disambiguate it and a named `--allow-destructive` opt-out. Dropping a
populated column, retyping, and flipping optional→required with NULLs present:
all three **refused**, and the `migration "…" { Member.phone = "" }` backfill
ledger emitted `UPDATE … WHERE IS NULL` then `SET NOT NULL`, in that order.

I could not make Loom destroy data by accident. That is a strong result and the
main reason this is "Pilot only" and not "Do not adopt".

The gap: **moving an aggregate between bounded contexts is `DROP TABLE`** and no
safe spelling exists (**F-009**) — the canonical DDD refactor, in a DDD tool.

---

## 5. Direct answers

**How long to a running app?** ~95 min as a true outsider; ~10 min once F-001 is
known. **To a modelled domain?** Commons' domain — 10 aggregates, workflows,
auth, channels, i18n — took me about 4 hours including the dead ends, at 320
lines. That is genuinely fast. **To a safe breaking change?** Additive: one
regenerate, ~10s. A rename, retype, or required-flip: one regenerate, read the
refusal, add a 1-line `migration` ledger block, regenerate. Minutes, and safe by
default.

**What the DSL cannot express, and what you do then.** Multi-table reads,
multi-table authorization, full-text search, rate limiting. You denormalise into
the aggregate, or you step outside the model — a sidecar service, or a pinned
file. Stepping outside costs you regeneration on that file, permanently.

**Exactly what happens to hand-edits on regenerate.** They are overwritten
without a word. `--dry-run` shows `write` vs `unchanged`, but `write` does not
distinguish "new file" from "your edits die here". `.loomignore` pins a file
reliably (`skipped (.loomignore): 1`) — and that file then never receives another
model change, with no staleness detector. I demonstrated it: pinned
`member.routes.ts`, added two fields to `Member`, and got a database column and a
repository that write a field the API cannot accept. **"You own the source"
means "until the next regenerate", unless you pin it, and then it means "and it
stops tracking the model".**

**Does a breaking migration keep data?** Yes, for column-level changes — verified
against a populated database for add, rename, and required-flip; refused rather
than destroyed for drop and retype. No, for moving an aggregate between contexts.

**Does isolation hold in the generated code or only in the model?** **In the
generated code.** `mask unless` compiles to a real `toWireMasked(root, currentUser)`
at the serialization boundary, every read path uses it, and a non-admin token
against a live server got `email: null`. Capability `filter`s install at the
query layer on every read. This is the strongest single result in the
evaluation. The caveat is scope, not enforcement: `denyByDefault` leaves the
auto-`findAll` list route ungated (**F-006**), so 8 of 10 Commons list reads
were open to a token with no role and no permissions.

**Are the targets interchangeable, or is one real and the rest demos?** Between
node and python, genuinely interchangeable — byte-identical JSON on a
10-field aggregate. Not a demo. But node is clearly the reference
implementation: it is the default, it is what worked first every time, and the
other four each failed differently (dotnet compile, elixir crash, java/elixir
unverified). Call it **two real backends, one likely-real (java), two needing
proof**; and **three real frontends of six**.

**Could we operate and debug it at 3am?** Partially. In favour: structured logs
with `requestLog().debug({event, aggregate, find, rows})`, health and ready
endpoints, an observability compose overlay, ProblemDetails errors with stable
shapes, a `.loom/` bundle with ER/sequence/deployment diagrams and a LikeC4
model. Against: `ddd trace` cannot map the default backend's own shipped bundle
(it ships as a `tsup` single file — **F-018**), `breakpoints` precision is
uneven, and when the generator itself fails it throws a JS stack trace naming
`out/generator/...` with no `.ddd` line (**F-005**, **F-013**). Your SRE can
operate the *generated app*; debugging the *generator* needs someone who knows
Loom's internals, and there is one such person.

**Exit cost in year two.** Moderate and bounded, which is the honest good news.
You keep the generated tree — idiomatic Hono/EF/Ecto/FastAPI/Spring, MIT-granted,
no Loom runtime dependency. You delete `.ddd`, delete the regenerate step, and
own the code. For Commons at ~26k lines (one backend + one frontend) that is a
real but survivable inheritance; at 40 aggregates and 56k lines across targets it
is a serious one. The thing you actually lose is the *reason the code is
consistent* — after exit, nothing keeps the frontend agreeing with the backend.
Budget one to two engineer-quarters to re-establish ownership (tests, CI,
conventions, an ADR explaining why the code looks generated).

**The most likely way this decision blows up — and how we'd see it coming.**
Not a dramatic failure. It is: six months in, someone needs a feed query, or
group-scoped visibility, or rate limiting, or a webhook signature check. Each is
individually small and individually outside the DSL. Each gets a `.loomignore`
pin. Within a year a meaningful fraction of the codebase is pinned, those files
no longer track the model, and the product's central promise — one source of
truth, no drift — is quietly false while the build stays green. **The leading
indicator is the line count of `.loomignore`.** Make it a metric from day one;
if it grows monotonically past ~5 entries, the fit is wrong and you should exit
early while the tree is small.

The second, faster failure mode: a SILENT emission bug ships to production
because four gates in a row were green (**F-014**). The indicator there is
whether C4/C5 are in place.

---

## 6. Gap register

19 findings. Counted by class:

| Class | Count | Findings |
|---|---|---|
| **SILENT** — valid input, exit 0, output wrong / uncompilable / crashed | **12** | F-001, F-003, F-004, F-005, F-013, F-014, F-015, F-016, F-017, F-020, F-021, F-022 |
| **HONEST** — refused with a clear, actionable diagnostic | **4** | F-002, F-009, F-010, F-012 |
| **DOCUMENTED** — named up front | **3** | F-006, F-008 (overwrite contract), F-018 |
| **Docs-vs-reality** | **2** | F-007, F-011 |
| **Reconciliation** (Phase 6 only) | **1** | F-019 |

By severity: **S1 ×10** (F-001, F-003, F-005, F-013, F-014, F-015, F-016, F-020,
F-021, F-022), **S2 ×6**, **S3 ×6**, **S4 ×0**.

Separately, the ten adversarial models in Phase 6 produced **9 HONEST refusals
and 1 SILENT miss** (the miss is F-014) — so the diagnostic layer scores well
when the defect is in the *user's* model, and badly when it is in the emitter.

**Let the ratio speak.** Twelve SILENT to four HONEST is the wrong way round for
a compiler — and the ratio got *worse* in the second pass, because the four
targets I had left unverified contributed two more silent S1s and no honest
ones. The HONEST gaps are genuinely excellent — `loom.projection-where-not-queryable`,
`loom.criterion-not-selectable`, the destructive-migration gate, the
`denyByDefault` endpoint report, the `patch` address book — several are better
than what mainstream tools produce. But a compiler's job is that *everything*
lands in that column, and here the ordinary shapes (a shared VO, a field named
`state`, a `Tag id[]`, a VO named `Money`) land in the silent one. Notably,
**the silent failures are concentrated in the non-reference targets and the
cross-cutting emitters** — which is exactly where a per-target emitter
architecture with no shared conformance oracle would put them.

---

## 7. Risk register

| Risk | Severity | Evidence | Mitigation |
|---|---|---|---|
| **Bus factor 1.** One human in the entire visible history (135 commits); 669 of 810 authored by `Claude <noreply@anthropic.com>`; 6 by `claude[bot]`. | **High** | `git shortlog -sn`. (The clone is shallow, so this is the visible window — ~3 weeks, PRs #2563–#2910 — not the project's age. I do not claim the project is new.) | Escrow + the FSL's 2-year Apache conversion give legal continuity, not engineering continuity. Require C6, or accept that we fork on abandonment. |
| **AI-authored codebase at high velocity.** ~800 commits and ~350 PRs in the visible window. | Medium-High | same | This cuts both ways: it explains the unusual breadth *and* the six ordinary-shape defects. Judge by the gates (C4), not the velocity. |
| **SILENT emission defects reach production.** Four green gates then a runtime failure. | **High** | F-014 | C5 (type-check in the generated Dockerfile) + our own compile gate over generated output for every target we ship. |
| **Security posture cannot be expressed as recommended.** | **High** | F-005 + F-006 | C2 + C3. Until then: gate every list read explicitly with a comparison, and pen-test the enumerable surface. |
| **Customisation drift.** Pinned files silently stop tracking the model. | **High (organizational)** | F-008 | Track `.loomignore` length as a metric. Code-review rule: a pinned file's aggregate changing requires re-reviewing the pin. |
| **Read-model ceiling forces denormalisation.** | Medium (design-time) | F-002, F-012 | Decide it up front. It is a legitimate architecture; just not one we'd have chosen freely. |
| **Context boundaries are expensive to change.** | Medium | F-009 | Spend real design time on boundaries before the first production write. |
| **Docs are ahead of the code.** README contradicted on 5 claims; maintainers track 9 "stale-prose" rows themselves. | Medium | F-007, F-010, F-011, F-019 | Treat `docs/audits/` + `src/diagnostics/unsupported-register.ts` as the real status document. Re-read at every upgrade. |
| **Toolchain-upgrade stability.** Not tested — the visible history is too short and there are no releases to upgrade between. | **Unknown** | — | Before adopting, pin a version and do one upgrade on a copy of Commons; measure what the regenerate diff does. |
| **Licence.** FSL-1.1-Apache-2.0. Internal use is an explicit Permitted Purpose; per-release 2-year Apache conversion. Generated code is MIT-granted — but that grant ships only via `ddd new`, not `ddd generate`. | Low-Medium | `LICENSE`, F-007 | Fine for Commons (internal product). Get the MIT grant over generated output in writing; don't rely on a README sentence. |

### Team workflow

**Is output committed?** It has to be, in practice: the compile gate you need
(C4) runs on the generated tree, `.loomignore` pins live in it, and `ddd verify`
consumes test results from it. That means **every model change produces a
diff in the hundreds-to-thousands of lines** — my two-field additive change
rewrote 23 files. Code review has to become "review the `.ddd` diff, confirm the
generated diff is mechanical" — which is a real discipline change, and which
nothing in the tooling helps you enforce. A parallel-edit merge on generated
files is meaningless: you resolve the `.ddd` and regenerate. That is actually
*easier* than merging hand-written code — a genuine plus — provided everyone
understands the generated tree is not to be edited.

---

## 8. Fit analysis

**Good fit** — CRUD-heavy internal line-of-business systems; multi-tenant SaaS
admin surfaces; anything where the hard part is breadth (many aggregates, many
screens, consistent auth, audit trails, migrations) rather than depth (clever
queries, novel interaction); teams who will accept the DSL's ceiling as an
architectural constraint; and greenfield work where context boundaries are
already well understood.

**Poor fit — and this is Commons.** A social product is mostly *relationship
reads*: a feed, a follower fan-out, group-scoped visibility, search, a
notification inbox. Four of Commons' headline requirements sit on the wrong side
of Loom's single-table read ceiling, and the workaround for each is the same
one: maintain a denormalised copy by hand. We would be fighting the tool on the
core of the product while enjoying its benefits on the periphery (moderation
queue, bans, appeals, audit trail — which Loom models beautifully).

**Recommendation for Commons specifically:** even if C1–C7 were all satisfied, I
would not pick Loom for *this* product. I would pilot it on our next internal
admin/back-office system instead, where the fit is genuinely good, and let
Commons use a conventional stack.

---

## 9. Comparison

| | **Loom** | **Framework + AI assistant** (Rails/Phoenix + Claude/Cursor) | **No-code** (Retool/Bubble) | **In-house scaffolding** |
|---|---|---|---|---|
| Time to first running app | ~10 min (known-issues) | ~1 hr | ~30 min | ~2 weeks to build the scaffolder |
| Consistency across layers | **Structural** — the model is the only input | Degrades with each prompt | N/A (one layer) | As good as you maintain it |
| Ceiling | **Hard** — single-table reads/filters; outside it you leave the model | **None** — it's just code | Hard, and you can't leave | None |
| Cost of leaving the ceiling | Permanent drift on a pinned file | Zero | Rewrite | Zero |
| Multi-target | 2 verified, 5 claimed | One, well | One | One |
| Data-safe evolution | **Best in class here** — refuses destructive changes, auto-detects renames, backfill ledger | You write the migration; the assistant will happily write a destructive one | Opaque | Whatever you built |
| Source ownership | Yes, MIT, no runtime dep | Yes | No | Yes |
| Bus factor | **1** | Framework: thousands | Vendor | Yours |
| Silent-defect risk | **9 found in one afternoon** | Assistant hallucination, but you review the diff | Vendor bugs, opaque | Yours, and you can fix them |

The honest framing: **Loom's real competitor is a framework plus an AI
assistant**, and the axis it wins on is *not* speed — it is **structural
consistency and data-safe evolution**. An assistant will write you a feed query
in thirty seconds that Loom cannot express at all; it will also, six months
later, have written three subtly different serializations of the same entity,
and a migration that drops a column. Loom will not do either. That trade is
genuinely attractive for the right product. Commons is not that product, and the
bus factor makes it a bet on one person regardless.

---

## 10. Top 10 fixes, ranked by adoption impact

| # | Fix | Why it ranks here |
|---|---|---|
| 1 | **Route every page-gate call site through `tryRenderGate`** (F-005) | Unblocks the entire recommended security posture. Their own test already specifies the contract; two call sites don't use it. Likely a one-line change per site. |
| 2 | **Gate the auto-`findAll` route under `denyByDefault`** (F-006) | `denyByDefault` currently leaves most of the API enumerable. Highest security impact per unit of work. |
| 3 | **Type-check generated TypeScript in its own Dockerfile** (F-014 amplifier) | Converts the worst failure shape (four green gates, runtime defect) into a build failure. Adds one line to a template. |
| 4 | **Fix cross-context value-object emission on dotnet + the 4 JSX frontends** (F-001) | Breaks the vendor's own front-page example on 5 of 9 targets. First thing a new user hits. |
| 5 | **Validate `test e2e` calls against emitted routes** (F-003) | Both halves are in one IR. Turns the "no drift" claim from marketing into a gate, and fixes the README example. |
| 6 | **Make `Money` not special-case construction validation** (F-014) | The gate exists and works for every other name. Restores the "LLM-safe" claim's stated mechanism. |
| 7 | **A conformance corpus of *ordinary shapes*, compiled on every target** — a shared VO, a field named `state`, a field named `member`, an `X id[]`, a `for`-loop reactor, `mask unless`, a VO named `Money` — plus a **per-target reserved-word escape map** | This is the structural fix, and it moved up in the second pass: it would have caught **8 of the 10** S1 defects. Their absence is why a 16-agent internal audit missed all of them. |
| 8 | **Replace emitter `throw`s with `loom.*-unsupported-backend` diagnostics** (F-005, F-013) | The register's own header demands this. Converts crashes into HONEST gaps — the single best ratio improvement available. |
| 9 | **Stale-pin detection**: warn when a `.loomignore`-pinned file's aggregate changed (F-008) | Makes the escape hatch safe to use, which makes "you own the source" honest. |
| 10 | **Qualify the README** to match `docs/audits/` (F-019), and emit the MIT LICENSE from `generate` (F-007) | Cheapest items on the list; they are what a technical buyer checks first, and getting caught on them costs more trust than the bugs do. |

---

## 11. Coverage limits — what I did not test

Stated plainly, because the recommendation should not be read as broader than
the evidence.

- **Everything generated is now compile-tested.** No target is left
  "unverified": all five backends and all six frontends were built with their
  real toolchains (node/vue/svelte/angular/react via npm + tsc/vue-tsc/
  svelte-check/ng, dotnet via `dotnet publish`, java via `gradle:9-jdk25`,
  elixir via `mix compile --warnings-as-errors` behind the documented hex
  mirror, feliz via `dotnet fable` + vite, flutter via `flutter analyze`).
- **Not booted:** vue, svelte, flutter, feliz, elixir, java. Only node, python
  and (on a reduced model) dotnet ran as live services. **Wire identity was
  verified for exactly one pair** (node ↔ python); the "identical API contracts"
  claim rests on that one comparison, not on five.
- **Design packs: not tested.** I used `mantine` and the default. The "swap any
  time" and "thirteen packs" claims are **Unverified**, not verified.
- **Playground / visual builder / VS Code extension / MCP server: not tested.**
  These are a significant part of the pitch and I have no evidence either way.
- **Kubernetes output, observability overlay, provenance/`snapshot`, event
  sourcing (`persistedAs: eventLog`), inheritance (TPC/TPH, polymorphic reads),
  domain services, `extern`, seeds, multi-file `import`:** not exercised.
- **Runtime performance and load:** not tested. "No scaling cliff" is verified
  only for *generation* time.
- **Toolchain upgrade stability:** not tested — no releases to move between in
  the visible history. This is a real blind spot for a multi-year commitment.
- **Flutter/Feliz `X id[]` and cross-context VO behaviour:** unknown; they may
  share F-001/F-016 or not.
- **Confidence is highest** on: the modelling ceiling (F-002, F-012 — tested
  from several angles), migration safety (six change classes against a populated
  DB), and runtime authorization enforcement (live server, real OIDC tokens,
  two principals). **Confidence is lowest** on: runtime behaviour of the seven
  targets I compiled but never booted, the design packs, the playground, and
  toolchain-upgrade stability.

One methodological note: the harness auto-injected the repository's `CLAUDE.md`
into my context before Phase 0, so I was not perfectly blind to internals. I did
not open `docs/new-plan/`, `docs/old/`, `docs/audits/`, `experience_gathered.md`,
`.claude/` or `test/` until Phase 6, and every finding is grounded in a command
run from outside.
