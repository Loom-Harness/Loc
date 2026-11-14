# D-HEEX-SHARED-WALKER — Phoenix LiveView renders on the shared walker core; there is no second page walker

**Status:** PINNED, 2026-11-11. Supersedes the June 2026 architecture review's
§5 call to keep the HEEx page walker separate
([history](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/architecture-review-2026-06.md)).

**Context.** The June review kept LiveView on its own recursion engine
because the `WalkerTarget` contract could not express three things LiveView
needs: lambdas hoisted to `handle_event/3` clauses, `for` comprehensions and
`if`-block children. The shared core has since gained a seam for each of them,
built for other frontends: hoisted handlers for Feliz (`bindEventHandler`),
`renderForEach` for Svelte, Vue and Angular, and the block forms of
`renderConditionalChild` / `renderMatchChild`. It also gained the data-access
seam for a server-session target (D-LIVEVIEW-REFERENCE). The HEEx engine was
moved onto the core one primitive at a time, and the HEEx corpus diff stayed
byte-identical at every step.

**Decision.**
- Every frontend, LiveView included, renders a page or component body through
  `walkBody` (`src/generator/_walker/walker-core.ts`). `heexTarget`
  (`src/generator/elixir/heex-target.ts`) is a target like the others. It has
  no whole-node escape hatch, and the `WalkerTarget` contract has none.
- LiveView's differences are seams on `heexTarget`:
  - Its expressions render as Elixir through its own expression renderer
    (`heex-walker-core.ts`, reached by `renderExprOverride` /
    `renderTextContentOverride`).
  - Its handlers are bound through `bindEventHandler`.
  - Its per-scope walk state uses `scopeSink`, including the `tab-group` scope
    that numbers `Tabs` in document order.
  - Its user components render through `renderUserComponent`.
- A primitive whose LiveView form needs wiring the shared emitter does not
  model renders whole through a named override on `heexTarget`. The wiring
  covers an Ecto changeset bound in `mount`, a hoisted sort/page/upload
  handler, and an assign the page loads. The overrides are the forms,
  `Table`, `FileUpload`, `Modal`, `FileLink`, `ProvenanceInfo`, `Timeline`,
  `IdLink`, `Chart` and `Action`, and they live in their own modules
  (`heex-form.ts`, `heex-table.ts`, `heex-display.ts`, …). Every other
  primitive renders through its shared emitter and the procedural HEEx pack
  (`heex-pack.ts`).
- The primitive registry has one renderer slot. Primitive coverage on LiveView
  is the HEEx showcase gate (`heex-coverage.test.ts`), which must reach every
  primitive that the capability table admits on `phoenixLiveView`. `DataGrid`
  stays refused (`loom.target-unsupported#datagrid`).

**Guards.**
- The HEEx corpus diff (`scripts/heex-corpus-diff.mjs`) for any change to the
  walker or the HEEx target.
- `heex-coverage.test.ts`, the walker-core framework census, and the
  D-LIVEVIEW-REFERENCE legs.
