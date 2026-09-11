# Wave C1 · packet 1b (`match` error-variant binding + the placement fork) — hand-off

*Branch: `claude/c1-1b-placement-fork`. Base: `bcc1c4c86` (the wave-C1 branch head
= `main` + Wave C0). Tree fence: `src/language/validators/**`,
`src/ir/validate/checks/**` (not needed — see §Placement below),
`src/diagnostics/{messages,code-docs}.ts`, `src/generator/_stmt/target.ts`,
`test/fixtures/corpus/` (not used — see §Where the fixtures went),
`docs/new-plan/T5-*.md` / `T6-*.md` (mission headings only),
`docs/language-reference/`.*

Commits:

| sha | what |
|---|---|
| `87a6ef323` | the four `.ddd` fixtures (rule 13 — their own commit) |
| `1a4c2e0dd` | the three gates, the two generator guards, the codes + anchors + census entries |
| `235766c7c` | M-T5.28 `done`, M-T5.30 minted, M-T6.61 flipped, language-reference ch. 6 |

---

## Row table

| row | outcome | proof: test file + the assertion that fails when reverted |
|---|---|---|
| **M-T6.61** `match` error-variant binding, .NET + Java (P0) | **already fixed — tracker flip, no rebuild** | re-verified BY GENERATING on this head; see §M-T6.61 below |
| **M-T5.28** `variant-match` off a page crashes all five backends | **gated** — `loom.variant-match-placement`, phase ④, permanent refusal | `test/language/validators/stmt-placement.test.ts` → *"refuses the effect form of `match` in a domain body, on the offending statement"*: `expected [] to deeply equal [ 'loom.variant-match-placement' ]` |
| **M-T5.28** `if let` off a workflow emits `<unknown>` | **gated** — `loom.if-let-placement`, phase ④, permanent refusal | same file → *"refuses `if let` outside a workflow as a permanent rule"*: `expected [] to deeply equal [ 'loom.if-let-placement' ]` |
| **M-T5.28** `for` off a workflow emits `<unknown>` | **gated as an HONEST GAP** — `loom.for-placement`, phase ④, names successor **M-T5.30** | same file → *"refuses `for` outside a workflow as an HONEST GAP naming its successor mission"*: `expected [] to deeply equal [ 'loom.for-placement' ]` |
| the gates do not refuse valid programs | **guarded** | same file → *"leaves all three alone in the bodies that DO lower them"*: under the zone mutation, `expected [ {…}, {…} ] to deeply equal []` with both diagnostics printed against `commandHandler 'sweepAgain'` |
| the `_stmt/target.ts` throw at ~line 205 | **replaced with an internal-invariant assertion**, `default:`-arm `never` check added | `test/generator/_stmt/target.test.ts` → *"dispatches the shared spine's variant-match guard, naming the backend"* (updated to the new text); `npx tsc -b` fails if a `StmtIR.kind` loses its arm |
| the SECOND copy of that throw, `elixir/vanilla/operation-returns-emit.ts:1244` | **same treatment** (found by grepping the old text; it was not in the packet brief) | `npx vitest run test/generator/elixir` — 192 files / 1205 tests green |
| **M-T5.30** minted `open` in `T5-language-core.md` | **new mission** — the successor `loom.for-placement` names | `test/language/validators/stmt-placement.test.ts` asserts the string `M-T5.30` is IN the `for` message and NOT in either permanent one |

Nothing handed off: no defect outside the fence was found that this packet
could not close. One adjacent, already-honest gap is recorded in §M-T6.61.

---

## M-T6.61 — verified fixed on this head, by generating

The packet brief said "verify by generating a `match` with an `error` arm on
dotnet + java and reading the output; if fixed, flip, do not rebuild." Done —
and the first repro was a FALSE NEGATIVE worth recording, because it is the
shape the fix's own commit message warns about.

A `match` over a **repository union find** bound with `let`
(`let outcome = Orders.byCode(code)` where `byCode: Order or NotFound`) renders
as a presence ternary — `var label = outcome is not null ? outcome.Code :
outcome.Resource;` — never reaching `matchVariant` at all. That is the
"optional twin" path, and it is correct; it just cannot see the bug.

The bug's actual shape is an ORDINARY one-success/one-error DU whose carriers
are emitted: `payload Hit { code: string }` + `error NotFound { resource:
string }`, an `operation probe(): Hit or NotFound`, then
`owner := match r { Hit h => h.code, NotFound n => n.resource }`. On this head
both backends bind the arm:

```csharp
Owner = r switch {
    HitOrNotFound_Hit h => h.Code,
    HitOrNotFound_NotFound n => n.Resource,
    _ => throw new System.InvalidOperationException("unmatched variant"),
};
```
```java
this.owner = switch (r) {
  case HitOrNotFound_Hit h -> h.code();
  case HitOrNotFound_NotFound n -> n.resource();
  default -> null;
};
```

against the reported `_ => n.Resource` (CS0103) / `case null -> n.resource()`
(cannot find symbol). Fixed by **#2857 / `f518e31`**, 2026-09-10 — both leaves
had special-cased "one non-error variant + ≥1 error variant" as an optional
twin, an arity guess that also matches a real DU.

**Adjacent finding, honest and already coded, not handed off:** the same repro
on `platform: elixir` is refused by `loom.vanilla-op-call-position` (a sibling-op
call outside `return` tail position, which the elixir backend cannot lower).
That is a named refusal with a remedy in its text, not a silent decline, so it
needs no row.

Consequence for this packet: the plan's condition on M-T5.28's messages ("must
not recommend the .NET/Java `match` form **until 1b's fix is in**") is satisfied.
The messages nonetheless recommend **no replacement construct at all** — see
§Message design — so they are correct independent of that fix and will not need
a follow-up edit.

---

## Placement — what reproduces, and why the gate is phase ④

All three reproduced on this head before anything was built (`node bin/cli.js
parse` + `generate system`, `platform:` substituted five ways):

| shape, in an aggregate `operation` body | phase ④ before | emission before |
|---|---|---|
| `match probe() { NotFound e => … }` | `0 error(s), 0 warning(s)` | **THREW** on all five: `variant-match statement is frontend-only; it must not reach the {TS, .NET, vanilla Elixir, Java, Python} backend` |
| `for n in notes { code := n }` | `0 error(s), 0 warning(s)` | `this.<unknown>()` (node/.NET/Java), `self._<unknown>()` (python), `_ = <unknown>(record)` (elixir) — generation **succeeded** |
| `if let c = code { code := c }` | `0 error(s), 0 warning(s)` | same `<unknown>` sentinel, all five, generation succeeded |

The mission's fork ("gate or lower") resolved as **gate on all three**, which
is the ruling's default. The genuinely open question the brief asked me to
decide was WHERE, and it has a hard answer rather than a preference:

> **`for` / `if let` outside a workflow have no IR node at all.** `lower-stmt.ts`
> has no arm for either, so by the time an IR check leaf (phase ⑦) could look,
> the statement has already been replaced by the fallback's
> `{kind:"call", target:"function", name:"<unknown>"}`. An IR gate could only
> pattern-match that sentinel — a *proxy* for the defect, and one shared with
> every other unhandled statement kind, present and future.

Phase ④ sees the real construct, its exact span, and — since the answer is pure
containment — needs nothing lowering would add. `variant-match` *does* survive
into the IR, but splitting one three-line rule across two phases for that alone
would have been worse. So: one new leaf, `src/language/validators/stmt-placement.ts`,
a single `AstUtils.streamAllContents` pass with two helpers —

* `zoneOf(node)` walks outwards to the first classifying ancestor →
  `frontend` (`ActionDecl` / `Page` / `Component` / `Store` / `Ui`),
  `workflow` (`WorkflowCreateDecl` / `HandleDecl` / `OnDecl` / `CommandHandler` /
  `QueryHandler`), `domain` (`Operation` / `Create` / `Destroy` / `Apply` /
  `FunctionDecl` / `DomainServiceOperation` / `ProjectionOn`), or `unknown`.
  The nesting statements and `Lambda` are transparent, so a `match` inside a
  page-body lambda inherits `frontend` and one inside a domain `if` inherits
  `domain`.
* `describeOwner(node)` names that body in the message (`operation 'touch'`,
  `commandHandler 'sweepAgain'`, `a projection 'on' fold`, …).

`zoneOf` returning `unknown` fires nothing, deliberately: a body owner added to
the grammar later degrades to *silence as today* rather than to a false refusal.
The complete container set for `Statement` is enumerated at
`src/language/generated/ast.ts:530`, and every reachable body owner in it is
classified — `StampDecl`, `TestBlock`, `TestE2E` and `UiNotification` appear
there only via statement kinds their own rules admit (`AssignOrCallStmt` /
`TestStatement`), none of which is one of the three gated ones.

### The two generator throws

The brief named `_stmt/target.ts:205`. Grepping the old text found a **second
copy** — `src/generator/elixir/vanilla/operation-returns-emit.ts:1244`, the
vanilla-Elixir body renderer's own `variant-match` arm. Both now throw an
internal-invariant error naming `loom.variant-match-placement` rather than
asserting a design rule. Both stay THROWS: a silent skip drops the statement's
effects on the floor, which is the failure mode the mission exists to remove.
`_stmt/target.ts` additionally grows a `default:` arm holding the `never`
binding, so a new `StmtIR.kind` remains a compile error there exactly as it was
when the `variant-match` arm was the switch's last one.

---

## Message design — why the permanent refusals name no replacement

The brief: *"the message for the two permanent refusals must NOT recommend the
.NET/Java `match` form."* Rather than write a message that is correct only until
M-T6.61 lands and then wants editing, the two permanent messages prescribe **no
replacement construct at all** — they state where the construct lives and why,
and stop:

* `loom.variant-match-placement` — "…is frontend-only — it lowers to a page /
  component / store 'action' handler and has no backend form — but this one is
  in *`<owner>`*, which runs on the backend. Move the effect into the 'action'
  that invokes it. This is a **permanent placement rule, not a missing feature**."
* `loom.if-let-placement` — "…only a workflow body ('create' / 'handle' / 'on')
  or a top-level 'commandHandler' / 'queryHandler' lowers it. This one is in
  *`<owner>`*… do the optional read in a workflow or handler and pass the
  resolved value in. This is a **permanent placement rule, not a missing feature**."
* `loom.for-placement` — "…that lowering owns the per-iteration save the loop
  needs. This one is in *`<owner>`*, where the loop would be dropped silently.
  Put it in a workflow or handler for now; this is a **GAP, not a design rule** —
  mission **M-T5.30** tracks lowering 'for' into domain bodies."

The test pins that asymmetry directly: `toContain("permanent placement rule")`
+ `not.toMatch(/M-T\d/)` on the two, and `toContain("GAP, not a design rule")`
+ `toContain("M-T5.30")` + `not.toContain("permanent placement rule")` on the
third. A future author who softens one into the other fails a named assertion.

**M-T5.30** (`docs/new-plan/T5-language-core.md`, `open` · **M** · P3) is that
successor: decide whether a domain-body `for` over a *containment or value
array* — where no repository save is involved — is meaningful; if yes it is a
`StmtIR` kind plus one arm in each of the five `StmtTarget` leaf tables and the
`_stmt` spine (which already owns the `if` recursion); if no, the "GAP" clause
comes out and `loom.for-placement` becomes the third permanent rule. The
mission's verification section names the exact test assertion to flip in the
decline case.

---

## Where the fixtures went, and why not `test/fixtures/corpus/`

The brief asked me to check for a negative-fixture convention in the corpus
first. **There is none.** `test/fixtures/corpus/manifest.ts` carries `id`,
`title`, `doc`, `backends`, `note`, `deployables` and nothing else; the word
`expectDiagnostics` (or any equivalent) appears nowhere in the manifest, in
`backends.ts`, in `harness.ts`, or in `test/conformance/corpus-coverage.test.ts`.
The corpus is a **positive matrix by construction**: every `<id>.ddd` must
GENERATE cleanly on each backend its row declares, and a feature with no row
fails the completeness check — so a source the compiler refuses has no shape to
take there. Where the corpus records a refusal today it does so in PROSE, in a
row's `note`, with the negative itself pinned in a per-topic test (e.g. the
`projection-document-aggregation` row points at
`test/ir/projection-document-aggregation.test.ts`).

So the refusal fixtures live beside their gate, which is the convention the
repo's other negatives already follow (`test/ir/temporal-queryable-gate.test.ts`,
`test/ir/projection-document-aggregation.test.ts`) — with one upgrade: they are
real `.ddd` FILES rather than inline template strings, so `ddd parse
test/language/validators/fixtures/stmt-placement-for.ddd` reproduces the refusal
by hand.

```
test/language/validators/fixtures/
  stmt-placement-variant-match.ddd   refused: loom.variant-match-placement
  stmt-placement-for.ddd             refused: loom.for-placement
  stmt-placement-if-let.ddd          refused: loom.if-let-placement
  stmt-placement-allowed.ddd         the over-fire guard — all six legal sites
```

Each refusal file carries a header saying what it refuses and why it is not in
the corpus, so the next reader does not re-litigate it.

Being tracked `.ddd` files they enter `test/system/ddd-source-census.test.ts`'s
population, whose "validates every self-contained `.ddd` with zero AST errors"
gate they would fail by design — so all three are pinned in
`DELIBERATELY_INVALID` with the reason. That is not just bookkeeping: the
census's negative control (`it("still rejects the deliberately-invalid
fixture")`) now asserts all four keep producing errors, so **a gate deleted by
accident fails there as well as in its own suite.**

The fourth fixture doubles as the regression net the mission needs most. The
danger with a placement rule is over-firing, and the six legal sites it carries
are exactly the ones a mis-classified body owner would break: workflow `create`
× {`for`, `if let`}, `commandHandler` × {`for`, `if let`}, and a page `action`'s
`match await` (twice over, arms bound).

---

## Mutation proofs

Method per CLAUDE.md: pristine copy saved to the scratchpad first, mutation
applied in place, suite run, **file copied back** (never `git checkout --`).
Restoration verified green after each.

| # | mutation | command | the assertion that failed |
|---|---|---|---|
| 1 | `stmt-placement.ts` — `if (isMatchStmt(node)) { if (true) continue; …` (the variant-match check never fires) | `npx vitest run test/language/validators/stmt-placement.test.ts test/system/diagnostic-firing-census.test.ts` | `stmt-placement.test.ts` → *"refuses the effect form of `match` in a domain body, on the offending statement"*: `AssertionError: expected [] to deeply equal [ 'loom.variant-match-placement' ]`. AND `diagnostic-firing-census.test.ts` → *"loom.variant-match-placement fires"*: `did not come out of its own fixture … Raised instead: (nothing)`. 2 failed / 122 passed |
| 2 | same, on the `isIfLetStmt` arm | same | *"refuses `if let` outside a workflow as a permanent rule"*: `expected [] to deeply equal [ 'loom.if-let-placement' ]`, + the census's *"loom.if-let-placement fires"*. 2 failed / 122 passed |
| 3 | same, on the `isForStmt` arm | same | *"refuses `for` outside a workflow as an HONEST GAP naming its successor mission"*: `expected [] to deeply equal [ 'loom.for-placement' ]`, + the census's *"loom.for-placement fires"*. 2 failed / 122 passed |
| 4 | `zoneOf` — dropped `isCommandHandler(c)` from the workflow arm, so a handler body reads as `domain` (the over-fire shape, not the under-fire one) | `npx vitest run test/language/validators/stmt-placement.test.ts` | *"leaves all three alone in the bodies that DO lower them"*: `expected [ { …(3) }, { …(3) } ] to deeply equal []`, printing `loom.for-placement` at line 35 and `loom.if-let-placement` at line 36, both naming `commandHandler 'sweepAgain'`. 1 failed / 3 passed |

Mutations 1–3 prove each gate reaches the thing it names; mutation 4 proves the
over-fire guard is not vacuous — it is the one that would have caught a
mis-classified body owner, the likeliest way this rule goes wrong.

The two generator guards are not mutation-proved by a refusal test, and
deliberately: they are now UNREACHABLE from `.ddd` source (that is the point of
the phase-④ gate). What still gates them is `test/generator/_stmt/target.test.ts`,
which drives the spine directly with a synthetic `variant-match` `StmtIR` and
asserts the throw, and `npx tsc -b`, which fails if the `default:` arm's `never`
binding stops being `never`.

---

## Gates run, with counts

All on the packet's final tree (post-commit), `nice -n 10`:

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `test/ typecheck ratchet OK — 182 files, 470 errors, src/ clean` (unchanged: the new test file adds none) |
| `npm run lint` (`biome ci .`) | exit 0, 3031 files; none of the new/changed files flagged |
| `npx vitest run test/language` | **189 files / 1901 passed**, 2 skipped |
| `npx vitest run test/ir` | **261 files / 2994 passed**, 1 skipped |
| `npx vitest run test/system` | **90 files / 1930 passed**, 30 skipped (1 file skipped) |
| `npx vitest run test/conformance` | **44 files / 3100 passed** |
| `npx vitest run test/cli` | **18 files / 120 passed** |
| `npx vitest run test/generator/elixir` | **192 files / 1205 passed** |
| `npx vitest run test/generator/_stmt test/generator/typescript/render-stmt-chunks.test.ts test/language/validators` | **5 files / 57 passed** |
| `node docs/build.mjs` | rendered clean (no site artefacts tracked) |
| every tracked `.ddd` re-validated under the new gates | `ddd-source-census.test.ts` 5/5 — **340 files, zero new failures** |
| every `examples/**` + `web/src/examples/**` re-parsed by hand | all clean except the pre-existing `examples/sales-ui.ddd` (`NON_PARSING_SOURCES`, unrelated) |

`node scripts/mission-counts.mjs --write` — **the script does not exist on this
tree.** It is Wave **C0.4**'s deliverable (`docs/new-plan/README.md:62` says so
in as many words: *"a script for this number is Wave C0.4 of the completion
plan"*), and nothing under `scripts/`, `test/` or `package.json` references the
name. There is likewise no `test/system/mission-counts.test.ts`. The track-file
edits are therefore hand-made and the README's 175-heading count is left alone;
whoever lands C0.4 should re-derive it (`grep -c '^## M-T' docs/new-plan/T*.md`
is +1 net from this packet: M-T5.28 and M-T6.61 stay as `done` headings pending
archival, M-T5.30 is new).

`node scripts/ledger-counts.mjs --check` not run — this packet touches no
ledger row.

---

## For the coordinator

* **`src/diagnostics/messages.ts` was edited ADDITIVELY**, as the brief required:
  one new section block (`// src/language/validators/stmt-placement.ts`) inserted
  between the existing `statements.ts` and `structural.ts` sections, three new
  keys, nothing reordered or reworded. Expect a clean fold against #2860 / #2861
  / #2884.
* `src/diagnostics/code-docs.ts` likewise: three keys appended inside the
  existing chapter-06 group.
* The only file outside the stated fence is
  `src/generator/elixir/vanilla/operation-returns-emit.ts` — the second copy of
  the throw the brief pointed at. The change is the same five-line guard
  rewrite; if the fence must hold strictly, that hunk can be lifted out and the
  packet still lands (the elixir throw then keeps its old wording, claiming a
  design rule the validator now owns).
* `test/system/ddd-source-census.test.ts` and
  `test/system/diagnostic-firing-census.test.ts` are both ratchet registers that
  MUST be edited by any packet that mints a code or adds a `.ddd`; both were
  outside the brief's list but neither is optional.
