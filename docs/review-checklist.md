# Review checklist — decisions a reviewer enforces

A decision record ends with `**Enforced by:**`. Most name a test that fails
when the ruling breaks. The rulings below have no practical gate: they govern
process, product scope or code layout, or they record a design that was
removed or declined, so the failure they guard against is a change that
reintroduces it. Their records point here (`**Enforced by:** review —
\`docs/review-checklist.md#<tag>\` — <why a gate is impractical>`), and a
reviewer of any PR checks the diff against every item that the PR's area
touches.

`test/system/decision-gates.test.ts` keeps this file and the records in step:
every section here is pointed at by its record, and every review-tier record
points at a section here that names its tag. A section is added with the
record that needs it; a record that gains a gate moves to the gate tier and its
section is deleted. A gate demoted to review is a reviewed change.

## Process and scope

### D-AI-EMPHASIS
A change that repositions the product (README, docs landing page, MCP or
playground copy) keeps Loom presented as a platform; IR-embedding is not
pitched as shipped.

### D-PRIORITY-ORDER
Work picked from the backlog follows the order: target gaps and bugs, then
architecture, then new surface area. A PR adding surface area while a gap in
the same area is open says why.

### D-READ-SURFACE-ORDER
The read-surface work lands in its stated order: projection masking, then the
two small gates, then the system-read construct.

### D-TARGET-MATRIX-FROZEN
No PR adds a backend or frontend target (a `src/platform/registry.ts` entry or
a `TARGET_FACTS` row) without reopening this ruling.

### D-PYTHON-SINGLE-REALIZATION
A missing second python realization (persistence or style adapter) is not filed
or fixed as a gap.

### D-PHOENIX-FORMAT-GATE
No PR adds a `mix format` (or Dialyzer) gate over generated Elixir.

## Code layout

### D-HONO-SHARED
The Hono emitter stays in `src/platform/hono/shared/`; versioned dirs
(`v5/`, …) hold pin sets only, not emitter code.

### D-PERSISTENCE-PER-BACKEND
Persistence emission stays in each backend's generator; only the seed spine
and the existing shared substrate move to a shared layer.

### D-PHOENIX-DIR
Elixir generator code lives under `src/generator/elixir/`, the platform module
is `elixir`, and no file, module or workflow reintroduces the retired Phoenix
spelling.

## Declined or removed designs — do not reintroduce

### D-ENV-SWAP
No deployable `overrides` block or other per-environment storage-swap syntax
is added to the grammar.

### D-SEED-XREF
Seed cross-references stay explicit ids; no `@handle` reference syntax is added
to seed datasets.

### D-TENANCY-SCOPE
The per-aggregate tenancy stance stays two values (`tenantOwned` /
`crossTenant`); no `platform` scope value is added.

### D-TENANCY-HIERARCHY
Superseded by D-TENANCY-FLAT: no `dataKey` stamp, materialized path or
`deep`/`global` read level is reintroduced.

### D-NO-MIXED-FOUNDATION
Superseded with the foundation axis: no per-aggregate or per-deployable
foundation choice is reintroduced on Elixir.

### D-PHOENIX-FOUNDATION-ROUTING
Superseded with the Ash foundation: no Ash-based emission path is
reintroduced.

### D-PHOENIX-FOUNDATION-STRATEGY
Superseded with the Ash foundation: plain Ecto/Phoenix stays the only Elixir
emission.

### D-VANILLA-PHOENIX-FOUNDATION
Superseded with the foundation axis: no `foundation:` clause is reintroduced.

### D-PHOENIX-TRANSPORT
Superseded: no `transport:` axis or `phoenixRouter` alias is reintroduced.

### D-POLICY-STYLE
Superseded: authorization grammar stays the allow/deny/read ladder; the
data/operations/fields policy sub-sections are not reintroduced.

### D-WIRESHAPE-KEEP
Superseded by D-WIRE-RECORDS: the declared response record is the wire source
of truth; no derived wire shape is reintroduced as an alternative.
