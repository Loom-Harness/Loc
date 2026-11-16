# D-REGISTRY-NAMES — storage types and design packs are registry-checked names, not grammar keywords

**Status:** PINNED (owner rulings 2026-10-21).

**Question.** Where does the list of supported storage vendors and design
packs live: in the grammar, in the registries the toolchain reads, or both?

**Decision.**
- **One list each, and it is not the grammar.** `storage { type: … }` takes an
  identifier checked against the sourceType registry (`src/util/source-types.ts`,
  plus sourceTypes registered by out-of-tree plugins). A bare `design:` takes an
  identifier checked against the built-in pack families (`BUILTIN_PACK_LATEST`
  in `src/util/builtin-formats.ts`, which mirrors `designs/`). Neither name is
  a keyword, so adding a sourceType or a pack needs no grammar edit.
- **An unknown name is a validator error** at the declaration:
  `loom.storage-type-unknown` and `loom.design-pack-unknown`, each suggesting
  the nearest known name and listing them all. A resource bound to a storage of
  unknown type is not reported again.
- **The quoted `design:` form keeps its meaning**: a pinned built-in
  (`"mantine@v9"`) or a custom pack directory. Only the bare form is a pack
  family.
- **Every registered sourceType binds at least one kind.** A type nothing can
  use is not registered, so it is unknown rather than accepted and refused
  later.
- Breaking changes here ship as a hard cutover with a `scripts/` codemod when a
  valid spelling changes. This one changes no valid spelling, so there is no
  codemod.
- The editor completes both slots from the same registries.

**Why.** The vendor lists existed three times (grammar union, registry,
capability table) and drifted: the grammar accepted names no kind could use,
and a typo was a parse error listing every keyword instead of the known
names.

**Enforced by:** `test/language/validation/registry-names.test.ts`, `test/language/lsp/registry-name-completion.test.ts`
