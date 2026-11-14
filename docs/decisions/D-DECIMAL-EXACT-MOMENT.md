# D-DECIMAL-EXACT-MOMENT — decimal exactness ships as ONE PR with every wire golden re-captured

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0). The
*semantic* ruling was already given by the owner on 2026-09-07 (`decimal`
arithmetic is EXACT) and is **not** re-opened here; what this entry rules is the
rule NUMBER and the shipping shape.

**Question.** The owner ruled `decimal` arithmetic exact — under which RS number,
and how does a change that MOVES the oracle every other backend is compared
against actually land?

**Options.** (i) node first, then python, re-capturing goldens twice; (ii) one PR
carrying node + python + every re-captured golden; (iii) freeze the goldens and
compare against a second oracle.

**Decision.** (ii) — **one coordinated PR**, and mint **RS-35** (not RS-31; see
Consequences).

**Rationale.**

- **The oracle is not one golden's property, it is every golden's.**
  `jq -r .oracle test/behavioral/wire-golden/*.json` answers `node` for **all 54
  files** (measured 2026-09-10). Any PR that changes node's decimal arithmetic
  moves all 54 at once, so a partial landing leaves the differential tier
  comparing four backends against an oracle that no longer describes node —
  green exactly where it should be red.
- Splitting by backend also splits the review. The mission demands the goldens be
  reviewed diff-by-diff and never as a drive-by rebaseline; that review is only
  meaningful once, against the final oracle.
- `LOOM_WIRE_UPDATE=1` is the capture path, and it is a single command over the
  whole set — sequencing buys nothing it does not cost twice.

**Consequences.**

- **The plan's "mint RS-31" is stale.** `docs/conformance-semantics.md` already
  carries RS-31 (code-point `.length`), RS-32, RS-33 and RS-34. Under that file's
  own *"Claim the NUMBER before you build"* protocol the next free number is
  **RS-35**, and no open PR claims it (checked against the 11 open PRs on
  2026-09-10). RS-36 and RS-37 are claimed inside this same batch by
  D-FIRST-ON-EMPTY and D-ABSENT-JOIN-DATETIME-WIRE — take RS-38 next.
  **Superseded at the Wave C5 5a fold (2026-09-28):** the datetime rule had not
  landed when decimal-exact minted, and the registry test forbids a gap, so
  decimal-exact took **RS-37**; D-ABSENT-JOIN-DATETIME-WIRE mints RS-38 when it
  lands.
- The PR body states that **historical rows are not rewritten**, so values
  persisted before the change may disagree with values persisted after, and it
  carries the migration note.
- The blast-radius items the mission attached ride the same PR: node's
  `decimal.js` running at the default 20 significant digits (no `Decimal.set`
  emitted) against 28+ elsewhere, the inbound decimal precision-acceptance skew
  (java unlimited / .NET 28–29 / double-clamped), and the
  `sum → decimal` catalog signature in `src/util/collection-ops.ts` disagreeing
  with `type-system.ts`'s body-type rule.
- Scope the node implementation BEFORE writing it and report the finding: python
  already has `Decimal` on the column side (M-T6.45), so its gap may be narrow,
  while node likely needs a decimal library threaded through the domain layer and
  the derived-field evaluator.

**Unblocks.** M-T5.22 → wave **C2 packet 2f**.

**Sources.** [`T5-language-core.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T5-language-core.md) M-T5.22 (the
2026-09-07 ruling);
[`numeric-types-audit-2026-08-23.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/numeric-types-audit-2026-08-23.md)
F11 + annex; [`conformance-semantics.md`](../conformance-semantics.md) RS-24 and the
claim-the-number protocol; `test/behavioral/wire-golden/*.json`.
