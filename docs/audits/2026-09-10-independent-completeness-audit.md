# Independent completeness audit — 2026-09-10

*Commissioned as a **fresh** audit: every existing `docs/audits/` file was deliberately
left unread, so nothing below is inherited. Every claim was measured on `main` @ `42fce9e`
(2026-09-10) with the command shown beside it. Where a finding turns out to match a mission
that already exists, that is said plainly — the point of an independent pass is to show
which parts of the plan survive being re-derived from scratch, not to pretend novelty.*

**Re-based four times** — onto `93bc82d`, `bcc1c4c8`, `c0b5ca1f` and finally `d6192914`, as `main`
moved 21, 7 and 53 commits under this branch in turn. Every finding was re-measured on each new head;
the two that moved (F6, and the M-T9.22 row in §4.2) say so. The first rebase brought in a third
2026-09 plan,
[`completion-waves-2026-09.md`](../new-plan/completion-waves-2026-09.md), authored independently
and merged about three hours earlier. §4.0 reconciles the two.

**Verdict.** Loom is a finished *compiler* wrapped in an unfinished *product*. The pipeline,
the target matrix and the gate discipline are in better shape than the mission count
suggests: 49 of the 61 register "gaps" cannot fire on any shipping target, the frontend
walker is at parity on 54 of 56 primitives, the fast suite is clean, and a 1,039-line model
generates 753 files in 2.5 s. What is missing splits three ways — a **measurement layer that
cannot see its own blind spots**, a **release/product surface that does not exist at all**,
and one **portability bug class** that no instrument in the repo is shaped to catch.

---

## 1. Method

| Sweep | Command | Result |
|---|---|---|
| Source size | `find src -name '*.ts' \| xargs wc -l` | 884 files, 351 k LOC |
| Marker debt | `grep -rE '\b(TODO\|FIXME\|HACK\|XXX)\b' src` | 46 hits, 41 of them prose |
| Diagnostic surface | `grep -rhoE '"loom\.[a-z0-9-]+"' src \| sort -u` | 493 codes |
| Honest gaps | `src/diagnostics/unsupported-register.ts` | 61 rows — 49 `gap`, 11 `scope`, 16 `verified` |
| Skipped tests | `grep -rE '(it\|test\|describe)\.(skip\|todo)' test` | 7, all reasoned |
| Corpus parse | `ddd parse` over every repo `.ddd` | 1 failure (`examples/sales-ui.ddd`) |
| Generation | `ddd generate system examples/showcase.ddd` | 2 487 ms, 753 files, 4.5 MB |
| Deep fuzz | `LOOM_FUZZ_DEEP=1 LOOM_FUZZ_DEEP_N=400 npm run test:fuzz-deep` | **RED**, 3 seeds |
| Advisories | `npm audit` | 11 (4 high), all in the dev tree |

---

## 2. What is genuinely finished

Recording this matters, because the live-mission count (153) reads as a much less complete
system than the code is.

- **The register's gap count overstates the gap surface by roughly 5×.** Of the 49 `gap`
  rows, the per-backend support sets in `src/ir/validate/checks/` are `{node, dotnet, elixir,
  java, python}` — all five — for event sourcing, provenance, audit, TPH, filter bypass,
  paged query handlers, projection group-by, projection aggregation and query-time
  projections. Those gates are **latent**: they are seams a sixth target would trip, and the
  matrix is frozen, so no sixth target is coming. Two sets are genuinely short:
  `PROJECTION_DOCUMENT_AGG_SUPPORTED` omits `java`, and `AUDITED_RETURNING_UNSUPPORTED`
  is `{node}`.
- **Frontend primitive parity is effectively closed.** 56 primitives in
  `_walker/registry.ts`; every one carries both a `tsx` and a `heex` renderer except
  `DataGrid` (a reasoned refusal under D-DATAGRID-TARGETS) and `Tab` (rendered inside
  `Tabs`). Flutter's residue is four form-field shapes, frozen with reasons.
- **Marker debt is near zero.** Of 46 TODO-family hits in `src/`, 41 are prose *about* TODO
  handling (the Elixir emitters explaining why they have no `# TODO` fallthrough, the i18n
  `TODO:` placeholder prefix, the migration backfill recipes). Five are live deferrals, all
  Flutter, all loud.
- **Generated output is clean.** Generating `showcase`, `acme` and `storefront-system` and
  grepping the 1,153 emitted files for `loom:unrendered`, `unresolved:`, `TODO(flutter …)`
  and `TODO: method-call` returns **nothing**.
- **Compiler performance is a non-issue.** 2.5 s for the largest model; `tsc -b` in 24 s.
- **Regeneration safety exists.** `.loomignore`, scaffold-once preservation and protected
  families (migrations) are all in the write phase — a regen over a customized tree does not
  clobber.

---

## 3. Findings

Ordered by how much of Loom's promise each one blocks.

### F1 — A backend refuses an ordinary DDD model on naming grounds, and no instrument owns it · **P1**

An aggregate that carries **both** a field named `amount` **and** a field typed by a value
object named `Amount` is refused on .NET and accepted on the other four backends.

```
# reproduced from scratch, /tmp/f45.ddd
valueobject Amount { scale: int }
aggregate Claim with crudish { amount: decimal  price: Amount }
deployable d { platform: dotnet … }     → loom.dotnet-name-collision  (1 error)
deployable d { platform: java   … }     → OK
deployable d { platform: node   … }     → OK
```

The diagnostic's own advice is *"rename the declaration … or host this context on a node /
python / elixir / java deployable"* — that is, **move off .NET**. A `Money`/`Amount` value
object beside a scalar amount is the single most canonical DDD shape there is;
`examples/acme.ddd` only escapes because its value object is called `Money`.

The real defect is in the C# emitter, not the model: the generated class references the type
by *simple* name, so a same-named member hides it. Emitting the type qualified removes the
refusal entirely.

**Why nothing owns it.** `loom.dotnet-name-collision` carries a `-collision` suffix, and the
`*-unsupported` register — the repo's only drain instrument for target gaps — is scoped **by
suffix**. So a per-target refusal wearing any other suffix is structurally invisible to the
one list that exists to drain per-target refusals. Grepping the register and every track file
for the code returns nothing.

### F2 — The register's membership rule is a naming convention, which its own header says cannot work · **P1**

`unsupported-register.ts` opens by arguing, correctly, that *"NO NAMING CONVENTION separates
these"* — and therefore writes `kind` down per row as a reviewed field. But **membership** in
the register is still decided by the code's suffix. Two consequences, both measured:

- `loom.dotnet-name-collision` (F1) — a target refusal, no row.
- `loom.user-component-deferred-target` — Angular and Feliz refuse a user component
  declaring `slot`/`action` params (no `ngComponentOutletInputs` projection channel; no F#
  props-record spelling). It is pinned as a gap in
  `test/conformance/frontend-showcase-render.test.ts`, and it is a **seventh** row on exactly
  the axis M-T1.20 enumerates as "the five rejections outside the pack matrix" — which lists
  six and not this one.

The fix is to make membership the same kind of reviewed predicate the `kind` field already
is: *does this code refuse an otherwise-valid model on one target?* — then gate that the
answer is recorded for every code, not just the suffixed ones.

### F3 — The generative fuzzer is built, finds real defects, is red, and runs nowhere · **P1**

M-T9.22 (*"Generative compiler-robustness fuzzing"*) is statused **`open` — "no code yet"**.
The code exists: `test/system/pipeline-fuzz-deep.test.ts` plus a model generator and a
shrinker under `test/_helpers/`. It works — it produced F1 unprompted, with a shrunk
20-line corpus-ready repro and a replay seed.

Three things are wrong at once:

1. **It is red on `main`.** 400 seeds → 3 failures (seeds 45, 70, 115), all F1.
2. **No workflow runs it.** `grep -rn fuzz .github/workflows/` matches only Schemathesis.
   The one tier that explores the *input space* rather than a fixture list is unwired.
3. **Its triage misattributes the class it found.** The failure reads *"the GENERATOR emitted
   an invalid model. Fix `test/_helpers/ddd-model-generator.ts`"* — so the next author is
   pointed at teaching the fuzzer to avoid the name `Amount`, rather than at the .NET
   emitter. A model that one backend refuses and four accept is a **backend** finding; the
   harness's tier ladder has no rung for it.

### F4 — Loom cannot be installed · **P1 for "done", P3 for engineering**

Nothing in the repo produces an artifact anyone outside it can consume.

| Signal | State |
|---|---|
| `package.json` version | `0.1.0`, unchanged |
| `files` / `exports` / `publishConfig` | absent — a publish would ship the whole tree |
| `repository` field | absent |
| Publish workflow | none of the 67 workflows publishes anything |
| `packages/*` versions | all six at `0.0.0-experimental` |
| `vscode/` extension | complete manifest, `0.1.0`, never packaged or published |
| Changelog / release notes | none at repo root |

Everything a user needs is *built* — a CLI, an LSP server, an MCP server, a DAP server, a
VS Code extension, six workspace packages. None of it is *shipped*. M-T8.7 covers the
packaging **split** (moving `platform/hono/v*` into `packages/`) and is `blocked(browser
discovery)` at P3; release engineering itself is covered nowhere.

### F5 — No dependency-advisory or freshness gate exists on either surface · **P2**

`npm audit` reports **11 advisories, 4 high** (`fast-uri`, `ip-address`, `nanoid`,
`postcss` — all transitive dev-tree, so no user is exposed today). More consequential is that
nothing would ever tell you:

- No `dependabot.yml`, no Renovate config.
- No `npm audit` / OSV / Trivy / CodeQL step in any workflow.
- The **generated-app** stacks are pinned by hand and have drifted apart: `stacks/v1` still
  emits **React 18.3 + zod 3.23**, `stacks/v3` emits React 19.2 + zod 4. Four shipping design
  packs — `chakra/v2`, `mantine/v7`, `mui/v5`, `shadcn/v3` — resolve to `v1`, so **choosing
  one of those packs silently gives you a two-major-old React app.**

The repo has a `dependency-upgrade` skill describing how to land a bump correctly. There is
no gate that says a bump is *due*.

### F6 — A gate that scanned 29 % of what it names, and passed green · **P0 — fixed mid-audit; the class is not**

Independently reproduced: `test/system/walker-give-up-routing.test.ts` enumerates via
`git ls-files 'src/generator/<t>/**/*.ts'`. Git's default pathspec is `wildmatch` without
`WM_PATHNAME`, so `**/` still requires a following `/` — the pattern matches subdirectories
only.

```
git ls-files with the four globs as written        →  28 files
same trees with both '<t>/*.ts' and '<t>/**/*.ts'  →  96 files
npx vitest run test/system/walker-give-up-routing  →  3 passed
```

**Fixed on `main` by #2843 while this audit was being written** — `WALKER_GLOBS` now carries both
entries per tree, the scan reaches **140** files, and the 28 sites are drained (`NOT_A_GIVE_UP` is
down to the helper itself). It is kept here for two reasons. An independent pass re-derived it in
one command, which is the argument for F7. And **the fix did not close the class**: the repaired
gate still asserts no denominator, so the same pattern narrowing again would pass green a second
time. That is F7, and it is sharper now than when it was written — the instance was fixed and the
shape was not.

### F7 — No gate proves its own denominator · **P1**

F6 is one instance of the repo's most expensive recurring shape (`experience_gathered.md`
§59, §63): *a check that never reaches the thing it names*. The repo has ~40 census/ratchet
gates, and each computes a file set, a call-site set or a code set — the **numerator** is
asserted everywhere, the **denominator** almost nowhere. A one-line assertion per gate ("this
scan reached N files / N call sites, and N is pinned") would have failed F6 on the commit
that introduced it. The same shape audited the other `git ls-files` users:
`inline-ddd-source-census` and `ddd-source-census` are fine, but by luck of pattern, not by
construction.

### F8 — Verification tiers exist that CI can never run · **P2**

Three workflows are in neither the per-PR set nor the merge queue — `channels-e2e`,
`api-call-e2e`, `phoenix-ui-e2e` — a blind spot CLAUDE.md already documents. Independent
additions: `test:fuzz-deep` (F3) is in **no** workflow at all, and 13 corpus fixtures are
waived out of the runtime leg by `E2E_LESS_CORPUS_FIXTURES` — including `channels-broker`,
`outbox`, `resources`, `api-call`, `tenancy-hierarchy` and `extern`, i.e. six of the features
most likely to be wrong at runtime rather than at compile time.

### F9 — The corpus is heavily skewed toward one frontend · **P2**

Declarations across all 280 repo `.ddd` files:

| target | node | elixir | dotnet | java | python | react | svelte | vue | flutter | feliz | angular |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| count | 93 | 87 | 50 | 42 | 35 | 34 | 9 | 6 | 3 | 2 | 2 |

Backends are within 2.7× of each other. Frontends span **17×**. The two self-hosting
frontends — Feliz and Flutter, the two that M-T1.20 itself identifies as carrying most of the
remaining risk *because* the per-pack build matrices cannot see them — are the two with the
thinnest corpus. A per-target corpus floor would make the skew fail rather than accumulate.

### F10 — `.ddd` has three writers and no canonical form · **P2**

Source is written by humans, by `ddd patch` (the AI authoring loop) and by the visual
builder. There is no formatter: no `ddd fmt`, no `DocumentFormattingProvider` in
`src/language/lsp/`. The infrastructure is already there — `src/language/print/` is a
complete AST→source printer, gated for completeness and round-trip safety, and already drives
the LSP unfold-macro action. T8 notes in passing that *"`ddd fmt` stays a separate future
proposal"*; nothing carries it. For a language whose thesis is that one model is edited three
ways, a canonical form is not cosmetic — it is what stops the three writers producing diffs
against each other.

### F11 — `wire-spec.json` is emitted and nothing consumes it · **P2**

`docs/loom-artifacts.md` describes it as *"diffable — wire-contract drift between regens shows
up as a clean JSON diff"*, and it carries enum members precisely so a removal moves the file.
But no command reads it back. The CLI has 17 commands and none of them compares two versions
of a model. Searching every track file for "breaking change", "wire compat", "backward
compat" and "semver" returns **zero** matches. So the artifact that knows whether a model edit
breaks existing clients is a file a human is expected to eyeball.

### F12 — `examples/sales-ui.ddd` still does not parse · **P2 (already owned)**

Confirmed independently: 7 syntax errors from line 133. Every other `.ddd` in `examples/` and
`web/src/examples/` parses clean. This is M-T9.51, `open`.

### F13 — 45 of 61 register rows have an unreviewed classification · **P3**

`verified: true` appears 16 times. The register's own header says rows land `false` and are
promoted on review, so this is a known state — but it means the instrument that decides what
"gap" means has had a quarter of its rows checked.

---

## 4. Comparison with the planned missions

### 4.0 Reconciling with `completion-waves-2026-09.md`

That plan and this audit were written the same day without knowledge of each other, from
opposite ends: it counts **denominators that must read zero**, this one asks **what is missing
that nothing counts**. They agree where they overlap, and the overlap is worth stating because
its numbers are better than this audit's.

**Where its measurement supersedes mine.** §2 of this doc says 49 of the 61 register `gap` rows
cannot fire on any shipping target. The completion plan's §1 does the same split properly and
records it as a schema change: **24 LIVE · 20 LATENT · 3 CONFIG · 2 dormant · 1 settled**, with
"done" defined as LIVE = 0 and LATENT re-classed to a `seam` kind so `MAX_OPEN_GAPS` stops
counting seams as gaps. **Use its numbers.** The independent corroboration is still worth
something — two passes, no shared source, same conclusion that the headline gap count overstates
the gap surface by roughly 5× — but the classification belongs to that plan.

Likewise `loom.user-component-deferred-target`: this audit found it as an unowned *seventh*
rejection on M-T1.20's axis (F2); the completion plan already tracks the same code as a
denominator row (**~23 pins — feliz 10 · angular 4 · flutter 5+**, target zero). That row is the
better instrument. What survives from F2 is not the instance but the **entry rule**, which its
§1 does not touch: the register decides membership by suffix, so this code has a denominator row
in one plan and no register row in the other — and `loom.dotnet-name-collision` has neither.

**Where this audit adds rows its §1 table does not have.** Five of its denominators would still
read zero with every finding below unfixed, because nothing counts them:

| This audit | Why the completion plan's §1 cannot see it |
|---|---|
| F1 · the .NET name collision | A `-collision` code, so it is in no register; and it is a *refusal*, not a silence, so §18's silent-sentinel row does not reach it either |
| F4 · nothing is installable | Its Wave C6 disposes of PRODUCT *missions*; publishing is not a mission, so there is no row to disposition |
| F5 · no advisory or freshness gate | No dependency row in §1 at all, on either surface |
| F7 · gates that assert no denominator | §1 *is* a table of denominators — and none of them is asserted by the gate that computes it. F6's fix is the proof: repaired, still unpinned |
| F11 · nothing reads `wire-spec.json` | It is an emitted artifact, not a register, so it has no "reads zero" form |

F3 is the interesting middle case. The completion plan's Wave C3 is "verification that sees
runtime values" and does not mention the generative fuzzer, because M-T9.22 says `open` — the
plan believed its own tracker. The fuzzer exists, is red, and found F1 unprompted. A plan built
on a §1 table inherits every mis-status in the track files, which is the argument for keeping an
audit that measures the code instead.

**Net effect on the wave plan.** Nothing here reorders it. M-T6.69 belongs in **Wave C1** beside
the other P0 miscompiles (it is one, and it gates the fuzz leg); M-T9.59 in **C2**, since it
decides what "nothing unsupported per target" is even counting; M-T9.64 and M-T9.62 in **C3**;
M-T9.61, M-T9.63 and M-T2.16 in **C4**; M-T8.24 and M-T8.25 are **C6** product rows, and M-T8.24
in particular is the one C6 row that no owner triage covers today.

### 4.1 What the plan already has right

The roadmap survives an independent re-derivation better than most. F6 (M-T9.55, merged),
F12 (M-T9.51), the Flutter form-field tail (M-T1.18 M-A), the persistence-adapter subset
(M-T6.35), the projection group-by/document holes (M-T4.2), the `envelope` divergence
(M-T6.57, PR #2852), the workflow-`create` miscompile (**M-T6.62** — renumbered from M-T6.60
on `main` after two headings collided on one id; PR #2850) and the `match` error-binding drop
(M-T6.61, **merged as #2857** during this audit) were all found or confirmed and all already
have owners.

The waiver files are the strongest artifact in the repo: `KNOWN_HEEX_GAPS` and
`KNOWN_FLUTTER_GAPS` carry arguments, not excuses, and one of them documents its own
previous reason as *"partly FALSE"* and quotes it. That is unusual and worth keeping.

### 4.2 Where the plan is mis-statused

| Mission | Says | Measured |
|---|---|---|
| **M-T9.22** | `open` — *"no code yet"* | The generator, shrinker and deep leg all exist and work; the leg is **red** and unwired. *(Re-statused to `partial` on `main` on 2026-09-11, independently of this audit — so this row is now history, not a live correction. The leg is still red and still runs in no workflow: that is M-T9.64.)* |
| **M-T1.20** | *"the five rejections"* (lists six) | `loom.user-component-deferred-target` is a seventh on the same axis. |
| **M-T9.27** | register `partial`, slice 4 open | The remaining slice is not "drain the rows" — it is that the **membership rule is wrong** (F2). Draining every suffixed row leaves F1 untouched. `completion-waves-2026-09.md` §1 re-counts the rows correctly and still inherits the entry hole. |

*(PR #2856, open at the time of writing, flips 27 further mission statuses that had already
been finished — so tracker lag is a live, known condition, not a claim of this audit.)*

### 4.3 What no mission covers

| # | Finding | Nearest mission | Why it is not covered |
|---|---|---|---|
| F1 | .NET name-collision portability break | — | Wrong suffix for the register; no track file cites the code |
| F2 | Register membership is suffix-scoped | M-T9.27 | That mission drains rows; it does not question the entry rule |
| F4 | Loom cannot be installed | M-T8.7 (P3, blocked) | Covers the packaging *split*, not versioning, publishing or release |
| F5 | No advisory / freshness gate | — | The `dependency-upgrade` skill says *how*; nothing says *when* |
| F7 | No gate proves its denominator | M-T9.8 (recurring) | An adversarial sweep finds instances; nothing makes the class structurally impossible |
| F9 | Frontend corpus skew | M-T9.29, M-T9.42 | Both work the census/promotion axis; neither sets a per-target floor |
| F10 | No `.ddd` formatter | — | Explicitly named as "a separate future proposal" and never minted |
| F11 | No wire-compat command | — | Zero matches for the concept anywhere in the plan |

---

## 5. Proposed additions

IDs were re-derived on every rebase against `main`'s docs, `main`'s commit log and every open
PR title — the last of those matters, because two ids this branch had already taken were claimed
elsewhere between pushes (`M-T6.63` by a stub claim commit timestamped seven minutes before this
branch's first push, `M-T9.60` by PR #2888). This is the third renumbering, and the reason is
worth recording for the next agent: **a mission id is claimed by a PR title or a stub commit long
before it is a heading**, so a scan of `docs/new-plan/` alone reports an id free when it is not.
The runbook's verify-free-at-mint step means all three sources, not the track files.

### M-T6.69 — The .NET simple-name collision is an emitter bug, not a naming rule · **S–M** · **P1**
Emit the C# type reference qualified (namespace-qualified or via a `using` alias) at the sites
`system-checks.ts` guards, so a field named `amount` can coexist with a type named `Amount`.
Then **delete the gate in the same PR** — a waiver that outlives its cause is the failure this
repo already ratchets against. Mutation-prove by restoring the collision shape and confirming
`dotnet build` fails without the fix and passes with it. Corpus fixture: seed 45's shrunk
model, verbatim, compiled on all five backends. Closes F1; unblocks the fuzz drain in F3.

### M-T9.59 — The `*-unsupported` register cannot see a target gap that wears another suffix · **M** · **P1**
Re-scope register membership from *suffix* to the reviewed predicate the file's own header
argues for: **does this code refuse an otherwise-valid model on one target?** Concretely:
(1) classify all 493 `loom.*` codes once, into `target-refusal` / `misuse` / `impossible` /
`no-effect`; (2) admit every `target-refusal` to the register regardless of suffix — starting
with `loom.dotnet-name-collision` and `loom.user-component-deferred-target`; (3) extend
`test/system/unsupported-register.test.ts` so a code whose message names a single target and
has no row **fails**, closing the entry hole rather than the exit one. 23 codes name a target
in their catalog message today and sit outside the register; most are genuine misuse errors,
which is exactly why the classification has to be reviewed and written down. Closes F2, and
makes F1's class findable next time. Relates to M-T9.27 (this is its slice 4, re-aimed) and
M-T9.56 (the other "the code identity is not carrying its weight" mission).

### M-T9.64 — Wire the deep fuzz tier, fix its triage, drain its findings · **M** · **P1**
Three slices. (1) **Fix the tier ladder**: a model that one backend refuses and four accept
must classify as a *backend* finding, not as "fix the model generator" — today the harness
sends the author to the wrong file. (2) **Turn it green**: seeds 45/70/115 all reduce to F1,
so M-T6.69 closes them; re-run at 400 seeds and pin the seed count. (3) **Run it**: a nightly
workflow with the seed in the failure output and a `ci-red-alarm` registration, so a red night
is visible. Re-status **M-T9.22** as `partial` in the same PR — its code exists. Closes F3, F8
in part.

### M-T8.24 — Loom cannot be installed: the release surface · **M** · **P1 for "done"**
The smallest set that makes the toolchain consumable: a real version and a changelog; `files`,
`exports`, `types`, `repository` and `engines` on the root manifest; a `npm pack` smoke that
asserts the tarball contains `bin/`, `out/`, `designs/`, `stacks/`, the top-level `.hbs`
trees and **no** `test/` or `.claude/`; a tag-driven publish workflow (`--dry-run` until an
owner flips it); the six `packages/*` off `0.0.0-experimental` onto a shared version policy;
and `vsce package` for the VS Code extension as a release artifact. This is the single largest
"done" gap and it touches no generator code. Closes F4. Distinct from M-T8.7, which is the
*module-boundary* work and stays blocked.

### M-T9.61 — Nothing says a dependency bump is due · **S** · **P2**
Two halves, matching Loom's two surfaces. **Toolchain:** a Dependabot (or Renovate) config
plus an `npm audit --audit-level=high` step that fails the build, with an explicit,
expiry-dated waiver file for accepted dev-tree advisories. **Generated apps:** a freshness
ratchet over `stacks/*/stack.json` and the backend-package pins that fails when a pinned major
falls more than one behind latest — which today would fire immediately on `stacks/v1`'s React
18.3 and zod 3.23, and name the four design packs still resolving to it. Pairs with the
existing `dependency-upgrade` skill, which already knows how to land the bump once the gate
says one is due. Closes F5.

### M-T9.62 — Every census gate asserts its own denominator · **S** to build, **M** to apply · **P1**
The generalization of M-T9.55. Give each census/ratchet gate a pinned scan-size assertion —
"this scan reached N files (or call sites, or codes), and N is pinned here" — so a pattern
that stops matching fails as a *shrunken denominator* rather than passing green. Then apply it
to the ~40 existing gates, taking the pathspec class first (`git ls-files` with `**` under
git's default non-`WM_PATHNAME` wildmatch is a trap the repo has now hit at least once).
Mutation-prove per gate by narrowing its pattern and confirming the gate fails. Closes F7;
this is the structural version of what M-T9.8 finds by hand.

### M-T2.16 — `ddd diff`: a wire-contract compatibility verdict, not a JSON diff · **M** · **P2**
`wire-spec.json` already carries everything needed (field sets, carriers, enum members in
declaration order) and nothing reads it. Add `ddd diff <old> <new>` — over two `.ddd` sources,
or a source against a `.loom/snapshots/*.loomsnap.json` — classifying each change as
`compatible` / `breaking-for-clients` / `breaking-for-data`, with a non-zero exit on breaking
and `--json` for CI. The classification rules are the ones the emitters already encode
(removing an enum member, narrowing a carrier, dropping a wire field). This is the read side
of the artifact bundle and the thing that lets a team put a model change behind a review gate.
Closes F11. Relates to M-T2.1 (rename intent supplies the "this is a rename, not a
drop+add" signal) and to the migration destructive-gating already in phase ⑨.

### M-T8.25 — `ddd fmt`: one canonical form for a source three things write · **S–M** · **P2**
`src/language/print/` is a complete, completeness-gated AST→source printer already driving the
unfold-macro action. Wrap it as `ddd fmt [--check]`, register a Langium
`DocumentFormattingProvider` so the LSP and the VS Code extension format on save, and have
`ddd patch` and the builder emit through the same printer. Gate with `ddd fmt --check` over
the repo's own `.ddd` corpus. The risk to manage is round-trip fidelity on comments and blank
lines, which `print-structural-roundtrip.test.ts` already partly pins. Closes F10.

### M-T9.63 — A per-target corpus floor · **S** · **P2**
Assert a minimum count of corpus/example declarations per target and fail below it, so the 17×
frontend skew (F9) cannot widen. Set the floor at today's value for the healthy targets and
one above today's for Feliz, Flutter and Angular, so the ratchet forces the gap closed rather
than freezing it. Pairs with M-T9.42's promotion work (which supplies the fixtures) and
M-T9.38 (which supplies the Feliz/Flutter runtime leg those fixtures would then exercise).

### Fold into an existing mission, don't mint

- **M-T1.20** — add `loom.user-component-deferred-target` as the seventh rejection, with the
  Angular/Feliz reason already recorded in `frontend-showcase-render.test.ts`.
- **M-T9.13** — the `E2E_LESS_CORPUS_FIXTURES` drain should be ordered by *runtime risk*, not
  alphabetically: `outbox`, `channels-broker`, `resources`, `api-call` and `tenancy-hierarchy`
  are the five whose failure modes are invisible to a compile gate.

---

## 6. What "done" would mean

[`completion-waves-2026-09.md`](../new-plan/completion-waves-2026-09.md) §1 answers this
mechanically and better than prose can: a table of registers, each with a "done reads" column,
all of them at once, held for two weekly deltas. **That is the operational definition and this
audit does not compete with it.** What follows is the shorter question its table cannot ask —
*done as what?* — because a register can only count things someone thought to count. Five
clauses, from this audit's evidence:

1. **No target refuses a portable model.** Every `loom.*` code is classified once (M-T9.59),
   every `target-refusal` row either drains or is re-argued as a permanent, reasoned refusal
   in the shape of `KNOWN_HEEX_GAPS`. F1 is the proof this clause is not yet met, and the
   proof it is *reachable* — the .NET one is an emitter fix, not a decision.
2. **Every gate reaches what it names.** F6/F7. Until denominators are asserted, no green
   check is evidence, and every other clause on this list is measured with instruments that
   might be reading 29 % of the tree.
3. **The input space is explored, not just the input list.** The corpus proves the models
   someone wrote work. The fuzzer (F3) is the only thing that proves the *unwritten* ones do,
   and it found a real bug the first time it ran unattended.
4. **Someone outside the repo can install it.** F4. Loom is a product with a CLI, an LSP, an
   MCP server, a DAP server and an editor extension, none of which anyone can obtain.
5. **The model is safe to change.** Regeneration already does not clobber (§2), and migrations
   are gated. What is missing is the client-facing half: a compatibility verdict on a model
   edit (F11), and a canonical source form so three writers do not fight (F10).

Clauses 1–3 are about **trusting the matrix**. Clauses 4–5 are about **being a product**. The
completion plan's eight waves are almost entirely clauses 1–3, which is the right order — 4 and
5 are worth nothing on a matrix you cannot trust. But 4 and 5 are also the two clauses no amount
of further mission-draining reaches, because neither has a register that could read non-zero.
Wave C6 disposes of every PRODUCT *mission*; publishing the thing is not a mission, and a
compatibility verdict on a model edit is not a mission. They are the last two rows, and today
they are on nobody's table but this one's.

---

*Evidence for every claim: commands in §1 and inline. Re-run them before acting — `main`
moves.*
