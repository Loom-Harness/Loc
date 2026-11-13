# `ddd` CLI surface — sub-command extension model

> Convention spec. Describes the shipped command set (`src/cli/main.ts`,
> Commander-based) and pins how new sub-commands attach. The flag-by-flag
> reference is [`tools.md`](../tools.md#cli); `ddd <command> --help` is the
> source of truth.

## Shipped commands

| Command | Shape | Role |
|---|---|---|
| `ddd parse <file>` | check | parse + validate (syntax, AST and IR tiers); non-zero exit on errors |
| `ddd generate system <file> -o <out>` | emit | full multi-deployable tree + `docker-compose.yml` |
| `ddd new <name>` | emit | scaffold a validated starter project (`main.ddd`, `README.md`, `.loomignore`, `LICENSE`) |
| `ddd patch <file> --patches <p.json>` | emit | apply node-addressed model patches to a `.ddd` source (prints the patched source, or `--json`) |
| `ddd migrate add\|status\|remove\|rebase` | steward | record, inspect, drop, or re-base entries of the migration chain (`migrations/` beside the `.ddd`) |
| `ddd diff <file>` | check | classify model changes as compatible / breaking-for-clients / breaking-for-data; exit 1 on breaking, 2 when it cannot diff |
| `ddd verify <file> --results … \| --from-vitest … \| --from-playwright …` | check | join existing test-results reports onto the requirements graph → `.loom/verification.*`; gates the exit code; runs no suite |
| `ddd snapshot <file> -o <out>` | steward | capture an immutable provenance rule snapshot under `.loom/snapshots/` |
| `ddd trace <logfile>` | check | annotate a stack trace with the `.ddd` constructs its frames map to, via `.loom/sourcemap.json` |
| `ddd breakpoints <file> --line <n>` | check | resolve a `.ddd` line to the generated `file:line`(s) it produced |
| `ddd i18n extract\|init\|sync\|status\|check\|approve\|export\|import\|prune` | steward | translator workflow over the extracted string catalog |

Flags that recur: `-o/--out` (`generate system`, `snapshot`, `new`,
`trace`, `breakpoints`, `i18n extract`; `verify` takes `--out` only),
`-w/--watch` and `--dry-run` (`generate system`; `--dry-run` also on
`snapshot`), `--json`, `--all-warnings`.

## Command taxonomy

Sub-commands fall into three shapes; a new command should declare which
it is, because the shape dictates its flag contract and exit semantics:

| Shape | Reads | Writes | Exit |
|---|---|---|---|
| **check** (`parse`, `diff`, `verify`, `trace`, `breakpoints`) | `.ddd` (+ reports / maps) | nothing, or report artefacts (`verify` writes `.loom/verification.*`) | non-zero on diagnostics or a failed gate |
| **emit** (`generate`, `new`, `patch`) | `.ddd` | files under `-o` (or stdout) | non-zero on diagnostics or generation failure |
| **steward** (`snapshot`, `migrate`, `i18n sync`) | `.ddd` + an existing tracked artefact | updates that artefact deliberately | non-zero on conflict |

**emit** commands that write a tree (`generate system`) honour
`--dry-run` (print plan, touch nothing) and are idempotent (re-running with
no source change is a no-op diff). **steward** commands mutate
author-owned, version-controlled state (the migration chain, snapshots,
locale catalogs) and are therefore run *deliberately*, never on every
build — they are the `ef migrations add` of Loom, not part of `generate`.

## Adding a sub-command

1. Add the Commander command in `src/cli/main.ts` (or a sub-module under
   `src/cli/<area>/` for multi-verb groups — the i18n group puts its verbs in
   `src/cli/i18n/`).
2. Declare its taxonomy shape and honour that shape's flag contract
   (`--dry-run` for emit; deliberate-run + conflict exit for steward).
3. Keep the command **thin** — it parses args and calls into the
   toolchain library (`@loom/core` / `src/`); no domain logic in the CLI
   layer. The browser playground re-invokes the same library entry
   points without the CLI, so logic in `main.ts` is logic the playground
   can't reach.
4. Diagnostics use the `loom.*` codes from
   [`diagnostic-catalog.md`](./diagnostic-catalog.md); exit code derives
   from the highest diagnostic severity.
5. Add a `test/cli/<command>.test.ts`.

## The `ddd i18n` group

A multi-verb **steward** group (verbs in `src/cli/i18n/`; the workflow is
in [`tools.md`](../tools.md#i18n-translator-workflow-ddd-i18n)). `init`
scaffolds `locales/<locale>/<ns>.json` and the source lock; `sync` is the
three-way merge (BASE = source lock, OURS = translator file, THEIRS = fresh
extraction); `status` and `check --strict` are the CI gates.

All of them write under the author-owned `<repo>/locales/` tree (never under
the generated `out/`), exit non-zero on unresolved merge conflict, and
are opt-in — `ddd generate` only *copies* resolved catalogs into the
output, it never reconciles. This is the steward contract above.
