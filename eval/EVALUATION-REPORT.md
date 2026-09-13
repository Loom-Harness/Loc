# Loom — engineering evaluation

**Question:** should we build our next product on Loom, and under what conditions?
**Method:** a ~10-hour time-boxed spike. I built **two** applications of my own from
scratch in the DSL — a multi-tenant B2B field-service system (**FieldOps**, 354 lines,
11 aggregates) and an insurance claims-handling system (**Clearline**, 196 lines, built
specifically to probe abstract aggregates, TPH-vs-TPC, discriminated unions and an
authority-limit rule). I ran FieldOps against a real Postgres,
regenerated it onto all five backends and six frontends, evolved it against a
populated database, attacked its tenant isolation from outside, and only then read
the maintainers' internal material.
**Evidence:** `eval/EVAL-LOG.md` (commands + exact output + time lost),
`eval/FINDINGS.md` (43 findings + 6 recorded positives, numbered, with repro steps),
`eval/repro/*.ddd` (17 minimal reproductions), `eval/fieldops/`, `eval/clearline/`,
`eval/adversarial/`.

---

## 1. Recommendation

# **Pilot only.**

Use Loom today for **one internal, non-revenue system, on the node/Hono + React
target only, with a named owner who accepts the operational rules in §1.2.** Do not
put a customer-facing or revenue-bearing product on it this year.

That is a deliberately higher grade than "do not adopt", and I want to be precise
about why, because the raw defect count would justify a harsher verdict.

**What is genuinely excellent and rare:**
- **Multi-tenant isolation holds.** Eight attack vectors from a second real OIDC
  principal — list, by-id, operation, workflow, audit-history, update, delete, and a
  claimless token — all returned empty or 404, and the filter is compiled into the
  SQL, not bolted onto the DTO. Forgetting a tenancy stance is a compile error. I
  tried to break this and could not. (POSITIVE-01)
- **The destructive-migration gate is better than most hand-rolled tooling.** Drop a
  column with data, retype it, flip it to NOT NULL, or rename two fields at once, and
  it refuses — naming the table, the column, the risk and the exact fix.
  (POSITIVE-02)
- **`ddd trace` maps a production stack trace back to the `.ddd` line and column.**
  That materially changes the "can we debug generated code" answer. (POSITIVE-05)
- **The diagnostics are, when they fire, the best I have seen in a DSL** — 9 of 10
  deliberately broken files got an actionable message at the right line:col, with
  "did you mean" suggestions. (POSITIVE-04)
- **No scaling cliff in the toolchain.** 39 aggregates / 838 lines → 50,124 LOC in
  3.1 s. Generation is effectively flat. (POSITIVE-03)
- **~3 minutes to a running full-stack app with a real database.** Nothing else I
  have measured is close. (Phase 0)

**What blocks anything more than a pilot** — one sentence, because it is one thing:

> Both models, using only documented features, passed `ddd parse` and
> `ddd generate system` with **"0 error(s), 0 warning(s)"** and produced code that
> **did not compile** — FieldOps: 214 files, 7 errors, 5 distinct bugs; Clearline:
> 164 files, 8 errors, 4 more. Then, after I fixed those, adding one nullable field
> to an aggregate silently took the running application down while the container
> reported healthy.
>
> And the sharpest single fact: **`derived bad: string = someString.totallyMadeUpMember`
> passes validation with `0 error(s), 0 warning(s)` and is emitted verbatim** — an
> invented member on any primitive, which is precisely the "hallucinated field" the
> LLM-safety claim says the gates catch.

The architectural claim — *the model is validated before emission, so the layers
cannot drift* — is the entire reason to choose this over a framework plus an AI
assistant. On my model that claim did not hold, and the maintainers' own roadmap
says so in their own words: *"several residues have the WRONG failure mode (silent
output or generator crash instead of an honest `loom.*` gate)."*

### 1.1 What would move this to "Adopt with conditions"

Specific and checkable. All six:

1. **No emitted artifact ever fails its own target compiler for a model that
   validates clean.** Concretely: a CI gate that generates every example *and a
   corpus of adversarial models*, then runs `tsc --noEmit`, `dotnet build
   -warnaserror`, `gradle testClasses`, `mix compile --warnings-as-errors` and
   `mypy` on all of them — and, separately, greps the output for the literal string
   `unresolved:`. **Test it by reverting any one of F-006, F-009, F-011, F-030 and
   confirming the gate goes red.** (Today the vendor's own examples do not trigger
   any of these, which is exactly why CI never saw them.)
2. **The `/* unresolved */ undefined` emitter fallback is deleted**, not
   validator-guarded. A page-body reference the compiler cannot resolve must be a
   `loom.*` error. As long as that fallback exists, every hole nobody has found yet
   is a silent one. (F-014)
3. **`generate system` into a directory with no `.loom/snapshots/` but an existing
   migration history refuses, or at minimum warns loudly.** Re-emitting an
   `Initial` migration under an already-applied tag must not be reachable without an
   explicit flag. (F-029)
4. **`currentUser` is type-checked against the declared `user {}` shape** — a
   reference to a member that shape does not declare is an error, not emitted code.
   (F-008)
5. **A published backend-support matrix that states, per backend, what is
   compile-gated**, and a README that stops implying five equivalent backends until
   five backends compile the same corpus. (F-028)
6. **A second maintainer with merge rights, and tagged releases.** Today: one human,
   810 commits in the visible window, 83% machine-authored, no tags, version 0.1.0.
   (F-037)

Conditions 1–3 are the ones I would actually gate money on. They are all tractable —
none requires a redesign.

### 1.2 Operational rules if you run the pilot

Non-negotiable, because each one is a defect I hit:

- **Commit the entire generated tree to git, including `.loom/snapshots/`, and never
  generate into a fresh directory.** Add a CI assertion that the initial migration
  file's hash never changes. (F-029)
- **Compile the generated output in CI on every model change** — `tsc --noEmit` is
  not optional, it is your only real validator.
- **`grep -rn 'unresolved:' <outdir>` as a build gate.** One line; catches F-014.
- **Pin every image in the generated compose file** and re-pin after each
  regenerate. Two of five sidecars ship on `:latest`, and one of them is a Docker Hub
  repo that no longer exists. (F-013)
- **Do not use the broker/`channels:` feature.** Events carrying a `datetime` are
  published, delivered, and silently dropped by the consumer. (F-019)
- **Node/Hono + React only.** Nothing else compiled.

---

## 2. Claim verification matrix

Every claim quoted verbatim from `README.md` unless marked. Graded against what I
executed.

| # | Claim (verbatim) | Grade | Evidence |
|---|---|---|---|
| 1 | *"The speed of no-code."* / *"All the speed of no-code"* | **Verified** | `ddd new` → `generate system` → `docker compose up` = **~2.9 min of tool time** to a running 3-service stack with a real Postgres, real migrations, an FK with `ON DELETE RESTRICT`, and a 422 on an invariant violation. Phase 0. |
| 2 | *"The keys to the codebase … full ownership of every line that's generated."* | **Partial** | You get readable, idiomatic source and an MIT grant. But 5 of 6 hand-edits were **silently overwritten** on the next generate. `.loomignore` pins a whole file — and `docs/tools.md` tells you not to pin the domain files, which are exactly where every codegen-bug workaround lives. **"You own the source" means "until the next regenerate."** F-031. |
| 3 | *"Zero vendor lock-in."* | **Verified** | The output is a plain Vite/React + Hono/Drizzle tree with a normal `package.json`; it builds and runs with Loom uninstalled. Deleting the DSL costs you the regeneration loop, not the application. See §8 exit cost. |
| 4 | *"No scaling cliff."* | **Partial** | Verified for the *generator*: 11→39 aggregates, generate 2.5 s → 3.1 s, parse 2.4 s → 3.0 s, 50,124 LOC. POSITIVE-03. Unverified for the generated application at load — I did not load-test. The 39-aggregate output did not compile (F-030). |
| 5 | *"No drift between layers."* | **Contradicted** | A projection's `select` resolves names against the domain model, not the emitted table (F-006, F-011). `currentUser.permissions` type-checks against a `user{}` shape that has no `permissions` field (F-008). Declaring the documented list-read gate changes the client's response shape while the page emitter still reads `.items` (F-015). Two enums sharing a member name resolve to the wrong enum in the shared IR (F-022). |
| 6 | *"Validation gates catch hallucinated fields and out-of-scope references **before any code is emitted**."* | **Contradicted** | The page-body emitter's designed fallback for an unresolvable reference is to emit the literal string `/* unresolved: X */ undefined` — six times into one dashboard page — and report `0 error(s), 0 warning(s)`. F-014. The maintainers' own retrospective calls this "a pre-existing gap". |
| 7 | *"All `generate` sub-commands run validation first and refuse to emit if there are errors."* | **Partial** | True as stated (it does refuse) — but a filter the validator accepts kills codegen with an uncaught `QueryEmissionRefusal` and a 10-frame stack trace, whose own message says *"the IR validator should have rejected this filter before codegen reached it."* F-007. |
| 8 | *"Five backends from one source … Identical API contracts; idiomatic per-runtime output."* | **Contradicted** | All five **generate** with `0 error(s)`. **One compiles.** node ✅ · python (imports, but `mypy`: 10 errors incl. a runtime-fatal undefined name) · dotnet ❌ 3 errors · java ❌ 5 errors · elixir ❌ compile error, ≥2 distinct. F-028. |
| 9 | *"Six frontends — React, Vue, Svelte, Angular, Feliz, Flutter."* | **Partial** | Built from the same model: react ✅, svelte ✅, angular ✅, vue ❌ (F-021), feliz ❌ 31 F# errors (F-033), flutter **unverified** (no Flutter SDK in my environment — I will not grade what I did not run). |
| 10 | *"Thirteen design packs … swap any time. The page DSL is identical; only the rendering changes."* | **Verified (4 sampled)** | mantine, shadcn, mui, chakra all built clean from the same `ui` block — swapping is a one-word change. I sampled 4 of 13 on React plus vuetify/shadcnSvelte/angularMaterial via their frameworks. Not a claim about the other packs. |
| 11 | *"Pick a runtime per deployable. Switch any time."* | **Verified (mechanically)** | One system with a node backend + a python backend + a react frontend + a svelte frontend composed into a single 10-service stack, generated clean. Mechanically true; §8's caveat is that only one of those runtimes compiles. |
| 12 | *"Browser playground. Typed editor with LSP support, visual system builder, live preview, in-browser test runner."* | **Unverified** | `web/` has no `node_modules` in a fresh clone and `npm run build:web` no-ops with a hint. I chose to spend the budget on compiling backends instead. Not tested; not graded. |
| 13 | *"Built-in traceability … `ddd verify` rolls results into per-requirement Definition-of-Done verdicts."* | **Verified** | Real: `requirement` → `testCase` → `test verifies TC-00x` → `ddd verify --results` → `✅ US-001 (VERIFIED) / ❌ US-003 (FAILING)`, **exit 1** on a failing requirement, plus `.loom/gaps.md` listing requirements with no solution. One caveat: an unrecognised `status` string is silently treated as unverified while the report says "_No unknown results._" (F-035). |
| 14 | *"LLM-safe by construction. One source of truth … Validation gates catch **hallucinated fields** … before any code is emitted."* | **Contradicted** | **Directly.** `s.totallyMadeUpMember` on a `string`, `n.alsoInvented` on an `int`, `m.amount` on a `money` — every primitive accepts an arbitrary invented member with `0 error(s), 0 warning(s)`, and it is emitted verbatim into the domain class and into an `invariant` that can then never fire (F-040, 20-line repro). Plus: a compiler that says "0 errors" over code that does not compile (F-012, F-028), emits `undefined` into a page (F-014), and resolves an enum member to the wrong enum (F-022). The DSL *is* small enough to fit in a prompt and the model *is* a single source of truth — but the gate that would make an LLM safe on it is open. |
| 15 | *"The **code Loom generates** … is licensed to you under the MIT License — the CLI emits a `LICENSE` file at the output-directory root that says so explicitly."* | **Contradicted** | `ddd generate system -o out` emits no `LICENSE`. Only `ddd new` does. `docs/tools.md` states the real behaviour and contradicts the README. The *grant* is real; the *artifact* is not. F-036. |
| 16 | *"Generated migrations (Drizzle / EF Core / Ecto / JPA / SQLAlchemy)."* | **Partial** | Excellent in place — correct incremental deltas, a strong destructive gate, data preserved across a rename. **Catastrophic from a clean directory** — rewrites the initial migration under the same tag, the migrator skips it, the app 500s on every request while reporting healthy. F-029. |
| 17 | *"OIDC … PKCE, refresh rotation"*, `docs/auth.md` | **Partial** | The verifier, JWKS handshake and Keycloak sidecar are all real and the 401/403/404 behaviour is correct. But the generated realm provisions **zero protocol mappers** for the claims the model declares, so the shipped demo user has no `tenantId` and every write 500s until you hand-configure Keycloak (25 min). F-016, F-018. |
| 18 | `docs/channels.md`: *"the consumer loop receives it and spawns the correlated instance … in its own database"* | **Contradicted** | Publishing is perfect (valid CloudEvents 1.0 on the broker, verified by subscribing directly). The consumer drops every event carrying a `datetime` — `value.toISOString is not a function`, logged at `warn` in a different service, no retry, no DLQ. The README's own example event has a `datetime`. F-019. |
| 19 | `docs/scaffold-macros.md`: *"A hand-written `<Agg>Totals` wins."* | **Contradicted** | It produces six `/* unresolved */ undefined` holes and a frontend that does not build. Deleting the hand-written projection fixes it. F-014. |
| 20 | `docs/auth.md`: *"Declaring an explicit `find all(): T[] requires <expr>` gates that route."* | **Partial / harmful** | The gate lands, but the declaration switches the API client from a paged envelope to a bare array while the page emitter still reads `.data.items`. You can have the gate or a working frontend, not both. At runtime `(x.data?.items ?? [])` is `[]` — a silently empty picker, no error anywhere. F-015. |

**Tally: 5 Verified · 8 Partial · 6 Contradicted · 1 Unverified.**

---

## 3. Target matrix

One model (`eval/fieldops/fieldops.ddd`, 354 meaningful lines), regenerated by
substituting only `platform:` / `framework:` / `design:`.

### Backends

| backend | generates | Loom's verdict | **compiles** | boots | wire-verified |
|---|---|---|---|---|---|
| **node** (Hono/Drizzle) | ✅ 224 files | 0 errors | ✅ `tsc --noEmit` clean | ✅ **full round-trip against Postgres** | ✅ values checked |
| **python** (FastAPI/SQLAlchemy) | ✅ 244 files | 0 errors | ⚠️ imports; **`mypy` 10 errors** incl. `Name "current_user" is not defined` (runtime 500) | not attempted | unverified |
| **dotnet** (ASP.NET/EF) | ✅ 495 files | 0 errors | ❌ `dotnet build -warnaserror` — **3 errors** | n/a | unverified |
| **java** (Spring Boot/JPA) | ✅ 415 files | 0 errors | ❌ `gradle testClasses` (JDK 25/Gradle 9) — **5 errors** | n/a | unverified |
| **elixir** (Phoenix/Ecto) | ✅ 375 files | 0 errors | ❌ `mix compile` — **≥2 distinct** (aborts on first) | n/a | unverified |

### Frontends

| frontend / pack | generates | **builds** (`npm run build` / `dotnet build`) | notes |
|---|---|---|---|
| react / mantine | ✅ | ✅ | the fully exercised path |
| react / shadcn | ✅ 241 files | ✅ | |
| react / mui | ✅ 224 files | ✅ | |
| react / chakra | ✅ 225 files | ✅ | |
| svelte / shadcnSvelte | ✅ 227 files | ✅ | |
| angular / angularMaterial | ✅ 224 files | ✅ | |
| vue / vuetify | ✅ 226 files | ❌ | `TS2345` on an optional ref in a `router-link :title` (F-021) |
| feliz / "corporate" | ✅ 160 files | ❌ **31 F# errors** | workflow-form emitter uses two different field-name sets (F-033) |
| flutter / daisyui | ✅ 185 files | **unverified** | no Flutter SDK available; not graded |

**Multi-target composition:** two frontends (react + svelte) on one backend, and two
backends (node + python) in one system, generated clean into a single 10-service
compose stack. Mechanically real.

**The second model, on the one backend that works.** Clearline (196 lines,
inheritance + unions + authority limits) on node/Hono:
`0 error(s), 0 warning(s). Wrote 164 file(s)` → **`tsc --noEmit`: 8 errors**, four of
them new classes (F-039 `== null` in a criterion, F-040 invented members on
primitives, F-041 a projection over a TPH subtype, plus F-030 again). So the backend
that passed FieldOps after five workarounds failed a second, differently-shaped model
in four new ways on the first compile.

**Honest scope statement:** I sampled **two** models. These results say "the five
backends are not interchangeable for these domains" — not "backend X never works".
Every ❌ above is a specific, minimal, reproducible defect in `eval/repro/`.

---

## 4. What using it is actually like

### Phase 0 — the first hour is genuinely delightful

`ddd new phase0` → 4 files. `ddd generate system main.ddd -o .` → **83 files in
1.5 s**. `docker compose up -d --build` → 58 s → three healthy services. `POST
/api/projects {"name":"Apollo"}` → an id; `GET` it back → correct JSON with the
derived field materialised and an optimistic-concurrency `version`; `psql` shows a
real schema-namespaced table with a real FK. Post `{"name":""}` → RFC7807 422 with
`{"pointer":"/name","message":"Name must be at least 1 character"}`.

Two rough edges: the README writes every command as `ddd …` but never puts `ddd` on
`PATH` (F-001), and behind a TLS-inspecting corporate proxy the first
`docker compose up` hangs for 15 minutes with no output (the fix — drop a CA into the
generated `certs/` dir — is in the Dockerfile's own comment, but nothing on the
failure path points at it; F-003).

The scaffolded `main.ddd` opens with a comment naming two of its own auth holes. That
candour is characteristic, and it is the single best thing about the product's
documentation culture.

### Phase 1 — modelling is fast until it isn't

The WorkOrder slice — a five-state lifecycle with guarded transitions, contained line
items, a derived Money total, a cross-field single-currency invariant, technician
skills and domain events — **parsed clean on the first try**. That is a remarkable
DSL result and I want it on the record.

Then I hit three walls in ninety minutes, and all three are things a real application
needs:

1. *"On completion, decrement stock for each part used; insufficient stock fails the
   whole operation."* The workflow grammar has `for x in Repo.run(...)` and it has
   `let x = Repo.getById(...)`, but a `for` body may not contain the second. I tried
   iterating the contained line items (refused, correctly), then lifted part-usage
   into its own aggregate with a criterion and retrieval so the loop iterated a real
   repository result — refused again, because the *load inside the loop* is the
   problem. There is no spelling. I shipped one-part-per-call. (F-004)
2. *"A technician sees only their own work orders; an admin sees all."* The
   permission-catalogue spelling is honestly refused (`.contains` isn't queryable).
   Every other spelling — `currentUser.role == "admin" || …`, even a bare `true || …`
   — passes `ddd parse` with `0 error(s)` and then crashes `generate system` with a
   ten-frame internal stack trace. Only the unconditional owner filter survives, so
   admins lose the list. (F-005 + F-007)
3. *The dashboard.* `sum(w.total)` over a derived field and `sum(i.amount.amount)`
   over a value-object sub-field both validate clean and emit SQL against columns
   that do not exist. I denormalised a stored `totalAmount` column purely so the
   reporting layer could work. (F-006, F-011)

Two diagnostics in this phase were genuinely better than a human reviewer:
`loom.unique-missing-tenant-scope` — *"`unique (number)` on tenant-owned aggregate
'Invoice' omits the tenant discriminator — this is a GLOBAL unique across all
tenants. Did you mean `unique (tenantId, number)`?"* — and the Feliz design-pack error
that listed all 32 valid daisyUI themes.

**Then I compiled it.** `0 error(s), 0 warning(s). Wrote 214 file(s)` — and
`tsc --noEmit` gave me seven errors across five distinct bugs, four of which the
validator is structurally positioned to catch. The frontend gave me fourteen more, in
pages a macro wrote. That moment — the gap between the compiler's confidence and the
type checker's verdict — is the whole evaluation in one command.

### Clearline — the second model, in ninety minutes

I built the claims domain specifically to reach what FieldOps hadn't: an `abstract
aggregate Claim` with three concrete kinds sharing one lifecycle and one queue, a
discriminated union of decision outcomes, and an authority-limit rule.

The good: **TPH is textbook.** One `claims` table, a `kind` discriminator, shared
columns NOT NULL, subtype columns NULL, the `Money` value object flattened into
`contractor_estimate_amount` / `_currency`. I read the DDL and would have signed it
off in review.

The instructive: **you cannot change your mind.** Flipping to `ownTable` (TPC) is not
a migration problem — it is a *modelling* error, five of them, one per aggregate that
references `Claim id`. Reserves, payouts, subrogations and approval steps all hang off
"a claim"; the diagnostic's suggested fix ("reference a concrete subtype's id") means
three nullable FKs per child and losing the polymorphism the base existed for. So the
brief's exercise — *decide, then change your mind and migrate* — has the answer **"the
decision is permanent."** The diagnostic is excellent and I do not hold this against
the tool's honesty; I hold it against anyone who plans to defer the choice.

The frustrating: the authority-limit rule is expressible as a write gate
(`requires amount.amount <= money(currentUser.authorityLimit)` — exactly the shape the
brief asks for, and it works) but **not as a read**. `currentUser` is illegal in a
`derived`, and `requires` gates get no `can_*` companion, so the queue cannot show an
adjuster which steps they may actually approve. The only way to build that screen is
to re-implement the rule in TypeScript against the token — writing the authorization
rule twice, in two languages, which is the exact drift the product exists to prevent.

And then I compiled it: `0 error(s), 0 warning(s)`, 164 files, **8 `tsc` errors**,
four of them classes I hadn't seen in FieldOps. The one that stopped me was
`limit.amount > deductible.amount` on two `money` fields — a natural thing to write,
accepted by the validator, emitted as `this._limit.amount > this._deductible.amount`
on a `Decimal` that has no `.amount`. I generalised it in a 20-line file: **every
primitive accepts an arbitrary invented member with zero diagnostics.**

### Phase 5 — the evolution story is two different products

**In place, it is excellent.** Add `phone: string?`, regenerate over the existing
tree, and you get `Wrote 18 file(s), unchanged: 204` and a clean incremental
migration. Deploy it: column added, existing rows preserved, app healthy. Then try to
break it — drop a column with data, retype it, flip it to NOT NULL, rename two fields
at once — and every one is **refused**, with the table, the column, the risk and the
exact `migration { … }` syntax that would make it safe. A single rename is
auto-detected and emitted as a real `RENAME COLUMN`. I could not make it destroy data.

**From a clean directory, the same change is an outage.** The baseline is state
stored in the output tree (`.loom/snapshots/`). Generate into a fresh directory — what
CI does, what a new machine does, what `-o ../build` does — and there is no baseline,
so it re-emits `Initial` under the same tag with the new column folded in. The
migrator sees the tag as applied and skips it. The container reports **healthy**,
because `/ready` doesn't touch the table. Every read and every write returns 500.

That asymmetry is the product in miniature: the safety engineering is real and
thoughtful, and one decision about where state lives routes around all of it.

**And hand-edits:** 5 of 6 silently clobbered, reported only as a file count.
`.loomignore` works exactly as documented — but the docs are explicit that you must
not pin domain files, and every workaround I needed for the codegen bugs in this
report lives in a domain file.

---

## 5. Gap register

43 findings across two models. Counted by the brief's classification:

| class | count | what it means for us |
|---|---|---|
| **SILENT** (valid input, exit 0, output wrong/stubbed/uncompilable) | **28** (26 distinct + 2 roll-ups) | The dangerous class. Only a downstream compiler or a production incident tells you. |
| **HONEST** (refused with a clear diagnostic) | **9** | Cheap. You hit a wall, you know immediately, you design around it. |
| **DOCUMENTED** (named up front) | **5** | Cheapest. Budget for it. |
| Project-health / meta | **1** | |
| Positives recorded with equal rigour | **6** | |

**The ratio is the finding.** Roughly **three silent for every honest one.** A tool
whose value proposition is *"validated before emission"* should have that ratio
inverted. Every honest gap I hit (F-004's `for`-loop wall, F-005's non-queryable
filter, F-038's TPC refusal, the tenancy-stance requirement, the destructive-migration
refusals, 9 of 10 adversarial files) cost me minutes, told me exactly what was wrong,
and taught me the language's shape. Every silent one cost me a compile cycle, a
debugging session, or a live outage.

Severity spread: **S1 × 22**, **S2 × 11**, **S3 × 9**, **S4 × 1**.

The four that would decide a real adoption:
- **F-029** — adding a nullable field takes production down, silently, healthcheck green.
- **F-040** — an invented member on any primitive validates clean and is emitted.
- **F-014** — the page emitter emits `undefined` by design and reports success.
- **F-019** — broker events carrying a timestamp are published, delivered and dropped.

**The shape of the silent class matters more than its size.** These are not 28
unrelated bugs. They cluster into four mechanisms, and each mechanism is one fix:
1. **The validator has no member table for primitive receivers** → F-040 (and the
   invariant that can never fire behind it).
2. **Projection `select` resolves against the domain model, not the emitted schema**
   → F-006, F-011, F-041 — three different mechanisms, same root.
3. **Emitted-import sets are computed per call site and miss symbols** → F-009, F-030.
4. **The page/expression emitters fail open** (`/* unresolved */ undefined`,
   `as unknown as DomainEvent`, `eq(col, null)`) rather than refusing → F-014, F-019,
   F-039.
That is encouraging for the fix list in §10 and discouraging for the claim that the
IR is "fully resolved".

---

## 6. Risk register

| risk | likelihood | impact | evidence | mitigation |
|---|---|---|---|---|
| **Silent codegen defects reach production** | **High** | **Severe** | 19 SILENT findings in 9 hours on one model; the maintainers' own roadmap names the class | Compile every backend in CI; grep for `unresolved:`; treat `tsc` as the real validator |
| **Migration rebaseline outage** | **High** | **Severe** | F-029 — reproduced live, app healthy and 500ing | Commit `.loom/snapshots/`; never generate to a clean dir; CI-assert the initial migration hash |
| **Bus factor 1** | **Certain** | **Severe** | 810 commits, 83% machine-authored, one human, no tags, v0.1.0, ~3-week visible history (F-037) | Escrow/fork the generator; keep the generated tree independently buildable; budget to maintain a fork |
| **Backend lock-in to node** | **High** | **Moderate** | 1 of 5 backends compiles (F-028) | Plan on node/Hono; treat the other four as roadmap |
| **Feature claim rot** | **High** | **Moderate** | Their own audit: *"~940 claims re-verified, ~1/3 were stale or wrong"* | Verify every feature yourself before designing on it; assume docs lead reality |
| **Escape-hatch cost on a codegen bug** | **High** | **Moderate** | F-031 + the "don't pin domain files" guidance | Pin and fork the specific file, accept it freezes; or maintain a patch script |
| **Operability at 3am** | **Medium** | **Moderate** | No `restart:` policy anywhere (F-020); opaque `{"detail":"internal"}` 500s (F-017, F-018); a dropped event visible only as a `warn` in another service (F-019) | Add restart policies and alerting yourself; structured logs and OTel *are* emitted, which helps |
| **Broker/event architecture unusable** | **Certain (today)** | **Moderate** | F-019 | Don't use `channels:`; do eventing outside the model |
| **License / procurement friction** | **Low** | **Low** | FSL-1.1 with a 2-year Apache-2.0 conversion; generated code MIT but the promised `LICENSE` file isn't emitted by `generate` (F-036) | Get the MIT grant in writing; it's a real and reasonable posture, just under-evidenced in the artifact |

---

## 7. Fit analysis

**Where Loom fits well.** A CRUD-shaped, multi-tenant, database-backed internal
application, on node + React, where the domain is genuinely the interesting part and
the plumbing is not; where you would otherwise spend two months on auth, tenancy,
migrations, an admin UI and a test harness. The tenancy layer alone is worth
months, and it is the part I trust most.

**Where it does not fit.** Anything whose core logic is a loop over child records
with cross-aggregate writes (F-004 has no spelling for it). Anything needing
conditional row-level visibility (F-005/F-007). Anything event-driven across
deployables (F-019). Anything where a silent wrong answer is worse than an outage —
payments, clinical, safety. And any team that cannot absorb "the generator may be
wrong; compile everything" as a standing discipline.

**Team shape.** This needs a senior owner who reads generated code fluently and is
comfortable being the second maintainer of a DSL compiler when upstream stalls. It
is *not* a tool that lets a junior team move faster safely — the failure modes are
subtle and the recovery requires understanding both the model and the emitter.

---

## 8. Comparison

| | **Loom** | **Framework + AI assistant** (Rails/Phoenix/Next + Claude/Cursor) | **No-code** (Retool, Bubble, OutSystems) | **In-house scaffolding** |
|---|---|---|---|---|
| Time to first running app | **~3 min** | hours | minutes | days–weeks to build the scaffolder |
| Time to a modelled domain (my 11-aggregate FieldOps) | **~2.5 h** to model, +2 h to make it compile | ~1–2 days | ~1 day, then a ceiling | n/a |
| Multi-tenant isolation | **Compiler-enforced, verified under attack** | Your discipline; one missed `where` = an incident | Platform-provided, opaque | Your discipline |
| Migrations against live data | Excellent in place; **catastrophic from a clean dir** | Mature, battle-tested (AR/Ecto/EF) | Platform-managed, opaque | Whatever you wrote |
| Cross-layer consistency | The pitch; **not delivered** (6 Contradicted claims) | Drifts, but the type checker sees the drift | Consistent inside the platform | Drifts |
| Source ownership | Real, **but regenerate clobbers edits** | Total | None | Total |
| Backend/frontend choice | 1 of 5 / 3 of 6 compile today | One, but it works | None | One |
| Scaling cliff | None in the generator | None | **Yes — the reason people leave** | None |
| Bus factor | **1** | Thousands | Vendor | Yours |
| Debuggability | **`ddd trace` → `.ddd` line:col** (genuinely novel) | Native | Poor | Native |
| Exit cost | Low (see §8 below) | n/a | **Very high — rewrite** | n/a |

**The honest head-to-head is against a framework plus an AI assistant**, because that
is what we would otherwise do. Loom's claim over that alternative is *"no
architectural drift after a few prompts — the model is the source of truth, the LLM
can't hallucinate fields the model doesn't have."* Today the DSL compiler itself
hallucinates: it resolves `Draft` to the wrong enum (F-022), reads `permissions` off a
user shape that lacks it (F-008), selects a column that isn't in the table (F-006,
F-011), and writes `undefined` into a React page (F-014). Against Rails + Claude, the
type checker catches roughly the same class of mistake — the difference is that Rails
does not tell you it validated first.

Where Loom genuinely wins that comparison is **tenancy, migrations safety, and
`ddd trace`.** Those are not things an AI assistant gives you.

---

## 9. The specific questions, answered

**How long to a running app?** ~3 minutes of tool time; ~5 minutes realistically;
37 minutes for me including a sandbox-TLS detour that any corporate proxy will
reproduce.

**How long to a modelled domain?** 2 h 20 m to model 11 aggregates with lifecycles,
invariants, tenancy, auth, workflows, events and tests — and then another ~2 hours to
make the output compile, which is the number that matters.

**How long to a safe breaking change?** In place, with the tree committed: **minutes**,
and the destructive gate will stop you doing something stupid. From a clean directory:
you will not find out it was unsafe until production 500s.

**What can the DSL not express, and what do you do then?** Six things, across two
models:
1. **A loop over records that loads another aggregate per iteration** — the canonical
   inventory / fulfilment / ledger-posting pattern. `for x in Repo.run(...)` exists and
   `let x = Repo.getById(...)` exists, but not together. (F-004)
2. **Conditional row-level visibility** — "owner OR admin". One spelling is honestly
   refused; every other spelling crashes codegen. (F-005 + F-007)
3. **Changing your mind about TPH vs TPC.** If anything references the abstract base
   by `Base id` — which is how you model reserves, payouts and approvals hanging off a
   claim — TPC is unreachable, permanently, at modelling time. (F-038)
4. **Showing an authority-limit rule in the UI.** `requires amount <= currentUser.limit`
   gates the write correctly, but `currentUser` is illegal in a `derived` and `requires`
   has no `can_*` companion — so the UI cannot ask "may I approve this?" without
   reimplementing the rule client-side. (F-043)
5. **Two external APIs on one bounded context.** One `resource` per (context, kind);
   an OCR service and a fraud-scoring API force a context split for infrastructural
   reasons. (F-042)
6. **A translated UI end-to-end.** The translator workflow and the generated runtime
   are not connected. (F-034)

For (1), (2) and (4) you leave the model: hand-write the handler (or the rule) and pin
the file, accepting that it freezes against future model changes. That is the escape
hatch, and its price is that the pinned file stops being generated — **so the more
bugs and limits you work around, the less of your system the model actually owns**,
which is the opposite of the direction the product is selling.

**Exactly what happens to hand-edits on regenerate?** Overwritten, silently, reported
only as a file count. `.loomignore` (gitignore syntax, at the output root) pins a file
completely and permanently; `--dry-run` shows the plan. There is no merge, no region
markers, no three-way. **"You own the source" is true; "your edits survive" is not.**

**Does a breaking migration keep data?** In place: yes, and it is the best part of the
product — drop/retype/NOT-NULL-flip/multi-rename are all refused with an exact fix, and
a single rename is auto-detected as a real `RENAME COLUMN`. From a clean output
directory: the schema change never runs and the application breaks entirely. So the
answer is "yes, if and only if you treat `.loom/snapshots/` as production state."

**Does isolation hold in the generated code, or only in the model?** **In the generated
code.** The filter is compiled into every read as real SQL
(`eq(t.tenantId, requireCurrentUser().tenantId)`), the stamp into every insert, and
`select name, tenant_id from ops.customers` shows the values. Eight attacks from a
second real OIDC principal all failed closed with 404s. A missing stance is a compile
error. This is the claim I tested hardest and it is the one that held.

**Are the targets interchangeable, or is one real and the rest demos?** **One is real.**
node/Hono compiles, boots and round-trips. React (4 packs), Svelte and Angular build.
Everything else fails on the same model, and F-022 shows why it is structural rather
than incidental: one bug in the shared "fully resolved" IR produced four different
outcomes because two backends have structural enums and two have nominal ones. The
backends are not five implementations of one contract; they are five emitters that
agree where they have been tested together.

**Could we operate and debug it at 3am?** **Debug: better than expected.** Structured
JSON logs with request/trace/span ids and an actor id, OTel wiring, healthchecks, and
`ddd trace` turning a stack frame into `Ops.WorkOrder.complete (fieldops.ddd:172:48)`.
**Operate: not yet.** No `restart:` policy on any service, so a transient DNS blip
killed the API permanently in my run. Domain errors are excellent (422/409/404 with
real messages) but infrastructure errors collapse to `{"detail":"internal"}` — a
missing tenant claim, a NOT NULL violation and a null dereference are indistinguishable
to the person on call. And the failure that worries me most is invisible: a dropped
broker event appears only as a `warn` in a different service's log.

**Exit cost in year two?** **Low, and this is a genuine strength.** The output is an
ordinary Vite/React SPA and an ordinary Hono/Drizzle service with a normal
`package.json`, a normal Postgres schema, and real migrations — it builds and runs
with Loom uninstalled, under MIT. Walking away costs you the regeneration loop, not
the application: you `.loomignore` everything (or just stop running the generator) and
maintain ~19k lines of generated-but-idiomatic TypeScript by hand. Budget one engineer
for a quarter to absorb it. Compare that to a no-code exit, which is a rewrite. **This
is why "Pilot only" and not "Do not adopt" — the downside is bounded.**

**Most likely way this blows up, and how we'd see it coming.** Not a dramatic failure.
It goes like this: the pilot succeeds, the team likes the speed, a second and third
service get modelled, and someone adds a field. CI regenerates into a clean workspace
because that is what CI does. The deploy is green — healthchecks pass — and the service
500s on every request to one table. You roll back, add "always generate in place" to
the runbook, and move on. Six months later the model owns 40 aggregates, three
workarounds are pinned in `.loomignore` and no longer regenerate, and a `DeniedWithReason`
enum member shares a name with an `InvoiceStatus` member so a status comparison is
silently always-false on the Python service someone added. Nobody notices for three
weeks because it compiles.

**The early warning is simple and cheap: put `tsc --noEmit` (and the equivalent for
every backend you actually use) plus `grep -rn 'unresolved:'` in CI on day one, and
count how often they fire.** If they fire on model changes that Loom reported as
`0 error(s)`, the core claim is not holding for you either, and the conditions in
§1.1 are the ones to press upstream.

---

## 10. Top 10 fixes, ranked by adoption impact

| # | fix | finding | why it's first |
|---|---|---|---|
| 1 | Refuse (or loudly warn) when `generate system` would re-emit an `Initial` migration into a tree whose migration history it cannot see | F-029 | Turns a silent production outage into a one-line error. Highest severity, smallest change. |
| 2 | Give primitive receivers a member table, so `s.totallyMadeUpMember` is an error | **F-040** | The literal counter-example to "LLM-safe … catches hallucinated fields", and it can silently disable an `invariant` you wrote and reviewed. |
| 3 | Delete the `/* unresolved */ undefined` emitter fallback; make an unresolved page-body reference a `loom.*` error | F-014 | Closes the whole class rather than one instance. The maintainers already play whack-a-mole in front of it with three validator checks. |
| 4 | Compile-gate every backend on an adversarial corpus, not just the examples, and mutation-prove it by reverting F-006/F-009/F-011/F-030 | F-012, F-028, F-030 | Four one-token defects survived 9,000 tests because the vendor's own examples don't trigger them. |
| 5 | Type-check `currentUser` against the declared `user {}` shape | F-008 | It's the security layer, and the fix is the same member-resolution the rest of the language already does. |
| 6 | Qualify a bare enum value by the target field's enum type in the IR | F-022 | One IR bug, five backends, four different wrong answers — including two that *look* fine. |
| 7 | Revive typed fields (`datetime`) at the broker consumer boundary and delete the `as unknown as DomainEvent` cast | F-019 | Makes an entire headline feature work; the double cast is the only thing hiding it from TypeScript. |
| 8 | Resolve a projection's `select` against the EMITTED schema, not the domain model | F-006, F-011, F-041 | One root cause, three separate mechanisms already found; it will keep producing new instances until it's fixed at the source. |
| 9 | Emit the Keycloak protocol mappers for the claims the model declares | F-016 | The generator already emits `claim(payload,"tenantId")`; emitting the matching mapper is mechanical, and it turns a 25-minute manual setup into zero. |
| 10 | Extend the queryable-filter validator to cover everything `refuseOutOfVocabulary` rejects (and emit `isNull` for `== null`) | F-007, F-039 | The generator's own error message already states the invariant that's broken; "show me the open ones" is the most common query there is. |

*Just off the list, and cheap:* make the page emitter read the API client's actual
list shape (F-015); warn on overwrite by naming the modified files replaced rather
than printing a count (F-031) — one line of output that would have changed how I
worked all day.

---

## 11. Coverage limits — what I did not test, and where confidence is low

Stated plainly, because a matrix with gaps in it is worse than one that admits them.

**Not tested at all:** the browser playground and visual builder (claim 12 —
ungraded); the VS Code extension / LSP; the MCP and DAP servers; `ddd patch`;
Kubernetes output; the observability overlay (`docker-compose.obs.yml`) beyond
confirming logs and trace ids appear; event-sourced aggregates
(`persistedAs: eventLog`); `shape: document` / `embedded`; `extern`; provenance +
`snapshot` beyond confirming the files are emitted; domain services;
`softDeletable` / `versioned`; multi-file models and `import`; macros + `unfold`;
the generated Playwright suites (generated, never executed); the tenancy `policy {}`
read ladder (`deep` / `global`) and hierarchical org trees; the outbox / durable
channel retention modes; load and performance of the generated application.

**Clearline was modelled, generated and compiled but never booted.** Its
inheritance findings (F-038, F-041), the union surface, and the authority-limit rule
(F-043) are verified at the model, SQL-DDL and `tsc` level — I read the emitted TPH
table and the emitted gate — but I did not run a claim through the API. Where a
Clearline result depends on runtime behaviour I have not claimed one.

**Tested shallowly (smoke only):** Flutter and the remaining 9 design packs
(generate-only); the `.loom/` artifact bundle (inspected, not validated); `ddd verify`
(one results file); i18n (extract/init/status/check, not a full `sync` three-way
merge); the audit trail (`/history` returns 200 for the owner and 404 cross-tenant —
I did not verify the row contents).

### Coverage checklist (Phase 4)

*exercised* = driven end-to-end and the values checked · *smoke* = generated and
inspected, or compiled but not run · *not tested*.

**Language.** aggregates/entities/containment **exercised** · value objects +
invariants **exercised** (cross-field single-currency invariant enforced at runtime,
422) · enums **exercised** (and F-022) · optional & collection types **exercised**
(and F-010, F-021) · derived fields **exercised** (derived `total` = 100 on the wire)
· functions **exercised** · operations with preconditions **exercised** (422 with my
own message) · `when` state guards + `can_*` **exercised** (409 `Disallowed`;
`{"allowed":true}`) · events **exercised** · repositories + custom finds
**exercised** · cross-aggregate refs **exercised** · criterion/retrieval
**exercised** (and F-023, F-039) · payloads/commands/unions **smoke** (declared,
generated, not driven) · `option` **not tested** · abstract aggregates + `extends` +
TPH **smoke** (DDL read and verified; TPC **exercised as a refusal**, F-038) ·
polymorphic reads **smoke** · domain services **not tested** · capabilities:
`tenantOwned` **exercised**, `audited` **smoke** (`/history` 200 vs 404),
`crudish` **exercised**, `softDeletable`/`versioned` **not tested** · macros +
`unfold` **not tested** (`scaffold` **exercised** as a consumer) · multi-file
**not tested** · stdlib money/decimal **exercised**, date/time **exercised**,
collection ops **exercised** (`sum`, `all`, `count`, `first`) · `extern`
**not tested** · provenance + `snapshot` **smoke** (files emitted).

**System.** modules/contexts **exercised** · api/storage/ui/deployable
**exercised** · multiple deployables + per-deployable platforms **exercised**
(node+python+react+svelte in one stack) · compose output **exercised** (8 services
booted) · resources: objectStore **smoke** (MinIO sidecar booted, verb compiled;
Java F-025), queue **not tested**, mailer **smoke** (Mailpit booted), outbound api
**smoke** · channels/brokers **exercised** (publish verified on the wire, consume
broken — F-019) · outbox **not tested** · workflows transactional **exercised**
(rollback verified: stock stayed at 1) · k8s output **not tested** · migrations +
destructive gating **exercised** (7 change shapes) · observability **smoke** (logs,
request/trace/span/actor ids) · `.loom/` bundle **smoke** (18 artifacts inspected;
`gaps.md` and `wire-spec.json` read).

**Frontend.** page primitive library **smoke** (via `scaffold`) ·
scaffolded → hand-written gradient **not tested** · six frameworks **smoke** (4
build, 2 fail, 1 unverified) · design-pack swap **exercised** (4 React packs built)
· menus **smoke** · forms validated against invariants **exercised** (422 surfaced)
· i18n **exercised** (extract/init/status/check) but **not wired** (F-034) ·
generated Playwright objects **smoke** (emitted, never run).

**Auth/tenancy.** OIDC **exercised** (real Keycloak, real JWKS, real tokens); PKCE +
refresh rotation **not tested** · deny-by-default **not tested** (`enforcement: opt`)
· permissions with `implies` **exercised** (expanded correctly to
`field.dispatch || field.admin`) · policy ladders **not tested** · `requires`
**exercised** · `mask unless` **exercised** (null without the permission, on both
list and by-id, fail-closed) · `currentUser` **exercised** · tenancy stances
**exercised**, hierarchy **not tested**, `crossTenant` **smoke** · audit trail
**smoke**, history read **smoke** (200/404 scoping verified, row contents not).

**Tooling.** inline tests **smoke** (emitted, not executed) · e2e tests **smoke** ·
traceability + `ddd verify` **exercised** (VERIFIED/FAILING, exit 1) · OpenAPI
**smoke** (served, routes enumerated; no conformance run) · `--dry-run`
**exercised** · watch **not tested** · `--sourcemap` + `trace` + `breakpoints`
**exercised** · `patch` **not tested** · MCP tools **not tested** · playground
**not tested** · `ddd new` templates **exercised** (crud/node) · docs site
**not tested**.

**Where my confidence is lowest:**
- **Python.** It imports and `mypy` finds 10 errors, but I never booted it. The
  `current_user` NameError is certain to be a 500 on that read path; I have not
  measured what else lies behind it.
- **The "one model" caveat.** Everything in §3 comes from a single domain. A
  different model would hit a different subset of emitters. The per-backend ❌ marks
  are proven defects; they are not a measure of each backend's overall quality.
- **Elixir's true error count.** `mix` aborts on the first error. I peeled two and
  stopped; the real number is ≥2 and unknown.
- **Whether the SILENT/HONEST ratio generalises.** 19:6 is what one honest model
  produced in one day. It is a strong signal, not a population statistic.

**One process caveat, recorded for honesty:** this session's harness injected the
repository's `CLAUDE.md` into my context at startup, before I could decline it. I did
not use it as a source of evidence or navigation during Phases 0–5, and every claim
above is backed by a command in `eval/EVAL-LOG.md` that I ran from outside. Phase 6's
reconciliation section cites internal material explicitly, as intended.
