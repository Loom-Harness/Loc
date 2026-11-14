# D-NUMERIC-INGRESS-STRICT — request-side numeric lenience is narrowed to match the strict majority

**Status:** proposed — **owner-only, no default.** It is a breaking narrowing on
a shipping wire; no client can be signed up to it by a timer.

**Question.** python and elixir accept request values the other three refuse — a
stringified number for an `int` field, and (elixir alone) a JSON number for a
`money` field. Narrow them, or ratify the lenience?

**Options.** (a) strict everywhere — refuse a string where a number is declared,
refuse a JSON number where `money` is declared; (b) lenient everywhere — widen
node/.NET/java to coerce; (c) leave the skew and document it.

**Decision (proposed).** (a) strict, on **both** rows.

**Rationale.**

- **The contract is already strict on the majority and in the published schema.**
  node emits `z.number().int()`, .NET's `System.Text.Json` refuses String→Number
  without `AllowReadingFromString`, and java's `WireNumberStrictness` fails the
  `LogicalType.Integer` string coercion — the one backend that was *moved* there
  deliberately, by M-T6.48. python's acceptance is pydantic 2 lax mode and
  elixir's is `Ecto.Type.cast(:integer, "5")`: two framework defaults nobody
  chose.
- **The money row is worse than a skew.** Four backends type a `money` request
  field as a STRING (`z.string()`, `string Price`, `String price`,
  `Annotated[str, …]`), so a JSON number never reaches a guard. Elixir's
  create/update path casts straight onto the `:decimal` column, so nothing types
  the wire value and `Ecto.Type.cast(:decimal, 12.5)` succeeds. RS-12 governs the
  RESPONSE direction only — it says how money serializes, not what a request may
  carry — which is why no existing gate saw this.
- **Owner-only** because a client sending `{"qty":"5"}` to a python or elixir
  deployable starts getting a 4xx it did not get before. Nothing in the repo can
  make that call for a downstream consumer.

**Consequences.** `ConfigDict(strict=True)` on python request models — or
per-field `Strict()`, which is narrower and leaves datetime parsing alone — and a
pre-`cast/3` wire-type guard on the elixir changeset path
(`__loom_int_field` / `__loom_money_field`, answering through the existing
`__loom_param_error` responder the op-param arm already emits). The
characterization pins in the second `describe` of
`test/conformance/numeric-ingress-parity.test.ts` are deleted and replaced by the
same assertions inverted, in the same diff, so the contract is visibly moving;
the file's header measurement table is **re-measured against the real
deserializers**, not edited.

**Not in this ruling — the third divergence is an ordinary defect.** M-T6.60 also
records a 40-digit money string parsing on node/java/python/elixir, reaching
`NUMERIC(19,4)`, and 500-ing from the database (only .NET refuses it, because
`decimal.TryParse` stops at ~29 significant digits). A 500 is never the right
answer, so there is nothing to rule: it is a **defect**, bounded from
`MONEY_WIRE_SCALE` + the `NUMERIC(19,4)` precision in
`src/generator/money-scale.ts` so one constant governs both the wire guard and
the column, and it drains with wave **C1 packet 1e**'s `G2644` numeric-ingress
residue row rather than waiting on a signature.

**Unblocks.** M-T6.60 → wave **C2 packet 2f**; Schemathesis F11.

**Sources.** [`T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.60;
[`numeric-types-audit-2026-08-23.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/numeric-types-audit-2026-08-23.md)
F12 annex; M-T6.48 and `test/conformance/numeric-ingress-parity.test.ts`; RS-12,
RS-24.
