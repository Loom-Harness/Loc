# D-TARGET-MATRIX-FROZEN — no new backends or frontends: the target set is five backends and six frontends

**Status:** owner ruling, 2026-07-17.

**Decision.** The target matrix is closed: the five backends (node, dotnet,
elixir, python, java) and six frontends (react, vue, svelte, angular, feliz,
flutter) registered in `src/platform/registry.ts`. The studies for further
targets (Go, PHP, NestJS, Blazor Server, HTMX, Next.js) are design record, not
backlog.

**Why.** The largest emit surface — entity, schema, repository and routes,
roughly 37–70 files per backend — cannot be abstracted (see
D-PERSISTENCE-PER-BACKEND), so every new target re-lands it by hand and
re-mirrors every authorization-filter sentinel, with a cross-tenant-leak risk
each time. With the set closed that cost is bounded ×5: each capability lands
once per target and is done, and the breadth budget goes to depth.

**Consequence.** Do not propose a new target without re-opening this decision.
"Add the target to the gate set" is never a reason to grow the matrix; the
`seam` rows in `src/diagnostics/unsupported-register.ts` exist for a target
that is not coming.
