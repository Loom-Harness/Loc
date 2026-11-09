import type { SavingShape } from "./aggregate.js";
import type { BoundedContextIR } from "./context.js";
import type { ConfigEntryIR } from "./system.js";
import type { Sourced } from "./types.js";

// ---------------------------------------------------------------------------

export interface SubdomainIR {
  name: string;
  contexts: BoundedContextIR[];
  /** Permission catalogue declared via per-subdomain `permissions { ... }`
   *  blocks.  Empty when the subdomain declares none.  Each entry's
   *  `runtimeString` is the value backends compare against
   *  `currentUser.permissions[]` claims; the source-side identifier
   *  (`name`) is what `permissions.<name>` references resolve to in
   *  expression bodies. */
  permissions: PermissionDeclIR[];
  /** Name of the deployable that owns migrations for this subdomain's
   *  primary persistent storage.  Populated by `enrichLoomModel` — the
   *  first backend deployable (in declaration order) that hosts any
   *  context from this subdomain and whose platform `needsDb`.
   *  Undefined when no deployable matches (frontend-only subdomains,
   *  etc.) — backends MUST emit migrations only when
   *  `subdomain.migrationsOwner === deployable.name`. */
  migrationsOwner?: string;
}

/** One permission declared in a subdomain's `permissions { }` block. */
export interface PermissionDeclIR {
  /** Source-side identifier used as `permissions.<name>` in
   *  expression bodies. */
  name: string;
  /** Runtime string emitted when a `permissions.<name>` reference
   *  lowers to a literal — `<lowercased-subdomain>.<name>`.  Stable
   *  across regens so claim payloads can be expressed in plain
   *  strings on the wire. */
  runtimeString: string;
  /** Runtime strings of the permissions that transitively IMPLY this one
   *  (`X implies Y` ⇒ `impliedBy(Y)` includes `X`).  A `contains(this)`
   *  authorization check is expanded to also accept any of these, so holding
   *  a broader permission satisfies a narrower gate.  Absent / empty when
   *  nothing implies it.  See `src/ir/util/permission-closure.ts`
   *  (authorization.md §6). */
  impliedBy?: string[];
}

/** D-STORAGE-SPLIT: a per-(context, kind) binding from a domain
 *  context to a physical `storage`.  Carries per-kind config
 *  validated against the resolved storage's `type`. */
export interface DataSourceIR {
  name: string;
  /** Name of the BoundedContext the binding applies to. */
  contextName: string;
  /** Which datalogue kind this binding satisfies for the context. */
  kind: DataSourceKind;
  /** Name of the physical `storage` declaration this binding routes to.
   *  Empty when the binding targets an in-system `api` instead — see
   *  {@link DataSourceIR.apiName}. */
  storageName: string;
  /** Name of the in-system `api` this binding routes to, when `use:` names an
   *  `Api` rather than a `Storage` (M-T4.8).  The address and the operation
   *  set are then DERIVED from the deployable that `serves:` it, so no
   *  `baseUrl` is authored and the emitted client is typed.  Mutually
   *  exclusive with {@link DataSourceIR.storageName} — exactly one is
   *  non-empty on a well-formed binding, which `loom.resource-api-target-kind`
   *  and the IR store checks pin. */
  apiName?: string;
  schema?: string;
  tablePrefix?: string;
  keyPrefix?: string;
  /** Cache TTL in seconds.  Validator requires storage type to be
   *  cache-capable (e.g. redis) when this is set. */
  ttl?: number;
  /** Snapshot policy: take a snapshot every N events. */
  every?: number;
  /** Snapshot policy: retain at most N snapshots per stream. */
  retain?: number;
  isolationLevel?: "readUncommitted" | "readCommitted" | "repeatableRead" | "serializable";
  readonly?: boolean;
  /** Saving shape of the materialised read model this binding routes
   *  (D-DOCUMENT-AXIS, `shape:` knob).  Per-projection override of the
   *  aggregate header's `shape: …` (see {@link SavingShape} /
   *  {@link effectiveSavingShape}).  Omitted → the header decides. */
  shape?: SavingShape;
  /** Generic vendor-parameter map for the binding (RFC §3.2). */
  config?: readonly ConfigEntryIR[];
  /** Manual performance indexes declared via `index: [...]`
   *  (uniqueness-and-indexes.md §3.2, D-INDEX-INFRA).  Each entry names its
   *  target entity EXPLICITLY (an aggregate or one of its contained parts in
   *  the binding's context) plus the column(s) — one for a single-column
   *  index, several for a composite.  Always non-unique — uniqueness is the
   *  domain `unique (...)` invariant.  Omitted when none declared. */
  manualIndexes?: readonly ManualIndexIR[];
}

/** One `index: [...]` entry — an explicitly-targeted performance index on a
 *  storage binding (uniqueness-and-indexes.md §3.2).  `entity` is an aggregate
 *  or contained-part name in the binding's context; `columns` are its
 *  field names.  The migrations builder places the index on that entity's
 *  table, named `<table>_<cols>_idx`, non-unique. */
export interface ManualIndexIR {
  entity: string;
  columns: readonly string[];
}

export type DataSourceKind =
  | "state"
  | "eventLog"
  | "snapshot"
  | "cache"
  | "replica"
  | "objectStore"
  | "queue"
  | "api"
  | "mailer";

/** Access mode used to reach a source in a given context (RFC §3.5).
 *  Owned here (the IR vocabulary); the sourceType registry declares
 *  which interfaces each `(sourceType, kind)` exposes. */
export type LoomInterface = "sql" | "rest" | "graphql" | "webSocket" | "amqp" | "sdk";

/** A derived, implicit logical *need*: what a bounded context requires
 *  of its data layer, independent of the technology that satisfies it
 *  (RFC §3.3).  Needs are not authored — they are derived during
 *  enrichment from how the context's aggregates persist, and threaded
 *  onto `EnrichedSystemIR.needs`.  A `resource` binding satisfies a need
 *  when its `sourceType` supports the need's `kind` and offers all the
 *  need's `capabilities` (validated in IR; RFC §5). */
export interface NeedIR {
  /** The bounded context that has the need. */
  contextName: string;
  /** The required (surface) kind — the `(context, kind)` routing key. */
  kind: DataSourceKind;
  /** Capabilities the context requires within that kind. */
  capabilities: readonly string[];
}

// `static` is the page-metamodel's UI-only deployable kind: builds a
// Vite bundle and serves it via a small static-asset host (nginx in
// the v0 emitter).  Shares the `react` platform surface.
//
// `phoenixLiveView` is the fullstack Elixir / Phoenix LiveView
// platform: a single deployable serves a Phoenix API AND mounts
// a `ui:` whose pages render as LiveView modules against the
// `coreComponents` HEEx pack.  Unlike `react`/`static` it owns its own
// database (`needsDb: true`) and never declares `targets:` —
// validator enforces both.
// `java` is the Spring Boot / Spring Data JPA backend (backend-only,
// like `dotnet`; mounts an embedded React SPA when the deployable
// declares `ui:`).
//
// `python` is the FastAPI + SQLAlchemy 2 backend (backend-only, like
// `node`/`dotnet`).  (The `fastapi` platform alias was retired — `python`
// is the only spelling, mirroring the retired `hono`/`phoenix` aliases.)
//
// `svelte` is the second frontend-only platform: a Svelte 5 /
// SvelteKit static SPA rendered against a svelte-format design pack
// (`shadcnSvelte`/`flowbite`).  Same deployable contract as `react`:
// `targets:` a backend, inherits its contexts, owns no database.
//
// `vue` is the third frontend-only platform: a Vue 3 Vite SPA
// (vue-router, SFC pages) rendered against a vue-format design pack
// (`vuetify`/`shadcnVue`).  Same deployable contract as `react`.
export type Platform =
  | "dotnet"
  | "node"
  | "react"
  | "svelte"
  | "vue"
  | "angular"
  | "feliz"
  | "flutter"
  | "static"
  | "elixir"
  | "python"
  | "java";

// The `shape: …` platform-axes lookup (`PLATFORM_SAVING_SHAPES`) lives in
// `src/util/platform-axes.ts` so the language validators may consume it
// without a backward `language → ir` value edge.  It type-depends on
// `Platform` / `SavingShape` here.

export interface DeployableIR extends Sourced {
  name: string;
  /** The platform **family** (`"node"`, `"dotnet"`, `"react"`, …) —
   *  the closed union every downstream consumer branches on.  A
   *  `family@version` pin in the source is normalised here to its
   *  family so `platform === "node"` etc. stay valid. */
  platform: Platform;
  /** The fully-qualified backend ref (`"node@v5"`) after lowering,
   *  mirroring `design?`.  Bareword `platform: node` resolves through
   *  `BUILTIN_PLATFORM_LATEST`; a pin (`platform: "node@v5"`) flows
   *  through as written.  For frontend platforms (`react`/`static`)
   *  this equals `platform` (they version via the design/stack axis,
   *  not here).  The system orchestrator's dispatch keys on `platform`
   *  while every family has exactly one registered version. */
  platformRef: string;
  /** Names of bounded contexts hosted by this deployable.  For react
   * frontends, inherited from the targeted backend deployable. */
  contextNames: string[];
  /** Names of dataSource declarations the deployable wires up.
   *  Empty for frontend-only deployables.  Validator enforces that
   *  every listed dataSource's `for:` is one of `contextNames`. */
  dataSourceNames: string[];
  /** Names of channelSource declarations the deployable wires up — the
   *  messaging twin of `dataSourceNames` (channels.md §"Surface — transport
   *  binding").  Listing a binding routes the channel's
   *  events over its broker for this deployable (producer and/or consumer
   *  side is derived from the hosted contexts).  Empty ⇒ the channel's
   *  events reach this deployable only via in-process dispatch. */
  channelSourceNames: string[];
  /** HTTP port the deployable's web server listens on. */
  port: number;
  /** Backend deployable this frontend talks to.  Set only when
   * platform === "react"; the frontend's API base URL is derived from
   * the target's port. */
  targetName?: string;
  /** Design-system template pack the React frontend generator renders
   *  pages against.  Built-ins: "mantine", "chakra", "mui", "shadcn",
   *  "coreComponents".  A string starting with "./" or "/" is a custom
   *  pack path resolved relative to the .ddd file (a directory
   *  containing pack.json).  Only meaningful when platform === "react"
   *  (or "static"/"dotnet" with a UI mount, or "phoenix");
   *  ignored otherwise.
   *
   *  After lowering this field is always fully qualified
   *  (`family@version`, e.g. `"mantine@v9"`) for built-in packs.  The
   *  bareword DSL form `design: mantine` resolves through
   *  `BUILTIN_PACK_LATEST` during lowering, so downstream consumers
   *  (generator dispatch in `src/generator/react/index.ts`, the
   *  build-matrix CI test, snapshot fixtures) see an unambiguous
   *  string and don't need to re-resolve the toolchain default.
   *  Custom paths flow through verbatim.
   *
   *  Named `design` rather than `ui` because the test DSL already
   *  uses `ui.workflows.X(...)` as a member-access namespace; making
   *  `ui` a keyword in the deployable block would shadow the test-DSL
   *  accessor and break parsing of existing examples. */
  design?: string;
  /** For a custom `design:` path: the directory of the `.ddd` file that
   *  declared this deployable, which a RELATIVE path resolves against
   *  (`resolvePackDir(design, designBaseDir)`).  Absent for built-in packs
   *  and for a model with no file location (an in-memory source). */
  designBaseDir?: string;
  /** Realization axes (D-REALIZATION-AXES).  Each decomposes the
   *  platform bundle into one orthogonal concern.  All optional in the
   *  type but **always concrete on backend deployables post-lowering**
   *  (normalized to the platform's default, mirroring how `design` is
   *  resolved via `BUILTIN_PACK_LATEST`); left `undefined` on frontend
   *  (`react`/`static`) deployables, which carry no domain realization.
   *
   *  `directoryLayout` maps onto the D-ADAPTER-HOME adapter kind `layout`;
   *  `persistence` onto the `persistence` adapter.  Both carry real
   *  per-backend choice.  There is no application/style axis: each backend
   *  has one fixed emission style, resolved internally by `resolveStyle`. */
  persistence?: string;
  directoryLayout?: string;
  /** Per-deployable auth opt-in.  Populated when the source declares
   *  `auth: required` or `auth: ui` on the deployable.  Backends with
   *  `auth.required === true` emit JWT-decode middleware + a verifier
   *  hook the user implements; a frontend with `auth.ui === true`
   *  mounts the login redirect + route guard under the system
   *  `auth { ... }` block.  Deployables without this stay open
   *  (existing behaviour). */
  auth?: { required: boolean; ui: boolean };
  /** Name of the `ui { ... }` SystemMember this deployable serves.
   *  Set when the source declares
   *  either `ui: <Name>` (sugar) or `ui <Name> { framework: ... }`
   *  (full block).  Validator ensures the referenced ui
   *  exists, the deployable's platform supports a UI mount, and the
   *  framework value is one of the v0-allowed alternatives.  Empty
   *  string is never produced — undefined ⇒ no UI binding. */
  uiName?: string;
  /** Frontend rendering technology — `react` is the only v0 value
   *  (default when `ui:` is set without an explicit `framework:`).
   *  Future LiveView / Blazor backends extend this enum without
   *  breaking the deployable IR. */
  uiFramework?: string;
  /** D-PHOENIX-SURFACE: the `ui` declarations this deployable `hosts:`.
   *  The host↔ui relation that supersedes `uiName` (the legacy single
   *  `ui:` binding).  A list from day one so a deployable can host
   *  several UIs (the deferred one-ui-many-frameworks case).  Empty
   *  when the source uses the legacy `ui:` binding instead.  When
   *  present and the legacy binding is absent, `uiName`/`uiFramework`
   *  fall back to the first entry (the framework comes from the `ui`
   *  declaration itself, not the platform). */
  hostedUiNames: string[];
  /** Apis this backend deployable serves.  Each
   *  entry references an `Api` declared at system scope.  Empty
   *  for frontend deployables and for backends that haven't yet
   *  migrated to the explicit composition syntax. */
  serves: string[];
  /** UI api parameter bindings for frontend
   *  deployables.  Each entry binds a UI parameter (declared as
   *  `api <Name>: <Api>` in the ui block) to the backend
   *  deployable that supplies it (which must `serves:` the
   *  param's contract).  Empty for backend deployables and for
   *  frontends whose UI declares no api parameters. */
  uiBindings: UiParamBindingIR[];
  /** Optional favicon path — relative to the source `.ddd` file.
   *  Carried verbatim through lowering; the React generator
   *  resolves the path, copies the referenced file into
   *  `public/favicon.<ext>`, and emits a corresponding
   *  `<link rel="icon">` in the generated `index.html`. */
  favicon?: string;
}

/** A single UI-parameter binding on a frontend deployable.
 *  Maps the UI parameter's local name to the backend deployable
 *  that fills it. */
export interface UiParamBindingIR {
  /** Local UI parameter name (matches `api <name>: <Api>` in the ui block). */
  paramName: string;
  /** Name of the backend deployable that supplies the param's contract. */
  sourceDeployableName: string;
}
