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
| `valueobject` declared in context A, used from context B | dotnet, react, vue, svelte, angular — **and node, java, python** (see correction below) |
| field named `state` | dotnet — collides with the emitter's nested `State` class |
| field named `member` | feliz — reserved F# keyword |
| record named `Money` (or `Card`, `Table`, `Badge`, `Alert`, `Field`, …) | **every** target — construction validation is silently skipped |
| reference collection `X id[]` | angular |
| `for x in Repo.run(C(...))` in a reactor | elixir (generator crash), java + feliz (non-compiling) |

## Outcome

All five fix PRs merged on 2026-09-14: **#2923** (F-014, F-015, F-022, F-023),
**#2925** (F-001, F-020), **#2926** (F-013, F-021), **#2927** (F-003, F-004,
F-016), **#2924** (F-007, F-010, F-011, F-017).  Each repro was then re-run
against merged `main` (`fb822206`) and the **emitted output** inspected, not
just CI's green: the three refusal fixes exit 1 with their diagnostic, and the
emitter fixes show `__State`, `import java.util.Objects`, escaped `` `member` ``,
`MoneyResponse`, `new FormControl<string[]>([])` and the root-pinned
`vitest.config.ts` in the generated tree.  The F-016 check was run BEFORE #2927
merged and correctly still showed the defect, which is what makes the rest
evidence rather than a vacuous pass.

F-018 is the only genuinely open row.  F-005 is #2871's.  F-002 and F-012 are
expressiveness ceilings, not defects.  F-006, F-008 and F-009 stay open as
posture, design and feature decisions respectively.

## Register

| ID | Sev | Class | Title | Status |
|---|---|---|---|---|
| F-001 | S1 | SILENT | cross-context value object → broken emission on **all nine** targets (see correction) | #2925 merged |
| F-002 | S2 | HONEST | multi-table reads not expressible (home feed) | ceiling, not a defect |
| F-003 | S1 | SILENT | generator emits an e2e suite calling routes it did not generate | #2927 merged |
| F-004 | S3 | SILENT | generated `e2e/` has no vitest config, inherits an ancestor's | #2927 merged |
| F-005 | S1 | SILENT | a call in a page gate crashes the generator | **claimed by #2871** |
| F-006 | S2 | DOCUMENTED | `denyByDefault` does not gate the auto-`findAll` list route | open (posture) |
| F-007 | S3 | SILENT | MIT `LICENSE` not emitted by `generate` (README says it is) | #2924 merged |
| F-008 | S2 | DOCUMENTED | `.loomignore` pin goes permanently stale with no detector | open (design) |
| F-009 | S2 | HONEST | no data-preserving move of an aggregate between contexts | open (feature) |
| F-010 | S3 | HONEST | `elastic`/`meilisearch` declarable but no resource kind accepts them | #2924 merged |
| F-011 | S3 | SILENT | reference docs show comma syntax the grammar rejects | #2924 merged (the `user {}` row was left to #2873, which has since merged and MADE that spelling legal — the row is correct as written) |
| F-012 | S2 | HONEST | group-scoped visibility not expressible | ceiling, not a defect |
| F-013 | S1 | SILENT | `for-each` in a reactor crashes the elixir emitter (raw throw) | #2926 merged |
| F-014 | S1 | SILENT | a record named after a walker primitive skips construction validation | #2923 merged |
| F-015 | S1 | SILENT | field named `state` → uncompilable C# | #2923 merged |
| F-016 | S1 | SILENT | `X id[]` → uncompilable Angular | #2927 merged |
| F-017 | S3 | SILENT | `ddd verify` exits 0 when nothing is verified | #2924 merged |
| F-018 | S3 | DOCUMENTED | `ddd trace` cannot map the default backend's own bundle | open |
| F-019 | S2 | — | README's unqualified cross-target claims vs the internal ledger | docs |
| F-020 | S1 | SILENT | `mask unless` emits Java missing `import java.util.Objects` | #2925 merged |
| F-021 | S1 | SILENT | reactor `for-each` emits non-compiling Java | #2926 merged |
| F-022 | S1 | SILENT | field named `member` → invalid F# | #2923 merged |
| F-023 | S1 | SILENT | a workflow + a Feliz UI references a `Model` field never declared (`model.AllWs`) — found while fixing the above | #2923 merged |

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

## Found while fixing, deliberately NOT fixed

Each was surfaced by a wave agent, verified, and left out of scope rather than
silently widening a PR. Recorded here so they are not lost:

| What | Where | Why deferred |
|---|---|---|
| `with crudish, auditable` emits `createdBy: User id` against a `User` aggregate the model need not declare — the generated Java fails with `symbol: class UserId`. 12-line repro. | `crudish` + `auditable` interaction | Unrelated to any wave's brief; wants its own issue |
| Other .NET entity members a field can collide with (`Create`, `AssertInvariants`, `Id`, …) — the same class as F-015, partly gated by `loom.dotnet-name-collision` | `dotnet/emit/entity.ts` | Separate defect class; F-015's fix is class-proof for the holder only |
| A cross-context value object reached **only through a workflow** still degrades — `java/emit/workflow*.ts` and `elixir/**` still resolve against `ctx.valueObjects` | java + elixir workflow emitters | Those dirs were reserved to another wave; named as a known gap in #2925 |
| `loom.workflow-foreach-unknown-binding` false-positives on a loop-body `factory-let` (pre-existing, reproduces identically on `main`) | `ir/validate/checks/workflow-checks.ts` | Pre-existing; fix location identified, not this wave's |
| A domain `valueobject` named after a walker primitive **captured** the primitive in lowering, silently disabling every CallIR-keyed page validator | `lowerBuilderCall` | **Fixed** in #2925 via `Env.ui` — noted here because it is F-014's mirror image, from the lowering side rather than the validator side |

## Correction to F-001, recorded 2026-09-14

**The original entry understated the scope, and the method error is worth
recording.** The first pass graded node / python / java as *unaffected* by
inspecting the emitted files — a shared `value-objects` module existed, so the
row was marked OK. It was never compiled. Compiling it shows two further
defects, measured on `main` @ `c89ccb44` with a two-context model whose
aggregates carry `with crudish`:

```
node:  domain/beta.ts references Money 7x; its imports are Ids and Events only
java:  public void update(String price)        <- the `Money` parameter collapsed to String
```

The second is a **separate root cause**: `indexMembers` in `lower.ts` walked
`members`, but a `Subdomain` holds its contexts in `contexts`, so the member
index was empty for any subdomain-wrapped model and `crudish`'s
`update(paid: Money)` lowered to `update(paid: string)` **on all five
backends**. That is silently-wrong typing, not a missing import — worse than
the row it was found under.

The same evaluation's own report flagged three frontends as "confirmed by
inspection of the emitted text only — I did not stand up their toolchains" and
then failed to apply that qualifier to the backends. **Inspection is not a
compile**, and the register should not have carried an unqualified OK for a
target that was never built.

## What the evaluator could not find in the tree

Nothing in `test/` compiles a corpus model containing a shared value object, a
field named `state`, a field named `member`, an `X id[]` and a reactor
`for`-loop against every target. That absence is why a 16-agent internal audit
(`targets-completeness-2026-08-30`) carries none of these six rows.
