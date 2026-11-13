# D-I18N-HEEX-ICU — who formats an interpolated message on Phoenix

**Status:** PINNED.

**Decision.** **The message stays ICU verbatim; gettext resolves it and
an ICU engine formats the result.** Phoenix is the one frontend whose
translation runtime is not Loom's own shim — it uses `gettext`, which
every Elixir tool speaks. But gettext interpolates `%{name}`, not ICU
`{name}`, and has no `plural`/`select` arg type, so an interpolated
message has to be reconciled somewhere. Two jobs, split at their natural
seam:

```
gettext resolves the message  →  ex_cldr_messages formats the holes
```

which is exactly the two steps the JS shim already is (`messages[key] ??
default`, then `intl-messageformat`). The emitted call nests that way
round — `loom_icu(pgettext(<key>, <ICU msgid>), [<holes>])` — so the
holes are formatted in *the active locale's translation*, which may
reorder them or use plural categories English does not have.

The rejected alternative is rewriting ICU to gettext's `%{}` grammar at
emit time. It is cheaper, but the Phoenix `.po` would stop carrying the
same msgid as the other five catalogs, and the `,format` set and
plural/select would be lost outright. One `messageKey()` → one catalog →
one message is the invariant the whole i18n design rests on.

**Second-tier gate.** The CLDR backend costs real compile time, so it
ships only for a ui with an **interpolated** message — one tier below
the existing "has any string at all" gate. A translatable-but-literal-only
Phoenix app keeps the deps, files and bytes it had before. The gate reads
the extraction pass's per-entry `icu` marker, not a `{`-sniff over the
catalog: merged pack chrome carries holes too (`chrome.pageOf` is "Page
{page} of {pages}") and HEEx renders none of it through this path.

**Documented degradation.** `ex_cldr_messages` implements ICU
MessageFormat but not ICU number **skeletons** — `{total, number,
::currency/USD}`, the spelling Loom's own grammar documents — and raises
on a `date` style unless `ex_cldr_dates_times` is configured. An
unformattable message degrades to raw hole substitution rather than
crashing the render: the value appears unformatted, which is what the
page showed before it was translatable. Same trade, same reason, as the
Flutter runtime's `_substitute` fallback — though Flutter no longer
*needs* it for skeletons: its runtime pre-formats the `, number` /
`, date` / `, time` holes through `intl`'s `NumberFormat`/`DateFormat`
before `MessageFormat` parses the message, and keeps `_substitute` only
for a message the parser genuinely rejects.

**Affects.** `i18n.md`; `generator/elixir/i18n.ts`,
`generator/elixir/heex-walker-core.ts`,
`generator/elixir/vanilla/shell-emit.ts`;
`_walker/i18n-extract.ts` (`MessageEntry.icu`).
