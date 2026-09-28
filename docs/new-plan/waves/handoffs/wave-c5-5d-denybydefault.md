# Wave C5 · moment 5d (M-T3.1) — the `enforcement:` default flip — hand-off

*Branch: `claude/c5-denybydefault`. Base: `4816dda14` (the C5 coordinator head
= `main` @ `fc1880a05` + the wave log; `origin/main` had not moved at hand-off).
Commit range `4816dda14..HEAD`. Never pushed; the wave PR is the claim. Tree
fence: `src/ir/lower/**` (the default), `src/ir/validate/checks/**` (comments
only), `src/cli/**` (`ddd new`), `scripts/` (the codemod), `docs/auth.md`,
`docs/migrations.md`, `docs/language.md`, `docs/language-reference/17-auth.md`,
the `.ddd` corpus the codemod rewrote, and the test files whose inline sources
it rewrote.*

| # | row | outcome |
|---|---|---|
| — | **the flip** | **done.** `DEFAULT_ENFORCEMENT = "denyByDefault"` — `src/ir/lower/lower-auth.ts:22`, read at `:62`. An `auth { … }` block that names no `enforcement:` is deny-by-default; a system with **no** `auth` block still has no posture (`sys.auth` undefined — see decision D1 below) |
| a | **codemod** | **done.** `scripts/codemod-enforcement-opt.mjs` (+ `.d.mts`): `findAuthBlocks` `:64`, `pinEnforcementOpt` `:110`; `--list` / `--check` / write modes. Comment- and string-aware, idempotent, never touches a block that already names `enforcement:` (either value). Run over the whole tree; outcome per file below |
| b | **docs** | **done.** `docs/migrations.md:829` "Language-version migrations" → `:836` "The `enforcement:` default flip (M-T3.1)" (the migration note + codemod recipe); `docs/auth.md:25` (the enforcement note rewritten) and the `requires` section; `docs/language.md` (the `auth` row + the `requires` row); `docs/language-reference/17-auth.md` (clause list `:200`, the Default-deny paragraph) |
| c | **fixtures still validate** | **done — codemod on 15 `.ddd` + 29 test files, 4 `.ddd` left on the new default, 0 gates added; plus ONE fixture the tree walk missed, pinned after CI (below).** Table below; `test/system/codemod-enforcement-opt.test.ts` is the standing tree gate |
| d | **`ddd new`** | **done.** The commented-out `user`/`auth { enforcement: denyByDefault }` block is gone from `main.ddd` (a 6-line pointer at `src/cli/new-templates.ts:254` remains); the README gains "Authentication and authorization" (`:340`) with the paste-able `user`/`auth` blocks and an explicit `enforcement: opt` example |
| — | **witnesses** | `test/ir/default-deny-language-default.test.ts` (validator) and `test/cli/enforcement-default-generate.test.ts` (node leg through the real CLI), both mutation-proved (below) |

M-T3.1 → **`done`**, moved to `archive/T3-done.md`; README counts regenerated.

---

## Row (c) — fixture by fixture

`node scripts/codemod-enforcement-opt.mjs --list .` on the base found **19**
`.ddd` files with an `auth` block naming no `enforcement:` (the 20th grep hit,
`test/fixtures/corpus/auth-id-claim-stub.ddd`, carries `auth {` only inside a
comment — the codemod correctly skips it). Each was validated under the new
default before deciding:

| file | under `denyByDefault` | decision |
|---|---|---|
| `examples/showcase.ddd` | 22 errors | **codemod** (a grammar-coverage showcase, not an authz fixture; now also covers the `enforcement:` clause) |
| `eval/repro/nullable-claim-find.ddd` | 6 errors | **codemod** (repro of a codegen defect, not of authz) |
| `eval/repro/page-gate-permissions.ddd` | 3 errors | **codemod** |
| `eval/repro/scaffold-gate-permissions.ddd` | 3 errors | **codemod** |
| `test/e2e/fixtures/auth-oidc-e2e.ddd` / `-dotnet.ddd` / `-java.ddd` | 3 errors each | **codemod** (OIDC token-flow legs) |
| `test/e2e/fixtures/python-build/auth-oidc.ddd` | 3 errors | **codemod** |
| `test/e2e/fixtures/ts-build/auth-ui.ddd`, `svelte-build/auth-ui.ddd` | 3 errors each | **codemod** |
| `test/e2e/fixtures/elixir-vanilla-build/vanilla-auth-oidc.ddd` | 3 errors | **codemod** |
| `test/e2e/fixtures/elixir-vanilla-build/embedded-tenancy.ddd` | 2 errors | **codemod** |
| `test/e2e/fixtures/elixir-vanilla-build/vanilla-tenancy.ddd` | 1 error | **codemod** |
| `test/fixtures/corpus/auth-oidc.ddd`, `auth-id-claim.ddd` | 3 errors each | **codemod** |
| `test/e2e/fixtures/auth-gate-e2e/auth-gate.ddd` | 0 errors, 1 warning (`loom.default-deny-by-id-ungated`) | **left on the default** — already gated |
| `test/e2e/fixtures/elixir-vanilla-build/vanilla-tenancy-hierarchy.ddd`, `vanilla-tenancy-registry.ddd` | 0 errors | **left on the default** |
| `eval/repro/F005-ui-gate-crash.ddd` | 0 errors | **left on the default** |

No fixture in the tree was *meant* to exercise `denyByDefault` implicitly (the
ones that do spell `enforcement: denyByDefault` explicitly and are unaffected),
so no gate was added to any fixture. **Post-fold correction (2026-09-28):** one
fixture is not a file at all — `generated-flutter-build.yml` writes its app-shell
fixture with `cat > ci-flutter-shell/shell.ddd <<'DDD'`, and its `auth` block on
the default plus a deliberately ungated `reprice` failed the leg's `generate
system` step with `loom.default-deny-ungated`. The coordinator pinned
`enforcement: opt` in the heredoc and extended the tree gate to extract and
validate every `.ddd` heredoc under `.github/workflows/` (seven today), so a
workflow-inline fixture is now reached locally. `examples/acme.ddd`, `vue-showcase.ddd`,
everything under `web/src/examples/`, `journey/`, `eval-*/` and
`docs/audits/models/` already name `enforcement:` or have no `auth` block —
nothing to rewrite.

**Inline sources.** The first full `npm test` after the flip: 31 files / 103
tests red. 29 were codegen/ui-gate/tenancy/OIDC tests whose inline `.ddd`
carries an ungated `auth` block (none is about `denyByDefault`); the codemod's
`pinEnforcementOpt` was applied to exactly those files (34 blocks: 20 multi-line + 14
inline blocks, diff reviewed — only the inserted clause changed). The other
two were real: `test/language/auth-block.test.ts` asserted the old default
(now expects `denyByDefault`), and `test/system/vacuous-parse-assertion.test.ts`
caught my own new test binding `errors` from a `validate: false` parse (fixed
to `parseErrorsOf`).

**Emitted output.** Nothing in `src/generator/**`, `src/platform/**` or
`src/system/**` reads `enforcement` (only `validateDefaultDeny` does), so the
flip changes **no emitted byte** for a model that validates either way:
measured on `auth-gate.ddd` (pinned vs. default, `generate system`, 91 files,
`diff -r` empty — the default run adds one warning to the console, nothing to
disk). Measured corpus-wide too: `scripts/capture-corpus-snapshot.mjs`, base
vs head over all 83 corpus fixtures × 5 backends — **byte-identical, 415
cells**, the two pinned corpus fixtures included (the inserted clause line
moves no emitted byte). **No fixture or example's emitted output changed**;
what changed is which models *validate* (the 15 + 29 above, before their pin)
and one extra `loom.default-deny-by-id-ungated` warning on the console for
the four `.ddd` left on the default. **No wire golden moved** — the node
behavioural leg's `auth-oidc` case (below) matches its golden, and no golden
file is touched; nothing waits for 5a's capture.

## The witnesses, and their mutation proofs

Mutation = `DEFAULT_ENFORCEMENT` reverted to `"opt"` in
`src/ir/lower/lower-auth.ts`, backed up and restored by file copy (never
`git checkout`), `tsc -b` re-run for the CLI leg.

- `test/ir/default-deny-language-default.test.ts` — 6 cases. Under the
  mutation **3 fail**: "an auth block that names no `enforcement:` lowers to
  denyByDefault" (`expected 'opt' to be 'denyByDefault'`), "an ungated
  operation under the DEFAULT raises loom.default-deny-ungated"
  (`expected [] to deeply equal [ 'Ticket/close' ]`), "an empty `auth { }` is
  deny-by-default too". The explicit-`opt`, explicit-`denyByDefault` and
  no-auth-block cases stay green (they must). Every case carries a vacuity
  guard that the context really is hosted on an `auth: required` backend.
- `test/cli/enforcement-default-generate.test.ts` — node, through
  `bin/cli.js generate system`. Under the mutation **1 fails**: "refuses an
  ungated route under the DEFAULT and writes no app" (`expected +0 not to be
  +0` — the exit status). The pinned-`opt` case (route generated, no
  `ForbiddenError`) and the gated case (route throws `ForbiddenError`, the
  handler maps it to `problem(403, …)`) stay green.
- `test/cli/new-auth-guidance.test.ts` — mutation = the pre-flip
  `src/cli/new-templates.ts` (from `HEAD` of the base, restored by copy): all
  **4 fail** (`not to contain 'enforcement: denyByDefault'`; `expected [] to
  have a length of 2`; the spliced plain block reports
  `loom.auth-no-user-block` instead of `loom.default-deny-ungated`; …).
- `test/system/codemod-enforcement-opt.test.ts` tree gate — mutation = the
  `enforcement: opt` line deleted from `test/fixtures/corpus/auth-oidc.ddd`:
  **1 fails**, "test/fixtures/corpus/auth-oidc.ddd validates under
  denyByDefault" (`… relies on the default and is ungated: expected [ …(3) ]
  to deeply equal []`).

**On "an ungated route answers 403 by default".** The brief's phrasing does
not match the shipped semantics: `denyByDefault` is a **compile-time**
posture (`validateDefaultDeny` errors; no emitter reads `enforcement`), so an
ungated route under the default is not a 403 — it is **never generated**.
The node-leg witness therefore asserts the stronger fact (`generate system`
exits non-zero and writes no `api/`), plus the 403 of the gate the author
must write instead. Runtime, on the node behavioural leg (PGlite + the
in-process OIDC mock, `node test/behavioral/run.mjs auth-oidc`):

- the codemod-pinned corpus fixture: 4/4 — api ✓, authz ladder
  401 / **403** / 204 ✓, `wire: matches golden`;
- a scratch copy of the same fixture **on the new default** (pin removed,
  `policy Anyone(): bool = true` + `with crudish(requires: Anyone)` added to
  satisfy it — reverted by file copy afterwards): 4/4, the same ladder
  including **403**, `wire: matches golden`.

## Local gates (on the final tree; `origin/main` = the base, no merge needed)

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | exit 0 |
| `npx biome ci . --diagnostic-level=error` | exit 0 |
| `node scripts/mission-counts.mjs --check` | exit 0 |
| `node scripts/ledger-counts.mjs --check` | exit 0 |
| `node docs/build.mjs` | exit 0 |
| `npm test` (redirected, exit appended) | `NPM_TEST_EXIT=0` — 2224 files passed / 89 skipped; 26685 tests passed, 6 expected-fail, 1219 skipped. (The first run after the flip, before the inline-source pins, was 31 files / 103 tests red — see row (c).) |
| corpus snapshot (`scripts/capture-corpus-snapshot.mjs`, base vs head) | **`BYTE-IDENTICAL: 415 cells, no emitted file differs`** — base = `DEFAULT_ENFORCEMENT "opt"` + the two corpus fixtures at `4816dda14`, head = this branch (both pinned corpus fixtures included) |
| node behavioural leg, `auth-oidc` | 4/4, `wire: matches golden` (details above) |

## Open PRs on the fence

- **#3048** (`denyByDefault` ⊗ `persistedAs: eventLog`, F-004) — composes, no
  overlap in code: it edits `default-deny-checks.ts` inside
  `validateDefaultDeny`'s body; this branch edits only that file's header
  comment (lines 19-27) — a textual neighbour, expect a trivial or no
  conflict. Its new `loom.default-deny-es-create-ungateable` census fixture
  spells
  `enforcement: denyByDefault` explicitly — unaffected.
- **#2945** (`currentUser` in read filters) — adds
  `test/fixtures/corpus/criterion-current-user.ddd`; if its `auth` block
  names no `enforcement:` and it has ungated reads, the tree gate
  (`codemod-enforcement-opt.test.ts`) fails at fold, naming the file. Recipe:
  `node scripts/codemod-enforcement-opt.mjs test/fixtures/corpus/criterion-current-user.ddd`
  (or gate its reads if it is meant to run on the default). It also changes
  what counts as a gated read, not whether `validateDefaultDeny` runs — no
  code overlap.
- **#2948** (the auth demo's token/claims) — touches `src/cli/main.ts` and
  `src/system/**`, not `new-templates.ts`; no overlap with the starter edit.
- **Any open PR that adds a `.ddd` or an inline source with an ungated `auth`
  block** will be red on this flip in the same way. The tree gate catches the
  `.ddd` files; inline test sources surface as ordinary test failures whose
  message is `loom.default-deny-ungated`. The recipe is the same one-liner.

## Hand-offs outside the fence

- **`web/src/builder/system-v2/view-graph.ts:617`** renders
  `enforcement: ${a.enforcement ?? "—"}` for an `auth` block — after the flip
  "—" means `denyByDefault`. Cosmetic; recipe: `?? "denyByDefault (default)"`.
- **`src/diagnostics/messages.ts:3000`** — one comment word touched ("the
  default `opt` mode" → "an explicit `opt` mode"); no message text changed.

## Decisions taken

- **D1 — a system with no `auth { … }` block gets no posture.** The field lives
  in the `auth` block, and the only way to opt such a system *out* of a
  defaulted posture would be to ADD an `auth` block — which switches the
  emitted verifier from the dev stub to OIDC. A default nobody can opt out of
  without changing the generated app is not a default; so the flip is scoped
  to "an `auth` block that names no `enforcement:`". Pinned by the no-auth-block
  case of the witness test.
- **D2 — the codemod is syntactic and unconditional.** It pins every
  unpinned block, whether or not the model would validate under the new
  default, because "keeps its behaviour" is the contract and a user's project
  is not ours to re-validate. For the repo's own tree the decision was made
  per file (validate first, pin only what fails) so that fixtures already
  sound under `denyByDefault` exercise the new default.
- **D3 — no new `loom.*` code.** The flip reuses `loom.default-deny-ungated`;
  nothing new to catalogue.

## Decisions wanted from the owner

- Whether a system with no `auth` block but `auth: required` deployables (the
  stub-verifier shape) should ALSO default to deny-by-default in a later
  major — it would need an opt-out surface that does not imply OIDC (e.g. an
  `enforcement:` clause on the `user { … }` block or the deployable). D1 is the
  conservative default until then.
