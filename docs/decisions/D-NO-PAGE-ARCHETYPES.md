# D-NO-PAGE-ARCHETYPES

**Status:** PINNED.

**Problem.** The page DSL shipped three "archetype" builder-call names —
`List { of: T }`, `Detail { of: T, by: id }`, `MasterDetail { of: T, scope?,
detail? }` — documented (`page-metamodel.md` §4/§9) as the canonical page
bodies and used in examples. They were **inert**: `admissibleInSource: true`
in the walker registry but with **no `tsx`/`heex` renderer and no expander
arm**, so a body of `List { of: Order }` parsed, validated, then dead-ended to
a `// not supported by the React walker yet` comment (and they sat in
`NON_PAGE_BODY_LAYOUT_PRIMITIVES`, excluded as page bodies outright). Meanwhile
the scaffold sentinels `scaffoldList`/`scaffoldDetails` — also
`admissibleInSource` — *are* generative (a phase-⑤c expander arm rewrites them
into the full Breadcrumbs · Toolbar · QueryView · Table tree) and are
themselves hand-writable and embeddable anywhere (the expander recurses into
nested bodies). So the archetypes were duplicate names for the working scaffold
sentinels, minus the wiring.

**Decision.** **Remove `List` / `Detail` / `MasterDetail`** from the language.
The list/detail surface is the `scaffold` macro (whole-page generation) plus
the `scaffoldList` / `scaffoldDetails` body sentinels (hand-writable, for
embedding a list/detail in a custom page). No capability is lost — the
embeddable case the archetypes were imagined for is already served by writing
`scaffoldList { of: T }` in a custom page body. `MasterDetail`'s richer
split-pane shape (`scope:` + `detail:` lambda) was never implemented; it is
not reintroduced (compose `scaffoldList` + a `state {}` selection + a detail
component if needed).

**Removed from:** `src/generator/_walker/registry.ts`,
`src/language/walker-stdlib.ts`, `NON_PAGE_BODY_LAYOUT_PRIMITIVES`
(`walker-core.ts`), the web visual-builder model (`web/src/builder/page/`),
and their tests; examples switched to `scaffoldList`/`scaffoldDetails`.

**Supersedes** the `proposals/unfoldable-page-scaffolding.md` direction (which
explored *implementing* the archetypes as emitted components) for the
archetype question specifically. The residual idea in that proposal — that the
phase-⑤c scaffold expansion is opaque "magic" that could instead emit
unfoldable, named components — remains an OPEN, separate consideration for the
`scaffoldList`/`scaffoldDetails` sentinels themselves; it is not blocked by
this removal.

**Superseded (2026-06-19).** The `scaffold*` page-body sentinels
(`scaffoldList` / `scaffoldDetails` / `scaffoldNewForm` / `scaffoldOperations`
/ `scaffoldWorkflowForm` / `scaffoldInstanceList` /
`scaffoldInstanceDetails`) — together with their phase-⑤c expander
(`src/ir/lower/walker-primitive-expander.ts`) — have now been **removed
entirely**: they were "scaffolds that aren't scaffolds" — opaque,
permanently-in-source indirections with no `unfold`. The only scaffold surface
is the `with scaffold(...)` **page macro**, which emits full unfoldable AST
trees (`src/macros/stdlib/scaffold/_body-builders.ts`). The sentinels are no
longer `admissibleInSource` — a hand-written `body: scaffoldList { of: X }`
now fails validation with "Unknown builder type". Embedding a list/detail in a
custom page therefore means writing the body explicitly (the example
`web/src/examples/extern-showcase.ddd` shows the inlined list tree).

**Update (2026-06-20).** The two **singleton index-page sentinels** (`Home` /
`WorkflowsIndex`) — the last holdouts — are gone too. They are
now ordinary scaffold macros (`scaffoldHome` / `scaffoldWorkflowsIndex`
in `_body-builders.ts`) emitting full bodies from the
gathered inventory; the `expandInlineScaffoldPrimitives` expander, the ⑤c pass,
the `Home`/`WorkflowsIndex` registry primitives, and the page
`origin`/`source` fields are all removed. `walker-primitive-expander.ts` is now
just `buildExpandContext`. A page's kind is derived on demand from its
role-scoped name + area via `classifyPage` (`src/ir/util/page-kind.ts`).
