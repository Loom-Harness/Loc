# D-I18N-KEY — i18n key stability

**Status:** PINNED.

**Decision.** Two key families, chosen by what the text describes.

- **Model-derived text** (a type's name, a field / operation / enum-value
  label, a named rule or error message) is keyed by **context-qualified model
  identity**: `<Ctx>.<Type>.<facet>[.<member>]`, constructed in one place
  (`src/util/model-text-key.ts`). The source spelling is the `label(…)` /
  `plural(…)` intrinsics; the English default is derived from the identifier.
  The key survives any rewording of the default, and changes only when the
  model element is renamed or moved — which `ddd i18n sync` follows (declared
  `migration` steps, then an unambiguous inference), re-keying the translation
  instead of dropping it.
- **Hand-written literals** in page, component and menu bodies are keyed by a
  **content hash**: `<Ui>.page.<Page>.<role>.<hash>` (and `component` / `menu`
  forms), where `<hash>` is a 6-character FNV-1a base-36 hash of the source
  text (`src/util/content-hash.ts`). A reword re-keys: the old key goes
  stale and the new one starts untranslated. The slot `role` is part of the key
  so equal text in two slots stays two entries.

Placeholders are carried as ICU holes (`{name}`) in the message; a placeholder
rename is a source change like any other, and `sync` flags the translations
that need review rather than rewriting them. There is no named-message
construct in the grammar, and no invariant `message` clause: an unnamed rule
gets a generic message, a named rule gets `<Ctx>.<Agg>.rule.<name>`.

Rejected: live with positional-only hashing (leaks source structure to the
client), and runtime noun insertion (`{entity}`) — placeholders carry data,
never words.

**Affects.** [`i18n.md`](../i18n.md); the `ddd i18n sync` three-way merge; the
generated catalog key shape.
