# D-INDEX-SUGGEST — index suggestions are an advisory lint, not an auto-emitted index

**Status:** PINNED.

**Problem.** Loom can see which columns get filtered frequently (find predicates,
FK-shaped reads), so it *could* auto-create covering indexes. But silently
emitting indexes hides a cost (write amplification, storage) the author never
chose, and an index is an ops decision.

**Decision.** Loom does **not** auto-emit performance indexes. It emits an
**advisory warning** — `loom.index-suggestion` (`validateIndexSuggestions`,
`src/ir/validate/checks/index-suggestion-checks.ts`) — pointing at a
frequently-filtered column with no covering index, and the author opts in via the
manual `index:` hatch (D-INDEX-INFRA). Advisory, never an error; never changes
emitted schema on its own.

**Affects.** `uniqueness-and-indexes.md` §11 (canonical); `../resources.md`.
