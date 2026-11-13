# D-I18N-KEY — i18n key stability

**Status:** PINNED.

**Decision.** **Option B as default, Option C as escape hatch.**

- **Inline user-visible literals** are keyed by a content hash —
  `page.<page>.<role>.<sha-6>` (6-char base64 of `sha512(source)`).
  Placeholders are **normalised to positional for hashing** (`"Order
  {0}"`) but **rendered named** at use (`{orderNumber}`). Effect: a
  placeholder *rename* leaves the hash stable; `ddd i18n sync` rewrites
  the placeholder name in the catalog without re-keying (Option B).
- **Named `text { }` entries** get true stable keys
  (`text.<Namespace>.<name>`) with author-chosen placeholder names —
  the escape hatch (Option C) for strings that must survive *content*
  edits, not just renames.

Option A (live with churn) is rejected; positional-only hashing without
named render is rejected (leaks DSL/source structure to the client).
The unnamed-placeholder fallback warns (`loom.unnamed-placeholder`).

**Affects.** `i18n.md`, `i18n-strings.md`; the `ddd i18n sync`
three-way merge; the generated catalog key shape.
