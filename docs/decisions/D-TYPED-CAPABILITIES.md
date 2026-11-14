# D-TYPED-CAPABILITIES — capabilities are first-class pure-mixin declarations

**Status:** PINNED (proposal pending scheduling).

**Problem.** Loom's capability surface (`implements "X"` / `filter for "X"` /
`stamp for "X"`) is the one stringly-typed corner — no resolution, no contract,
and a muddy capability-vs-macro line (capabilities are *implemented as* macros
today).

**Decision.** Promote capabilities to a first-class **`capability { fields +
filter + stamp }`** declaration with **typed references** (`implements X` /
`with X`). It is a **pure mixin** — everything in the body is *provided*; **no**
`requires`/`provides`/`expects` keywords and **no** field-conformance (every
capability provides what its own behavior uses; the rare "operate on a host
field" case is *parameterization*, not a contract). Provision is local +
unfoldable (not magic); provided members are non-overridable by default. Lowers
to the existing per-aggregate `contextFilters`/`contextStamps` IR ⇒
**byte-identical migration**. Subsumes the `audit`/`softDelete` field+filter+stamp
macros; `crudish`/`scaffold*` stay macros (operations/structure). Open: emission
deduplication when a capability is reused (`typed-capabilities.md` OQ#1).

**Affects.** `typed-capabilities.md` (canonical); `../capabilities.md` (evolves
its mechanism); `multi-tenancy-design-note.md` (`tenantOwned`/`tenantRegistry`
are capabilities).
