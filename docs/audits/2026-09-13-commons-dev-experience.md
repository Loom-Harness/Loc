# Commons dev-experience audit — 2026-09-13

**Method.** An outside evaluator built one application (**Commons**, a customer
community platform — members, posts, an arbitrarily-deep comment tree, groups,
follows, moderation, bans, media scanning, notification fan-out, GDPR erasure)
from the README and `docs/` only, ran it against a real Postgres and the
generated Keycloak realm, regenerated it onto **all five backends and all six
frontends**, compiled every one with its real toolchain, and evolved it against
a populated database.

Model: 320 `.ddd` lines → 225 files (one backend + one frontend + notifier), or
1148 files across all eleven targets. Repros: `eval/repro/*.ddd`.

**Snapshot commit:** `bcd25e3e`; every row below **re-verified on `619708fd`**
(fresh `main`, 17 commits later) before being filed.

## Headline

22 findings. **S1 ×10, S2 ×6, S3 ×6.** By class: **SILENT 12, HONEST 4,
DOCUMENTED 3, docs-vs-reality 2, reconciliation 1.**

Twelve silent to four honest is the wrong ratio for a compiler, and the silent
ones cluster into **one root cause**:

> **A model identifier or construct that is legal in Loom and fatal in the
> target, interpolated verbatim with no reserved-word map and no post-emit
> compile check.**

Six of the ten S1s are that pattern, across five different targets:

| Model shape (all legal `.ddd`, all `parse` + `generate` clean) | Target it breaks |
|---|---|
| `valueobject` declared in context A, used from context B | dotnet, react, vue, svelte, angular |
| field named `state` | dotnet — collides with the emitter's nested `State` class |
| field named `member` | feliz — reserved F# keyword |
| record named `Money` (or `Card`, `Table`, `Badge`, `Alert`, `Field`, …) | **every** target — construction validation is silently skipped |
| reference collection `X id[]` | angular |
| `for x in Repo.run(C(...))` in a reactor | elixir (generator crash), java + feliz (non-compiling) |

## Register

| ID | Sev | Class | Title | Status |
|---|---|---|---|---|
| F-001 | S1 | SILENT | cross-context value object → undefined type on dotnet + 4 JSX frontends | open |
| F-002 | S2 | HONEST | multi-table reads not expressible (home feed) | ceiling, not a defect |
| F-003 | S1 | SILENT | generator emits an e2e suite calling routes it did not generate | open |
| F-004 | S3 | SILENT | generated `e2e/` has no vitest config, inherits an ancestor's | open |
| F-005 | S1 | SILENT | a call in a page gate crashes the generator | **claimed by #2871** |
| F-006 | S2 | DOCUMENTED | `denyByDefault` does not gate the auto-`findAll` list route | open (posture) |
| F-007 | S3 | SILENT | MIT `LICENSE` not emitted by `generate` (README says it is) | open |
| F-008 | S2 | DOCUMENTED | `.loomignore` pin goes permanently stale with no detector | open (design) |
| F-009 | S2 | HONEST | no data-preserving move of an aggregate between contexts | open (feature) |
| F-010 | S3 | HONEST | `elastic`/`meilisearch` declarable but no resource kind accepts them | open |
| F-011 | S3 | SILENT | reference docs show comma syntax the grammar rejects | open |
| F-012 | S2 | HONEST | group-scoped visibility not expressible | ceiling, not a defect |
| F-013 | S1 | SILENT | `for-each` in a reactor crashes the elixir emitter (raw throw) | open |
| F-014 | S1 | SILENT | a record named after a walker primitive skips construction validation | open |
| F-015 | S1 | SILENT | field named `state` → uncompilable C# | open |
| F-016 | S1 | SILENT | `X id[]` → uncompilable Angular | open |
| F-017 | S3 | SILENT | `ddd verify` exits 0 when nothing is verified | open |
| F-018 | S3 | DOCUMENTED | `ddd trace` cannot map the default backend's own bundle | open |
| F-019 | S2 | — | README's unqualified cross-target claims vs the internal ledger | docs |
| F-020 | S1 | SILENT | `mask unless` emits Java missing `import java.util.Objects` | open |
| F-021 | S1 | SILENT | reactor `for-each` emits non-compiling Java | open |
| F-022 | S1 | SILENT | field named `member` → invalid F# | open |

## Target matrix (one model, real toolchains, zero unverified)

| Target | Generates | Compiles |
|---|---|---|
| node (Hono) | ✅ | ✅ |
| python (FastAPI) | ✅ | ✅ |
| elixir (Phoenix) | ❌ F-013 | ✅ `mix compile --warnings-as-errors` exit 0 without it |
| dotnet | ✅ | ❌ F-015 |
| java | ✅ | ❌ F-020 + F-021 |
| react / vue / svelte | ✅ | ✅ |
| flutter | ✅ | ✅ `flutter analyze` 0 errors 0 warnings |
| angular | ✅ | ❌ F-016 |
| feliz | ✅ | ❌ F-022 (rename one field → builds an 894 kB bundle) |

Seven of eleven compile the model as written. **Three of the four failures are
one field-rename away from compiling** — which is what makes the reserved-word
map (below) the highest-leverage fix in the register.

## What the evaluator could not find in the tree

Nothing in `test/` compiles a corpus model containing a shared value object, a
field named `state`, a field named `member`, an `X id[]` and a reactor
`for`-loop against every target. That absence is why a 16-agent internal audit
(`targets-completeness-2026-08-30`) carries none of these six rows.
