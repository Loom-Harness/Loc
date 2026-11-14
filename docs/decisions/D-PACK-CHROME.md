# D-PACK-CHROME — how a design pack makes its own strings translatable

**Status:** PINNED.

**Decision.** **A pack DECLARES its chrome in `pack.json`; the toolchain
derives the key and decides whether i18n is on.** The user-visible-string
extraction pass walks the IR, so a word that exists only in a `.hbs` is
invisible to it and therefore untranslatable. The curated `chrome.*` table
([D-I18N-ATTR](D-I18N-ATTR.md) and
the `localizedChrome*` helpers) covers chrome an EMITTER builds and hands a
template as a ready token; it cannot cover a string the pack invents, because
that would need a curated key in the toolchain, a token in the emitter's view
model and a threading argument at every call site — for a word only that pack
renders. Packs genuinely disagree about those words: two of fifteen spell the
empty picker `— select —` rather than `Select…`, one labels a breadcrumb
landmark, two carry a visually-hidden `Close`.

So `pack.json` grows a `chrome` map of `role → English`, and templates spell
it through helpers the loader binds into every `pack.render` — `{{{chrome}}}`
(markup text, with ICU hole values as hash args), `{{{chromeAttr}}}` (a WHOLE
attribute: a bound attribute changes shape per framework, so the template
cannot spell the name and take only the value), `{{{chromeValue}}}` (a
target-native value), `{{{chromeImport}}}` (whole-FILE templates only).

Keys are `pack.<family>.<role>.<hash>`, consistent with
[D-I18N-KEY](D-I18N-KEY.md): the `pack.` namespace cannot
collide with `page.*` / `component.*` / `menu.*` or `chrome.*`; `<family>`
rather than `family@version`, because two versions that spell a string
identically should share one translation and the content hash separates them
the moment they diverge; and a rephrase re-keys, so `ddd i18n sync` sees a
delete-old + add-new instead of silently keeping a translation of the old
wording.

**This does not weaken D-I18N-ATTR.** A pack names a ROLE; it never resolves
a key and never decides whether the app has a translation runtime. Both stay
in the toolchain (`packChromeKey`, `LoadedPack.setChromeI18n`), which is what
keeps the i18n-OFF path byte-identical BY CONSTRUCTION — the binding starts
off, each helper returns the bytes the template previously spelled inline,
and a frontend switches it on only for a UI already translatable by its
authored strings.

**Rejected: scraping the `.hbs` for English.** It cannot tell `Remove` from a
TypeScript generic bound, an `@doc` string or a class name; it gives an author
no opt-out; it produces no ROLE, which is what makes two occurrences of
`Close` in one pack distinguishable to a translator; and it cannot be
validated — whereas a declaration is rejected at pack LOAD when its message
carries a character significant to the markup it is spliced into unquoted.

**Corollary.** A declared role no template renders is a dead catalog entry (a
translator translating a string the app never shows) and fails a gate; so does
a template leaving user-visible English in a markup text node or a user-facing
attribute. Both live in `test/generator/pack-declared-chrome.test.ts`.

**Affects.** `design-packs.md` §2 `chrome`, `i18n.md`;
`_packs/pack-chrome.ts`, `_packs/loader.ts`, `_walker/render-primitive.ts`,
`_frontend/i18n-runtime.ts`, `system/i18n-catalog.ts`; every `pack.json`.
