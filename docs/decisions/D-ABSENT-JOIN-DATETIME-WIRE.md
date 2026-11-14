# D-ABSENT-JOIN-DATETIME-WIRE — an absent join value is wire `null` on every target; sub-second datetimes ship as milliseconds

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** Two wire-form questions the `G2667-D3` row left open: what does a
LEFT-JOINed field carry when the join target is absent, and what fractional-second
form does a `datetime` take on the wire?

**Options (join).** wire `null` everywhere / each language's own zero default /
drop the source row. **Options (datetime).** node's minimal-digit trim (`.12Z`) /
exactly three digits when a fraction is present (`.120Z`) / microseconds
(`.120000Z`).

**Decision.** **Join = wire `null`, on every backend and every field type** —
RS-34 already pins this and is ratified here, *including* the .NET value-typed
case its own "Open" section leaves unfixed. **Datetime = milliseconds: at most
three fractional digits, and a whole-second instant carries no fraction at all**
(RS-4's canonical `…00Z` is preserved).

**Rationale (join).** RS-34 is already in the registry with all five arms landed
and mutation-proven; the only fork left is .NET's `default!` on a value-typed
joined field, where a joined `int`/`bool`/`decimal`/`datetime` reads
`0`/`false`/`DateTime.MinValue` instead of `null`. That is not a second
semantics, it is an unfinished arm — and RS-34's own reason (wire `null` is the
only value that means the same thing on every backend and needs no per-type
default table) already decides it.

**Rationale (datetime).**

- **The observed triple has one mechanism per backend.** node canonicalises with
  `${date}.toISOString().replace(/\.?0+Z$/, "Z")`
  (`src/generator/typescript/repository-wire-builder.ts:139`), which strips ALL
  trailing zeros, so `.120` spells `.12Z`; java's `Instant.toString()` emits
  digits in groups of three (`.120Z`); python's `isoformat()` emits six
  (`.120000Z`); elixir emits none at all, because its column is `:utc_datetime`
  (second precision) where every other backend's is `TIMESTAMP WITH TIME ZONE`
  (ledger `F2-W-06`).
- **Milliseconds is the only precision every target can carry end to end.** node's
  `Date` is millisecond-resolution by construction, so a microsecond contract
  needs a NEW datetime carrier on node (a string or a decimal) — a far larger
  change than truncating four backends.
- **Three digits rather than node's minimal trim**, because `.12Z` and `.120Z`
  are the same instant spelled two ways: a differential tier comparing strings
  then has to normalise, and normalisation is exactly what hid `F2-W-05` and
  `F2-W-06`.
- **Correction to the plan's proposed default.** "millisecond precision, three
  digits, on every backend" as written contradicts **RS-4**, which is PINNED,
  conforming on all five, and says a whole-second instant spells `…00Z` with the
  zero fraction trimmed. This ruling therefore keeps RS-4's whole-second form and
  applies "exactly three digits" only when a fraction is present.

**Consequences.** Mints **RS-38** for the datetime wire form (RS-35 and RS-36 are
claimed elsewhere in this batch; RS-37 went to decimal-exact at the Wave C5 5a
fold on 2026-09-28, because the registry forbids gaps and this rule had not
landed). RS-34 gains its .NET value-typed arm and its
"Open" section closes — the absent branch stops being `default!` and the
Response schema widens that joined member to nullable. Elixir moves declared
datetime columns to `:utc_datetime_usec` with the matching `timestamptz`
migration column **and deletes the truncation machinery that exists only because
of the old type** (`__truncate_dt/1` in `vanilla/context-emit.ts`,
`stampFieldIsDatetime` in `stamp-emit.ts`, the operation-returns `force_change`
wrap) — leaving it in place would truncate on the wider column and half-fix the
row. Sub-millisecond input is **truncated at ingress, not rounded**, so the
stored value and the wire value agree and a read-back equals the write (RS-4);
rounding can carry a value into the next second. The `<timestamp>` normalisation
that masks this in the differential tier is narrowed in the same PR, or the fix
cannot be seen.

**Unblocks.** `G2667-D3` (.NET value-typed arm) → wave **C2 packet 2d**;
`F2-W-06` → wave **C2 packet 2a**.

**Sources.** [`conformance-semantics.md`](../conformance-semantics.md) RS-4, RS-34
(its Open section); [`targets-completeness-2026-08-30.ledger.json`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/targets-completeness-2026-08-30.ledger.json)
rows `G2667-D3-projection-join-unguarded-index` and `F2-W-06` (with the W1b
elixir note that sizes it);
`src/generator/typescript/repository-wire-builder.ts`,
`src/generator/dotnet/query-projection-emit.ts`,
`src/generator/elixir/vanilla/context-emit.ts`.
