# Evaluation closure review — 2026-09-28

**Question:** were the problems that the September 2026 platform-evaluation sessions found closed properly, or are there still open bugs and gaps, missing missions, and wrong claims?

**Answer:** about two thirds of what was found is fixed and verified. Bookkeeping has not kept up:

- **Six evaluation runs never reached `main`.** Their findings live only on unmerged branches, and nothing in `docs/new-plan/` points at them.
- **About 60 real defects and gaps are still live with no owner.** None of them has a mission or a non-stale PR.
- **The status text is often wrong in both directions.** Registers and `coverage.md` rows call fixed things open, and a few open things fixed.

**Method.** Thirteen agents each re-verified one register against `main` at `d2a0bc02`.

- **Repros re-run.** Every repro was run with `ddd parse` / `generate system` on a freshly rebuilt CLI.
- **Output inspected.** Agents read the emitted code, and checked pinning tests plus `git log` / PR state.
- **No stack booted.** Docker was not used, so runtime claims rest on static evidence (the generated code and the fix commits).
- **Transcripts not read.** Session transcripts are not readable from a session. Every evaluation session since 09-10 left a register on a branch, so the registers and PR bodies are the record.
- **Rebuild needed.** The checked-in `out/` build was stale (09-21). Several findings looked open until the CLI was rebuilt.

Per-register tables (one row per finding, with evidence) are in the sibling files listed at the bottom.

---

## 1. Registers that never reached `main`

| branch | register | findings | on main? |
|---|---|---|---|
| `claude/loom-platform-eval-3aiinh` (09-22) | `eval-platform/`: stack-switching probe, 5 backends × 6 frontends | 7 | **no** |
| `claude/loom-platform-eval-mc2v5j` (09-22) | `eval-cargo/`: Meridian freight adoption | 16 | **no** (fix PRs cite it) |
| `claude/loom-dev-experience-test-xukeqa` (09-22 → 09-28) | `eval-claims/`: claims platform, F-101…F-117 | 17 | **no** (#3026/#3029 cite it) |
| `claude/loom-dsl-evaluation-dhw7gb` (09-13) | architecture-council evaluation | 12 | **no** |
| `claude/loom-dsl-evaluation-kllafl` (09-14 → 09-20) | FieldOps + Clearline, `FIX-REGISTER.md` (12 packets A–L) | 47 | **no**, and no PR was ever opened from it |
| `claude/loom-dsl-evaluation-bxc2c6` (09-13) | Commons second pass | — | register is on main; **35 repro sources are not**, and main's `eval/FINDINGS.md` cites them |

`eval-clinica/` is on main but has **no row in `docs/new-plan/coverage.md`**, so none of its open items can reach the plan.

**Action:** do not merge these branches. Most contain hundreds of generated files, and `bxc2c6` would delete newer `eval/` trees. Port each register's findings and repros under `docs/audits/`, with a verified-status column (these tables are that column). Then add a `coverage.md` row per register and mission the open items in §2.

## 2. Still broken with no owner (deduplicated across registers)

**Owner** here means a live mission in `docs/new-plan/` or an open PR that is actually being worked. The five 09-14 drafts (#2947, #2948, #2949, #2966, #2969) have conflicts and have been idle since 09-21, so they do not count.

### 2a. Silent wrong output: valid input, exit 0, broken code

| # | defect | source ids | evidence |
|---|---|---|---|
| 1 | **Migration silently renames a column.** Dropping `title` and adding `description` in one edit emits `RENAME COLUMN "title" TO "description"` with 0 diagnostics. There is no `loom.migration-rename-inferred` warning. | platform F-3 (S1) | unmerged-eval-platform.md |
| 2 | **An author-declared `find all() where <pred>` loses its filter** on Python (`select(DocRow)`) and Elixir (`Repo.all`). #2945 was closed today saying nothing else on its branch still reproduces; this does. | clearline X-1 (S1) | unmerged-eval-clearline.md |
| 3 | **A `requires`-gated operation reached from a reactor or workflow is broken on all five backends.** Node, .NET and Java get an unbound `currentUser`; Python drops the gate; Elixir passes `nil`. The only claim is #2966 (stale, Java-only). | claims F-103, clearline F-024 | unmerged-eval-claims.md, pr-sweep.md |
| 4 | **A gate on an event-sourced create emits `currentUser`/`ForbiddenError` without imports** (node). Since #3054 made `denyByDefault` the default, an event-sourced aggregate with a create no longer builds under default auth. #3048 says M-T3.16 owns the hoist, but M-T3.16 closed today without it, and the c5 handoff asks for a new mission. | cargo F-004 | unmerged-eval-cargo.md |
| 5 | **A node find compares a nullable claim** (`currentUser.technicianId: TechnicianId \| null`) inside `eq(...)`. Wave 2 of #2911 dropped it without comment. | fieldops-audit F-014 (S1) | fieldops-audit.md |
| 6 | **No escaping of reserved words in the target languages.** Fields `def`/`lambda`/`pass` and `operation class()` produce a Python SyntaxError. A field named `assertInvariants` produces .NET CS0102. #3063 (draft) widens only *Loom's* keyword list. | commons R-1/D-2, fieldops-audit F-016 | commons.md |
| 7 | **A paged `queryHandler` over a retrieval, once routed, crashes on all five backends** with `internal: … Please file a bug`. The register says "fixed" because the 09-21 check never routed it. | clinica F-009 | clinica.md |
| 8 | **`apply Opened { … }` crashes with a `TypeError` in `lowerApply`** instead of giving a diagnostic. | fieldops-audit (J-docs) | fieldops-audit.md |
| 9 | **An invented member on an array receiver is emitted verbatim** (`f.totallyInvented`, `tags.bogus` → TS2339). #2949 gates only primitive receivers and is a stale draft, and H1/#3040 does not cover it. | testability F1-c | testability.md |
| 10 | **Projection over a shared-table (TPH) subtype** selects `schema.autoClaims`, a table that doesn't exist. | clearline F-041 | unmerged-eval-clearline.md |
| 11 | **A value object or enum on a foreign carried event** doesn't compile: the consumer's `value-objects.ts` is emitted empty but still imported. | clearline F-044 | unmerged-eval-clearline.md |
| 12 | **The .NET and Python channel decoders don't guard optional fields.** | clearline F-045 | unmerged-eval-clearline.md |
| 13 | **Kafka consumers on node, Java and .NET start at the latest offset**, so events published before a consumer's first boot are lost. The RabbitMQ half of F-112 was fixed. | claims F-112 residual | unmerged-eval-claims.md |
| 14 | **Elixir has three separate defects:** <br>• a value-object field in workflow state gets `field :total, :string` while the table has `total_amount`/`total_currency`; <br>• `sum(record.amount)` over a JSON map column; <br>• the pure-core `dispatch/2` stores a raw datetime string. | commons D-3, clearline F-011, testability F2-r2 | commons.md, testability.md |
| 15 | **Generated Python fails its own lint gates:** <br>• `mypy --strict`: `for child` is reused across two `contains` loops; <br>• ruff F841: an unused `getById` let; <br>• mypy `comparison-overlap`: enum-progression unit test; <br>• a message-less `matches` returns pydantic's raw message. | council F-012b, eval-fieldops F-015, testability F2-r1, fieldops-audit F-034b | respective files |
| 16 | **Java `objectStore.put(key, {…})` passes a `Map.of` into a `String` parameter.** | #2966 item 2 | pr-sweep.md |
| 17 | **A `with crudish` field that shares a name with a `resource`** raises a spurious `loom.lifecycle-body-dropped` on crudish's own create. | cargo (new) | unmerged-eval-cargo.md |
| 18 | **A scaffolded ui targeting a backend that doesn't serve the aggregate** passes `parse`, then `generate` gives 12–26 errors on generated `.tsx` lines, none naming the `.ddd` cause. `page-metamodel.md` says the validator refuses this, and `walker-core.ts:2088` calls the branch "DEAD on valid .ddd". Both claims are false. | claims F-108, council F-011 | unmerged-eval-claims.md, unmerged-eval-council.md |
| 19 | **The generated node Dockerfile builds with tsup and never runs `tsc --noEmit`**, so every node type error above ships. | cargo C2, commons X-1 | commons.md |

### 2b. Security and ops posture

| # | gap | source |
|---|---|---|
| 20 | **403 bodies echo the gate's source predicate** (`Forbidden: ${g.source}`), with no production switch to suppress it. | clinica F-020 |
| 21 | **The OIDC `aud` check is off by default and the backends differ.** .NET and Python fall back to `OIDC_AUDIENCE`; node, Java and Elixir don't. `docs/auth.md:1130` is wrong for two of them. | clinica F-020 |
| 22 | **Under the new `denyByDefault` default, the auto-`findAll` list route is open with no diagnostic**, while by-id reads do warn. There is no decision record. | commons F-006 |
| 23 | **A malformed `x-loom-dev-claims` header silently falls back** to the base identity. | fieldops-audit F-021 residual |
| 24 | **Generated compose has no `restart:` policy and no DB connect retry.** #2946 deferred it "to its own mission", which was never written. | clearline F-020 |
| 25 | **Generated projects ship no lockfiles and use caret-ranged deps.** This was marked "maintainer's call", but no decision was ever recorded. | fieldops-audit F-038 |
| 26 | **The demo tenant doesn't match any tenant row.** <br>• The demo user's `orgId` / seeded tenant matches no registry row, so its tenant lists are empty. <br>• The Keycloak demo user has no `permissions` attribute; only stale #2948 covers that part. | cargo F-011, fieldops-audit F-022r |
| 27 | **Feliz and Flutter never send `If-Match`**, so optimistic concurrency is off on two frontends. | fieldops-audit F-023 residual |

### 2c. Language and toolchain gaps

| # | gap | source |
|---|---|---|
| 28 | **IR-phase diagnostics print with no file:line**, because `LoomDiagnostic` has no span. | eshop G5/D10e |
| 29 | **An `api` block that no deployable `serves:` is silent.** | eshop D10d |
| 30 | **The `migration-ambiguous-rename` hint doesn't say the `migration` block goes at root level.** | eshop D10c |
| 31 | **Keyword field names are still restricted.** About 14–28 keywords (`event`, `test`, `storage`, …) still can't be field names, and in field position the error reads `Expecting '}'` rather than "is a Loom keyword". #3063 was opened today for this. | eshop P6a/b, clearline F-032 |
| 32 | **Argument types of operation calls inside a unit `test` body are not checked.** | claims F-105 |
| 33 | **Flutter `design:` accepts any value** (mantine and shadcn produce identical trees). | platform F-4 |
| 34 | **`ddd breakpoints` answers `:1` for fields, invariants and finds.** | platform F-6, eval-fieldops F-021r |
| 35 | **`ddd trace` can't map the default node bundle.** The Dockerfile runs without `--enable-source-maps`. | commons F-018 |
| 36 | **`ddd verify` with `"passed"`/`"failed"` reports 0/3, exits 0 and prints "No unknown results".** | clearline F-035 |
| 37 | **`ddd new` prints `npx ddd …`.** Outside the clone, that runs an unrelated public npm package called `ddd`. | eval-fieldops F-001r |
| 38 | **ICU `plural`/`select` branch text is silently dropped in backend `derived` fields**, with no diagnostic. The only record is an archived note. | clinica F-006, cargo F-002 |
| 39 | **A policy used from another context types as `unknown`**, and a policy or permission vocabulary can't be shared across contexts. | cargo F-006 |
| 40 | **A `.loomignore`-pinned file freezes.** Hand-edited files are counted but not named, and there is no staleness check, merge or `--diff`. | commons F-008, clinica F-012 |
| 41 | **An aggregate can't move between contexts without data loss** (no schema move). | commons F-009 |
| 42 | **Only one `resource` per (context, kind)**, and there is no `can_*` endpoint for a UI to render a `requires` gate. #2969 only promises a write-up. | clearline F-042/F-043 |
| 43 | **No test matchers for an emitted event or for object equality**, and no real UI negative matcher. Both were deferred "to its own mission", which was never filed. | testability F11-r, F7-r |
| 44 | **The `api.workflows.*` / `transactional-no-effect` false positive persists** on `for … { emit }` and `for`×`let`. It was planned for wave 4 and never landed. | fieldops-audit F-004 |
| 45 | **Scaffold filter bar doesn't read criterion or retrieval params.** | eshop D7a |
| 46 | **A hand-written `queryHandler` with the same name as a macro-emitted one** silently drops the macro's handler. | eshop D1 sub |
| 47 | **README claims "No drift between layers" and "Identical API contracts" without qualification.** | commons F-019 |

**Unfinished plan items with no mission** (fieldops-audit FIX-PLAN §5, clinica FIX-PLAN):

- the cross-backend symbol-sweep mission;
- widening `ir-walk-census` to independent `if` chains;
- a real OIDC code-flow gate;
- a nightly deep-fuzz leg, plus a second deployable and `test e2e` in the fuzz generator;
- the §5.7 corpus fixtures;
- the vue/svelte/angular field-shape waiver;
- clinica's wave-0 `generated-compiles` gate.

## 3. Open and tracked, but the tracking is stuck

| item | owner | state |
|---|---|---|
| platform F-2 (.NET `Task` / BCL name collision) | #3043 | open, blocked |
| platform F-1b (Elixir drops invariants) | #3023 | open |
| platform F-1a (member access on primitives, e.g. `money.amount` → Elixir `KeyError`) | #2949 | **draft, dirty, idle 2 weeks**; the register calls it "fixed" |
| cargo F-004 (event-sourced create gate) | #3048 | ready, blocked; wrong owner claim (see §2a #4) |
| cargo F-012 (drizzle journal ordering) | #3049 | ready, blocked; node-only by design |
| H1 (`envForNode` has no `DomainServiceOperation` arm) | #3040 | ready, blocked |
| cargo F-008, Python twin (cross-context value object written unflattened) | #3060 draft | its "write half is fine" claim is false |
| clearline packets C, E, I | #2949, #2942, #2943 | open |
| clearline packets G, J, K, L | #2947, #2966, #2948, #2969 | **stale dirty drafts**; parts already landed elsewhere, parts still live |
| "E2E-less drain" | #2977, #2978, #3058 | **three PRs claim the same work** |

H2 (domainService `getById` deref) **is fixed** (#3035, merged 09-27).

## 4. Wrong claims to correct (docs and trackers)

**Docs that make false statements about the product:**

- `docs/language.md:1150` (added by #3041) says a hand-written `create` cannot carry its own gate. It can: a leading `requires` works.
- `docs/page-metamodel.md` (~213, ~1267) promises a scaffold-targets validator that doesn't exist.
- `docs/auth.md:1130` describes the `aud` fallback wrongly for .NET and Python.
- The .NET verifier's generated comment says it "checks iss / aud / exp" even when no audience is set.
- `eval-fieldops` F-005 says `enforcement: opt` is the default. That stopped being true today (M-T3.1).

**Register headers and dispositions that are stale:**

- **fieldops-audit:**
  - Header: says "45 / 43 live / 16 S1 / 2 fixed". The truth is 50 findings, 18 S1, about 39 fixed.
  - FIX-PLAN and README: say "waves 1–5 still plans". All six waves merged in #2911.
  - Dispositions of F-005, F-047, §5.6 and §3.5 contradict what landed.
- **eval-fieldops:**
  - The only status table is from 09-14, so everything reads as open; 20 of 22 are fixed.
  - F-023, F-024 and F-025 say "not fixed", but #2981, #2982 and #2983 fixed them.
  - The README count is 22; the register has 26.
- **eval-clinica:**
  - F-009 is marked "fixed" but still crashes.
  - F-008 is marked "unowned", but M-T5.31 owns it.
  - F-018 is marked "open #2980"; #2980 merged.
  - The header tallies don't match the body.
- **eval-claims:** says "15 of 17 closed". The truth is 12 fixed, 1 missioned, 1 declined, 3 open.
- **Commons audit:**
  - The header says 22 findings and S1 ×10; the table has 23 rows with S1 ×11.
  - The audit and `coverage.md` say "F-018 is the only open row"; F-008, F-009 and F-019 are open too.
  - D-1 and D-4 are listed as "deliberately not fixed", but both were fixed.
- **Clearline FIX-REGISTER:**
  - F-004 is called "a language decision"; it was a validator bug, fixed in #2911.
  - F-020 and F-035 are attributed to PRs that explicitly didn't fix them.
- **Testability fleet plan:** says "every one of F1–F12 is merged, in flight, or owner-deferred". Four follow-ups declared in its own PRs were never missioned.
- **claimshub doc:** D1, D2 and D4 are marked "open, not merged". All three merged on 09-13.

**`docs/new-plan/coverage.md`:**

- **eshop row:** P7 and P11 are called open; both are fixed (#2900, #2901). P8 is mapped to #2876 but is #2902. The count "D1–D10/P1–P11" stops at P11; the body runs to P13.
- **claimshub row:** "all still open"; all are merged.
- **freight row:** cites M-T2.15, M-T6.63/64/65, M-T6.67a, M-T1.33/34, M-T5.30, M-T9.59 and M-T9.60, none of which exists as a heading. The fixes did land (#2875–#2914).
- **testability rows:** F3 is called in flight, but #2967 and #2997 are merged. F12 is omitted. F58 is mapped to M-T6.60 but is M-T6.62.

**Mission bookkeeping:**

- **Mission ids used twice:**
  - M-T9.59 names both a landed gate and a live mission.
  - M-T2.16 names both #2895 and the live `ddd diff` mission.
  - M-T1.32–34 and M-T5.30 are cited in the fleet plan and commits for work that now carries unrelated live headings.
- **Stale mission statuses:**
  - M-T1.31 is `open`, but #2860 merged.
  - M-T9.47 is `open`, but heading ids already exist.
  - M-T6.62 still says `in-flight`.
  - M-T6.56 still says `open`, though only residue remains.
  - The M-T3.19 heading still says "says nothing", though its warning landed.

**Ids and links:**

- **Finding ids collide across registers.** For example, "F-004" and "F-012" mean different defects in five registers. PR titles #3048 and #3049 use ids that match nothing on main. Future registers should carry a prefix (`CARGO-F-004`).
- **Broken links:**
  - `eval/FINDINGS.md` cites about 14 repro files that are only on `bxc2c6`.
  - `eval/fieldops-audit/*` links `fix-plans/`, `matrix/` and `evidence/` at the wrong level.
  - `eval/evidence/README.md` uses FieldOps numbering inside the Commons tree.
  - The eval-clinica `repro/*.ddd.txt` files crash `ddd parse` (".txt has no services").
- **Unresolved field-test mission ids.** The 13 `M-FT.*` ids are still undefined. Two carry real deferred work with no owner:
  - M-FT.5: the `Action` toast / parameterless-op affordance, deferred by #2746.
  - M-FT.24: the union wire shape and OpenAPI union document, deferred by #2744.

## 5. Recommended next steps

1. **Mission the silent-output items:** mission §2a #1–#19 in `docs/new-plan/` (T6 backend parity, T2 migrations, T5 language). Priorities:
   - #1, #2, #3, #4 and #6 are S1 or default-posture;
   - #19 (`tsc` in the node build) would have caught several others.
2. **Decide the security posture:** turn §2b into one decision packet (403 echo, `aud` default, list route under `denyByDefault`, lockfiles, restart policy).
3. **Port the unmerged registers:** port the §1 registers, add the eval-clinica and new rows to `coverage.md`, and fix the §4 claims (a docs-only `status-refresh` pass).
4. **Clear the stuck PRs:** close or rescope #2947, #2948, #2949, #2966 and #2969; pick one of #2977, #2978 and #3058; unblock #3040, #3043, #3048 and #3049.
5. **Make a stale register impossible:** a `test/system` gate that every `eval*/FINDINGS.md` header tally equals the count of its `### F-` headings. The same drift happened in five registers.

## Per-register detail

| file | register |
|---|---|
| [commons.md](commons.md) | `eval/` (Commons) + `docs/audits/2026-09-13-commons-dev-experience.md` |
| [fieldops-audit.md](fieldops-audit.md) | `eval/fieldops-audit/` (+ FIX-PLAN, fix-plans A–J) |
| [eval-fieldops.md](eval-fieldops.md) | `eval-fieldops/` |
| [clinica.md](clinica.md) | `eval-clinica/` |
| [dx-audits.md](dx-audits.md) | 09-10 eshop / claimshub / freight / independent-completeness audits |
| [testability.md](testability.md) | 09-13 testability audit, F1–F12 / P1–P11, the M-FT register |
| [pr-sweep.md](pr-sweep.md) | PR bodies since 08-28: promises, stale and duplicate claims |
| [unmerged-eval-platform.md](unmerged-eval-platform.md) | `eval-platform/` (branch only) |
| [unmerged-eval-cargo.md](unmerged-eval-cargo.md) | `eval-cargo/` (branch only) |
| [unmerged-eval-claims.md](unmerged-eval-claims.md) | `eval-claims/` (branch only) |
| [unmerged-eval-council.md](unmerged-eval-council.md) | architecture-council `eval/` (branch only) |
| [unmerged-eval-clearline.md](unmerged-eval-clearline.md) | FieldOps + Clearline `eval/` + FIX-REGISTER (branch only) |
| [unmerged-eval-commons-pass2.md](unmerged-eval-commons-pass2.md) | Commons second-pass delta |
