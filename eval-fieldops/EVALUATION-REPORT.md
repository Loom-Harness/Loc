# Loom — adoption evaluation for the architecture council

**Author:** staff engineer, time-boxed spike · **Date:** 2026-09-13
**Subject:** `Loom` (repo `loc-ddd-dsl`, working name "Loom") @ commit `bcd25e3e`
**Question:** should we build our next multi-tenant B2B product on Loom, and under what conditions?

---

## 1. Recommendation

**Pilot on a non-critical project only.**

Loom is a genuinely impressive compiler — I modelled a realistic field-service product in 317 lines
and had a 7-service stack serving authenticated, tenant-isolated, correctly-validated HTTP traffic in
about 15 minutes. But **1 of its 5 advertised backends and 3 of its 6 advertised frontends compiled
my model as shipped**, its migration engine silently mis-migrated data in one ordinary refactor, and
the project is six weeks old with a bus factor of one. Those are not reasons to walk away; they are
reasons not to put a revenue-bearing product on it this year.

### Conditions that would move this to "Adopt with conditions"

Each is checkable, and none requires trusting a roadmap:

1. **The target we ship on compiles our model in Loom's own CI.** Either Loom's corpus covers our
   feature combinations, or we contribute our model as a fixture. Falsifiable: our `.ddd` builds
   green on the target backend + frontend in their CI for 30 consecutive days.
2. **F-018 is fixed** — the migration rename heuristic must not silently reinterpret a
   delete-plus-add as a rename, and must never discard a declared backfill. Falsifiable: my repro
   (`eval-fieldops/repro/migr/`) either refuses or emits drop+add.
3. **A released, versioned artifact exists.** A published package, a version we can pin, a changelog,
   and a stated deprecation policy. Today there is no release at all (§7).
4. **`enforcement: denyByDefault` is the language default**, or we adopt a lint that makes it
   mandatory in every model we write (F-005, F-009).
5. **A second maintainer.** At minimum a named backup with commit rights and demonstrated merges.

### Conditions that would move it to "Adopt"

All of the above, plus: 12 months of release history; the by-id authorization hole (F-009) closed;
and a second company publicly running a production system on it.

### What would move it to "Do not adopt"

A tenant-isolation defect in generated code (I looked hard and **did not** find one — see §5), or
the single maintainer going quiet for a quarter.

---

## 2. Executive summary

Loom is a domain-specific language for describing a whole business system — data model, business
rules, permissions, screens, tests and infrastructure — in one text file, from which it generates a
complete, runnable application: backend, database migrations, a web frontend, Docker composition and
an OIDC identity provider. You keep the generated source; there is no runtime to license.

**What it genuinely does well.** The language is expressive and learnable — a 130-line domain model
parsed correctly on my first attempt, and I hit only four syntax errors all day, each with a clear
message. Its compiler diagnostics are better than most commercial compilers I have used: 9 of 10
deliberately-broken models produced a precise, correctly-located, actionable error, several naming
the exact fix. It refuses dangerous database migrations by default, and the safe path it generates is
exactly what a careful DBA would write by hand. Its output is byte-deterministic, so generated code
can be committed and reviewed. Authorization, multi-tenancy and field-level redaction work correctly
in the running application — I attacked all three and could not break tenant isolation. And the
"change the model, everything stays in sync" claim is real: adding one enum value changed 7 files and
17 lines, correctly, across database schema, API validation, the frontend client and a form.

**What it cannot do.** It cannot express a business rule that spans two aggregates as an invariant —
the construct is accepted and then produces code that does not compile, or on one backend silently
disappears. Its five backends are not interchangeable in practice: one ordinary field type broke two
of the eleven targets I built, in two unrelated ways, with no warning. Its migration engine will
silently move data into the wrong column if you delete one field and add another in the same change.
And it is not a product yet: there is no release, no version to pin, no changelog, and no upgrade
path — you would vendor a commit of someone's `main` branch.

**The shape of the risk.** Loom's own most recent internal audit puts it better than I can:
*"a finished compiler wrapped in an unfinished product."* I agree, and I would add the reason. The
repository is six weeks old and 83% of its commits were written by an AI agent under one person's
direction. That has produced extraordinary breadth and unusually good documentation — and a
characteristic failure mode: things that were never actually executed. Every defect I found is a
one-to-three-line fix; none is architectural. The problem is not that Loom is badly built. It is
that not enough of it has been run.

---

## 3. Claim verification matrix

Every claim quoted verbatim from `README.md`. Evidence is in `eval-fieldops/EVAL-LOG.md`; finding IDs in
`eval-fieldops/FINDINGS.md`.

| # | Claim (verbatim) | Grade | Evidence |
|---|---|---|---|
| 1 | "The speed of no-code." | **Verified** | `ddd new` → generated tree in **2.7 s of Loom time**; a running, curl-able app in **~15 min** (13 of which was `npm install` inside Docker). 317 lines of `.ddd` → 151 files / 12,555 lines. |
| 2 | "The keys to the codebase" / "full ownership of every line that's generated" | **Partially verified** | You get readable, idiomatic source and an MIT grant over it. But hand edits are **silently overwritten** on the next generate (F-019). `.loomignore` pins work exactly as documented — at the cost that a pinned file stops tracking the model. Honest version: *you own it until the next regenerate, unless you pin it.* |
| 3 | "Zero vendor lock-in" | **Verified** | Generated output is plain Hono/Drizzle, ASP.NET/EF, Spring/JPA, FastAPI/SQLAlchemy, Phoenix/Ecto with no Loom runtime import. `LICENSE` at the output root grants MIT. You could delete Loom tomorrow and keep compiling. |
| 4 | "No scaling cliff" | **Verified** (to 32 aggregates) | 992-line model / 32 aggregates: parse 4.7 s, generate 5.3 s, 358 files / 49,256 lines, generated-project `tsc` 12.4 s. Roughly linear; nothing fell over. |
| 5 | "No drift between layers" | **Verified — and the strongest result in the evaluation** | One added enum value → **7 files, 17 lines**, landing correctly in `db/schema.ts`, route validation, the frontend API client, the form page and the ER/wire artifacts. |
| 6 | Five backends — Hono, .NET, Phoenix, Spring Boot, FastAPI | **Contradicted (as "interchangeable")** | All 5 *generate* my model with 0 errors. **1 of 5 compiled as shipped.** .NET F-011, Java F-012, Elixir F-013+F-014, Python F-013 (compiles, `NameError` at runtime). After 1–3 one-line patches each, Java and Elixir compiled and .NET compiled without the channel — the architecture is sound, the gating is not. |
| 7 | Six frontends — React, Vue, Svelte, Angular, Feliz, Flutter | **Partially verified** | React / Vue / Svelte **build clean** with their own `npm run build`. Angular fails (F-016). Feliz fails with 14 F# errors (F-017). **Flutter unverified** — I did not attempt the multi-GB SDK. |
| 8 | "Thirteen design packs … swap any time" | **Verified** (5 of 13 sampled, 3 frameworks) | `mantine`, `shadcn`, `mui`, `chakra` each `tsc --noEmit` clean; `vuetify` (Vue) and `flowbite` (Svelte) build clean. A one-word change, correct every time. **The most solid part of the breadth story.** |
| 9 | "Pick a runtime per deployable. Switch any time." | **Contradicted** | Composition works — I built one system with 2 backends + 2 frontends + shared infra (9 services, 305 files). But *switching* is unsafe without compiling: see #6/#7. |
| 10 | "Identical API contracts" | **Partially verified** | `.loom/wire-spec.json` is **byte-identical (sha `391d0b4e…`) across all five backends**. Caveat: it is *derived from the model*, so it is identical by construction and proves nothing about runtime behaviour. Only the node backend was executed end-to-end. |
| 11 | "Browser playground … typed editor, visual system builder, live preview, in-browser test runner" | **Unverified** | Not tested — no browser session driven. Do not read this as negative. |
| 12 | "Built-in traceability … `ddd verify` rolls results into per-requirement Definition-of-Done verdicts" | **Verified** | `requirement → testCase → test → verdict` works end to end. Pass → `Verified 1/4`, exit 0. Fail → `Verification gate failed: 1 requirement(s) failing.`, **exit 1**, plus a readable `.loom/verification.md`. |
| 13 | "LLM-safe by construction … validation gates catch hallucinated fields … before any code is emitted" | **Partially verified** | The agent surface is real and good: a working MCP server exposing **14 tools**, structured diagnostics with stable `loom.*` codes, node-addressed patches, and a malformed patch address returns *"did you mean: aggregate Field.Part.onHand"* plus a 228-entry address book. **But "before any code is emitted" is false in the cases that matter** — F-003, F-006, F-011..F-017 all pass validation and emit code that does not compile. |
| 14 | "1,300+ test files / 9,000+ tests" | **Verified (under-claimed)** | Actual: **2,107 test files, ~14,912 test call sites**, 67 CI workflows. |
| 15 | "CI matrix … the backends are compiled against real toolchains" | **Verified, with the decisive caveat** | True — and the inputs are the vendor's own fixtures and `examples/`. Every bug I found lives in a feature *combination* the corpus lacks (§6). |
| 16 | "Generated migrations" / migration safety | **Partially verified** | Excellent refusal and backfill behaviour (§5), **undermined by F-018** — a silent data mis-migration. |

---

## 4. Target matrix

One model (`eval-fieldops/fieldops/main.ddd`, 317 lines); only `platform:` / `design:` varied. Every
"compiles" verdict is an **executed build** using the generated project's own declared toolchain.

### Backends
| Backend | generates | compiles | boots | wire-identical | notes |
|---|---|---|---|---|---|
| node / Hono | ✅ 158 files | ✅ `tsc --noEmit` 0 | ✅ **served real traffic** | ✅ | the one fully-exercised path |
| .NET / ASP.NET | ✅ 331 files | ❌ **F-011** CS0234 ×2 | — | contract ✅ | builds `-warnaserror`, 0 warnings, **without** a channel |
| Java / Spring Boot 4.1 | ✅ 277 files | ❌ **F-012** | — | contract ✅ | **BUILD SUCCESSFUL** after adding 3 import lines |
| Python / FastAPI | ✅ 169 files | ⚠️ compiles, **runtime `NameError`** | — | contract ✅ | `ruff` flags it: `F821` (**F-013**, **F-015**) |
| Elixir / Phoenix | ✅ 250 files | ❌ **F-013** + **F-014** | — | contract ✅ | compiles (`Generated api app`) after 2 one-line patches |

### Frontends
| Frontend | generates | builds (own `npm run build`) | notes |
|---|---|---|---|
| React | ✅ | ✅ | also served live at :3001 |
| Vue | ✅ | ✅ 904 ms | `vue-tsc` clean |
| Svelte | ✅ | ✅ | `svelte-check` clean |
| Angular | ✅ | ❌ **F-016** | `enum[]` → `FormControl(null)` vs `unknown[]` |
| Feliz (F#) | ✅ | ❌ **F-017** | 14 `error FS` — duplicate type + 8× Guid/string |
| Flutter | ✅ 126 files | ⚠️ **UNVERIFIED** | SDK not attempted. **Not a pass.** |

**Mixing:** ✅ — 2 backends + 2 frontends + shared infra in one system → 305 files, coherent 9-service
compose.

> **The single most telling result.** One ordinary field — `skills: Skill[]` — broke **two** of the
> eleven targets I built (Elixir, Angular), in two unrelated ways, and the toolchain reported
> `0 error(s), 0 warning(s)` both times.

---

## 5. What it is actually like to use

**Hour one (onboarding).** `npm install`, `ddd new`, `generate system`, `docker compose up`. Four
commands. Loom's own work took 2.7 seconds; the wall clock was dominated by `npm install` inside two
Docker images. Two places I had to guess: `ddd` is never on `PATH` despite every doc using it
(F-001), and the REST routes live under `/api/…`, which no quickstart states (F-002). Both trivial.
The generated app came up with structured JSON logs carrying `request_id`/`trace_id`/`span_id`,
working healthchecks, applied migrations, and RFC 7807 problem responses. *One thing deserves
specific credit:* this sandbox terminates TLS at a proxy, which normally breaks container builds —
and Loom had already anticipated it, shipping a `certs/` directory in every deployable with the
`COPY`/`update-ca-certificates` lines pre-wired. It worked first try.

**Hours two to four (modelling).** This is where Loom is genuinely delightful. My first 130-line
domain slice — six aggregates, containment, money arithmetic, optional foreign keys, a
multi-currency invariant — **parsed correctly on the first attempt** and its generated backend
type-checked clean. Most of the spec expressed directly: tenant isolation, guarded lifecycle
transitions (which also generate free `GET /{id}/can_<op>` endpoints for UI enablement), a
transactional cross-aggregate workflow, masked fields, file upload, brokered eventing, grouped
reporting projections.

The compiler volunteered two warnings I did not ask for and was glad to get: that my
`unique (serialNumber)` on a tenant-owned aggregate was a *global* unique across all tenants, and —
remarkably — that `sensitive(pii)` does **not** redact anything on the wire, naming the two things
that do. That is a vendor telling you its own feature is weaker than you assumed. It is the single
best signal of good faith I saw all day.

**The ceiling.** Two requirements from my spec could not be expressed cleanly:
- *"A work order may only go to a technician whose skills cover the asset's required skill"* — the
  natural cross-aggregate `invariant` is accepted, then emits non-compiling code on four backends
  and **silently nothing at all on Elixir** (F-003). The workaround is a workflow precondition,
  which only guards that one write path.
- *"A technician sees only their own work orders"* — `currentUser.id` is a user id, not a
  `Technician id`, and the type system correctly refuses the join. Requires denormalising a
  `technicianUserId` column onto the row.

**Maintenance (the part that decides adoption).** Additive change: excellent — one enum value, 7
files, 17 lines, perfectly readable diff. Breaking change against a **populated** database: mostly
excellent. Adding a required column **refused with exit code 1 and wrote nothing**, naming the exact
DDL and both remedies; supplying the declared backfill produced the textbook add-nullable → update →
set-not-null sequence, which I applied live with **zero data loss**. A plain rename was correctly
inferred and preserved data.

And then: I deleted one field and added an unrelated one in the same change, with an explicit
backfill for the new column, and Loom silently emitted
`ALTER TABLE … RENAME COLUMN "bin_code" TO "supplier_ref"` — putting bin codes in the supplier
reference column, discarding my declared backfill, exit 0, no warning, contradicting the rule its own
documentation states (F-018). I could find no flag or syntax that expresses the intent I actually had.

**Debugging.** Given a real stack trace from generated code, `ddd trace` pointed at
`main.ddd:134` — exactly the `precondition` that failed. Production triage back to the model works.
The reverse (`ddd breakpoints`) mostly returns line 1 (F-021).

---

## 6. Gap register

**22 findings.** Split by class:

| Class | Count | IDs |
|---|---|---|
| **SILENT** (valid input, exit 0, wrong / non-compiling / missing output) | **15** | F-003, F-006, F-007, F-008, F-011, F-012, F-013, F-014, F-015, F-016, F-017, F-018, F-020, F-021, F-022 |
| **SILENT in the default configuration, HONEST once reconfigured** | **2** | F-005 (silent under `enforcement: opt`, a hard error under `denyByDefault`), F-009 (disclosed in a `ddd new` comment; the compiler says nothing) |
| **DOCUMENTED** (named up front, with a working escape hatch) | **2** | F-001, F-019 |
| **DOCUMENTED but WRONG** (docs contradict the implementation) | **1** | F-010 |
| **DX papercut** | **1** | F-002 |
| **Recorded positive** (not a gap) | **1** | F-004 |
| **HONEST** (refused with a clear `loom.*` diagnostic) | **not counted as findings** | constant and high quality — see below |

**The ratio is the headline: 15 silent to 2 documented.** A buyer can plan around a documented gap
and around a refusal. Fifteen constructs that report success and produce broken output is a
different kind of cost, and it is the reason condition #1 in §1 exists.

**The HONEST column is not empty — it is the reason to take Loom seriously.** I did not file findings
for refusals because refusals are the desired behaviour, but they were constant and high quality:
a redis/kafka channel-compatibility mismatch named the compatible broker; a tenant-unscoped unique
index was caught; `sensitive(pii)`'s real (weak) semantics were volunteered; deny-by-default named
*why* a `crudish` member could not carry a gate and gave two fixes; an unqueryable filter listed what
*is* allowed; 9 of 10 deliberately-broken models produced precise, located, actionable errors. The
project maintains an explicit register of 61 known-unsupported rows and 493 diagnostic codes.

### By severity
| Sev | IDs | One-line |
|---|---|---|
| **S1** | **F-003** | cross-aggregate `invariant` → non-compiling on 4 backends, **silently dropped on Elixir** |
| | **F-006** | an `invariant` over a contained collection removes the `create` factory; call sites then fail to compile. Generalised: **nothing validates `Agg.create({…})` call sites at all** |
| | **F-007** | `criterion … != null` on an optional FK emits invalid Drizzle |
| | **F-011** | **.NET cannot build any system using a channel** (CS0234) |
| | **F-012** | `mask unless` on Java → missing `import java.util.Objects` |
| | **F-013** | `criterion` using `currentUser` — correct on node/.NET/Java, **broken on Python and Elixir** |
| | **F-014** | `enum[]` → invalid Ecto type; Elixir will not compile |
| | **F-016** | `enum[]` → Angular bundle will not build |
| | **F-017** | Feliz frontend: 14 F# errors (duplicate type + Guid/string) |
| | **F-018** | **migration rename heuristic silently mis-migrates data**, discards the declared backfill, contradicts its own docs |
| **S2** | F-005 | `ignoring tenantOwned` is a one-word cross-tenant bypass, unflagged under the **default** auth mode |
| | F-008 | generated compose pins `minio/minio:latest`, removed from Docker Hub — whole stack fails to start |
| | F-009 | under the **recommended** `denyByDefault`, `GET /<plural>/{id}` carries no authorization gate and nothing warns |
| | F-020 | cyclic containment → `RangeError` stack trace instead of a diagnostic |
| **S3** | F-010, F-015, F-019, F-021, F-022 | doc-vs-grammar contradictions; generated Python fails its own linter; hand edits clobbered silently; `ddd breakpoints` returns line 1; Prometheus config can't scrape the app it ships with |
| **S4** | F-001, F-002 | `ddd` not on PATH; undocumented `/api` route prefix |
| **n/a** | F-004 | recorded positive: the transactional workflow generates genuinely correct code |

### Why CI did not catch these — the mechanism, stated precisely
Loom *does* compile generated output per target in CI. Its inputs are the vendor's own fixtures and
`examples/`. Every bug I found lives in a **feature combination the corpus lacks**:
- **F-011**: the dotnet fixture with a channel has **`channelSource` count = 0** — and
  `channelSource` is what causes the broken file to be emitted at all.
- **F-012**: the `field-mask` fixture is marked `backends: ALL`, but masks with a
  `.contains(...)` predicate. I used `== "admin"` — string equality is what emits `Objects.equals`.
- **F-014 / F-016**: `enum[]` exists in the corpus only in two *dotnet* fixtures.

> **Loom's CI is broad across targets and thin across feature combinations — and the corpus is
> written by the same process that writes the emitters, so it tests what the author thought of.**

**They have already diagnosed this exactly, and built the right instrument — one generalisation too
narrow.** `test/system/emitted-unbound-identifiers.test.ts` exists, and its header is the clearest
statement of my central finding I could have written myself:

> *"The gap is not the invariant — it is the INPUT SET … PR time `examples/showcase.ddd` × 2 packs =
> 2 cells; push:main every example × every pack = 160 cells … the failing cell is simply not in the
> PR gate's input set."*

It generates all 160 cells per-PR and asserts that emitted code never references a name it did not
bring into scope — the exact invariant my **F-013** violates. But `test/_helpers/emitted-scope.ts`
scopes it to **frontend page files only** (`react`/`vue`/`svelte`/`angular` page globs) and to
unbound `t()` translate calls. My F-013 is an unbound identifier in a **Python backend repository**.
The instrument is built, correct, well-reasoned, and one generalisation away from catching a
genuine S1. That is why fix #1 below is cheap, not speculative.

This is also the fairest available summary of the maintainers' own posture: their
2026-08-24 internal audit identifies the F-012 bug *class* exactly, and its own remedy line ends
*"audit the route-layer twin for the same gap."* My F-012 **is** that twin. The class was found, the
generalisation written down, some instances fixed, and the rest shipped.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Vendor / bus factor** — 810 commits, repo **6 weeks old**, **83% AI-authored**, **one human** (135 commits), no second maintainer | **High** | **Severe** | Vendor a fork from day one. Budget to maintain it ourselves. Do not put a revenue product behind it until there are two maintainers. |
| **No release surface** — not published, no tags, no changelog, no deprecation policy, all packages `0.0.0-experimental` + private | **Certain (measured)** | High | Pin a commit SHA, vendor it, gate every bump behind a full regenerate-and-compile of our model. |
| **Silent per-target miscompiles** (13 SILENT findings) | **High** — I hit 10 in one day | High | **CI must compile and boot every target we ship, from our model, on every change.** Loom's "0 errors" is not a merge gate. |
| **Migration data corruption** (F-018) | Medium — needs a delete+add in one change | **Severe, irreversible** | Mandatory human review of every generated migration before apply. Never automate `generate → migrate` in CD. |
| **Abstraction ceiling** (F-003: cross-aggregate rules) | Certain for a rich domain | Medium | Express such rules in workflows; accept they guard one path; add integration tests at the API boundary. |
| **Regenerate clobbers hand edits** (F-019) | Certain | Medium | `.loomignore` discipline + a CI check that every pinned file still compiles against the current model — Loom will not tell you when a pin has drifted. |
| **Authorization hole on by-id reads** (F-009) | Medium | Medium–High | Gateway-level authorization, or treat by-id as authenticated-public in our threat model. |
| **Onboarding / key-person risk on our side** | Medium | Medium | The DSL is small and learnable (I was productive in ~2 hours). Real risk is the *operational* knowledge of the workarounds, not the language. |
| **Toolchain's own dependencies** — `npm audit`: 11 vulns, 4 high, all fixable | Low | Low | Build-time only; fork and bump. |

**On the risk I looked hardest for and did not find:** I attacked tenant isolation from the outside
with real tokens from the generated identity provider. A token with **no** tenant claim returned
**zero rows** (fail-closed, not fail-open). Tenant A's list read returned only A's data; reading
tenant B's record **by id** returned **404**, not 200. `mask unless` returned `null` to a dispatcher
and the real value to an admin. Authorization returned **403**, state guards **409**, validation
**422**, each with the exact predicate in the body. **Generated tenant isolation and permission
enforcement are real, not just modelled** — this is the strongest single reason Loom deserves a pilot
rather than a rejection.

---

## 8. Fit analysis

**Clearly good for:**
- Internal line-of-business and back-office applications — CRUD-heavy, many entities, real
  permissions and multi-tenancy, where consistency across many screens matters more than any one
  screen being bespoke.
- Prototyping a domain with stakeholders. Nothing else I know of gets from a domain conversation to
  a running, permissioned, migrated stack this fast.
- Teams that would otherwise hand-roll a scaffolding layer. Loom is a far better version of that.

**Clearly wrong for:**
- Anything where the UI *is* the product (consumer apps, heavily designed surfaces). The page DSL is
  a closed set of ~56 primitives; past that you eject pages and own them.
- Domains whose rules are mostly cross-aggregate or algorithmic. F-003 is the ceiling, and it is
  structural, not a bug.
- Regulated systems requiring an auditable, reviewed migration path — until F-018 is fixed.
- Teams that cannot afford to vendor and maintain a fork.

**Where our next product falls.** Multi-tenant B2B with real permissions is *squarely* in the good
column — it is exactly what Loom is built for, and my FieldOps model is a close proxy. The
disqualifiers are not fit; they are maturity and bus factor.

---

## 9. Comparison with the realistic alternatives

| | Loom | Conventional framework + AI assistant | No-code / low-code | In-house scaffolding |
|---|---|---|---|---|
| Time to first running stack | **~15 min** (measured) | hours–days | minutes | weeks to build the layer |
| Consistency across layers | **Enforced by construction** (verified) | drifts; the assistant has no model to check against | enforced, inside the platform | as good as your discipline |
| Source ownership | Yes (MIT over output) | Yes | **No** | Yes |
| Ceiling | Real (F-003), and you eject to hand-written code | None | **Hard — you rewrite** | None |
| Multi-target | 5 backends × 6 frontends claimed; **1×3 verified** | one, chosen deliberately | one | one |
| Maturity / support | **6 weeks, 1 maintainer, no release** | decades, huge ecosystems | vendor SLA | you are the vendor |
| Migration safety | Good gate, **one silent corruption bug** | your own tooling | vendor-managed | your own |
| Exit cost | **Low** — output is idiomatic and Loom-free | n/a | **Very high** | n/a |

**The honest comparison is against alternative 2**, because that is what the council will actually
weigh. A framework plus an AI assistant gets you moving nearly as fast and carries no vendor risk —
but it has no model to check against, so consistency degrades with every change, and nothing stops
the assistant inventing a field the database does not have. Loom's structural answer to that is real
and I verified it (claim #5). Whether that advantage is worth a six-week-old dependency with one
maintainer is precisely the judgement in §1: worth a pilot, not worth a product.

---

## 10. Top 10 fixes, ranked by adoption impact

1. **Generate the CI corpus combinatorially** (or accept user models as fixtures). Nine of my ten
   S1s would have been caught before release. This is the root cause, not a bug.
2. **Fix F-018.** Never collapse drop+add into a rename when the new column carries a declared
   backfill; refuse ambiguity instead. Data corruption outranks everything.
3. **Ship a release.** Publish, tag, changelog, deprecation policy. Today nothing is installable.
4. **Validate `Agg.create({…})` call sites** against the real factory input (F-006) — and refuse the
   cross-aggregate `invariant` with a diagnostic instead of emitting broken or absent code (F-003).
5. **Run each backend's own linter over generated output in CI** — `ruff check` alone would have
   caught F-013, a genuine S1, for free (F-015).
6. **Fix the four per-target compile bugs**: .NET channel namespace (F-011), Java `Objects` import
   (F-012), Elixir `enum[]` + `^` pin (F-013/F-014), Angular `enum[]` form control (F-016).
7. **Make `enforcement: denyByDefault` the default**, and warn on `ignoring tenantOwned` on its own
   merits (F-005).
8. **Gate `GET /<plural>/{id}`** under deny-by-default, or document it as a second exception (F-009).
9. **Warn when regeneration overwrites a locally-modified file** (F-019) and when a `.loomignore`
   pin has drifted from the model.
10. **Fix the cyclic-containment crash** (F-020) and the `ddd breakpoints` line resolution (F-021).

A second maintainer would outrank all ten, but it is not a fix.

---

## 11. Coverage and limits of this evaluation

**Sampling — read every cross-cutting sentence above against this.**
- **Backends:** all 5 generated; **compile attempted on all 5**; only **node** was booted and served
  real HTTP traffic. Statements about runtime behaviour are node-only.
- **Frontends:** all 6 generated; builds attempted on 5; **Flutter unverified** (SDK not attempted).
  Only React was served in a browser-reachable form, and I did **not** drive a browser — no
  Playwright run, no rendered-page verification. "The frontend works" is **not** a claim I am making.
- **Design packs:** 5 of 13 sampled, across 3 of 5 frameworks.
- **Migrations:** tested against a live populated Postgres, but with small row counts (2–3 rows per
  table), a single schema, and no concurrent load.

**Not tested at all:** the browser playground; the VS Code extension / LSP interactively; Kubernetes
/ Helm output (documented, not emitted for my model — I did not find the opt-in); event sourcing
(`persistedAs: eventLog`); aggregate inheritance / TPC vs TPH; i18n `sync`/`check` beyond generation;
the generated Playwright e2e harness; `ddd snapshot` provenance beyond artifact emission; the DAP
adapter; channel *delivery* through a real broker (I verified compose wiring and compile behaviour,
not message flow); performance under load; anything at >32 aggregates.

**Where my confidence is low.**
- **The Elixir and Python S1s** rest on a compile error and a linter finding respectively; I did not
  boot either backend, so I cannot say what *else* is broken behind them. Expect more, not fewer.
- **F-018's blast radius.** I proved one shape corrupts data. I did not enumerate which other
  refactors the heuristic mis-reads; there may be more.
- **Flutter and the playground** are genuinely unknown to me. Do not read their absence as doubt.

**Two disclosures about method.**
1. The harness injected the maintainers' `CLAUDE.md` into my context before Phase 0, which I could
   not decline. My "time to first app" is therefore an **optimistic lower bound** — I knew the CLI
   entry point and the build lifecycle before I started. A true outsider would be slower.
2. This sandbox terminates TLS at a proxy, which cost time on container builds and made the Java,
   .NET and Elixir toolchains awkward to obtain. Where an environment limit blocked me I have marked
   the cell **unverified** rather than failed. Two failures I initially suspected were mine, not
   Loom's, and are logged as such: migrations targeting a per-context schema (I looked in `public`),
   and the `ddd verify` results contract (I wrote `"passed"` instead of `"pass"`).

---

## 12. The ten questions, answered directly

1. **Time to a running app?** ~15 min as an outsider (4 commands; 2.7 s of it Loom's own work).
   To model a realistic domain: ~2 hours to a 317-line model covering most of a real product spec.
   To make the first breaking change safely: ~20 min, including reading the refusal and writing the
   backfill block.
2. **What can it not express?** Cross-aggregate invariants (F-003) — the single hardest ceiling.
   Row-level rules that need a join from the principal to a domain entity require denormalisation.
   Beyond that, the DSL covered my spec better than I expected.
3. **Edit generated code and regenerate — exactly what happens?** It is overwritten, silently, with
   no backup and no mention in the summary line. `.loomignore` pins it permanently, at the cost that
   the file stops tracking the model.
4. **Can a breaking schema change ship against production without data loss?** For the common cases,
   yes — demonstrated live with zero loss (§5). But **not safely unattended**: F-018 corrupts data on
   one ordinary refactor, silently.
5. **Is tenant isolation and permission enforcement airtight in the generated code?** Tenant
   isolation: **yes**, in everything I could attack — including fail-closed on a missing claim and
   404 on cross-tenant by-id. Permissions: **almost** — the by-id read is ungated even under the
   recommended posture (F-009), and `ignoring tenantOwned` is an unflagged bypass under the default
   posture (F-005).
6. **Are the 5 backends and 6 frontends genuinely interchangeable?** **No.** One is the real path
   (node/React); the others generate convincingly and mostly do not compile. They are not demos —
   each was 1–3 one-line fixes from working — but they are not interchangeable today.
7. **Could our SRE team operate it? Could our engineers debug it?** Operate: mostly yes — structured
   logs with trace ids, health/ready, OTel, Prometheus and Jaeger sidecars; the emitted Prometheus
   config can't scrape the app (F-022) and there is no emitted production posture. Debug: yes —
   `ddd trace` maps a real stack frame back to the exact model line.
8. **Exit cost in year two?** **Low, and this is Loom's best structural property.** The output is
   idiomatic Hono/Drizzle (or Spring/JPA, etc.) with no Loom runtime dependency and an MIT grant. You
   keep everything and stop regenerating. What you lose is the model as source of truth — from then
   on you maintain ~12,500 lines per 317 lines of model by hand.
9. **Most likely way this blows up, and how we'd see it coming?** A silent per-target miscompile or a
   mis-migration reaches production because we trusted "0 errors". **We would see it coming** by
   compiling and booting every target from our own model in our own CI, and by reviewing every
   generated migration by hand. Both are cheap. The second-most-likely: the single maintainer stops,
   and we inherit a 351k-line compiler. We would see that coming in the commit graph.
10. **Verdict and what changes it?** **Pilot on a non-critical project only** — §1 lists five
    falsifiable conditions that move it to "Adopt with conditions".

---

*Evidence: `eval-fieldops/FINDINGS.md` (22 findings), `eval-fieldops/EVAL-LOG.md` (chronological log with commands and
output), `eval-fieldops/fieldops/*.ddd` (the model), `eval-fieldops/repro/*` (minimal reproductions for every S1/S2).*
