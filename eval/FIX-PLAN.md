# Loom — fix plan for the defects found in the FieldOps evaluation

**Base:** fresh `main` @ `9a8f2fe0` (93 commits after the `09427a5` the evaluation ran on).
**Method:** every finding was **re-verified against fresh main before any fix was planned**, and
cross-checked against the ~30 open PRs for an existing claim. Nothing here is planned from memory of
the evaluation; a finding that no longer reproduces is marked FIXED and dropped.

> **Status: fleet in progress.** Nine agents are re-verifying and root-causing in parallel, one per
> subsystem. Sections 3–5 fill in as they report. Sections 1–2 are independent of that work.

---

## 1. The census that should drive the plan

My evaluation was not the only one. Four other agents built a different application end to end over
the same weekend, compiled the output, and filed what broke. Each explicitly deduped against the
others:

| Audit | Domain | Distinct defects filed | Overlap with the other builds |
|---|---|---|---|
| [#2861](https://github.com/Loom-Harness/Loc/pull/2861) | Jira-like tracker | 4 defects + 4 minted missions | negotiated, ~none |
| [#2862](https://github.com/Loom-Harness/Loc/pull/2862) | e-shop | 21 (D1–D10, P1–P11) → **8 fix PRs** | negotiated, ~none |
| [#2864](https://github.com/Loom-Harness/Loc/pull/2864) | freight forwarding | 7 defects + 4 design gaps | "none of the following is re-claimed here" |
| [#2865](https://github.com/Loom-Harness/Loc/pull/2865) | insurance claims | 4 defects | "**none of my four defects appear in any of their claimed slices**" |
| **this one** | multi-tenant field service | **45 findings, 16 S1** | partial — a handful already claimed |

**Five independent builds. Roughly eighty distinct defects. Near-zero mutual overlap.**

That is the number the plan has to answer to. It means the defect surface is **not being sampled to
exhaustion** — each new domain model finds a fresh set of emitter bugs, because each exercises a
different corner of the type × access-modifier × capability × target matrix. Patching the eighty does
not converge; the sixth build will find another forty.

Two of the other audits reached the same conclusion independently and said it plainly:

> #2864: *"D2, D3 and D4 are each **one fixture** away from being impossible. The per-PR
> `hono-build.yml` corpus carries no value object holding an `X id`, no workflow whose state field is
> an enum, and no `managed` field with a declared default — so three emitters can emit non-compiling
> TypeScript with every gate green. **The durable fix is one fixture carrying all three shapes plus a
> ratchet on the ts-build set's coverage of the type × access-modifier matrix, not three patches.**"*

> `experience_gathered.md` §104: *"**`npm test` cannot catch this class, structurally.** It compares
> strings. The question 'does this name resolve in the module that uses it?' is answered by the
> target language's own toolchain, and that runs one tier up — an opt-in corpus leg, not the per-PR
> fast suite."*

So this plan is in two halves, and **the second half is the one that matters**:

- **(A) Land the individual fixes** — necessary, bounded, mostly small. §3.
- **(B) Change what the gates measure** so the class stops regenerating. §5.

Doing only (A) is the failure mode this project is already in: 50 of its 92 issues are auto-filed
"🔴 main is red", and five independent audits in one weekend each found a disjoint set of the same
kind of bug.

---

## 2. What "already claimed" means here, and why it is checked first

`main` moved 93 commits under my evaluation while I was writing it, and several findings were fixed
or claimed in that window. Claiming work someone else has in flight is the most expensive mistake
available in this repo (CLAUDE.md devotes a whole section to it). So every row below carries one of:

- **FIXED** — no longer reproduces on `9a8f2fe0`; the fixing commit is named. No work planned.
- **CLAIMED BY #NNNN** — an open PR covers it; the PR is named and read. No work planned; if my repro
  adds a case the PR misses, that is noted as a comment to leave, not a new PR.
- **LIVE + UNCLAIMED** — reproduces, nobody owns it. These get a fix plan.

Known-or-suspected claims going in (to be confirmed per-finding by the fleet):

| My finding | Likely claim |
|---|---|
| F-006 `create(...)` params silently ignored | **#2861 slice 4** — adds `loom.create-params-not-wire`; mission **M-T5.32** makes the params *become* the contract and deletes the gate |
| F-008 `crudish` ⊥ `denyByDefault` | **#2877** — `with crudish(requires: <Policy>)` |
| F-010 deny-by-default forces the deprecated `find all` | **#2874** — "a `find` deprecation with nothing to migrate to"; also #2861 slice 3 |
| F-014 FK vs nullable user claim | **#2869** — "an `X id?` claim in `user {}` broke node, java, python and dotnet, four different ways" |
| F-032 vue nullable `IdLink` | **#2885** / commit `d8b5f7c1`, and #2861 commit 5 |
| F-011 / F-041 page-gate + page-body holes | **#2871** — "three page-body/gate holes that validate clean and then break codegen" |
| F-001 starter warns on its own output | **#2861 slice 3** |
| the `this.x :=` parse failure I hit | **#2873** |

**One finding is confirmed novel by their own admission.** #2862 states: *"**Angular is unverified
throughout.** Its plain `tsc` is clean and its emitters are untouched, but `ng build` — the half that
would catch the Vue class — could not be run: the generated project's Angular CLI wants Node ≥ 22.22.3
and this host caps at 22.22.2. **Nothing here claims Angular is clean.**"* I ran `ng build` in a
Node 24 container and it fails (F-033). That gap is mine to close.

---

## 3. Per-finding fix plans

*Filling in as the fleet reports.*

## 4. Sequencing

*Filling in.*

## 5. The durable fix — change what the gates measure

*Filling in, informed by the fleet's per-subsystem "why did no gate catch this" analyses.*
