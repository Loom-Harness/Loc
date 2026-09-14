# Loom — adoption evaluation for the Clinica programme

**Prepared for:** architecture council
**Author:** staff engineering, platform
**Date:** 2026-09-13 · **Repo state:** `bcd25e3e`, `Loom-Harness/loc`
**Effort:** one time-boxed spike (~5 hours of hands-on). Everything below was executed;
nothing is quoted from a doc without running it.

---

## 1. Recommendation

**Pilot on a non-critical project only.**

Loom's model-to-running-stack pipeline is real — I generated a 10-aggregate multi-tenant
clinic system from 444 lines of DSL, booted it under `docker compose` with Postgres,
Keycloak, Redis, MinIO and two frontends, and could not break tenant isolation from the
outside. But `ddd generate system` reports `0 error(s)` and then hands you a project that
**does not compile on three of the five backends and one of the six frontends**, from
ordinary modelling choices — a field named `state`, a `string[]`, a helper function called
from a workflow. Fourteen of my twenty-one defect findings are in that silent class.

Do not put Clinica — a clinical-records product with GDPR exposure — on it this year.

### Conditions that would move this to "Adopt with conditions"

Each is checkable; we should re-evaluate when all five hold.

1. **`generate` compiles what it emits.** `ddd generate system` invokes the target
   toolchain (or a `--verify-compiles` flag does) and fails the command when the emitted
   project does not build. Test: every repro in `eval-clinica/repro/` exits non-zero at
   `generate` time instead of at `tsc`/`dotnet build`/`ng build` time.
2. **The published open-gap ledger's SILENT class is empty**, and the compile gate runs
   against a corpus that includes a *realistic* application, not only feature fixtures.
   (The maintainers' own audit says five of six severe defects survived "because no corpus
   fixture exercises the shape".)
3. **A supported answer for hand-written code.** Either a per-file three-way merge on
   regenerate, or protected regions, or an explicit written statement that the generated
   tree is build output and must never be edited — and the README stops saying "the keys
   to the codebase". Today the answer is "your edit is silently deleted, or you pin the
   file and the next model change breaks the build."
4. **Versioning exists.** At least one tagged release, a changelog, and a stated
   compatibility policy between toolchain versions. There are currently **zero releases**;
   `package.json` reads `0.1.0`.
5. **Bus factor above one.** One human has authored every non-AI commit in the window I
   can see. We would need either a second maintainer with commit rights or a written,
   funded continuity plan before betting a product line on it.

Two further conditions would be needed before Clinica specifically: the ICU
date/money/plural formats must actually format (F-006), and the OIDC `audience`
check must be on by default (F-020).

---

## 2. Executive summary

Loom is a compiler. You write one `.ddd` file describing a domain — aggregates, value
objects, invariants, operations, events, permissions, tenancy, pages, deployables — and it
emits a complete multi-project tree: backend, database migrations, REST API with OpenAPI,
one or more frontends, an OIDC setup, a docker-compose stack, Playwright and vitest
suites, and a folder of derived diagrams and traceability reports. From my 444-line model
it produced **42,402 lines across 373 files** — roughly 95 lines of code per line of
model — in 2.2 seconds.

**What it genuinely does well.** The model-to-database story is the best I have seen in a
code generator. Migrations are diffed against a committed snapshot; a column drop or a
NOT-NULL tightening is *refused* with a message naming the offending step and both escape
hatches; a rename is detected and preserved data in my live database; a backfill clause
makes a tightening safe with no flag. Multi-tenancy is enforced in the generated queries,
not just described in the model — I attacked it with a second tenant's token and got empty
lists and 404s, never a leak. Error shapes are RFC 7807 throughout with correct status
codes. The diagnostics, when they fire, are among the best in any compiler I've used: they
name the rule, list the valid alternatives, and often carry a machine-applicable fix.
The generated source is well-commented, idiomatic, and in places better reasoned than
hand-written code.

**What it cannot do.** Any rule that spans *rows* — "no two appointments overlap for the
same practitioner", the single most important rule in a scheduling product — is not
expressible. The DSL accepts the natural attempt and emits code that does not compile and,
where it does, computes a tautology. Reads cannot join across aggregates, so
"show a patient only their own appointments" required denormalising a foreign key. The
`create` factory is a marker whose body is refused and whose parameter list is decorative,
so there is no custom construction logic. There is no date, money or plural formatting
that reaches the backend. And you cannot edit the output: hand-written code is deleted on
the next regenerate, and the sanctioned pin freezes the file until the next model change
breaks the build.

**The thing to understand before deciding.** Loom is sold as a scaffolder ("the keys to
the codebase", "zero vendor lock-in", "all the source you'd write by hand") and behaves as
a compiler (you never touch the output; you change the input and rebuild). Both are
defensible products. The compiler reading is the accurate one — and under it, every gap in
the DSL becomes a wall you cannot patch around locally, which is why the abstraction
ceiling matters far more here than the bug count.

---

## 3. Claim verification matrix

Every claim below is quoted verbatim from `README.md` or the docs landing page.
Grades: **Verified** (I ran it and it did what it says) · **Partially verified** ·
**Unverified** (could not test here) · **Contradicted** (I ran it and it did not).

| # | Claim (verbatim) | Grade | Evidence |
|---|---|---|---|
| 1 | "The speed of no-code." | **Verified** | `ddd new` → `generate system` → 83 files in **1.4s**; `docker compose up` → four healthy services. Time from zero to a running app, outsider, this environment: **~43 min**, of which ~40 was `npm install`/image build behind a proxy. Model-only work to a realistic 10-aggregate domain: ~2h. |
| 2 | "The keys to the codebase." / "All the source you'd write by hand." | **Contradicted** (as ownership) | Hand-edited `domain/appointment.ts` → regenerate → `Wrote 1 file(s)`, edit gone, no warning. Pinned via `.loomignore` → edit survives, then the next model change (`triageNote: string?`) left the pinned file stale and produced **11 `tsc` errors**. F-012. The documented customization story never involves editing target source at all. |
| 3 | "Zero vendor lock-in." | **Partially verified** | The output is genuinely yours and MIT-licensed (the CLI writes the `LICENSE` file), builds with stock toolchains, and has no Loom runtime dependency. But leaving Loom means owning 42k lines you did not write and losing the model; and while you stay, you cannot modify them. See §9 (exit cost). |
| 4 | "No scaling cliff." | **Verified** at the sizes I tested | 8 / 20 / 40 aggregates → generate 2.2s / 3.3s / 5.9s, 133 / 229 / 389 files, amplification flat at **77–80x**. Generated-project `tsc` at 40 aggregates: 12.3s. Linear, no cliff. Not tested beyond 40 aggregates. |
| 5 | "No drift between layers." | **Partially verified** | Within one generation, yes — the OpenAPI, the zod client schema and the DB all agreed on every field I checked. Across *time*, no: a `string`→`enum` change emitted **no migration and no constraint**, and the API then served `"requiredSkill":"massage"` against its own published enum, which its own generated client would reject (F-010). And the translated locale never reaches the app (F-017). |
| 6 | "five backends (Hono, .NET, Phoenix LiveView, Java/Spring Boot, Python/FastAPI)" | **Partially verified** | All five *generate* from one model. Compiled: node ✅, .NET ✅ (after F-013), Java ✅ (after F-014), elixir ✅ plain / ❌ under the project's own `--warnings-as-errors` (F-015), python syntax-only ✅ (full type-check unverified here). **Three of five needed a source-level workaround before they compiled.** |
| 7 | "six frontends — React, Vue, Svelte, Angular, Feliz, Flutter" | **Partially verified** | All six generate. Built: React ✅, Vue ✅ (twice — two different UIs), Svelte ✅, **Angular ❌** (`ng build` fails on a `string[]` field — F-022). Feliz and Flutter **unverified** — no F#/Fable or Flutter toolchain in this environment. |
| 8 | "Thirteen design packs … swap any time" | **Partially verified** | Tested 4 of 13 (mantine, vuetify, shadcnSvelte, angularMaterial) — each generated. Swapping is *not* one word: a framework change forces a pack change, refused with an excellent diagnostic naming the valid packs. |
| 9 | "Pick a runtime per deployable. Switch any time." | **Partially verified** | I ran two backend deployables in one system (node api + node notifier over a Redis channel) and two frontends on *different frameworks* off one backend (React staff UI + Vue patient portal) — both built. But "switch any time" costs a compile-failure hunt per target (claims 6 and 7), so switching is a project, not a flag. |
| 10 | "Browser playground. Typed editor with LSP support, visual system builder … live preview … in-browser test runner." Live at `lemmit.github.io/Loc/playground/`. | **Partially verified / link Contradicted** | The advertised URL is **404** (F-023), as is the landing page and the hosted doc set. Built from source it works: Monaco editor loaded, validated a model (`0 ERRORS`) and generated **107 files client-side**, 0 page errors, with Source/Chat/Builder/Model/Requirements panes. The "Bundle" and "Boot" (live preview) steps read *not run yet* / *blocked*; I did not drive them. |
| 11 | "Built-in traceability … `ddd verify` rolls results into per-requirement Definition-of-Done verdicts." | **Verified** | Declared 3 requirements + 3 test cases + 1 executable e2e test. `.loom/gaps.md` correctly listed the two test cases with no executable test. `ddd verify --results` → `Verified 0/4 (2 failing…)` **exit 1**; all-pass results → `Verified 2/4` **exit 0**. Exit codes exactly as documented. |
| 12 | "LLM-safe by construction … Validation gates catch hallucinated fields … before any code is emitted." | **Partially verified — and the second half is Contradicted** | The machinery is excellent: I planted a bogus create-input field and got *"'Appointment' has no create-input field 'lifecycleX'. Create inputs: clinic, patient, …"*; the MCP server returns coded diagnostics with a ready-to-apply `fixHint` patch. But **"before any code is emitted" is false**: F-002, F-004, F-013, F-014, F-016, F-018 and F-022 all pass validation clean and then emit non-compiling or crashing output. |
| 13 | "1,300+ test files / 9,000+ tests" | **Verified (understated)** | `find test -name '*.test.ts'` → **2,107** files; 67 CI workflows. |
| 14 | "Generated migrations (Drizzle / EF Core / Ecto / JPA / SQLAlchemy)" and the destructive gate | **Verified** | See §6 — seven scenarios run against a live Postgres holding rows. |
| 15 | "The code Loom generates … is licensed to you under the MIT License" | **Verified** | A `LICENSE` file with the MIT grant is written at the output root by `generate system`. |

---

## 4. Target matrix

One model (`eval-clinica/clinica/main.ddd`, 444 lines — 10 aggregates, 2 entity parts, 3 events, 2 workflows,
5 criteria, 2 retrievals, a channel, across 2 subdomains), only the target changed.
"Boots" was tested for the node stack only — the others were not brought up.

### Backends

| Backend | Generates | Compiles | Boots | Wire-identical | Notes |
|---|---|---|---|---|---|
| node / Hono | ✅ 373 files | ✅ `tsc --noEmit` | ✅ compose + host, migrations applied, real read/write | baseline | needed F-004 + F-016 removed from the model first |
| .NET / ASP.NET | ✅ 321 files | ✅ `dotnet build`, 0 warnings | ⛔ not run | not compared | **F-013** blocked it entirely until a field was renamed; `-warnaserror` still red (**F-019**) |
| Java / Spring Boot | ✅ 261 files | ✅ `gradle testClasses` | ⛔ not run | not compared | one hand-added import (**F-014**) |
| Python / FastAPI | ✅ 157 files | ⚠️ syntax only (`compileall`, py3.13) | ⛔ not run | not compared | `uv sync` + mypy + pytest **unverified** (sandbox proxy) |
| Elixir / Phoenix | ✅ 247 files | ⚠️ `mix compile` ✅ / `--warnings-as-errors` ❌ | ⛔ not run | not compared | **F-015** |

### Frontends

| Frontend | Generates | Builds | Notes |
|---|---|---|---|
| React (mantine) | ✅ | ✅ `tsc && vite build` | also served live on :3001 under compose, HTML + assets 200 |
| Vue (vuetify) | ✅ | ✅ | built twice — the staff UI and a separate patient portal off the same backend |
| Svelte (shadcnSvelte) | ✅ | ✅ | |
| Angular (angularMaterial) | ✅ | ❌ `ng build` fails | **F-022** — a `string[]` field; React degrades honestly on the same model |
| Feliz (F#/Fable) | ✅ 98 files | **unverified** | no `dotnet fable` toolchain here |
| Flutter (Dart) | ✅ 119 files | **unverified** | no Flutter SDK here |

**Wire-identity was not measured.** I only ran one backend live, so every "identical API
contracts" claim in §3 row 6 is inherited from the docs, not from my measurement. Treat it
as unverified.

---

## 5. What it's like to actually use it

**Getting started was fast and the starter is honest.** `ddd new` produced a 90-line model
whose header comment volunteers, unprompted, that under deny-by-default authorization the
synthesised `GET /{plural}/{id}` route "still serves to any authenticated caller, and
nothing warns". A vendor telling you where its own safety net has a hole, in the file it
hands you on day one, is a good sign about the culture. First generated tree: 1.4s.
First running stack: ~43 minutes, almost all of it `npm install` and image builds.

**Modelling the domain was mostly pleasant.** Slice 1 parsed first try. The type system
caught real mistakes — comparing a `Patient id` to a `string` claim, an enum case shadowed
by a same-named criterion (with a diagnostic that explained the shadowing *and* offered
both fixes). The `money` type, the access-modifier matrix (`internal`/`secret`/`managed`),
`mask unless`, `sensitive(pii, phi)`, `permissions { … }`, `tenancy by user.clinicId of
Clinic` — these are the right primitives for a B2B product, and they are not decoration:
`mask unless` really did serve `"costRate": null` to the front-desk token and `"85.5000"`
to the manager, from the same endpoint.

**Then I hit the ceiling, and the ceiling is where the decision lives.**

- *"No two appointments overlap for the same practitioner or room."* Not expressible. The
  natural attempt — a criterion plus a repository count in an invariant — validates clean
  and emits `Appointments.run(this._practitioner === this._practitioner && …)`: an
  undefined identifier *and* a tautology, on four backends, and silently nothing at all on
  Elixir (F-002). The rule has to leave the model entirely, into a hand-written Postgres
  exclusion constraint the generated migrations don't know about.
- *"A patient sees only their own appointments."* Reads cannot join to a referenced
  aggregate — refused honestly with `loom.retrieval-where-not-queryable` — so I
  denormalised the patient's OIDC subject onto every appointment row.
- *Custom construction.* `create(...) { … }` looks like a constructor. It is a marker: the
  body is refused if it does anything, and the parameter list "is not the request contract
  either". Initial state has to come from a field default.
- *The read path is mid-migration.* The compiler warns on every list `find` telling you to
  use a `criterion` or `retrieval` instead — but a `retrieval` produces **no HTTP route at
  all**. The working replacement costs four extra declarations and an `api { route … }`
  block; passing the retrieval to the paged handler crashes the generator with a stack
  trace (F-008, F-009). I kept the deprecated form.

**Maintenance is where the two halves diverge sharply.** Schema evolution is excellent
(§6). Code evolution is not: the first time I added a helper `function` and used it from a
workflow, three backends stopped compiling. The first time I named a field `state`, .NET
stopped compiling. The first time an aggregate had a `string[]`, Angular stopped
compiling. **None of these produced a diagnostic.** The workflow that actually works is:
change the model, regenerate, then run every target's compiler yourself, because
`generate` exiting 0 tells you nothing about whether the project builds.

---

## 6. Evolution: the migration story, measured

Run against a live Postgres holding real rows, each change applied by restarting the
generated API (which migrates on boot) and verified with `psql`.

| Change | Emitted | Outcome |
|---|---|---|
| add `preferredLanguage: string = "en"` | `ADD COLUMN … NOT NULL DEFAULT 'en'` then `DROP DEFAULT` | existing row backfilled — **verified by `select`** |
| rename `phone` → `phoneNumber` | `RENAME COLUMN "phone" TO "phone_number"` | value `+372123` **preserved — verified by `select`** |
| drop a populated column | **refused**, 0 files written, message names the step and both escape hatches | data intact |
| same, `--allow-destructive` | `DROP COLUMN` | as asked |
| required → optional | `DROP NOT NULL` | safe |
| optional → required (with NULLs) | **refused**: "SET NOT NULL … (fails on rows holding NULL)" | safe |
| + `migration "backfill" { Clinic.timezone = "Europe/Tallinn" }` | `UPDATE … WHERE … IS NULL` then `SET NOT NULL`, **no flag needed** | safe |
| delete the baseline snapshot | **refused**: "Restore the snapshot from version control, or pass `--allow-rebaseline`" | history protected |
| **`string` → `enum`** | **nothing at all** | ❌ **F-010** — no migration, no constraint; a pre-existing out-of-enum row is then served in violation of the API's own OpenAPI |

**Answer to "can a breaking schema change ship against a production database without data
loss?" — yes, for column adds, renames, drops and nullability, and the toolchain will stop
you when it can't guarantee it.** The one hole is type *narrowing*, where the storage type
doesn't change and the differ therefore sees nothing.

---

## 7. Gap register

23 entries in `eval-clinica/FINDINGS.md`; 21 are defects, 2 are recorded strengths.
Every S1 and S2 has a minimal reproduction in `eval-clinica/repro/`.

| Severity | Count | Findings |
|---|---|---|
| **S1 — blocker** | **7** | F-002 (cross-row invariant → non-compiling/tautological on 4 backends, silently dropped on the 5th) · F-004 (`when <function>()` → private-member call, 3 backends) · F-006 (ICU formats dropped everywhere; Python throws `TypeError`) · F-013 (a field named `state` breaks .NET) · F-014 (`mask unless` → missing `java.util.Objects` import) · F-016 (aggregate `function` called from a workflow: 4 of 5 backends broken) · F-022 (`string[]` breaks the Angular build) |
| **S2 — major** | **8** | F-008 (`retrieval` emits no route; the deprecated `find` is the only one-liner) · F-009 (emitter stack trace after `0 error(s)`) · F-010 (silent `string`→`enum`) · F-012 (hand-edits clobbered; pin freezes the file) · F-017 (translated locales never reach the app) · F-018 (recursive containment → `RangeError` on 4 backends) · F-020 (OIDC **`audience` check off by default**, clause undocumented, comment claims otherwise) · F-023 (the advertised live site and playground are 404) |
| **S3 — friction** | **6** | F-001 (CLI help points at archived docs) · F-003 / F-005 (raw parser dumps where a `loom.*` code belongs) · F-007 (`create { }` rejected though documented) · F-015 (Elixir fails its own `--warnings-as-errors` gate on a `datetime` param) · F-019 (an entity named `…Exception` fails the .NET analyzer gate) |
| **S4 — polish** | 0 | — |

### The split that decides the verdict

| Class | Count | Meaning |
|---|---|---|
| **SILENT** (valid input, exit 0, output wrong / non-compiling / crashing) | **14** | the dangerous class |
| **HONEST** (refused with a clear, named diagnostic) | **4** | annoying, plannable, safe |
| **DOCUMENTED / structural** | **3** | F-001, F-012, plus F-023 as a contradicted claim |

**A 14:4 silent-to-honest ratio is the headline number of this evaluation.** The honest
ones were genuinely excellent — `loom.sensitive-wire-unsupported` told me, in one
paragraph, exactly what the tag does *not* do, that the field "is serialized in cleartext
to any caller allowed to read 'Patient'", and the two ways to fix it. If the silent
fourteen looked like that, this report would say Adopt.

### Independently, the maintainers agree the class exists

Their own audit ledger (`docs/audits/targets-completeness-2026-08-30`) records **251 open
rows at audit time — 108 of them classified *silent*, 90 "proven from emitted output"** —
since dispositioned into missions, with **135 still open** in the committed ledger. A
September fleet audit found "**six defects that emit non-compiling or crashing code from
`.ddd` reporting `0 error(s), 0 warning(s)`**", and diagnosed the cause precisely: *"five
of the six severe defects survived because no corpus fixture exercises the shape."* That
is exactly why a realistic application found ten more in an afternoon. One of my findings
(F-002) was opened as PR **#2913** by the maintainer roughly an hour before I reproduced
it independently.

---

## 8. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Silent codegen defects reach production.** `generate` exits 0 on output that doesn't compile or is semantically wrong. | **High** — 14 found in one afternoon | High | Never ship without compiling every target in CI. Treat `generate` as a step, never a gate. Budget a compile-error hunt per model change. |
| R2 | **Abstraction ceiling blocks a requirement mid-project.** Cross-row invariants, joined reads, custom construction, formatting. | **High** | High | Spike the three hardest domain rules *first*, before committing. Keep an escape design (a hand-written service outside the generated tree) in the architecture from day one. |
| R3 | **Bus factor = 1.** One human author; ~83% of commits in the visible window authored by an AI agent; **zero releases**, no changelog, no version policy. | Medium | **Severe** | Fork and pin the generator at a known-good commit. Budget for in-house maintenance. Do not depend on upstream for a fix on our timeline. |
| R4 | **We cannot patch the generated code.** A defect we hit is unfixable locally without freezing a file (F-012). | **High** | High | Adopt the compiler model explicitly: gitignore the output except `.loom/snapshots/`, forbid edits in review, keep a patched fork of the *generator* instead. |
| R5 | **Toolchain-version drift.** No releases, no compat policy; the generated stack pins bleeding-edge deps (React 19, Vite 8, TS 6, .NET 10, Spring Boot 4, JDK 25). | Medium | Medium | Pin the generator commit **and** vendor the generated `package.json`. Re-generate on a schedule, not on demand. |
| R6 | **Security control gaps in generated code.** the OIDC `audience` check is off unless an undocumented clause is set (F-020); `sensitive()` doesn't redact the wire (documented, but the remedy `mask unless` breaks the Java build, F-014). | Medium | **Severe** for Clinica (PHI) | A full security review of the generated output before every release, not once. Treat generated auth as un-reviewed third-party code. |
| R7 | **Review and merge workflow is unsolved.** 373 files / 42k lines per generation; the toolchain emits no `.gitignore` and takes no position, yet `.loom/snapshots/` **must** be committed. | High | Medium | Decide the policy on day one (see §10). |
| R8 | **Data integrity on type narrowing** (F-010). | Medium | High | Add our own pre-deploy data audit for every enum/type tightening. |
| R9 | **Migration snapshot loss.** Lose `.loom/snapshots/*.json` and the migration history resets. | Low | **Severe** | It refuses safely and says so — but make the snapshot a protected path in the repo. |

---

## 9. Fit analysis

**Clearly good for:** internal line-of-business CRUD with a real permission and tenancy
model — the shape where the 95x amplification is mostly boilerplate you'd otherwise write
badly. Prototypes and pitch systems where a working multi-service stack in an hour is worth
more than the ceiling. A greenfield system whose rules are all *per-row* (validity,
lifecycle, authorization) rather than *cross-row*. Teams who will accept "you never edit
the output" as a rule, the way they accept it for a compiler.

**Clearly wrong for:** anything whose core rules span rows (booking, scheduling,
inventory, ledgers, capacity) — which is precisely Clinica. Products with heavy custom UI.
Anything that must ship in two languages today (F-017). Teams that expect to fix a
generator bug themselves in the afternoon they find it. Regulated products where generated
auth code must pass a review you can't re-run cheaply.

**Where Clinica falls: on the wrong side of that line, twice.** Its defining constraint is
*"no two appointments may overlap for the same practitioner or the same room"* — the
canonical cross-row invariant, the one thing Loom cannot say. And its clinical-notes
masking plus "read access to a patient record must itself be audited" puts it in the
regulated column. Loom would carry maybe 70% of Clinica cheaply and then hand us the 30%
that is the product.

---

## 10. Team workflow — what we would actually have to decide

- **Is the output committed?** The toolchain emits **no `.gitignore`** and takes no
  position. Committing means 373 files / 42k lines in every PR. Not committing is not
  clean either: `.loom/snapshots/<module>.snapshot.json` is the migration baseline and
  **must** be in version control — verified, by deleting it: *"refusing to re-baseline …
  Restore the snapshot from version control."* So the policy is "gitignore the output,
  commit `.loom/snapshots/` and `.loomignore`", and it has to be written down.
- **What do we review?** The model. A 444-line `.ddd` is a genuinely reviewable artifact —
  arguably the best thing about the approach. But the diff a reviewer *sees* on a generated
  tree is unreadable, which is another argument for not committing it.
- **Merge conflicts.** Two engineers editing one `.ddd` conflict like any source file —
  fine. The generated tree, if committed, would conflict on hundreds of files for no
  semantic reason.
- **CI cost.** Regeneration is cheap (2.2s for Clinica, 5.9s at 40 aggregates). The real
  cost is compiling five backends and six frontends, which is minutes-to-tens-of-minutes
  per change and is **mandatory**, per R1.
- **Onboarding.** I was productive in the DSL in about two hours with the docs open. But
  "productive" meant writing models that parse — the expensive knowledge is the set of
  shapes that *parse and then break a backend*, and that is undocumented and learned the
  hard way. Estimate a week to real productivity for a mid-level engineer, and treat the
  first month's output as unreviewed.

---

## 11. Comparison with the realistic alternatives

| | Loom | Conventional framework + AI assistant | No-code (Retool/Bubble/OutSystems) | In-house scaffolding layer |
|---|---|---|---|---|
| Time to first working stack | **~1h** | ~1 day | ~1h | weeks (build it first) |
| Cross-layer consistency | **Enforced by construction** | Drifts; the assistant will happily invent a field | Enforced, inside the platform | Whatever we enforce |
| Ceiling | **Hard and low on cross-row rules** | None | Low and hits sooner | Ours to raise |
| Can you edit the code? | **No** (F-012) | Yes | No | Yes |
| Migration safety | **Best in class** (§6) | Whatever we wire up | Platform's | Ours |
| Bug in the generator | Wait for upstream / fork | Fix it yourself | File a ticket | Fix it yourself |
| Vendor risk | **Bus factor 1, no releases** | None | Commercial vendor, priced | None |
| Exit cost | 42k lines you didn't write, model discarded | n/a | Rewrite | n/a |

The honest framing for the council: **Loom's real competitor is not Bubble, it is "a
conventional Hono/Spring app plus an AI assistant plus a strict review culture".** Loom
wins decisively on migration safety, tenancy enforcement and cross-layer consistency, and
loses decisively on the ceiling and on our ability to fix our own problems. For Clinica
the ceiling is load-bearing, so the comparison resolves against Loom.

**Exit cost if we abandon it in year two:** we keep the generated source (MIT, no runtime
dependency, stock toolchains, well-commented) and throw away the model. Practically that
means inheriting ~40–60k lines of code nobody on the team wrote, with the design rationale
living in a `.ddd` file that is now decorative. That is a *survivable* exit — better than
a no-code platform — but it is not the "zero lock-in" the README implies. The lock-in is
not legal or technical; it is that the model is the only readable description of the
system, and it stops being true the moment you start editing the output.

---

## 12. Top 10 fixes, ranked by adoption impact

1. **Make `generate` prove the output compiles** (a `--verify-compiles` that shells out to
   the target toolchain and fails the command). This alone converts most of the SILENT
   class into HONEST and would change my verdict more than any other single change.
2. **Fix the `function`-visibility class** (F-004 + F-016) — an aggregate helper called
   from a `when` guard, a route, or a workflow breaks 3–4 of 5 backends today. It is one
   root cause and it makes the DSL's only rule-reuse mechanism unusable.
3. **Refuse a repository read in an invariant with a diagnostic** (F-002) — and say
   plainly in the docs that cross-row invariants are out of scope, with the sanctioned
   alternative. Silent tautologies in a business rule are the worst failure mode in the
   register.
4. **Decide and state the source-ownership model** (F-012). Either build a three-way merge
   / protected regions, or rewrite the README to say "generated output is build output;
   do not edit it". The current wording sells the opposite of the behaviour.
5. **Reserve or mangle the names that break a backend** (F-013 `state`, F-019 `…Exception`)
   and emit the missing import (F-014). Three one-line fixes that unblock two backends.
6. **Make ICU formats format** on the backends, or reject them there (F-006) — and fix
   the Python `"str" + datetime` crash, which is a 500 on any read of an affected aggregate.
7. **Give `retrieval` an HTTP route** (F-008), or stop deprecating `find` until the
   replacement reaches the wire. Today the compiler warns you toward a dead end.
8. **Default the OIDC `audience` to `clientId`** (or warn when it is unset) and document
   the `audience:` clause, which exists in the grammar but nowhere in `docs/auth.md`
   (F-020). Ship the protocol mappers for the declared claims in the generated Keycloak realm.
9. **Carry translated locales into the generated frontends** (F-017) — the CLI half is
   already built and good; only the last mile is missing.
10. **Ship a release, a changelog and a compatibility policy** — and fix the README's
    dead site links (F-023). Zero releases is the single loudest signal to a buyer that
    this is not yet a product.

---

## 13. Coverage and limits of this evaluation

**What I ran.** `npm install` + build of the toolchain; `ddd new`; `generate system` on
five backends and six frontends; `docker compose up -d --build` of the full Clinica stack
(api + db + keycloak + staff_web, 4/4 healthy); the same API run on the host against a
dockerised Postgres with a local JWKS issuer I wrote (`eval-clinica/tools/idp.mjs`) so I could
control claims; ~40 live HTTP requests covering create/read/transition, every error shape,
role gates, field masking and cross-tenant attacks; 9 schema-evolution scenarios against a
database with rows; `tsc`/`dotnet build`/`gradle testClasses`/`mix compile`/`compileall`/
`vite build`/`vue-tsc`/`svelte-check`/`ng build`; `ddd verify`, `ddd patch`, `ddd trace`,
`ddd breakpoints --map`, `ddd i18n {extract,init,sync,check}`, `--dry-run`, `--sourcemap`,
`--allow-destructive`; the MCP server over stdio; the playground built from source and
driven in a real Chromium; a 10-case diagnostic-quality battery; and a scaling sweep to 40
aggregates.

**What I did not test, and where my confidence is low.**

- **Feliz and Flutter frontends: unverified.** No F#/Fable or Flutter toolchain here. They
  generate; I do not know whether they build. Do not read the Angular result as predictive
  either way.
- **Python beyond syntax: unverified.** `uv sync` could not reach PyPI through this
  sandbox's proxy, so `mypy`/`ruff`/`pytest` — the project's actual Python gates — did not
  run. Syntax compiles on 3.13.
- **Only the node backend was ever *booted*.** .NET, Java, Python and Elixir were compiled,
  not run. Every "identical API contracts" / wire-parity claim is therefore **unverified by
  me**; I could not compare response shapes across backends.
- **Design packs: 4 of 13 tested**, generate-only for three of them.
- **Not touched at all:** Kubernetes/Helm output, the DAP debug adapter, watch mode,
  event-sourced aggregates (`persistedAs: eventLog`), aggregate inheritance / polymorphic
  reads, `extern` operations, provenance + `ddd snapshot`, the OpenAPI conformance harness,
  the VS Code extension and LSP (completion/hover/go-to-definition), the macro `unfold`
  code action, seeds, timer sources, and the observability overlay beyond reading its
  compose file. The `ui` layer was exercised only through `scaffold` — I wrote no
  hand-authored pages, so the page-primitive library and the customization gradient's
  rungs 1–3 are **untested**.
- **Broker eventing was generated, not exercised.** The Redis channel, CloudEvents
  envelope and the notifier deployable were emitted and type-checked; I never published an
  event across the wire.
- **Scaling stopped at 40 aggregates.** A 200-aggregate enterprise model is unmeasured.
- **The build environment fought me.** An intercepting TLS proxy made every container
  `npm install`/`pip`/`nuget`/`hex` fetch a separate problem; the ~43-minute
  time-to-running-app and the ~22-minute compose build are inflated by it and should not
  be read as Loom's numbers. Loom's own Dockerfile `certs/` hook is what made it work.
- **One process caveat on my blindness protocol.** The harness injected the maintainers'
  `CLAUDE.md` into my context before I could decline it. I did not consult
  `docs/new-plan/`, `docs/audits/`, `experience_gathered.md` or `test/` until Phase 7, and
  every finding above was reproduced from outside via the CLI and the generated output —
  but a strict reading of "cold-start" is compromised on that one file.

**Where I am most confident:** the migration story (nine executed scenarios against live
data), tenant isolation (attacked directly with a second tenant's token), the silent-gap
class and its size (14 reproduced, each with a minimal repro, cross-checked across
backends), and the regenerate/ownership behaviour (F-012, reproduced twice).

**Where I am least confident:** cross-backend wire parity, the two self-hosting frontends,
and anything about how this behaves past ~40 aggregates or past six months of real product
change.
