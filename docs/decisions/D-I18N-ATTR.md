# D-I18N-ATTR — who resolves an attribute-position string

**Status:** PINNED.

**Decision.** **The a11y/i18n helper emits an already-TRANSLATED value; a
design pack never resolves a key.** A user-visible string in ATTRIBUTE
position (`Button`'s aria-label, `Toolbar`'s aria-label, `Alert`/`Modal`
title, `Divider` label) reaches a pack in exactly one of two spellings,
both produced by `src/generator/_walker/i18n-emit.ts` from the same
`messageKey()` the extraction pass uses:

- an HTML-ish attribute **FRAGMENT** (`localizedAriaLabelAttr`,
  `localizedNamedAttr`) — spliced verbatim by the four JSX/markup
  frontends, whose packs are `.hbs` templates that can only interpolate
  text;
- a target-native **VALUE** (`localizedNamedValue`, via the optional
  `WalkerTarget.renderStringLiteral` seam) — for the packs that build
  props procedurally rather than markup: Feliz (F# `prop.ariaLabel …`)
  and Flutter (Dart `Semantics(label: …)`).

Phoenix/HEEx is a third spelling of the SAME rule rather than an
exception: its markup is HTML-ish, but its runtime is gettext, so
`localizedHeexAttr` emits HEEx's `{…}` expression form
(`aria-label={pgettext("<key>", "<English>")}`) — which is why
`elixirI18nString` escapes `{`/`}` in the message. Until it existed
HEEx translated every TEXT slot and no ATTRIBUTE one, so an accessible
name shipped in English at every locale beside a caption that did not.

The rejected alternative is handing the pack the **key** and letting it
call the runtime: that duplicates the "is this app i18n-enabled at all"
decision into every pack, and one pack forgetting the check emits a
`t()` into an app with no runtime. Deciding once in the helper keeps the
i18n-OFF path byte-identical by construction, and keeps
`.loom/messages.en.json` the single catalog for both spellings.

**Corollary.** A pack that *drops* a user-visible slot is a bug, not a
style choice — the string still reaches the catalog, so a translator
translates text the app never renders.

**Corollary 2.** A slot the helper owns is a slot no pack re-decides.
When `Icon`'s accessible name joined the table, the walker took over the
decorative-vs-named decision as well — a pack now receives a name or
nothing, instead of re-implementing "`label:` and not `decorative:`"
from raw args in its own language. Two copies of that predicate (Feliz,
Flutter) and one HTML round-trip disappeared with it.

**Affects.** `i18n.md`, `accessibility.md`; `_walker/i18n-emit.ts`,
`_walker/a11y-emit.ts`, `_walker/target.ts`; every `primitive-*.hbs`
carrying a user-visible attribute, plus the Feliz/Flutter packs.
