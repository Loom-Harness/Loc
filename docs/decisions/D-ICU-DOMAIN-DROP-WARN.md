# D-ICU-DOMAIN-DROP-WARN — an ICU branch hole in backend domain code is a warning now; rendering the branches is a mission

**Status:** applied (owner ruling D8, eval-closure review 2026-09-28, item 38; wave C, implementer C7).

**Question.** A template hole carrying `, plural` / `, select` / `, selectordinal`
is admitted anywhere a template is. Every backend leaf table renders the
`i18nFormat` wrapper as its bare operand (`i18nFormat: (inner) => inner` in the
node, .NET, Java, Python and Elixir `render-expr.ts`), so in a `derived`,
`function` or `operation` body the BRANCH TEXT vanishes:
`` derived p: string = `{qty, plural, one {# item} other {# items}}` `` yields
`"3"`, with zero diagnostics on `parse` and `generate`.

**Options.** (a) render the branches on all five backends as a match/if chain over
the branch keys (English CLDR `one`/`other` plus `=N` exact matches); (b) warn
where the drop happens and document it; (c) refuse it as an error.

**Decision.** (b): the warning `loom.interp-format-dropped-in-domain` on every
`plural`/`select`/`selectordinal` hole whose template sits in a `derived`,
`function` (incl. top-level) or `operation` (aggregate or domain-service) body,
and never inside a `ui`. (a) becomes a mission; (c) would refuse models that
generate and run today.

**Scope kept deliberately narrow.** `number`/`date`/`time` formats are dropped in
domain code too, but they lose only formatting, not text, so they stay silent
(the docs say so). Templates in other backend bodies (workflows, handlers) are
not covered by the ruling and stay silent until the rendering mission decides
them.

**Affects.** `src/language/validators/template.ts`; `src/diagnostics/messages.ts`;
`src/diagnostics/code-docs.ts`; `docs/language.md`;
`docs/language-reference/05-expressions.md`.
