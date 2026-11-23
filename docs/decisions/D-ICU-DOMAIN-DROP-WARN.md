# D-ICU-DOMAIN-DROP-WARN — a format code on a template hole in backend domain code is refused; domain code formats with plain methods

**Status:** applied (owner ruling 178 on #5438, which replaces ruling D8's warning).

**Question.** A template hole may carry a format code (`, number`, `, date`,
`, plural`, `, select`, `, selectordinal`, …). A ui page renders it through the
translation layer. In backend domain code every backend renders the hole as its
bare value: `` `INV-{seq, number, ::integer-width/000000}` `` yields `INV-123`,
and a `plural` hole loses its branch text (`"3"`, not `"3 items"`).

**Decision.** Format codes stay for pages. In domain code — a `derived`,
`function`, `operation` (aggregate or domain-service), `commandHandler` /
`queryHandler`, `workflow` or listener (`on`) body — a hole with a format code
is the error `loom.interp-format-in-domain`, whose message names the plain
methods that say the same thing on every backend: `padStart(n, fill)` /
`padEnd(n, fill)` on text, `.format("yyyyMMdd")` on a `date` / `datetime` (the
fixed pattern subset of `src/util/format-pattern.ts`, checked at compile time by
`loom.intrinsic-format-pattern`), and `.format(places)` on a `decimal` / `money`
(half-even, `.` separator, no grouping). Branch text is written with `match` or
a ternary. Nothing is dropped silently.

**Affects.** `src/language/validators/template.ts`;
`src/language/validators/types.ts`; `src/util/intrinsics.ts`;
`src/util/format-pattern.ts`; `src/diagnostics/messages/types.ts`;
`docs/language.md`; `docs/language-reference/05-expressions.md`.

**Enforced by:** `test/language/validation/interpolation.test.ts`, `test/language/validation/format-pattern.test.ts`
