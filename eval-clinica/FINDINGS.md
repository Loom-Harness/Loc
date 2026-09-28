# Clinica / Loom evaluation — findings register

Severity: **S1** blocker · **S2** major · **S3** friction · **S4** polish.
Class: **SILENT** (valid input, exit 0, wrong/non-compiling output) · **HONEST**
(refused with a clear diagnostic) · **DOCUMENTED** (named in the docs up front).

**Tally — 24 entries: 22 defects + 2 recorded strengths.**

| | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| count | **7** | **8** | 6 | 0 |

| class | count |
|---|---|
| **SILENT** | **14** |
| HONEST | 4 |
| DOCUMENTED / structural / contradicted claim | 3 |

## Disposition — re-verified on `main` @ `62283b52` (2026-09-21)

The split below supersedes the 2026-09-13 overlap map that follows it.  Every
row was re-checked by RE-RUNNING the repro against that `main`, not read off the
original register: nine days and ~400 commits later, three of the "claimed
elsewhere" rows had been fixed, two of the "dropped" ones had become free to
take, and one (F-009) had been fixed by someone else without a PR title that
named it.  The 2026-09-13 section is kept below as the record of what was known
when the work was planned — that is its value, and updating it in place would
destroy it.

**17 of 22 defects are closed outright**; F-006 is half closed (the crash, not
the format-drop); the remaining four are F-008 and the three still claimed by
open PRs (F-012, F-017, F-018).

| Finding | State | Where |
|---|---|---|
| F-001 `--help` routes into `docs/old/**` | fixed | #2998 |
| F-002 repo read in an `invariant` | fixed | #2913 |
| F-003 unknown type is a dangling `NamedDecl` ref | fixed | #2998 |
| F-004 `when <function>()` calls a `private` member | fixed | #2974 |
| F-005 a soft keyword declarable but not readable | fixed | this PR |
| F-006 ICU format dropped — *python crash half* | fixed | #2950 |
| F-006 — *the format-drop itself* | **open, owned elsewhere** | recorded as DELIBERATE in `docs/new-plan/T1`; changing it is a language decision |
| F-007 `create { }` — a remedy that does not parse | fixed | #2998 |
| F-008 `retrieval` emits no HTTP route | **open, unowned** | the honest half (a deprecation naming its replacement's real cost) is available; auto-exposing a retrieval is a language decision |
| F-009 `Repo.run(<Retrieval>)` emitter crash | fixed | on `main`; no longer reproduces |
| F-010 `string` → `enum` emits no migration | fixed | #2998 |
| F-012 hand-edits clobbered on regenerate | claimed, open | #2948 |
| F-013 dotnet `state` collision | fixed | #2923 |
| F-014 java missing `java.util.Objects` | fixed | #2925 |
| F-015 elixir `__`-bound vars | fixed | #2911 |
| F-016 a workflow calling a `function` across aggregates | fixed | #2974 |
| F-017 `ddd i18n` locales never emitted | claimed, open | #2969 |
| F-018 recursive containment `RangeError` | claimed, open | #2980 (a `loom.containment-cycle` validator, self-cycle included) |
| F-019 an entity named `…Exception` fails the .NET build | fixed | #2950 |
| F-020 `aud` off by default — *the generated comment* | fixed | #2950 |
| F-020 — *the docs* | fixed | #2998 |
| F-022 Angular `string[]` form | fixed | landed on `main` |
| F-023 dead README site links | fixed | #2911 |
| F-024 .NET `transactional` workflow event buffer | fixed | #2950 |

Two findings remain genuinely open and neither is a bug to be quietly fixed:
**F-006's format-drop** is a recorded design decision, and **F-008** asks whether
a declared `retrieval` should auto-expose a route.  Both want an owner and a
ruling, not a patch.

---

## Overlap with in-flight work (checked 2026-09-13, against `main` @ `a25802d3` and all 26 open PRs)

Three other agents ran the same build-an-app-end-to-end exercise (#2911 FieldOps, #2865
ClaimsHub, #2864 freight). Their registers and the open PRs were read **before** any fix was
written here. Findings are split accordingly:

**Claimed elsewhere — no work done here, deliberately:**

| Mine | Claimed by | Verified how |
|---|---|---|
| F-002 repo read in an `invariant` | **#2913** `loom.repository-access-outside-workflow` | checked out their branch and ran my repro: now refused with a precise diagnostic |
| F-004 / F-016 aggregate `function` emitted `private` | #2911's register F-015 / F-026 | same root cause, same three backends |
| F-008 `retrieval` emits no route | **#2874** "a `find` deprecation with nothing to migrate to" + #2911 F-010 | title match |
| F-010 `string` → `enum` no migration | #2911 F-036 | title match |
| F-012 hand-edits clobbered | #2911 F-037 | title match |
| F-015 elixir `__`-bound vars | **#2911 F-030A — already fixed there**, with a new sweep gate | fix + gate present on their branch |
| F-017 i18n locales never emitted | #2911 F-044 | title match |
| F-018 recursive containment `RangeError` | #2911 F-040 | title match |
| F-022 Angular `string[]` form | #2911 F-033 | identical repro, same emitted line |
| F-023 dead README site links | **#2911 F-043 — already fixed there** | see the corrected entry below |
| F-020's realm-mapper sub-finding | #2911 F-022 | title match |

**Unclaimed — the disjoint set this branch works on:** F-006, F-009, F-013, F-014, F-019,
F-020 (the `audience` default itself), F-024, and the small docs/diagnostic items F-001,
F-003, F-005, F-007. Each was searched for in every open PR and in all three sibling
registers before being touched.

**Fixed in this branch (final):** F-006 (the Python crash half), F-019, F-020 (the
doc-honesty half), F-024 — each mutation-proved; F-006 and F-019/F-024 compile- or
runtime-verified against the real toolchain.

**Dropped after re-checking on a 190-commit-newer `main` (2026-09-14):**

| Finding | Why dropped |
|---|---|
| **F-014** java missing `java.util.Objects` | **Landed upstream** in #2925 (`d28e635d`) — the identical `collectJavaExprImports(w.maskUnless!, imports)` line at the same site, with a *better* test than mine (a six-symbol `JDK_SYMBOL_IMPORTS` table plus a service-level case). My version added nothing. |
| **F-013** dotnet `state` collision | **Claimed by #2923**, which fixes it by extracting a `state-holder.ts` and touches all six files my inline `__State` rename touched. Theirs is the more thorough refactor. |
| F-006 (the ICU format-drop half) | `docs/new-plan/T1` records the backend pass-through as DELIBERATE. Implementing or refusing it is a language decision with an owner; the docs half belongs in `docs/language.md`, which #2924 currently owns. |
| F-009 `Repo.run(<Retrieval>)` emitter crash | Still reproduces, but the fix belongs in `src/diagnostics/messages.ts` + `src/ir/validate/validate.ts`, both of which #2913 is editing. |
| F-001 / F-003 / F-005 / F-007 | Docs + diagnostics; `docs/language.md` and `README.md` are owned by #2924. |

That is three of my findings taken by other agents in ~18 hours, one of them work I had
already done. It is the clearest single measurement in this evaluation of how fast the
register moves — and the reason the "verify on fresh `main` first" rule earns its place.

Every S1 and S2 has a minimal `.ddd` in `eval-clinica/repro/`. Re-run all of them at once with:

```
bash eval-clinica/tools/verify-repros.sh
```
Each prints `0 error(s), 0 warning(s)` from `ddd generate system` and then the defect.
Last re-verified against `bcd25e3e` at the end of this evaluation — all nine reproduce.

---

### F-001 — CLI `--help` routes users to docs the project itself calls non-authoritative
Severity: S3   Class: DOCUMENTED-ish (docs/DX)
Area: CLI / docs
Claim under test: README — "`docs/README.md` is the canonical doc index."

Repro:
```
node bin/cli.js --help
```
Observed: the help text for `patch`, `trace` and `breakpoints` ends with
"See `docs/old/proposals/ai-authoring-loop.md`" / "…/source-map-and-debugging.md §6B"
/ "§6E". The README says `docs/old/` is "the archived design corpus — frozen
proposals and plans … not deployed to the docs site". So the CLI's own help sends
a new user to files that (a) are not on the published docs site and (b) the project
labels as superseded.
Expected: help points at `docs/debugging.md` / `docs/api-toolkit.md`, which exist.
Impact on adoption: minor, but it is the first thing a new engineer does.
Time lost: 10 min (chasing `docs/old/proposals/source-map-and-debugging.md` before
finding `docs/debugging.md`).

---

### F-002 — A repository read inside an `invariant` emits non-compiling, semantically inverted code on 4 backends and is silently dropped on the 5th
Severity: **S1**   Class: **SILENT gap**
Area: codegen / all backends / invariants + criteria
Claim under test: README — "Validation gates catch hallucinated fields and
out-of-scope references before any code is emitted"; "real, owned source code
across five backends".

Repro: `eval-clinica/repro/r02-overlap-system.ddd` (20 lines)
```
node bin/cli.js generate system eval-clinica/repro/r02-overlap-system.ddd -o /tmp/out-r02
cd /tmp/out-r02/api && npx tsc --noEmit --ignoreConfig --skipLibCheck \
   --target es2022 --module esnext --moduleResolution bundler domain/appointment.ts
```
The model declares the natural way to say "no two appointments overlap":
```ddd
criterion OverlapsExisting(p: Practitioner id, s: datetime, e: datetime) of Appointment =
  practitioner == p && startAt < e && endsAt > s

aggregate Appointment {
  practitioner: Practitioner id
  startAt: datetime
  durationMinutes: int
  derived endsAt: datetime = startAt + minutes(durationMinutes)
  invariant Appointments.run(OverlapsExisting(practitioner, startAt, endsAt)).count == 0
}
```
`ddd parse` and `ddd generate system` both report **`0 error(s), 0 warning(s)`**.

Observed (node):
```
domain/appointment.ts(40,11): error TS2552: Cannot find name 'Appointments'.
    Did you mean 'Appointment'?
```
and the emitted predicate itself:
```ts
if (!(Appointments.run(this._practitioner === this._practitioner
      && this._startAt < this.endsAt && this.endsAt > this._startAt).count === 0))
  throw new DomainError("Invariant violated: …");
```
Three independent defects in one line:
1. `Appointments` (the repository) is referenced but **never imported or defined**
   anywhere in the generated project — hard compile error.
2. The criterion's **parameters were captured by the candidate's own fields**.
   `practitioner == p` inlined to `this._practitioner === this._practitioner` —
   a tautology. `startAt < e` became `this._startAt < this.endsAt` (the row
   compared against itself). The predicate is not the rule that was written.
3. `.run(...)` was handed a `boolean` and `.count` read off it.

Cross-backend sample (4/5 identical shape, 5th diverges):

| Backend | Behaviour |
|---|---|
| node | `Cannot find name 'Appointments'` — does not compile; predicate is a tautology |
| dotnet | `Appointments.Run(this.Practitioner == this.Practitioner && …)` — same, does not compile |
| python | `Appointments.run(self._practitioner == self._practitioner and …)` — same, NameError at runtime |
| java | `Appointments.run(Objects.equals(this.practitioner, this.practitioner) && …)` — same, does not compile |
| elixir | **the invariant is dropped entirely** — no trace of it in the changeset or schema |

The elixir arm is the worst case for a buyer: the app *compiles and boots*, and the
business rule simply is not enforced. Verified that elixir does emit ordinary
invariants (`eval-clinica/repro/r03-elixir-invariant.ddd` → `validate_number(:duration_minutes,
greater_than_or_equal_to: 1)`), so this is a targeted silent drop, not "elixir
has no invariants".

Expected: a `loom.*` diagnostic refusing a repository read in an invariant body
(invariants are documented as per-instance predicates checked after mutation —
there is no transaction or query context there), *or* correct emission.
Workaround: none in the DSL. The rule has to move to a hand-written DB
constraint (a Postgres `EXCLUDE USING gist` range constraint) applied outside
the generated migrations, and the API must be taught to translate its error —
i.e. it leaves the model.
Impact on adoption: **this is the single most important rule in a scheduling
product.** It is also the general shape of "an invariant that spans rows",
which is common in any booking/inventory/ledger domain. The DSL accepts it
silently and produces something that is either uncompilable or wrong.
Time lost: 35 min.

---

### F-003 — `duration` is not a field type, and the refusal is a Langium-internal message
Severity: S3   Class: HONEST gap, poor diagnostic
Area: language / type system / diagnostics
Claim under test: `docs/language.md` — "There is no `duration` field type on the
wire — it lives only in expressions."  (So the limitation IS documented.)

Repro: `eval-clinica/repro/r01-duration-field.ddd.txt`
```
node bin/cli.js parse eval-clinica/repro/r01-duration-field.ddd.txt
```
Observed:
```
r01-duration-field.ddd:6:13 error: Could not resolve reference to NamedDecl named 'duration'.
```
Expected: a `loom.*` diagnostic along the lines of "`duration` is not a field
type; store the span as `int` minutes (or two `datetime`s)". `NamedDecl` is a
compiler-internal class name leaking into a user-facing error.
Workaround: model `durationMinutes: int`. Cheap, and the Clinica spec's
"start + duration, not an arbitrary timestamp pair" survives.
Impact on adoption: low on its own; representative of a diagnostic-quality
pattern measured systematically in Phase 6.
Time lost: 5 min.

---

### F-004 — `operation … when <aggregateFunction>()` emits a non-compiling project on node, .NET and Java
Severity: **S1**   Class: **SILENT gap**
Area: codegen / node + dotnet + java / `when` state gates
Claim under test: `docs/language.md` — "`operation name(params) when <pred> { … }` … a
side-effect-free `GET /{id}/can_<op>` companion returns `{ allowed }` for UI enablement…
**Supported on all five backends.**"  `docs/criterion.md` repeats it: "`when <predicate>`
operation guards with their auto-exposed side-effect-free `GET /<plural>/{id}/can_<op>`
endpoints are **shipped on all five backends**".

Repro: `eval-clinica/repro/r06-when-function-private.ddd` (17 lines)
```
node bin/cli.js generate system eval-clinica/repro/r06-when-function-private.ddd -o /tmp/out-r06
cd /tmp/out-r06/api && npm install && npx tsc --noEmit
```
Model:
```ddd
aggregate Doc {
  state: St
  function isOpen(): bool = state == Open
  operation close() when isOpen() { state := Closed }
}
```
`generate system` → `0 error(s), 0 warning(s). Wrote 42 file(s)`.

Observed (node):
```
http/doc.routes.ts(81,25):  error TS2341: Property 'isOpen' is private and
                            only accessible within class 'Doc'.
http/doc.routes.ts(106,42): error TS2341: Property 'isOpen' is private …
```
because the emitter writes `private isOpen(): boolean {…}` on the aggregate and then
calls `aggregate.isOpen()` from the route handler and from the `can_close` endpoint.

Cross-backend sample (5/5 generated; 3/5 do not compile):

| Backend | Emitted member | Call site outside the class | Compiles |
|---|---|---|---|
| node | `private isOpen()` | `doc.routes.ts:81,106` | **✗ TS2341** (executed) |
| dotnet | `private bool IsOpen()` | `CloseHandler.cs:25`, `CanCloseHandler.cs:27` | **✗ CS0122** (inspected — see coverage note) |
| java | `private boolean isOpen()` | `DocService.java:46,54` | **✗** (inspected) |
| python | `def _is_open(self)` | `doc_routes.py:82,95` | ✓ (leading `_` is convention only) |
| elixir | `is_open/1`, public in the context module | `c.ex:39,46` | ✓ |

I hit this in the real Clinica model, not in a contrived probe: `operation cancel(reason)
when isOpen()` and `operation reschedule(...) when isOpen()` produced 4 `tsc` errors in
an otherwise-clean 141-file generation.

Expected: emit the function non-private when a `when` guard (or its `can_` companion)
reads it, or refuse with a diagnostic.
Workaround: inline the predicate into every `when` clause
(`when state == Requested || state == Confirmed`) and lose the named-rule reuse the
`function` existed for. Cheap once you know; invisible until you compile.
Impact on adoption: the `when`-guard + `can_<op>` pair is the mechanism the generated
UI uses to enable/disable buttons, so it is on the main path, not a corner. It means
**`ddd generate system` exiting 0 tells you nothing about whether the project builds** —
a team must wire `tsc --noEmit` / `dotnet build` into the generate step themselves.
Time lost: 25 min (10 to spot, 15 to minimise and cross-check backends).

---

### F-005 — Soft keyword `from` is legal as a parameter name but not as a reference to that parameter; the error is a raw parser dump
Severity: S3   Class: HONEST gap, poor diagnostic
Area: language / grammar / diagnostics
Claim under test: `docs/language.md` — "Everything else that acts as a keyword
*somewhere* is a **soft keyword** — reserved only where its own rule begins, and
admitted as an ordinary identifier elsewhere."

Repro: `eval-clinica/repro/r04-soft-keyword-param.ddd.txt` (8 lines)
```ddd
criterion InWindow(from: datetime) of A = startAt >= from
```
Observed:
```
r04-soft-keyword-param.ddd:6:56 error: Unexpected 'from'. Expected one of:
  '!', '-', 'retrieval', '{', '(' (+111 more).
```
The *declaration* of the parameter is accepted; only the *use* is rejected. No `loom.*`
code, no mention that `from` is reserved, and the "Expected one of … (+111 more)" list
is a raw Chevrotain dump. `to` in the same position works fine, so there is no learnable
rule — you discover the reserved set one name at a time.
Expected: a diagnostic naming the rule ("`from` is reserved in expression position").
Workaround: rename the parameter. 2 minutes once diagnosed.
Impact on adoption: low individually. It is the archetype of the DSL's weakest
diagnostics — see the Phase 6 error-quality table.
Time lost: 12 min.

---

### F-006 — Every ICU format spec in an interpolated string is silently discarded; on Python the result is a runtime `TypeError`
Severity: **S1** (Python) / **S2** (other four)   Class: **SILENT gap**
Area: codegen / all five backends / string interpolation + i18n
Claim under test: `docs/language.md` — "a hole may carry an ICU format suffix after a
comma at hole-depth 0: `{total, number, ::currency/USD}`, `{n, number, ::percent}`,
`{at, date}` / `{at, time}`, `{n, plural, one {# item} other {# items}}` … These drive
the i18n string catalog."

Repro: `eval-clinica/repro/r07-icu-format-dropped.ddd` (22 lines)
```
node bin/cli.js generate system eval-clinica/repro/r07-icu-format-dropped.ddd -o /tmp/out-r07
grep -n "get d" /tmp/out-r07/api/domain/appt.ts
```
Generation: `0 error(s), 0 warning(s)`.

| `.ddd` source | node emits | correct? |
|---|---|---|
| `` `on {startAt, date}` `` | `"on " + this._startAt` | ✗ raw `Date.toString()` |
| `` `at {startAt, time}` `` | `"at " + this._startAt` | ✗ **identical to `date`** |
| `` `total {total, number, ::currency/EUR}` `` | `"total " + this._total.toString()` | ✗ no currency |
| `` `rate {pct, number, ::percent}` `` | `"rate " + String(this._pct)` | ✗ no percent |
| `` `{n, plural, one {# item} other {# items}}` `` | `String(this._n)` | ✗ **the plural arms vanish** — emits `"3"`, not `"3 items"` |

Same on all five backends (sampled all five):
`.NET` `public string D1 => "on " + this.StartAt;` · `java` `return "on " + this.startAt;`
· `python` `return "on " + self._start_at` · `elixir` same shape.

**Python is worse than wrong output — it throws.** `self._start_at` is a
`datetime`, and:
```
>>> "on " + datetime.datetime.now()
TypeError: can only concatenate str (not "datetime.datetime") to str
```
Any read of that aggregate 500s. The same generated file proves the emitter knows
better elsewhere: the auto-generated `inspect` on line 72 correctly writes
`self._start_at.isoformat()`.

Observed live in the Clinica app, not a probe. `derived display: string =
`Appointment {startAt, date}`` served over HTTP as:
```json
"display": "Appointment Thu Oct 01 2026 09:00:00 GMT+0000 (Coordinated Universal Time)"
```

There is **no correct path**: a bare `{startAt}` hole is refused with a good message
("Cannot interpolate a 'datetime' … Convert it first (e.g. wrap in a 'derived' that
formats it)"), but the DSL offers no datetime-formatting facility, so the advice is
circular. The only accepted spelling is the one that is silently ignored.

Expected: emit `Intl.DateTimeFormat` / `.ToString(fmt)` / `strftime` per spec, or
refuse the spec with a `loom.*` diagnostic.
Workaround: none inside the model. Format on the client, which puts a user-visible
string outside the "single source of truth".
Impact on adoption: every user-visible date, money amount and pluralised count in the
product. It also undercuts the i18n story, since these specs are documented as what
"drive the i18n string catalog". For the Python backend it is a 500 on any aggregate
with a formatted datetime in a `derived`.
Time lost: 30 min.

---

### F-007 — `create { }` is a parse error but `destroy { }` is not, and the docs say parens may be omitted
Severity: S3   Class: HONEST gap, docs contradiction
Area: language / grammar / docs
Claim under test: `docs/language-reference/06-behavior-and-statements.md` — "Listing
every create-input field — which is what `with crudish` generates — **or omitting the
parens** keeps it quiet."

Repro:
```ddd
aggregate Clinic { name: string  create { }  destroy { } }
```
Observed: `main.ddd:43:16 error: Expecting token of type '(' but found `{`.`
`destroy { }` on the next line parses fine. `create() { }` parses fine.
Expected: either accept `create { }` as documented, or fix the doc.
Time lost: 8 min.

---

### F-008 — The recommended list-read construct (`retrieval`) produces no HTTP endpoint; the only one-liner that does is the deprecated `find`
Severity: **S2**   Class: HONEST-but-costly (documented in fragments, never stated plainly)
Area: language / read path / API surface
Claim under test: `loom.repository-find-deprecated` (a warning the compiler emits on every
list find): "repository find 'x' is a wire-shaped list query — pass a criterion to 'run'
… or name a 'retrieval' instead of accreting a bespoke list finder on the repository."

Repro: `eval-clinica/repro/r08-retrieval-no-route.ddd` (14 lines)
```
node bin/cli.js generate system eval-clinica/repro/r08-retrieval-no-route.ddd -o /tmp/out-r08
grep -o '"/[a-z_/{}]*"' /tmp/out-r08/api/http/appt.routes.ts | sort -u
```
Observed — routes emitted: `"/"`, `"/{id}"`, `"/by_prac"`.
`by_prac` is the **deprecated** `find`. The `retrieval PracDay` emits **nothing reachable**.

The sanctioned replacement needs four more declarations
(`eval-clinica/repro/r08b-query-handler.ddd`): a `criterion`, a `queryHandler … : Agg paged`,
an `api X from <Subdomain> { route GET "/…" -> Ctx.Handler }` block, and `serves: X`
on the deployable — replacing a one-line `find byPrac(p: string): Appt[] where …`.
And the `queryHandler` must be spelled with **direct parameters**, not the
`(q: Query): Response` form `docs/language.md`'s grammar row shows; a `response`
record cannot carry `Appt[]` at all (`References across aggregate boundaries need an
id link`), so the obvious first attempt is a dead end.

Confirmed the retrieval's `sort:` is unreachable either way: passing the retrieval to
`Repo.run` inside the paged handler crashes the emitter (F-009), and the criterion form
takes its ordering from `?sort=` query params instead.

Expected: either auto-expose a declared `retrieval` (the way `findAll` is exposed), or
say plainly in the deprecation warning that the replacement costs four declarations and
an `api` block.
Workaround: keep using the deprecated `find` (warning on every build), or pay the four
declarations. I kept `find` in the Clinica model's calendar read.
Impact on adoption: the calendar-by-practitioner and waitlist reads are the two most
important screens in this product. It is also a live deprecation with no drop-in
replacement, which means today's models are being told to migrate to something more
verbose and, for ordered reads, incomplete.
Time lost: 50 min.

---

### F-009 — `Repo.run(<Retrieval>)` inside a paged `queryHandler` crashes the generator with a stack trace after validation reports 0 errors
Severity: **S2**   Class: **SILENT gap** (crash where a diagnostic belongs)
Area: codegen / node / read path
Claim under test: `docs/criterion.md` — "**`Repo.run` accepts a criterion too** …
`Repo.run(<Criterion>)` is first-class alongside `Repo.run(<Retrieval>)`. A declared
`retrieval` keeps precedence."

Repro: `eval-clinica/repro/r08b-query-handler.ddd` with the commented block re-enabled
```ddd
queryHandler ListViaRetrieval(p: string): Appt paged {
  let r = Appts.run(PracDay(p))      // PracDay is a `retrieval`
  return r
}
```
Observed:
```
0 error(s), 0 warning(s).
Error: internal: paged queryHandler 'ListViaRetrieval' in 'C' does not match the
supported `let r = Repo.run(<Criterion>(args)); return r` shape. Please file a bug.
    at emitPagedRunHandler (out/platform/hono/v4/explicit-handlers-builder.js:158:15)
    at emitRouteHandler …  at buildExplicitRoutesFile …  at emitSystem …
```
The validator passes the model clean, then the emitter throws a Node stack trace at
the user. Nothing is written; `-o` is left in whatever partial state the run reached.
To the generator's credit the message names the supported shape and admits it is a bug.
Expected: a `loom.*` validation error.
Impact on adoption: low blast radius, but it is the shape of failure that matters —
a stack trace is what a non-contributor sees when they follow the docs.
Time lost: 15 min.

---

### F-010 — A `string` → `enum` type change is a silent no-op: no migration, no backfill, no constraint; out-of-enum rows are then served in violation of the API's own contract
Severity: **S2**   Class: **SILENT gap**
Area: migrations / type evolution
Claim under test: README — "No drift between layers." `docs/migrations.md` — "a schema
change is bit-for-bit equivalent across all five backends".

Repro (against a live Postgres holding rows):
1. `eval-clinica/clinica/main.ddd` declares `requiredSkill: string` on `AppointmentType`; a row
   exists with `required_skill = 'massage'`.
2. Change it to `requiredSkill: Skill` where `enum Skill { physio, gp, dentist }`.
3. `node bin/cli.js generate system eval-clinica/clinica/main.ddd -o eval-clinica/out-node`

Observed: `0 error(s)`, 13 files rewritten, and **no new migration file at all**. Enums
persist as `TEXT`, so the column shape is unchanged and the differ sees nothing. There is
no `CHECK` constraint, no backfill, and no validation of existing values.

Then, live:
```
GET /api/appointment_types/{id}
200 {"requiredSkill":"massage", …}
```
while the same generation's OpenAPI declares
`"requiredSkill": {"$ref": "#/components/schemas/Skill"}` and the same generation's React
client parses the field with `SkillSchema` (a zod enum). The server serves a value its own
published contract forbids, and the generated client will throw on it.

Expected: either a `CHECK` constraint (so the DB refuses), or a `loom.*` warning that
existing rows are unvalidated against the new enum and need a backfill, or a
migration-block requirement as with the destructive gate.
Workaround: hand-write a data audit before deploying the change. Nothing in the toolchain
tells you it is needed.
Impact on adoption: "tighten a loose string field into an enum" is one of the most common
schema evolutions there is. This is the one place the otherwise-excellent migration gate
(F-011) does not look.
Time lost: 25 min.

---

### F-011 — POSITIVE: the destructive-migration gate is real, precise, and hard to get around by accident
Severity: n/a (verified strength, recorded so the register is balanced)
Area: migrations
Claim under test: `docs/migrations.md` — the `--allow-destructive` gate.

Verified against a live Postgres with rows, on the Clinica model (`eval-clinica/clinica/`):

| Change | Emitted | Data outcome |
|---|---|---|
| add `preferredLanguage: string = "en"` | `ADD COLUMN … NOT NULL DEFAULT 'en'` then `DROP DEFAULT` | existing row backfilled to `en` — **verified by `select`** |
| rename `phone` → `phoneNumber` (no migration block) | `ALTER TABLE … RENAME COLUMN "phone" TO "phone_number"` | value `+372123` **preserved — verified by `select`** |
| drop `insurancePolicyRef` (populated) | **refused**, 0 files written: "migration for module \"Scheduling\" contains 1 destructive change(s): DROP COLUMN …" | column + data intact after the refusal |
| same, with `--allow-destructive` | `ALTER TABLE … DROP COLUMN` | as asked |
| required → optional | `ALTER COLUMN … DROP NOT NULL` | safe |
| optional → required | **refused**: "SET NOT NULL on clinics.clinics.timezone (fails on rows holding NULL)" | safe |
| same + `migration "backfill-timezone" { Clinic.timezone = "Europe/Tallinn" }` | `UPDATE … WHERE … IS NULL` then `SET NOT NULL`, **no flag needed** | safe |

The refusal message names the offending step *and* both escape hatches. This is the
strongest part of the toolchain I tested.

---

### F-012 — Hand-edited generated code is silently overwritten; pinning it with `.loomignore` freezes the file and breaks the build on the next model change
Severity: **S2** (structural, not a bug)   Class: **SILENT** for the clobber, HONEST for the divergence
Area: regeneration / source ownership — **the core product claim**
Claim under test: README — "**The keys to the codebase.** … walk away with real, owned
source code"; "All the source you'd write by hand"; "Zero vendor lock-in".

Repro A — the clobber:
1. Add a hand-written method to `eval-clinica/out-node/api/domain/appointment.ts`
   (the no-overlap rule the DSL cannot express — F-002).
2. `node bin/cli.js generate system eval-clinica/clinica/main.ddd -o eval-clinica/out-node`

Observed: `Wrote 1 file(s) in eval-clinica/out-node, unchanged: 147`. The method is gone.
No warning, no backup, no "this file differs from the last emission" notice. The
CLI cannot tell the difference between "stale generated file" and "a human edited this".

Repro B — the sanctioned escape hatch, and its cost:
3. Re-apply the edit, and pin it: `echo api/domain/appointment.ts > eval-clinica/out-node/.loomignore`
4. Regenerate → `Wrote 1 file(s), unchanged: 146, skipped (.loomignore): 1`. **The edit survives.**
   `--dry-run` reports `skip (.loomignore)  api/domain/appointment.ts` — clear and honest.
5. Now make an ordinary model change: add `triageNote: string?` to `Appointment`.
6. Regenerate → `Wrote 15 file(s), … skipped (.loomignore): 1`, then `npx tsc --noEmit`:
```
db/repositories/appointment-repository.ts(37,453): error TS2353: … 'triageNote' does not
    exist in type '{ id: AppointmentId; … }'
db/repositories/appointment-repository.ts(63,445): error TS2339: Property 'triageNote'
    does not exist on type 'Appointment'.
    … 11 errors, all from the one pinned file …
```
The schema, migration, repository, routes, DTOs and React client all learned about
`triageNote`. The pinned aggregate did not, and the project no longer compiles.

**What this means in one sentence:** *you own the generated source until the next
regenerate, and the only way to keep an edit is to freeze that file and hand-merge every
future generator change into it yourself, forever.*

Mitigating: the divergence fails **loudly** (a compile error, not wrong behaviour), and
`--dry-run` names the pinned files. There is no per-file three-way merge, no "protected
region" markers, and no `--diff` against the previous emission.

The documented customization story (`docs/customization-gradient.md`, four rungs)
never involves editing target-language source at all — every rung is "write more `.ddd`".
That is a coherent design, but it is **not** the same promise as "the keys to the
codebase", and a buyer will read the README as the latter.

Workaround / real strategy: treat the generated tree as build output (gitignore it),
keep all customisation in `.ddd`, and accept the abstraction ceiling — or fork the output
permanently and stop regenerating.
Impact on adoption: this decides whether Loom is a *compiler* (fine — you never edit
the output, like you never edit `.class` files) or a *scaffolder* (you own it). It is
sold as the second and behaves as the first. Every gap in the register above
(F-002, F-004, F-006, F-008) becomes much more expensive under the compiler reading,
because you cannot patch around it locally.
Time lost: 40 min.

---

### F-013 — A field named `state` makes the .NET backend fail to compile — and it is the exact example `docs/language.md` uses to demonstrate legal field names
Severity: **S1**   Class: **SILENT gap**
Area: codegen / dotnet / naming
Claim under test: `docs/language.md` § *Keywords — hard vs. soft*, which prints this as a
working example:
```ddd
context Orders {
  aggregate Order {
    state: string        // page-DSL `state {}` keyword — soft as a field
    …
```

Repro: `eval-clinica/repro/r14-dotnet-state-collision.ddd` — **9 lines of model**
```ddd
aggregate Order { state: string }
…
deployable api { platform: dotnet, … }
```
```
node bin/cli.js generate system eval-clinica/repro/r14-dotnet-state-collision.ddd -o /tmp/out-r14
docker run … mcr.microsoft.com/dotnet/sdk:10.0 dotnet build
```
Generation: `Wrote 52 file(s)`, `0 error(s)`.
Observed (executed):
```
/w/Domain/Orders/Order.cs(16,19): error CS0102: The type 'Order' already contains a
    definition for 'State'
/w/Domain/Orders/Order.cs(46,23): error CS0542: 'State': member names cannot be the same
    as their enclosing type
Build FAILED.
```
Cause: the .NET emitter writes a nested `public sealed class State { … }` (the
rehydration DTO) inside **every** aggregate class, and the property for a field named
`state` is `public string State`. Any aggregate with a `state` field collides.

I hit this in Clinica, not in a probe — `Appointment.state` and `WaitlistEntry.state`,
the most natural name for a lifecycle field, gave 4 compile errors. The same model
compiles clean on node.
Expected: reserve the name in the validator, or mangle the nested type.
Workaround: rename the field (`status`, `lifecycleState`). Changes the wire contract,
so it is not free once shipped.
Impact on adoption: `state` is a top-20 field name. Combined with F-004 this means
**two of the five backends could not compile my realistic model**, from two unrelated
causes, with no diagnostic from `generate`.
Time lost: 20 min.

---

### F-014 — `mask unless` emits `Objects.equals(...)` into `<Agg>Response.java` without importing `java.util.Objects` — the Java project does not compile
Severity: **S1**   Class: **SILENT gap**
Area: codegen / java / field masking
Claim under test: `docs/auth.md` — `mask unless <predicate>` field read-redaction, listed
as a shipped feature; README — five backends from one source.

Repro: `eval-clinica/repro/r15-java-mask-missing-import.ddd` (14 lines)
```ddd
aggregate Employee {
  name: string
  salary: money mask unless currentUser.role == "hr"
}
```
Generated `features/employees/EmployeeResponse.java` line 21:
```java
return new EmployeeResponse(…, (__maskUser != null && (Objects.equals(__maskUser.role(), "hr")))
    ? … : null, value.version());
```
and its import block is:
```java
import com.loom.api.auth.CurrentUserAccessor;
import com.loom.api.auth.User;
import java.util.List;
import java.util.UUID;
```
— no `java.util.Objects`.
Observed on the full Clinica model under `gradle testClasses`:
```
symbol:   variable Objects
location: class PractitionerResponse
1 error
BUILD FAILED in 51s
```
Expected: emit the import, or compare with `==`/`.equals` inline.
Workaround: add one import line by hand — which F-012 then deletes on the next regenerate.
Impact on adoption: `mask unless` is the sanctioned answer to the *other* honest gap
(`sensitive(...)` not reaching the wire — see `loom.sensitive-wire-unsupported`). So the
recommended remedy for PII exposure breaks the Java build.
Time lost: 20 min.

---

### F-015 — The Elixir backend fails `mix compile --warnings-as-errors` on any operation with a `datetime` parameter
Severity: S3   Class: **SILENT gap** (contradicts a stated CI gate)
Area: codegen / elixir
Claim under test: README § Status — opt-in suites "build and boot the generated stacks
against real toolchains (… `mix compile --warnings-as-errors`)".

Repro: `eval-clinica/repro/r13-elixir-datetime-warning.ddd` (11 lines)
```ddd
aggregate Appt {
  startAt: datetime
  operation reschedule(newStart: datetime) { startAt := newStart }
}
```
```
docker run … elixir:1.18-alpine  mix deps.get && mix compile --warnings-as-errors
```
Observed (executed):
```
warning: the underscored variable "__other" is used after being set …
 48 │       __other -> __other
    └─ lib/api/c.ex:48:18: Api.C.reschedule_appt/2
Compilation failed due to warnings while using the --warnings-as-errors option
```
5 such warnings on the Clinica model, all from the generated datetime-coercion helper
(`__dt` / `__s` / `__d` / `__other`). It compiles fine without the flag.
Expected: name the bindings without the leading underscore.
Impact on adoption: cosmetic in itself, but it means a team that adopts the project's own
recommended gate cannot build a model with a `datetime` operation parameter.
Time lost: 15 min.

---

### F-016 — Calling an aggregate `function` from a workflow emits a call to a `private` member on node/.NET/Java and a **wrong method name** on Python: 4 of 5 backends broken
Severity: **S1**   Class: **SILENT gap**
Area: codegen / node + dotnet + java + python / aggregate helper functions
Claim under test: `docs/language.md` — "`function name(params): TypeRef = Expression` —
Pure helper (expression form); callable from any expression in the same aggregate";
`docs/workflow.md` — workflows "load or create multiple aggregates, invoke their
operations". This is the DSL's only mechanism for naming a domain rule once and reusing it.

Repro: `eval-clinica/repro/r16-workflow-calls-private-function.ddd` (26 lines)
```ddd
aggregate Tech {
  skills: string[]
  function hasSkill(s: string): bool = skills.contains(s)
}
workflow assign transactional {
  create(job: Job id, tech: Tech id) {
    let t = Techs.getById(tech)
    precondition t.hasSkill("physio")
    …
```
`generate system` → `Wrote 46 file(s)`, `0 error(s), 0 warning(s)`.

| Backend | Emitted member | Call site | Result |
|---|---|---|---|
| node | `private hasSkill(s: string)` | `http/workflows.ts:54` `t.hasSkill(…)` | **TS2341 — does not compile** (executed) |
| dotnet | `private bool HasSkill(string s)` | workflow handler | **CS0122 — does not compile** (inspected) |
| java | `private boolean hasSkill(String s)` | workflow service | **does not compile** (inspected) |
| python | `def _has_skill(self, s)` | `workflows_routes.py:39` calls **`t.has_skill(…)`** | **`AttributeError` at runtime** — the names don't even match |
| elixir | `has_skill/2`, public | context module | ✓ |

This is the same root cause as **F-004** but on a much wider surface: F-004 was
`when` guards, this is *any* cross-aggregate use of a helper `function`. Together they
mean the `function` member is effectively unusable outside the declaring aggregate on
four of the five backends, with no diagnostic.

Hit in the real Clinica model: `precondition p.hasSkill("physio")` inside the
`scheduleAppointment` workflow — the skill-matching rule the domain spec calls for.
Workaround: inline the predicate at every call site.
Impact on adoption: this and F-004 are the two findings that most directly contradict
"five backends from one source". The node project for my realistic model did not compile
until I removed both uses.
Time lost: 20 min.

---

### F-017 — The `ddd i18n` translator workflow produces locale files the generator never emits; a second language requires hand-editing generated source
Severity: **S2**   Class: **SILENT gap** (the CLI succeeds and the result goes nowhere)
Area: i18n / frontend codegen / docs
Claim under test: README — the `ddd i18n` command set; `docs/language.md` — ICU format
specs "drive the i18n string catalog". The Clinica brief requires "patient portal
localized into two languages".

Repro (executed end to end):
```
node bin/cli.js i18n extract eval-clinica/clinica/main.ddd --out /tmp/i18n   # 288 messages
cd eval-clinica/clinica && node ../../bin/cli.js i18n init main.ddd et       # locales/et.json, 288 TODO
# translate 4 keys by hand
node ../../bin/cli.js i18n check main.ddd --strict                   # "et: 284 TODO" → exit 1 ✓
node ../../bin/cli.js i18n sync main.ddd                             # "et: +1 new, 288 kept" ✓
cd /home/user/Loc && node bin/cli.js generate system eval-clinica/clinica/main.ddd -o eval-clinica/out-node
ls eval-clinica/out-node/staff_web/src/locales/
```
Observed: **`en.json` only.** The Estonian catalog with real translations sits in
`eval-clinica/clinica/locales/et.json` and is never read by `generate system`. There is no
`--locales` flag (checked `generate system --help`).

The generated runtime states the manual step itself
(`staff_web/src/i18n.ts`, emitted by `src/generator/_frontend/i18n-runtime.ts`):
> "To add a locale, drop a `src/locales/<locale>.json` file, **import it below, and
> register it in `catalogs`**."

So shipping a second language means hand-editing two generated files — which F-012 shows
are silently overwritten on the next regenerate, or frozen (and then stale) under
`.loomignore`.

Secondary: there is **no i18n reference doc**. `docs/README.md`'s index has no i18n entry,
and `grep -rn locale docs/*.md` returns nothing about wiring a locale. The only pointer
is in `docs/new-plan/` (the roadmap), which the README itself labels as plan, not reference.

The three-way merge itself is genuinely good — it kept my hand translations across a model
change and reported `+1 new, 288 kept` correctly. The gap is purely the last mile.
Expected: emit every `locales/*.json` next to the `.ddd` into each frontend and register
them in the generated `catalogs` map.
Workaround: hand-edit + `.loomignore`, with the staleness cost of F-012.
Impact on adoption: for any product that ships in more than one language, i18n is not
finished in the model — which is the opposite of the single-source-of-truth claim.
Time lost: 35 min (including 10 looking for a doc that does not exist).

---

### F-018 — A self-recursive entity part (a tree) validates clean, then crashes the generator with `RangeError: Maximum call stack size exceeded` on 4 of 5 backends
Severity: **S2**   Class: **SILENT gap** (crash where a diagnostic belongs)
Area: codegen / node + dotnet + python + elixir / containment
Claim under test: README — "Validation gates catch hallucinated fields and out-of-scope
references **before any code is emitted**."

Repro: `eval-clinica/repro/r18-recursive-containment-crash.ddd` (10 lines)
```ddd
aggregate Tree {
  contains kids: Node[]
  entity Node { label: string  contains kids: Node[] }
}
```
```
node bin/cli.js parse  …   → 0 error(s), 0 warning(s).  OK
node bin/cli.js generate system … -o /tmp/out-e05
```
Observed:
```
0 error(s), 0 warning(s).
RangeError: Maximum call stack size exceeded
    at nestedContainLoads (out/generator/typescript/repository-find-builder.js:154:26)
```
| Backend | Result |
|---|---|
| node | `RangeError: Maximum call stack size exceeded` |
| dotnet | `RangeError: Maximum call stack size exceeded` |
| python | `RangeError: Maximum call stack size exceeded` |
| elixir | `RangeError: Maximum call stack size exceeded` |
| java | `Wrote 60 file(s)` — generates (not compile-checked) |

A self-referencing part is the obvious first attempt at any tree-shaped domain
(org chart, category tree, threaded comments, a bill of materials). It parses and
validates as legal and then takes down the generator with a Node stack trace.
Expected: `loom.containment-cycle` or similar.
Workaround: model the recursion as a separate aggregate with a `Self id`-style
parent reference (which the `tenantRegistry` capability itself does).
Time lost: 15 min.

---

### F-019 — An entity whose name ends in `Exception` fails the .NET build under the analyzer settings the generator itself writes
Severity: S3   Class: **SILENT gap**
Area: codegen / dotnet / naming
Claim under test: README § Status — ".NET `dotnet build /warnaserror`'d" as a CI gate.

Repro: the Clinica model declares `entity AvailabilityException` (a date-specific
availability exception — ordinary domain language in scheduling).
```
docker run … mcr.microsoft.com/dotnet/sdk:10.0  dotnet build -warnaserror
```
Observed:
```
/w/Domain/Practitioners/AvailabilityException.cs(13,21): error CA1711: Rename type name
AvailabilityException so that it does not end in 'Exception'
Build FAILED.
```
The generated `Api.csproj` sets `<AnalysisLevel>latest-recommended</AnalysisLevel>` and
suppresses several CA rules by hand (CA1707, CA1848, CA1873 — with good comments
explaining why) but not CA1711, which fires on a *domain* name the author chose.
Plain `dotnet build` **succeeds with 0 warnings** once F-013 is worked around, so this is
specifically the `-warnaserror` gate.
Expected: suppress CA1711 alongside the others, or warn at model level.
Workaround: rename the entity.
Time lost: 10 min.

---

### F-020 — The OIDC `audience` check is off by default, the clause that enables it is undocumented, and the generated comment claims the check is on regardless
Severity: **S2** (security)   Class: **SILENT gap** + docs gap
Area: generated auth / all five backends
Claim under test: the generated `api/auth/oidc.ts` itself:
```
/** Generated OIDC verifier — validates signature (JWKS), issuer, and audience,
 *  then maps claims onto User. */
```
and, in the same emitter, `// … checks `iss` / `aud` / `exp` …`.

Repro (executed against the running Clinica API + a local JWKS issuer,
`eval-clinica/tools/idp.mjs`), with the model declaring the documented
`auth { oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") } }`:
```
# a token from the SAME issuer but minted for a different client
aud=some-other-app  →  GET /api/clinics  →  200
```
The emitted code is:
```ts
const { payload } = await jwtVerify(token, await getJwks(), { issuer: ISSUER });
```

**Root cause (corrected after reading the emitter — my first diagnosis said the check
was simply absent; it is conditional).** Every backend emits the audience check **only
when the model declares an `audience:` clause**:

| Backend | emitter | no-`audience:` behaviour |
|---|---|---|
| node (hono v4/v5) | `src/platform/hono/v4/auth-emit.ts:487` | `{ issuer: ISSUER }` — **check omitted** |
| dotnet | `src/generator/dotnet/auth-emit.ts:161` | check omitted |
| java | `src/generator/java/emit/auth.ts:674` | check omitted |
| elixir | `src/generator/elixir/auth-emit.ts:529` | check omitted |
| python | `src/generator/python/auth-emit.ts:590` | falls back to `os.environ.get("OIDC_AUDIENCE")` — **enablable at deploy time**, unlike the other four |

Three things compound:
1. **`audience:` exists in the grammar** (`src/language/ddd.langium:182`) but
   **`grep -n "audience" docs/auth.md` returns nothing** — the only way to discover the
   clause is to read the grammar. I wrote the `oidc { … }` block from `docs/language.md`'s
   own example, which shows `issuer` and `clientId` only.
2. **`clientId` is declared and is the natural audience**, and is used for the `/auth/*`
   handshake — but never as the verification audience, and nothing warns.
3. **The emitted comment asserts the check unconditionally**, so reading the generated
   source does not reveal that it is off.

Why it matters: one IdP realm serving several applications is the normal enterprise shape
— and is exactly what the generator's own `keycloak/realm.json` sets up. Without an `aud`
check, a token issued to *any* client of that realm authenticates here, carrying its
roles/permissions claims. The audience check is the control that stops one app's token
being replayed at another.
Expected: default the audience to `clientId`; or emit `loom.auth-audience-unset` (warning,
error under `enforcement: denyByDefault`) when `auth { oidc }` omits it; and make the
comment conditional on what was actually emitted. Also document the clause in `docs/auth.md`.
Workaround: **add `audience: env("OIDC_AUDIENCE")` to the `oidc { }` block** — a one-line
model change, once you know the clause exists.
Time lost: 15 min to find, 10 more to diagnose correctly.

Adjacent, lower-severity observations from the same review (each executed):
- **403 responses echo the authorization predicate source** —
  `"detail":"Forbidden: currentUser.permissions.contains(permissions.manageSchedule)"`.
  Useful in dev, information disclosure in prod; no flag to suppress it.
- **The generated Keycloak realm ships no protocol mappers for the declared claims.**
  `user { role, clinicId, permissions }` is declared in the model, and
  `keycloak/realm.json` emits only `sub`/`email` — so the out-of-the-box compose stack
  issues tokens with **no tenant claim**. That degrades safely (F-021) but means the
  batteries-included IdP cannot actually exercise the tenancy the model declares.

**Things that passed this review** (executed, so the register is balanced):
`?sort=id;DROP TABLE…` → 422, table intact (sort is whitelisted against a `sortColumns`
map with a safe default); `?pageSize=999999` → 422 (capped at 500); CORS is an explicit
env allowlist with `corsAllowAnyFallback = false`; every DB read goes through Drizzle's
parameterised builder; the 401 body is RFC 7807 like every other error; unauthenticated
requests to a path nothing serves fall through to 404 rather than 401 (with an RFC 9110
citation in the comment explaining why).

---

### F-021 — POSITIVE: tenant isolation held under direct attack
Severity: n/a (verified strength)
Area: tenancy / generated reads
Claim under test: `docs/tenancy.md` — "the 'forgot the filter on one query' cross-tenant
leak becomes a compile error instead of an incident".

Executed against the running Clinica API with two real tenants (clinic A, clinic B) and
real rows, using tokens minted with each tenant's claim:

| Attack | Result |
|---|---|
| tenant B `GET /api/appointments` | `{"items":[],"total":0}` |
| tenant B `GET /api/appointments/{A's id}` | **404** (existence hidden, not 403) |
| tenant B `POST /api/appointments/{A's id}/cancel` with a valid body | **404** |
| tenant B `GET /api/patients` | `{"items":[],"total":0}` |
| malformed tenant claim (`"CLINIC-A"` against a `guid` registry id) | empty list / 404, **not a 500** |
| registry self-scope: `GET /api/clinics` with the correct guid claim | exactly the caller's own clinic |

Also verified: `requires` gates → 403 (`frontDesk` cannot `reschedule`, cannot create a
`Practitioner`); `mask unless` → `"costRate": null` for `frontDesk` and `"85.5000"` for
`clinicManager`, from the same endpoint.
I could not break tenant isolation from the outside. Every business table carries
`tenant_id` with a derived index, and the filter is AND-ed into the generated reads.

---

### F-022 — An aggregate with a `string[]` field makes the generated Angular app fail `ng build`; React degrades honestly from the same model
Severity: **S1**   Class: **SILENT gap** — and a textbook parity divergence
Area: codegen / angular frontend / scaffolded create forms
Claim under test: README — "Six frontends … Pick per deployable. Switch any time."

Repro: `eval-clinica/repro/r22-angular-string-array-form.ddd` (17 lines)
```ddd
aggregate Tech { fullName: string  skills: string[]  derived display: string = fullName  create() { } }
ui W with scaffold(subdomains: [S]) { framework: angular }
deployable web { platform: angular, targets: api, ui: W, design: angularMaterial, port: 3004 }
```
```
node bin/cli.js generate system eval-clinica/repro/r22-angular-string-array-form.ddd -o /tmp/out-r22   # Wrote 76 file(s)
docker run … node:24-bookworm-slim  npm install && npm run build
```
Observed (executed):
```
✘ [ERROR] TS2345: Argument of type '{ fullName: string; skills: null; }' is not assignable
  to parameter of type 'CreateTechRequest'.
    Types of property 'skills' are incompatible.
      Type 'null' is not assignable to type 'string[]'.
  src/app/pages/tech-new.component.ts:40:50
Application bundle generation failed.
```
The generated Angular form builds the control as
`skills: new FormControl(null, { nonNullable: true })` and then hands `getRawValue()`
straight to a request type that requires `string[]`.

**What makes this the clearest parity story in the whole evaluation:** the *same*
limitation on React is handled honestly and visibly —
```tsx
defaultValues: { …, skills: [] },
<TextInput label="Skills" … disabled
  placeholder={t("pack.mantine.arrayUnsupported.m0hiqj", "(arrays not yet supported in forms)")} />
```
a disabled, *translated*, user-visible "arrays not yet supported in forms". Vue and Svelte
also build. Angular alone turns the same honest gap into a project that does not compile.
Expected: the Angular walker should take the same degradation path.
Workaround: don't use `T[]` scalar collections on any aggregate an Angular UI scaffolds —
which means the framework choice constrains the *domain model*.
Impact on adoption: this is the concrete answer to "are the six frontends
interchangeable?" — for my model, four of six built and one of the remaining two failed on
a field type the others handle. Discovering it costs a full `npm install` + `ng build` per
frontend, per model change.
Time lost: 25 min.

---

### F-023 — The README's "Live site" links point at the old org and 404 (the site itself is fine at the new one)
Severity: S3 (corrected down from S2)   Class: **Contradicted claim** — **claimed + fixed by #2911 (its F-043)**
Area: docs / project presentation
Claim under test: README — "**Live site:** <https://lemmit.github.io/Loc/>".

Repro:
```
curl -o /dev/null -w "%{http_code}\n" https://lemmit.github.io/Loc/            # 404
curl -o /dev/null -w "%{http_code}\n" https://loom-harness.github.io/Loc/      # 200
curl -o /dev/null -w "%{http_code}\n" https://loom-harness.github.io/Loc/playground/  # 200
```
The repository moved to the `Loom-Harness` org and the README's links (5 `lemmit.github.io`
+ 6 `github.com/lemmit/Loc` URLs across `README.md` and `docs/`) were not updated.

**Correction to my first write-up.** I originally reported this as "and no site is served at
the new org either", graded it S2, and said the playground "could not be evaluated as
advertised". That was wrong: I probed `loom-harness.github.io/loc/` (lowercase) and took the
404 as conclusive. GitHub Pages paths are case-sensitive — `/Loc/` serves 200, playground
included. The finding is real but smaller than I stated: stale links, not a missing site.
**#2911 already fixes it** (26 live files, including every scaffolded project via
`new-templates.ts`), so no work is claimed here.

---

### F-024 — A `transactional` workflow that emits an event declares its event buffer inside the `try` and drains it after the `catch` — CS0103 on .NET
Severity: **S1**   Class: **SILENT gap**   Status: **FIXED in this branch**
Area: codegen / dotnet / workflows
Found by: clearing F-013 and F-019 and re-running `dotnet build -warnaserror` on the full
Clinica model — this defect was hidden behind them.

Repro: `eval-clinica/repro/r24-dotnet-transactional-workflow-emit.ddd` (19 lines)
```ddd
workflow finishDoc transactional {
  create(d: Doc id) {
    let x = Docs.getById(d)
    x.finish()
    emit DocFinished { doc: d }
  }
}
```
Observed (executed, `mcr.microsoft.com/dotnet/sdk:10.0`):
```
/w/Application/Workflows/ScheduleAppointmentHandler.cs(55,28): error CS0103:
    The name '_workflowEvents' does not exist in the current context
Build FAILED.
```
Cause: `renderHandler` pushed `var _workflowEvents = new List<IDomainEvent>();` as the first
entry of `stmtLines`, and the `transactional` branch wraps `stmtLines` in `try { … }`. The
drain (`foreach (var ev in _workflowEvents)`) runs **after** the try/catch — deliberately, so
events dispatch only on commit — and so could not see the declaration. The non-transactional
path could not reach this: there `stmtLines` and the drain are already at the same level.

Fix: the body assembly declares the buffer at method level for both paths (non-transactional
output byte-identical). The sibling `renderEventReactorHandler` and the event-sourced branch
keep their own declarations — neither is try-wrapped.
Test: `test/generator/dotnet/emitter-owned-names.test.ts`, mutation-proved.
