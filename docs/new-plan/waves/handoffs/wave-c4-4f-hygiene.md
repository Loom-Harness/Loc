# Wave C4 · packet 4f — compiler and repo hygiene

Branch: `claude/c4-hygiene`, cut from the C4 coordinator head with 4a/4c/4d/4b/4e folded (`79748472c`).
Plan: [`../../completion-waves-2026-09.md`](../../completion-waves-2026-09.md) §4; wave log [`../wave-c4.md`](../wave-c4.md).
Rules: §3 there (rules 10–18), §3/§3a of [`../../improvement-waves-2026-09.md`](../../improvement-waves-2026-09.md), and the packet's COMMON RULES — plus 4b's absolute `test/` typecheck gate and 4c's absolute `code:` gate, both honoured throughout.

---

## Outcome in one line

**Five and a half of eight rows BUILT, two and a half DECLINED with the measurement — and every decline names what blocks it, not "too big".** Row 1 (M-T9.53) closed and found a **fourth** NUL the mission never named. Row 2 (M-T5.16) found a **third** parallel walker the mission never named, and measured the `unknown` cascade at **60.9 %** of corpus expressions. Row 3 (M-T9.4) shrank the residue from five items to **one**, by re-verifying each on this tree. Rows 7 and 8 shipped (`next-mission-id.mjs`, the merged-tree push preflight, biome-over-config-JSON). Rows 4, 5 and 6 are declined with the exact blocker — an owner fork, the proposal's own unresolved OQ1/OQ2, and a fence boundary respectively.

**Emission is BYTE-IDENTICAL across the whole packet**: `scripts/capture-corpus-snapshot.mjs` over the base tree vs the final tree — **395 cells / 26 534 emitted files, zero differences**.

---

## Row-by-row

| row | mission | outcome |
|---|---|---|
| 1 | M-T9.53 | **BUILT** — `open` → `done`. 4 NUL bytes escaped + a repo-wide gate, mutation-proved. |
| 2 | M-T5.16 | **BUILT (a)(c), MEASURED (b)** — `open` → `partial`. Three walkers made exhaustive; cascade census at 60.9 %; LSP-rebuild idempotence pinned. |
| 3 | M-T9.4 residue | **RE-VERIFIED** — 5 items → 1. A5 alone open, re-sized S → L with the count. |
| 4 | M-T9.5 `stacks/` move | **DECLINED** — owner fork + measured blast radius. |
| 5 | M-T5.9 | **(a) HALF-BUILT** — the missing denominator shipped (27 of 330 IR fields unread by any emitter, 3 confirmed); the rows are 4c's fence. **(b) DECLINED** — blocked on the proposal's own OQ1/OQ2. |
| 6 | M-T1.13 | **DECLINED** — fence: it deletes an emission path, and 4f's fence is byte-identical `src/generator/**`. |
| 7 | M-T8.9 + M-T9.32 | **BUILT** — biome over config JSON; the next-free-id check across open branches. |
| 8 | improvement-waves 4.1 | **BUILT** — the push hook typechecks the MERGED tree. |

---

## Row 1 — M-T9.53: four files were invisible to `grep`

**The count was four, not three.** The mission named three `src/` files; the repo-wide scan found a fourth on its first run.

| file:line | expression |
|---|---|
| `src/system/migrations-builder.ts:581` | `` `${schema ?? ""}\0${name}` `` |
| `src/ir/util/policy-decision-id.ts:43` | `` `${target}\0${gateSource}` `` |
| `src/ir/validate/checks/structural-checks.ts:1426` | `` `${location}\0${resourceName}.${verb}` `` |
| `scripts/quality-delta.mjs:457` | `const FIELD = "\0"` |

Each was a deliberate composite-key separator written as the BYTE. The fix is textual and the runtime string is provably identical (`\0` denotes U+0000; asserted directly, and the 395-cell corpus snapshot is byte-identical), which is exactly why it was easy to leave alone — and why a gate, not a sweep, was the deliverable.

**The gate:** `test/system/nul-byte-census.test.ts`. No tracked file under `src/`, `test/`, `docs/` or `scripts/` may carry a NUL, **exact at zero with no waiver list** — those four roots are text-only by construction (images and fonts live in `web/`, `designs/` and the template dirs, outside the scanned set). Three assertions:

1. a vacuum guard that pins the four named files INTO the scanned set (a future root-list edit cannot drop them while the gate still reads green);
2. a probe proving BOTH halves of the rule on a purpose-written pair — the scan fires on the NUL-bearing file, AND `grep -lI` returns only the clean twin although both contain the searched text;
3. the live census.

**Mutation proof** (file copy, never `git checkout --`): re-seeding the raw NUL into `policy-decision-id.ts` fails *"no tracked source file carries a NUL byte"* with `src/ir/util/policy-decision-id.ts:43 — 1 NUL byte(s), first at offset 2176`. Restored from the copy; green.

**Why it mattered**, in the packet's own words: 4e's consumer sweep over `src/ir/validate/**` returned `grep: … binary file matches` for `structural-checks.ts` — a *line of output*, not a row of results — so the file dropped out of that census with nobody noticing.

---

## Row 2 — M-T5.16 (a)(b)(c)

### (a) There were THREE parallel walkers, not two — `src/language/type-system.ts`

`typeAfterSuffix` (postfix member type), `stepInto` (member type along a dotted path) and `stepIntoNode` (the member's AST node, for go-to-definition) all answer the same question and were all `if (t.kind === …)` chains falling through to a silent `T.unknown` / `undefined`. The mission named two.

**The divergence was already real and recorded nowhere:** `userclaim`, `id`, `array` and `primitive` resolve members on `typeAfterSuffix` and resolve to `unknown` on `stepInto`.

All three are now `switch (t.kind)` over every `DddType` member with a `const _exhaustive: never` default (the `src/ir/util/walk.ts` idiom). Arms are a behaviour-preserving transcription — every kind returns exactly what it returned before — and the kinds with no member surface carry an explicit arm saying so rather than vanishing into a fallthrough. The divergence itself is now data: `MEMBER_RESOLVING_KINDS`.

**Mutation proof** (file copy): adding `| { kind: "probe"; … }` to `DddType` fails `tsc -b` at all three sites at once —

```
src/language/type-system.ts(1209,13): error TS2322: Type '{ kind: "probe"; … }' is not assignable to type 'never'.
src/language/type-system.ts(1845,13): …
src/language/type-system.ts(2261,13): …
```

— and fails `test/language/type-system/walker-exhaustiveness.test.ts` three times with *"`<walker>` has no `case "<kind>":` arm … ['probe']"*. The runtime test also pins the resolving sets against `MEMBER_RESOLVING_KINDS`, catching the other failure mode the `never`-check cannot: someone satisfying `tsc` by dropping a new kind into the trailing "no member surface" arm without deciding whether it has members.

### (b) The `unknown` cascade — measured, not narrowed

`test/system/unknown-cascade-census.test.ts`, two halves:

- **21 suppression sites across 6 files** on an exact shrink-only baseline (`statements.ts` 8, `types.ts` 7, `_shared.ts` 2, `type-system.ts` 2, `builder-call.ts` 1, `template.ts` 1), with an anti-slack arm so a narrowed site must lower its row in the same change. **Mutation-proved** by seeding a `kind === "unknown"` into `validators/repository.ts`: *"New `kind === \"unknown\"` cascade suppression(s) in a file that had none … ['src/language/validators/repository.ts']"*.
- **The measurement: 28 333 of 46 492 expression nodes across `examples/` + `web/src/examples/` — 60.9 % — type as `unknown`**, by node type `NameRef` 13 886, `PostfixChain` 11 773, `Lambda` 1 198, `BuilderCall` 801, … Banded both ways (0.50–0.66) so a rise is a regression and a fall must be banked.

**Read the number honestly, and it is two findings.** The env is `envForNode`, the SHARED env builder, which documents its own approximation ("`let` bindings are typed `T.unknown` for simplicity") — so this is an UPPER BOUND on what the validators suppress, since a validator that builds its env inline sees fewer. But every LSP hover / completion / go-to-definition consumer reads that same env, so the coarse env and the suppression compound: the env produces the placeholder and the suppression turns it into silence.

### (c) Macro expansion under an LSP rebuild — #22 does not reproduce, and now there is a pin

`test/macro/expansion-rebuild-idempotence.test.ts` drives the real `DocumentBuilder` (`NodeFileSystem`, a temp workspace) through the three rebuild shapes an editor produces: host re-edited, SIBLING edited with the host untouched, sibling removed and restored. Invariant: the spliced member count is stable.

**Measured:** on Langium 4 a sibling-triggered rebuild REPLACES the host's AST object, so the expander never re-runs over already-expanded members. The test records which regime it observed in its own failure message, so if a future Langium reuses the AST the pin becomes the live guard rather than a forward one.

**Mutation proof — and the shape of it is the finding.** A single seeded double-`expandModel` call did NOT fail the test: `mergeScopedMembers`'s scope-local override-by-name suppression absorbed it. Only with BOTH defenses off (a second `expandModel` in the listener AND the dedup disabled) did the host-re-edit case fail, pages **8 → 24**. **There are two independent defenses against double expansion and neither was written down**; C5's remediation text assumed there were none.

---

## Row 3 — M-T9.4 residue: five items → one

Every item re-verified on this tree, not inherited.

| item | verdict | evidence |
|---|---|---|
| **A5** retire the deprecated `WorkflowIR` primary-create facade | **STILL OPEN, and it is an L** | `params`/`statements`/`savesAtExit` are `@deprecated` facades over `creates` (`src/ir/types/loom-ir.ts:1279–1299`). **54 reader sites across 16 files**, all five backends + `_workflow/stmt-target.ts` + both lowerers + two IR check leaves. |
| **A7.4** fullstack-embed seam on `PlatformSurface` | **CLOSED** | `STATIC_BUNDLE_FRAMEWORKS` + `EMBEDDABLE_FRAMEWORKS`, `src/platform/surface.ts:39–58`; backend hosts advertise the wider set, frontend static hosts the narrower. |
| **B23** heex-parity behavioral OUTPUT test | **CLOSED** ([#2662](https://github.com/Loom-Harness/Loc/pull/2662)) | `test/behavioral/run-heex-ui.mjs` boots Phoenix, runs the emitted `*.ui.spec.ts` plus a create → list → detail round-trip, and asserts on RENDERED TEXT — a 200 with an empty page fails. |
| **C1–C7, C11, C12, C15** | **CLOSED** | Each carries its fix marker in `src/`: `(C1)`…`(C15)` across `validators/{structural,statements,builder-call,deployable,composition,types}.ts`, `print-structural.ts`, `lower-expr.ts`, `platform/metadata.ts`. Spot-checked C2 (`structural.ts:158` `Create`/`Destroy` owner arm), C11 (`types.ts:168` `BARE_REJECTED_COLLECTION_ACCESSORS`), C6 (`print-keyword-mirrors.test.ts` derives both keyword sets from the parsed grammar). |
| **#22 / C5** macro expansion under LSP rebuild | **CLOSED by this packet** | C5's named deliverable was "the currently-missing expander idempotency/incremental test". It is row 2 (c). |

**So M-T9.4's residue is A5 alone**, and the row's `M` sizing was carrying four closed items. Re-sized in the mission body.

---

## Row 4 — M-T9.5 `stacks/` → `src/platform/react/v{N}/`: DECLINED, owner fork

Two blockers, both measured:

**1. The target path names React; the directory does not hold only React.** `stacks/` holds five FRAMEWORK families — `v1`/`v3` (React/TSX), `vue1`, `sv1` (Svelte), `ng1` (Angular). Moving only `v1`/`v3` splits one directory across two homes, which is worse than either end state. Moving all five means per-framework platform package dirs — but `src/platform/{vue,svelte,angular}.ts` are thin surface FILES, so the real question is "do the frontends adopt the hono v4/v5 package pattern?", which is bigger than a move.

**2. It is not mechanical.** `stacks/` is resolved by path in three places, one a build-time glob:

- `src/generator/_packs/loader-fs.ts:187` — `<repo>/stacks/<id>/`;
- `web/src/build/template-bundled.ts:65,74,102–109,160,166` — three glob literals plus a path regex that reconstructs `/stacks/<id>/<file>` into the browser VFS;
- `web/src/build/loader-vfs.ts:167`.

Plus 7 `.github/workflows/generated-*` files, 4 tests (`stack-router-seam`, `_packs/package-json-shape`, `react/money-form-generics`, `playground/loader-vfs`), `docs/design-packs.md`, and the publish `files:` list. Under the byte-identical bar this is an **M**, and the web VFS half must land in the same PR or the playground silently stops finding its stacks.

**Owner decision wanted (D-STACKS-HOME):**
(a) move all five into per-framework platform package dirs (adopt the backend-packages pattern on the frontends);
(b) move React's two only and accept a split `stacks/`;
(c) **close the sub-item** — `stacks/<id>/` already IS a version axis with one directory per version, so the consolidation buys naming symmetry rather than behaviour. *4f's recommendation is (c) or (a); (b) is strictly worse than doing nothing.*

---

## Row 5 — M-T5.9: DECLINED, both halves, each for its own reason

**(a) The mechanism had landed; the DENOMINATOR was missing — so the denominator got BUILT, and the rows are handed off.** `src/ir/validate/checks/reserved-surfaces.ts` is a real single registry — `RESERVED_SURFACES` behind one `loom.reserved-not-emitted` meta-diagnostic, wording in `messages.ts`, a LIVE `code-docs.ts` anchor, a `FIRING_FIXTURES` entry, and a no-stale-rows reachability test. It carries **3 rows**: `timer-source-timezone`, `timer-source-overlap`, `storage-connection`. But nothing computed the SET of surfaces it ought to cover, so "routed through EVERY parse-but-no-emit surface" had no way to be true or false — the shape `gated-features-inventory.md` rotted into.

**BUILT: `test/system/inert-ir-field-census.test.ts`.** An IR field declared in `loom-ir.ts` and referenced by NO file under `src/generator/**`, `src/system/**` or `src/platform/**` is a candidate inert surface. **Measured: 27 of 330 declared fields.** Shrink-only exact baseline with an anti-slack arm and a stale-name guard, so a NEW unread field fails until it is given a reader, dispositioned, or given a `RESERVED_SURFACES` row. **Mutation-proved** by seeding `neverReadByAnyEmitter?: string` onto `WorkflowIR` — *"New IR field(s) that NO file under src/generator, src/system or src/platform reads … ['neverReadByAnyEmitter']"*.

The baseline is deliberately NOT zero. The scan over-approximates in exactly one direction, and three false-positive classes are real and benign: IR-internal plumbing (`loadPlan`, `resourceInterfaces`), reads through a destructure or spread the text scan cannot see, and fields the `ddd verify` / CLI / trace surfaces consume instead of an emitter (`testCaseId`, `verifiesTestCase`). A row therefore means "someone must say which of those it is", and the list can only get shorter.

**Three CONFIRMED by hand — each a real parse-but-no-emit surface with no `RESERVED_SURFACES` row today:**

- **`uiBindings` and `sourceDeployableName`** — written by `src/ir/lower/lower-deployment.ts:139,142,185` from a `uiCompose { … }` clause, and read by **nothing** under any emitting root. The clause parses, lowers, and vanishes; output is byte-identical with and without it.
- **`accessSource`** — stamped beside `access` (`lower-members.ts:141`, `enrich/enrichments.ts:1890,1909`, values `declared` / `default` / `stamp`). `access` IS read downstream; the provenance half is not.

> **HAND-OFF (H5, re-scoped): the ROWS, not the measurement.** Adding a `RESERVED_SURFACES` row is `src/ir/validate/checks/**` — packet 4c's fence, not 4f's. For each confirmed find: one row (`id`, `clause`, `consequence`, `probe`), its wording in `messages.ts` under the existing `loom.reserved-not-emitted` key, a `FIRING_FIXTURES` entry, **and delete its name from `NO_DOWNSTREAM_READER` in the census in the same PR** — the anti-slack arm fails if you do not. Then a disposition pass over the other 24 candidates, each gaining a one-line reason in the baseline or leaving it. Size **S**.

**(b) Blocked on the proposal's own open questions.** [`with-implements-split.md`](../../../old/proposals/with-implements-split.md) §Open questions:

- **OQ1** — the proposal itself says "**Not a soft 'open' item**". The headline ergonomics (`aggregate Build with crudish implements versioned { … }`) put `implements` in HEADER position; the grammar admits it only as a MEMBER (`ImplementsDecl`). So the split needs a grammar extension **plus** a Langium-ambiguity check that `with … implements …` parses cleanly before the `{` — and if it does not, the proposal falls back to a different shape and the examples must be rewritten.
- **OQ2** — a product decision: hard cutover (codemod + validator error) or a release where `with <capability>` warns before it errors.

4f declined to force either, particularly immediately after packet 4d reshaped the callable grammar into three shared fragments (`wave-c4-4d-callable.md`). Size once unblocked: **L** — grammar + `npm run langium:generate` + a `print-structural.ts` arm (`print-completeness.test.ts` pins it) + the kind-checking validator with a fix-it + a `scripts/` codemod with a test + a byte-identical proof across eleven targets.

**Owner decision wanted (D-WITH-IMPLEMENTS):** resolve OQ1 (run the ambiguity check first — it decides whether the proposal survives in its published form) and OQ2 (cutover vs warn window), then this is a schedulable L.

---

## Row 6 — M-T1.13 menu reform: DECLINED, fence not size

The mission's core move is deleting the implicit-derivation path, and that path is EMISSION: `src/generator/_frontend/menu-emitter.ts` derives the sidebar from the caller's default sections merged with each custom page's `menu { … }` metadata whenever no `ui`-level `menu { … }` block exists (its §MERGE rule, M-FT.6 / finding C1). **4f's fence excludes `src/generator/**` emission changes outright** — every 4f refactor had to be byte-identical — and this one is deliberately NOT byte-identical: it changes the sidebar a source with no explicit `menu` block produces.

> **The four-part shape for whoever takes it.** (1) macro half — `scaffold` materialises a real `menu { … }` into the `ui` so the scaffolded sidebar survives the deletion; (2) emitter half — `menu-emitter.ts` loses its default-derivation branch; (3) grammar half — retire the per-page `menu { … }` bag (`PageMenuMeta`, `ddd.langium:753–762`) against the `ui`-level block at `:830`, with the matching `print-structural` arm; (4) a `scripts/` codemod lifting every existing per-page `menu {}` into its `ui`'s block, with a test. Every `.ddd` in the corpus with a scaffolded ui is a regression case, so the natural gate is the frontend corpus snapshot with the diff justified line by line rather than a byte-identical claim.

---

## Row 7 — M-T8.9 (half) and M-T9.32 (the ID half)

### M-T9.32 — `scripts/next-mission-id.mjs`

`main` cannot answer "what is the next free mission id", because the answer is not on `main` yet: a freshly minted id lives on an open branch for hours. Twice on record — M-T6.37 claimed by two PRs in one hour, and M-T5.37/M-T5.38 colliding inside wave C4 itself.

The script reads **both** sides: the `## M-T<n>.<m>` headings in `docs/new-plan/` (live + archive), and every open PR's ADDED headings (`pulls/:n/files`, filtered to `docs/new-plan/**.md`) plus any id its title or body names — a claim announced in a body before the heading lands is exactly the collision window. Per track it prints max-on-main / max-claimed / next-free, and it names two collision shapes (`two-open-prs`, `already-on-main`); `--check` exits 1 on either.

**The mint rule is the HEADING (`+## M-Tx.y`), never the id regex.** A `Relates to M-T9.8` line in an added paragraph must not move the next-free number. **Mutation-proved** by widening the rule to "any id on an added line": the fixture patch goes from 1 mint to 4 and *"a HEADING mints an id; a MENTION in the same patch does not"* fails.

**Without a token it says the answer is INCOMPLETE rather than answering** — a main-only answer that LOOKED complete is the failure mode being fixed, so a silent degrade would reintroduce it. `--check` therefore fails on a definite collision only, never on being offline (a check that fails offline gets disabled).

Typed by `scripts/next-mission-id.d.mts` so the test asserts over real types (4b's gate). `RUNBOOK.md` §2 now tells an agent to run it instead of computing an id by eye.

> **NOT VERIFIED HERE, and it is the one gap in this row.** The sandbox has no `GITHUB_TOKEN` (`gh auth token` is empty), so only the pure core is exercised. **Recipe for whoever has a token — one command:**
> ```bash
> GITHUB_TOKEN=$(gh auth token) node scripts/next-mission-id.mjs --json | head -40
> ```
> Expect `"complete": true`, a `maxClaimed` above `maxExisting` on at least one track (the open wave PRs claim ids), and either an empty `collisions` array or a real live collision — which would itself be the check's first catch. If the `pulls/:n/files` shape has drifted, the only place to fix is `collectPrClaims`.

### M-T8.9 — biome over config JSON

`biome.json`'s `files.includes` was `.ts` + `scripts/**/*.mjs`, so every hand-authored JSON was outside every static check. **17 were unformatted**, and `designs/mui/v5/pack.json` carried a one-line 15-element import array AND the expanded form of the same shape three lines apart.

Scoped deliberately, not `**/*.json`: `test/behavioral/wire-golden/` alone is 62 goldens that exist to be compared byte for byte, and `test/fixtures/**` is captured generator output. The include list names the config families (`*.json` at root, `designs/**/pack.json`, `stacks/**/stack.json`, `packages/*/package.json`, `vscode/**/*.json`, `web/package.json`, `.claude/settings.json`) and excludes `package-lock.json`.

No gate wiring needed — `npm run lint` is `biome ci .` and is already required, so the new scope is enforced the moment it lands. **Mutation-proved** by seeding a blank line into `stacks/v1/stack.json`: `stacks/v1/stack.json format` / `Found 1 error`. `test/generator/_packs` + react/vue/svelte/angular (218 files, 1 719 tests) green after the reformat.

**Deferred with the reason:** *markdownlint* — a dev dependency, a config and a CI job over ~700 tracked `.md` of prose with deliberate long lines and inline HTML; the rule set is a decision, not a default-config drop-in, and a default config yields thousands of findings nobody drains. *Credo* — needs the Elixir toolchain in a job that does not exist; it belongs beside the elixir compile gates, not in the TS lint step.

---

## Row 8 — the push hook typechecks the MERGED tree (improvement-waves 4.1)

`.claude/hooks/pre-push-merge-check.sh` now runs **two** gates on a `git push`:

1. **Textual** — `git merge-tree --write-tree origin/main HEAD` (unchanged).
2. **Semantic** — on a clean merge, materialise `origin/main + HEAD` in a throwaway worktree (`git commit-tree` + `git worktree add --detach`, borrowing the checkout's `node_modules` by symlink so nothing installs) and run `npx tsc -b` and `node scripts/test-typecheck.mjs` there. Either failing denies the push, with the failing output attached.

**Fail-open everywhere else**, same stance as the existing gate: no `npx`, no borrowable `node_modules`, an unparsable merged-tree OID, a worktree that will not create, a 900 s timeout per gate, or `LOOM_SKIP_PUSH_TYPECHECK=1` — all ALLOW. It denies on exactly two things: a definite conflict, and a gate that ran to completion on the merged tree and failed.

**Measured:** 51 s for the full preflight on a warm `node_modules`; 1 s with the opt-out set.

**Mutation proofs, both deny paths, each on a throwaway commit dropped afterwards:**

- a seeded `src/util/_hook-probe.ts` with `export const broken: number = "not a number"` → deny, *"the MERGED tree does not compile … `src/util/_hook-probe.ts(1,14): error TS2322`"*;
- a seeded `test/util/_hook-probe.test.ts` importing a non-existent export → deny, *"the MERGED tree fails the test/ typecheck gate … `TS2305: Module '"../../src/util/naming.js"' has no exported member 'pascal'`"*.

**A defect found and fixed inside the row.** The worktree cleanup was a function-scoped `RETURN` trap, and `deny` `exit`s the script — an `exit` from inside a function never runs that function's `RETURN` trap. Both deny-path proofs leaked a live `git worktree`, which `git worktree list` then carries forever; three strays were removed and the trap moved to a top-level `EXIT` trap over one variable. Re-proved after the fix: deny fires, `git worktree list` unchanged.

Documented in `docs/tools.md` § "Local enforcement hooks" (the file had no hooks section at all).

---

## Local gates (on the merged tree, before hand-off)

| gate | result |
|---|---|
| `npm run langium:generate` | exit 0, **zero drift** (clean `git status` after) |
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | **gate OK** — `test/` and `src/` both clean under `tsconfig.test.json` |
| `npm run lint` (`biome ci .`) | exit 0 — 0 errors (30 warnings / 1 info, pre-existing), now over 3 341 files incl. the new JSON scope |
| corpus byte-identity | **395 cells / 26 534 files, BYTE-IDENTICAL** base vs final |
| `node scripts/mission-counts.mjs --check` | exit 0 (regenerated: **167 live / 115 archived**) |
| `node scripts/ledger-counts.mjs --check` | exit 0 |
| `node docs/build.mjs` | exit 0 |
| `npm test` | redirected with the exit code. **Final run on the final tree: `NPM_TEST_EXIT=0` — 2 178 files passed / 89 skipped (2 267), 26 075 passed / 6 expected-fail / 1 186 skipped (27 267), ~11 min.** No starvation timeouts, so nothing was re-run alone. |

The first run had one failure, recorded because it is the only red this packet
produced: `archived-docs-fence.test.ts` on
`docs/new-plan/T9-toolchain-health.md -> waves/handoffs/wave-c4-4f-hygiene.md`.
The mission bodies link this hand-off note and the note had not been written
yet — a forward link to the packet's own deliverable. Green in isolation once
the note landed (7/7) and in both subsequent full runs.

---

## Ratchets

| ratchet | at launch | after 4f |
|---|---|---|
| `test/` typecheck errors / files | 0 (4b drained it; gate absolute) | **0** — every test added here typechecks; `scripts/next-mission-id.d.mts` added so the `.mjs` core is typed rather than `any` |
| uncoded validator sites | 0 (4c; gate absolute) | **0** — this packet added no `accept(…)` |
| `UNDOCUMENTED_CODES` length | 365 | **365** — this packet minted no `loom.*` code |
| `MAX_OPEN_GAPS` / `LATENT_SEAMS` | 16 / 27 | **16 / 27** |
| NUL bytes under `src`/`test`/`docs`/`scripts` | 4 | **0**, gated exactly |
| `unknown`-cascade suppression sites | (unmeasured) | **21 across 6 files**, shrink-only baseline |
| IR fields no emitter reads | (unmeasured) | **27 of 330**, shrink-only baseline, 3 confirmed |
| corpus expressions typing `unknown` | (unmeasured) | **60.9 %** (28 333 / 46 492), banded 0.50–0.66 |

---

## Open-PR overlaps — cited, not duplicated

Read `list_pull_requests` (open, drafts included) at 2026-09-22 06:00Z.

- **#2982** (`claude/fix-workflow-param-id-shadow`, "a parameter named `id` loses name resolution") is the only open PR on `src/language/type-system.ts`, which row 2 (a) rewrites. **4f's hunks are the three walker bodies** (`typeAfterSuffix` ~line 1099, `stepInto` ~1715, `stepIntoNode` ~2108) plus one new exported const above `typeAfterSuffix`. #2982's change is in name resolution for a parameter named `id` — a different region — but the two touch one file, so **whichever lands second should re-read the three switch arms rather than taking a mechanical merge**: the arms are exhaustive now, so a resolution that drops one fails `tsc` loudly rather than silently, which is the good failure mode.
- **#2984** (routed handlers), **#2942** (walker-core), **#2947** / **#2983** (frontend DTOs), **#2980** (auth-emit, 25 findings) — **no overlap**: 4f changed no `src/generator/**` file and no `_walker` file. Its only `src/` edits are `type-system.ts`, the three NUL one-liners, and nothing else.
- **#2871 / #2874 / #2949 / #2945** (validator diagnostics) — **no overlap**: 4f edited no `src/language/validators/**` body. The `unknown`-cascade work is a `test/system` census that READS those files; it will fail on a PR that adds a suppression to a currently-clean validator file, which is the intended behaviour, and the fix is a one-line baseline row with a reason.
- **#2921 / #2938 / #2978 / #2977 / #2976** (docs/new-plan + test additions) — possible textual conflict only in `docs/new-plan/README.md`'s generated counts region; regenerate with `node scripts/mission-counts.mjs --write` after the merge.

**Edits outside the literal fence, named:**

- `CLAUDE.md` — ONE bullet (the `PreToolUse` hook description). The hook row changed the hook's behaviour, and leaving CLAUDE.md describing a one-gate hook would have been worse than the excursion. Minimal hunk; full write-up lives in `docs/tools.md`.
- `scripts/quality-delta.mjs` — ONE character (the raw NUL → `\0`), M-T9.32's neighbour file. No behaviour change.
- `biome.json` — the `files.includes` list (M-T8.9's whole deliverable) and the 17 JSON files it then reformatted.

---

## Hand-offs, with recipes

**H1 — M-T5.16 (b) drain: narrow the 21 suppressions, one at a time.** Fence: `src/language/validators/**` (4c's). For each site the question is *which* diagnostic would cascade, not whether any would: today `if (t.kind === "unknown") return;` before a block that raises three unrelated checks kills all three. The split is "suppress the type-MISMATCH arm, keep the arity / membership / sensitivity arms". `_shared.ts:123` (`warnSensitivityDrop`) is arguably sound as-is and should be dispositioned rather than changed; `statements.ts` (8 sites) is the volume. **Each narrowed site lowers its baseline row in `test/system/unknown-cascade-census.test.ts` in the same PR** — the anti-slack arm enforces it.

**H2 — M-T5.16 (b), the other half: give `envForNode` real `let`-binding types.** `src/language/type-system.ts:1884` types every `let` as `T.unknown` "for simplicity", by its own comment. It is the env behind LSP hover / completion / definition and several validators, and it is a large share of the measured 60.9 %. The fix is to run `typeOf` at the bind site while assembling the env (the comment says this is "awkward in a one-pass env builder" — it is a two-pass builder, not an impossible one). **Bank the result**: lower `UNKNOWN_SHARE_MIN`/`MAX` in the same PR.

**H3 — M-T9.4's A5, re-sized.** 54 reader sites / 16 files / five backends. Not the S the row implied. Natural slicing is one backend per PR behind the byte-identical corpus snapshot, with `_workflow/stmt-target.ts` and the two lowerers last.

**H4 — M-T9.32's live half.** One command, above, and it needs a token this sandbox does not have.

**H5 — M-T5.9 (a)'s three confirmed rows.** The denominator is BUILT (`test/system/inert-ir-field-census.test.ts`, 27 of 330 fields); what is left is `RESERVED_SURFACES` rows for `uiBindings` / `sourceDeployableName` / `accessSource`, which is `src/ir/validate/checks/**` — 4c's fence. Full recipe in Row 5 above. Each row deletes its name from the census baseline in the same PR; the anti-slack arm enforces it.

**H6 — wire `next-mission-id.mjs --check` into the weekly quality report** (or a cheap scheduled workflow) rather than leaving it human-invoked. It already has a token in CI and it fails only on a definite collision, so it is safe to schedule. Not done here because 4f added no workflow.

---

## Decisions wanted from the owner

- **D-STACKS-HOME** (Row 4) — (a) all five stack families into per-framework platform package dirs, (b) React's two only with a split `stacks/`, or (c) close the sub-item. **4f recommends (c) or (a); (b) is strictly worse than doing nothing.**
- **D-WITH-IMPLEMENTS** (Row 5b) — resolve the proposal's OQ1 (run the Langium ambiguity check on header-position `implements` FIRST; it decides whether the proposal survives in its published form) and OQ2 (hard cutover vs warn window). Until both are answered the mission is not schedulable.
- **M-T1.13's fence** (Row 6) — it needs a packet whose fence ADMITS a non-byte-identical `src/generator/_frontend/` change. Worth saying explicitly when it is next scheduled, because three C4 packets in a row have been byte-identical-fenced.

## Decisions taken (not asked)

- **The `unknown` measurement is reported as an upper bound, with the env named**, rather than as "60.9 % of validator checks are suppressed". The larger claim is not supportable from `envForNode` and would have been a false precision.
- **The exhaustiveness rewrite added no typing.** `stepInto` could have gained the `userclaim` / `id` / `array` / `primitive` arms `typeAfterSuffix` has, which would be a real improvement — and a behaviour change, on a byte-identical-fenced packet. It is recorded as data in `MEMBER_RESOLVING_KINDS` instead, so widening it is a visible one-line edit rather than an invisible one.
- **Rows 4, 5 and 6 were declined rather than half-built.** Each decline names a blocker that is not "size": an unsettled fork, the proposal's own unresolved OQ1, and a fence boundary.
