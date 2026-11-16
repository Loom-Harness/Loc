# D-NO-READ-BACK — generation reads nothing it wrote; hatch files are the user's

**Status:** PINNED.

**Problem.** A generator that reads its own earlier output to decide what to
do keeps state where nobody reviews it: a manifest in the output that a
teammate's clone lacks, a marker inside a file the user owns, a record that
drifts from what is on disk. The decision of what to write then depends on
history instead of on the model.

**Decision.** `generate system` is a function of its inputs: the model, the
`migrations/` chain and `locales/` beside it, and the output's `.loomignore`
(the user's own pin file). It reads nothing it wrote on an earlier run.

- **Generated files** are written when their content differs from what is on
  disk.
- **Files the model does not produce** are left in place and counted in one
  summary line; `--prune` deletes them on request. Only the folders the run
  writes into are looked at; dot-entries, build-tool directories and
  `.loomignore`d paths are never counted or deleted.
- **Hatch files** (the `extern` implementations, `docs/extern.md`) are the
  user's code. Emitters return their stubs in a map separate from the
  generated files, so no path is both. A hatch is present when its file exists
  and pending when it does not; nothing marks or records it. `generate`
  refuses while one is pending and names it; `ddd scaffold` writes the missing
  stubs and never touches an existing file.
- The generated orientation page is `docs/README.md`, regenerated every run;
  the project's root `README.md` is the team's.
- **The record of earlier generations is git.** `generate --merge` commits the
  pristine output (generated files and hatch stubs) as a generated commit in
  the branch's own history, found by its `Generated-from:` trailer, and merges
  it with `git merge`; `--check` compares the model's output with the last
  generated commit. No named branch, ref, hook or file outside those commits
  records anything.

**Rationale.** Existence is the only state that cannot drift from disk, and
git already records what an earlier generation looked like. Without a record
of past runs a stale file and a team's file look alike, so deletion is an
explicit act. A missing hatch means the generated code that calls it cannot
build, so the run refuses instead of producing a tree that fails later.

**Affects.** `src/cli/commands/generate.ts` (the write plan, the summary,
`--prune`, `ddd scaffold`); `src/util/hatch.ts`; every backend's extern
emitters; `src/system/index.ts` (`SystemEmission.hatches`); `docs/tools.md`
§ Regeneration; `docs/extern.md`.

**Enforced by:** `test/cli/hatch-preserve.test.ts`, `test/cli/regen-prune.test.ts`, `test/cli/regen-replay/node.test.ts`, `test/cli/regen-replay/dotnet.test.ts`, `test/cli/regen-replay/java.test.ts`, `test/cli/regen-replay/python.test.ts`, `test/cli/regen-replay/elixir.test.ts`
