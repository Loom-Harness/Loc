# Fix register — every finding, its disposition, and who owns it

Ground truth re-established against fresh `origin/main` **76ef74ad** on 2026-09-14,
190 commits after the evaluation. Every "still broken" row below was re-run from
its `eval/repro/*.ddd` file on that base, not carried over from the report.

Three things changed between the evaluation and this register:

- **F-008 is FIXED upstream** (PR #2884, merged). `currentUser.permissions` against
  a `user {}` shape with no `permissions` field is now 2 parse errors, was 0.
- **F-013, F-026, F-036 are CLAIMED** by PR #2911 — a parallel end-to-end FieldOps
  evaluation that reached the same MinIO image, the same `Api.Api` namespace bug
  and the same false LICENSE claim independently. Not ours to take.
- **F-032 and F-035 are CLAIMED** by #2923 / #2924 (the "Commons" audit waves).

Everything else was re-verified as still broken and is assigned below.

---

## Assigned — twelve parallel work packets

Each agent: branches from fresh `main`, re-verifies its own cluster first, opens a
**draft PR to claim before implementing** (CLAUDE.md §"Claim your work with a draft
PR"), then mutation-proves every gate by file copy (never `git checkout --`, §84)
and verifies against the **real toolchain**, not an emitted-text assertion.

All twelve are claimed with a live draft PR. **The claim protocol earned its keep:**
a container restart killed all twelve agents mid-flight, and because every one had
opened its PR before implementing, nothing had to be re-planned — each successor
resumed from its own PR body, and two agents' completed work survived on their
pushed branches (the broker fix: 10 files / +833; the primitive-member fix: 3
files / +142).

| PR | Cluster | Findings | The one-sentence root cause |
|---|---|---|---|
| **#2940** | **A** `fix-projection-schema-resolution` | F-006, F-011, F-041 | a projection's `select` resolves names against the DOMAIN MODEL, not the EMITTED TABLE — so a `derived`, a value-object sub-field and a TPH subtype each emit a column or relation that does not exist |
| **#2939** | **B** `fix-emitted-import-symbols` | F-009, F-030 | the emitted TypeScript uses a symbol the file never imports (`ne` from a `!=` filter; `Decimal` from a `money` default) — import sets are accumulated per call site |
| **#2949** | **C** `fix-primitive-member-access` | F-040, F-040a | there is no member table for primitive receivers, so `s.totallyMadeUpMember` validates clean and is emitted verbatim — including into an `invariant` that can then never fire |
| **#2945** | **D** `fix-currentuser-in-criteria` | F-007, F-023 | the row-level authorization primitive: python/elixir emit an unbound `current_user`, and any claim other than `.id` passes validation then crashes codegen |
| **#2942** | **E** `fix-page-emitter-fails-open` | F-014, F-015 | the page-body emitter's designed fallback is `/* unresolved: X */ undefined`; and the documented list-read gate switches the client's response shape while the page still reads `.items` |
| **#2944** | **F** `f019-broker-wire-decode` | F-019 | the consumer spreads `JSON.parse` output through `as unknown as DomainEvent`, so every event carrying a `datetime` is delivered and then silently dropped |
| **#2947** | **G** `fix-four-codegen-defects` | F-010, F-017, F-021, F-039 | four independent small defects: an optional part field emitted as required; a `managed` NOT NULL field with no default is unconstructible; Vue rejects an optional ref in a `router-link`; `== null` emits `eq(col, null)` instead of `isNull(col)` |
| **#2946** | **H** `fix-migration-silent-rebaseline` | F-029 *(+F-020)* | the migration baseline is state inside the output tree, so generating into a clean directory re-emits `Initial` under the same tag, the migrator skips it, and the app 500s while the healthcheck stays green |
| **#2943** | **I** `fix-enum-member-collision` | F-022 | a bare enum value lowers by first-declaration-wins instead of by the target's enum type — one IR bug, five backends, four different outcomes |
| **—** | **J** `fix-java-elixir-feliz-compile` | F-024, F-025, F-027, F-033 | the Java/Elixir/Feliz half of "five backends generate, one compiles" |
| **#2948** | **K** `fix-auth-bootstrap-and-overwrite-visibility` | F-016, F-018, F-031 | the generated Keycloak realm provisions none of the declared claims (so the shipped auth demo 500s on every write); a missing claim is a 500 not a 4xx; regenerate clobbers hand-edits reporting only a count |
| **—** | **L** `fix-i18n-locale-wiring` | F-034 *(+ scoping F-004, F-042, F-043)* | the `ddd i18n` translator workflow and the generated `t()` runtime never meet |

### Deliberately scoped, not landed (cluster L, Part 2)

These are language-design decisions, not defects. Landing them blind would be
worse than leaving them. Each gets a written proposal and an effort estimate:

- **F-004** — a workflow `for` body cannot load another aggregate, so "decrement
  stock for each part used, transactionally" has no expression. *The misleading
  diagnostic IS being fixed* (it blames an unknown binding when the binding
  exists); the feature is not.
- **F-042** — one `resource` per (context, kind), so two external APIs force a
  context split for infrastructural reasons.
- **F-043** — `requires` gates have no `can_*` companion, so an authority-limit
  rule can gate the write but cannot be shown in the UI, and must be duplicated
  client-side.

---

## Not assigned, with reasons

| Finding | Why not |
|---|---|
| F-008 | **fixed upstream** — PR #2884, verified on 76ef74ad |
| F-013, F-026, F-036 | **claimed** by PR #2911 (parallel FieldOps evaluation) |
| F-032 | **claimed** — #2883 (merged, widened some) + #2923 (`state`, `member`). Still 21 reserved words on fresh main, but it is in flight |
| F-035 | **claimed** by #2924 ("a verify gate that cannot fail") |
| F-001 | S4. `ddd` is never put on `PATH`; a README `npm link` line |
| F-002 | 11 advisories (4 high) in the toolchain's own deps — the `dependency-upgrade` skill owns this shape, and it touches both surfaces |
| F-003 | the proxy-CA mechanism EXISTS and is documented; only the failure path doesn't point at it |
| F-005 | subsumed by cluster D — if D widens the queryable vocabulary, the requirement becomes expressible |
| F-012, F-028 | roll-up summaries of other findings, no separate fix |
| F-037 | project health, not a code change |
| F-038 | **honest by design.** TPH→TPC is refused with an excellent diagnostic when anything references the base by `Base id`. Worth knowing (the decision is permanent at modelling time), not worth "fixing" silently |

---

## What the fleet is being held to

Every packet carries the same bar, because the finding that mattered most in the
evaluation was not any single bug — it was that **both models validated clean and
did not compile**. So:

1. **Re-verify on fresh `main` first.** Claims rot; 190 commits landed under this
   register between the evaluation and today, and one finding had already been fixed.
2. **Draft PR before code**, naming the files touched — the repo runs parallel
   agents and a claim is how they avoid colliding.
3. **Mutation-prove every gate**, reverting by file copy. A green first run proves
   nothing; and `git checkout -- <path>` silently discards every other uncommitted
   edit in the file, so a proof reverted that way can fail for an unrelated reason
   and read as a pass.
4. **Verify against the real toolchain.** `tsc --noEmit`, `dotnet build`,
   `gradle testClasses`, `mix compile`, `mypy` — or, where the defect is invisible
   to a compiler (F-019's dropped event, F-029's skipped migration, F-016's empty
   token), **boot the stack and check the value**. PR #2911 put it well:
   *"a gate's reach is bounded by its oracle as well as its inputs."*
