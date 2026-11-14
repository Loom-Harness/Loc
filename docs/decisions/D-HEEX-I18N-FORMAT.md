# D-HEEX-I18N-FORMAT — Phoenix formats numbers and dates through CLDR, in the negotiated locale

**Status:** applied.

**Question.** The four JS frontends, Feliz and Flutter format a number or a
date in the active locale through their platform (`Intl`, `intl`). Phoenix
renders on the server, where the equivalent is a CLDR library compiled into
the app. Does a generated Phoenix app carry one, and what does it format?

**Decision.** Yes, behind the second-tier i18n gate that already ships the
ICU engine (`D-I18N-HEEX-ICU`). The gate is "an interpolated message, or a
`DateDisplay`", so a translatable-but-literal-only app stays CLDR-free: its
text resolves through gettext alone and its dependency list is the
gettext-only one. When the gate opens the app gets `ex_cldr`,
`ex_cldr_numbers`, `ex_cldr_dates_times` and `ex_cldr_messages`, and a
backend that compiles every shipped locale's data.

What is formatted:

- **ICU holes.** `{d, date}` / `{d, time}` and `{n, number}` format through
  the message engine's number and date providers. The number **skeletons**
  Loom spells (`::currency/<ISO>`, `::percent`) are formatted by the
  generated runtime through `Cldr.Number` before the message step, because
  the engine does not implement skeletons.
- **`DateDisplay`.** Under i18n it renders through `loom_date/1`, which formats
  the value in the locale the request negotiated; the `<time datetime>`
  attribute stays ISO. Without i18n it keeps `Calendar.strftime` ISO output.
- **The `i18nFormat` wrapper** is carried inside the interpolated message's
  ICU text (the shared `icuFromConcat` re-detection), so the same message and
  the same key reach the `.po` catalog as on the other frontends. A wrapper
  that is not part of a message still renders its operand unformatted.

**Degradation.** A message the engine still cannot format (a skeleton token
outside `currency/<ISO>` and `percent`, a malformed translation) renders its
holes by raw substitution rather than crashing the page, and `loom_date/1`
falls back to the ISO date.

**Not covered.** `Money { format: "locale" }` stays refused on Phoenix
(`loom.target-unsupported#money-locale-format`); the amount in an interpolated
message formats through its ICU hole.

**Affects.** `generator/elixir/i18n.ts` (the CLDR backend, the `loom_icu/2` /
`loom_date/1` runtime, the gate), `generator/elixir/heex-pack.ts`
(`renderDateDisplay`), `generator/_i18n/locale-format.ts` (`uiUsesLocaleFormat`),
`generator/elixir/vanilla/shell-emit.ts`.
