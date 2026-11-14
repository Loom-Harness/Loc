# D-MESSAGELESS-DEFAULT — every message-less wire rule answers node's sentence, on every backend

**Status:** proposed (default applies 48 h after merge unless overridden).
Taken as the owner default recorded for wave C3F ("node's sentence is
canonical", [`wave-c3f.md`](https://github.com/Loom-Harness/Loc/blob/609a44bc8a2f7f7e6215ac99e2cc9858302c0f4d/docs/new-plan/waves/wave-c3f.md)) and built by its packet F4.

**Question.** An unnamed rule still refuses a request, and
the refusal is one `errors[].message` wire field. Before this ruling it had a
value per framework: FluentValidation's `'Amount' must be greater than or
equal to '1'.`, java's generic `Invariant violated: amount >= 1` for a shape it
had classified as single-field, elixir's domain-floor `Precondition failed: …`
(no `errors[]` at all), and python's `Value error, Invariant violated: …` at an
empty pointer. `D-MESSAGELESS-RULE-WIRE-MESSAGE` had settled python's
single-field case only (M-T6.86 held the rest behind four waivers). Which
sentence does the wire carry, for which rules?

**Decision.** The one node sends, for every message-less rule the wire
validator carries, on every backend:

- a single-field shape → `singleFieldMessage(field, pattern)`
  (`src/generator/zod-refine.ts`);
- any other shape → node's refine default `Invariant violated: <source>`, at
  the pointer `pickErrorPath` derives (node's refine `path`);
- no `errors[].code` — the code is the i18n key of AUTHORED text.

`D-MESSAGELESS-RULE-WIRE-MESSAGE` stands; this extends it from python to .NET,
Dapper, java and elixir, and from the single-field shape to every
message-less rule.

**Not covered.** A MISSING required member is not a rule, and its sentence is
still each framework's (node's zod text is itself zod-major-specific:
`Invalid input: expected string, received undefined` on zod 4, `Required` on
3). Whether to adopt a zod text as the cross-backend contract or mint a
Loom-owned sentence is its own question — mission M-T6.93. Elixir's
create/update changeset passes the same sentence as the `message:` of each
message-less single-field validator, as its operation rung does.

**Consequences.** .NET appends `.WithMessage(<node sentence>)` to each
native FluentValidation arm (`dotnet/validator-emit.ts`); java passes the
sentence to `patternCheck` (`java/emit/validator.ts`); elixir lifts every
wire-translatable precondition — messaged or not — to the `{:validation_failed,
errors}` rung, the message-less entry carrying no `code`
(`elixir/vanilla/denial.ts`); python raises a `PydanticCustomError` of type
`invariant` through `ValidationError.from_exception_data`, so the entry has the
field's `loc` and no "Value error, " prefix (`python/emit/wire-constraints.ts`).
Pinned by RS-43 and the `validation-messages` / `intrinsics` wire goldens; the
four `M-T6.86` waivers are deleted.
