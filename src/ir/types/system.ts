import type { TestPrincipalIR, TestStmtIR } from "./aggregate.js";
import type { DataSourceIR, DeployableIR, SubdomainIR } from "./deployment.js";
import type { FieldIR } from "./members.js";
import type { ApiIR, LayoutIR, UiIR } from "./ui.js";

/** A deployment plan: subdomains grouping bounded contexts, plus the
 * deployable artefacts that ship subsets of those contexts. */
export interface SystemIR {
  name: string;
  subdomains: SubdomainIR[];
  deployables: DeployableIR[];
  e2eTests: TestE2EIR[];
  /** Optional system-wide user-claim shape.  Populated when the source
   *  declares a `user { ... }` block at system scope.  Required when
   *  any deployable has `auth: { required: true }` (validator
   *  enforces).  The fields are the typed claims that backends decode
   *  JWT tokens into; `currentUser` references in expression bodies
   *  resolve members against this shape. */
  user?: UserIR;
  /** Optional system-wide OIDC auth config.  Populated when the source
   *  declares an `auth { ... }` block at system scope.  Requires a
   *  `user { ... }` block (validator enforces).  Drives the generated
   *  OIDC verifier + `/auth/*` handshake on opted-in deployables. */
  auth?: AuthIR;
  /** Optional system-wide tenancy declaration (tenancy.md).
   *  Populated when the source declares `tenancy by user.<claim> of
   *  <Registry>` at system scope.  At most one per system (validator
   *  enforces).  Claim-exists / registry-exists / stance checks are the
   *  phase-④/⑦ tenancy validators' job — this carries the declared
   *  facts only. */
  tenancy?: TenancyIR;
  /** Optional system-wide visual-identity tokens.  Populated when the
   *  source declares a `theme { ... }` block at system scope.  Each
   *  React deployable consumes the same ThemeIR; the platform's
   *  emitter translates the framework-agnostic tokens into Mantine /
   *  shadcn / etc. theming knobs. */
  theme?: ThemeIR;
  /** System-wide i18n settings.  Always present: `source` is the declared
   *  `i18n { source: … }` tag, or {@link DEFAULT_SOURCE_LOCALE} when the block
   *  is absent. */
  i18n: I18nIR;
  /** UI declarations at system scope.  Each is referenced by
   *  zero-or-more deployables via `DeployableIR.uiName`.  Empty when
   *  the system declares no `ui { ... }` blocks.  Order preserves
   *  source order (matters for stable scaffold expansion). */
  uis: UiIR[];
  /** API declarations at system scope.  Each is a contract derived
   *  from a module's domain — its aggregates, repositories,
   *  workflows become the api's exposed operations.  UIs
   *  reference apis via their `api X: ApiName` parameters; backend
   *  deployables `serves:` a named api; frontend deployables
   *  `consumes:` an api from a named target. */
  apis: ApiIR[];
  /** Storage declarations at system scope.  Each is a physical
   *  infrastructure instance referenced from a `dataSource` binding.
   *  Reusable across deployables. */
  storages: StorageIR[];
  /** DataSource declarations at system scope.  Each binds a
   *  `(BoundedContext, DataSourceKind)` pair to a physical storage,
   *  optionally with per-kind config (`schema:` / `every:` / `ttl:` /
   *  …).  Deployables list which dataSources they host via the
   *  `dataSources:` clause. */
  dataSources: DataSourceIR[];
  /** ChannelSource declarations at system scope (channels.md) — the physical
   *  binding of a `channel` to a `storage`, the messaging twin of
   *  `dataSource`.  Deployables do not yet list which they wire; these
   *  bindings drive the `.loom/asyncapi.yaml` emission. */
  channelSources: ChannelSourceIR[];
  /** TimerSource declarations at system scope (scheduling.md, M-T4.1) — a
   *  wall-clock cadence that fires a plain domain `event`, which workflows
   *  react to via the existing `on`/`create … by` triggers.  Time modelled as
   *  an event source, not a new trigger.  The emit owner is DERIVED (not stored
   *  here): the backend deployable whose `migrationsOwner` owns the for-event's
   *  context emits the scheduler, so single-fire lock and DB owner coincide. */
  timerSources: TimerSourceIR[];
  /** Named `layout <Name> { … }` SystemMembers.  Pages
   *  reference one via `layout: <Name>` — the React generator emits
   *  one `<Name>Layout` wrapper component per entry and routes
   *  matching pages through it. */
  layouts: LayoutIR[];
}

/** Physical binding of a `channel` to a `storage` (channels.md).
 *  System-scope, mirroring `DataSourceIR`.  `channelName` is the bare
 *  channel name; `storageName` the bound storage instance. */
export interface ChannelSourceIR {
  name: string;
  channelName: string;
  storageName: string;
}

/** A wall-clock cadence bound to a domain event (scheduling.md, M-T4.1).
 *  System-scope, the clock twin of `ChannelSourceIR`.  `event` is the resolved
 *  name of the plain `EventDecl` the timer fires; `context` is the bounded
 *  context that declares it (used to derive the emit/lock owner from the
 *  subdomain's `migrationsOwner`).  `cadence` is discriminated by which of the
 *  grammar's `cron:` / `every:` fields was set.  `timezone` / `overlap` parse
 *  and are carried, but no emitter reads them. */
export interface TimerSourceIR {
  name: string;
  event: string;
  context: string;
  cadence: TimerCadenceIR;
  /** `in: "<tz>"` — inert; carried for future timezone support. */
  timezone?: string;
  /** `overlap: allow` — inert; the emitted scheduler always skips on overlap. */
  overlap?: boolean;
}

/** Timer cadence, discriminated by the grammar field that set it.  `cron` is a
 *  real 5-field expression (or an `@nickname`) passed through to the backend's
 *  native scheduler; `everyMs` is a fixed interval in milliseconds, used only
 *  for cadences cron cannot express (sub-minute / non-dividing). */
export type TimerCadenceIR = { kind: "cron"; cron: string } | { kind: "every"; everyMs: number };

/** A single typed storage instance.  v0 type enum covers the
 *  common roles seen in real deployments — postgres / mysql /
 *  sqlite / inMemory for transactional, redis for cache, elastic
 *  / meilisearch for search, kafka for events, clickhouse /
 *  bigquery for analytics. */
export interface StorageIR {
  name: string;
  type: StorageKind;
  /** Compose-service handle the deployable shares with the storage,
   *  used as the host name in generated connection strings.  Optional
   *  in v1; when omitted the system orchestrator derives a default. */
  instance?: string;
  /** Source of the runtime connection string — `service(name)` for
   *  intra-compose discovery, `env("VAR")` for environment lookup,
   *  `secret(handle)` for a future secrets-manager binding, or
   *  `literal("…")` for a hard-coded URL.  Optional in v1. */
  connection?: ConnectionSourceIR;
  /** Generic vendor-parameter map (region, bucket, vhost, …), validated
   *  per sourceType against the registry config schema. */
  config?: readonly ConfigEntryIR[];
}

export type ConnectionSourceIR =
  | { kind: "service"; service: string }
  | { kind: "env"; env: string }
  | { kind: "secret"; secret: string }
  | { kind: "literal"; literal: string };

/** A single generic `config` entry value (RFC §3.1/§8).  Every value is a
 *  string: the config-key vocabulary (`ConfigKeyType`) has no numeric or
 *  boolean key, so the grammar admits no other value kind. */
export type ConfigValueIR = { kind: "string"; value: string };

/** One `key: value` pair from a `config { … }` map, in declaration order. */
export interface ConfigEntryIR {
  key: string;
  value: ConfigValueIR;
}

export type StorageKind =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "inMemory"
  | "redis"
  | "elastic"
  | "meilisearch"
  | "kafka"
  | "clickhouse"
  | "bigquery"
  | "s3"
  | "localDisk"
  | "rabbitmq"
  | "restApi"
  | "smtp"
  | "ses"
  | "sendgrid";

/** System-level `theme { ... }` block.  Tokens are semantic so the
 *  same source applies to whatever target the React generator
 *  picks (Mantine today; shadcn/ui or others tomorrow).  All
 *  fields optional — a `theme {}` block is allowed but produces
 *  the platform's defaults.  Color values are validated to be
 *  CSS hex strings (#RGB / #RRGGBB / #RRGGBBAA); radius is one
 *  of the five named scale steps. */
/** The default source language of a system with no `i18n { … }` block. */
export const DEFAULT_SOURCE_LOCALE = "en";

/** The source language of a system.  Tolerates a hand-built system with no
 *  `i18n` (the default source). */
export function sourceLocaleOf(sys: { i18n?: I18nIR }): string {
  return sys.i18n?.source ?? DEFAULT_SOURCE_LOCALE;
}

/** The resolved `i18n { … }` block of a system. */
export interface I18nIR {
  /** BCP-47 tag of the language the `.ddd` text is written in. */
  source: string;
}

export interface ThemeIR {
  /** Brand color — e.g. "#3b82f6".  Mantine emitter generates a
   *  10-shade ramp from this hex and registers it as the project's
   *  `primaryColor`. */
  primary?: string;
  /** Secondary brand colour — used by packs that ship a second
   *  named accent (e.g. CSS `--color-secondary`).  Optional. */
  secondary?: string;
  /** Accent colour — third accent slot (e.g. highlight chips,
   *  callouts).  Optional. */
  accent?: string;
  /** Success semantic colour (positive feedback / confirmations). */
  success?: string;
  /** Warning semantic colour (cautions, non-blocking notices). */
  warning?: string;
  /** Error semantic colour (destructive actions, validation errors). */
  error?: string;
  /** Neutral / gray palette source.  Mantine emitter sets
   *  `colors.gray` to a 10-shade ramp from this hex, which Mantine
   *  uses for muted text, borders, dimmed backgrounds, etc. */
  neutral?: string;
  /** Border-radius scale step.  One of the five named values. */
  radius?: "none" | "sm" | "md" | "lg" | "xl";
  /** Body / control font stack.  Passed through verbatim — caller
   *  is responsible for ensuring the named fonts are available
   *  (web font import, system fallback chain). */
  fontFamily?: string;
  /** Monospace font stack — used for code blocks, ID displays,
   *  and other tabular content.  Same pass-through semantics as
   *  `fontFamily`. */
  fontFamilyMono?: string;
  /** Initial colour scheme — `"light"`, `"dark"`, or `"auto"`
   *  (follow system preference).  Packs that support theme
   *  toggling read this as the boot-time default. */
  colorScheme?: "light" | "dark" | "auto";
}

/** System-level `user { ... }` block.  Each field carries an
 *  ordinary TypeIR — primitives, `X id`, enums, value-objects,
 *  optional `T?` — and contributes to the emitted User type plus
 *  the `currentUser` magic identifier's member-access surface. */
export interface UserIR {
  fields: FieldIR[];
}

/** A resolved auth config value — an inline literal or a runtime
 *  `env(VAR)` reference (the deployment supplies the value; it never
 *  bakes into generated source). */
export type AuthValueIR = { kind: "literal"; value: string } | { kind: "env"; env: string };

/** One IdP-claim → `user { ... }`-field mapping. */
export interface ClaimMappingIR {
  /** Target field on the `user { ... }` shape. */
  field: string;
  /** Dotted IdP claim path, e.g. `realm_access.roles`. */
  path: string;
}

/** Fully-resolved OIDC endpoint config.  Provider presets
 *  (`keycloak` / `google` / …) are resolved into this record during
 *  lowering so backends never special-case provider names — they
 *  always consume concrete endpoints. */
export interface OidcConfigIR {
  issuer?: AuthValueIR;
  clientId?: AuthValueIR;
  clientSecret?: AuthValueIR;
  audience?: AuthValueIR;
  scopes: string[];
}

/** System-level OIDC authentication config (D-AUTH-OIDC).  Populated
 *  when the source declares an `auth { ... }` block; requires a
 *  `user { ... }` block (validator enforces).  Drives the generated
 *  token verifier (filling the existing per-backend verifier seam) and
 *  the `/auth/*` redirect handshake — Loom owns no auth runtime. */
export interface AuthIR {
  /** Provider preset name as written in source (`keycloak` / `custom`
   *  / `google` / …).  `undefined` when only a raw `oidc { ... }` block
   *  was given.  Already resolved into `oidc`; retained for emission
   *  hints (e.g. the bundled dev Keycloak). */
  provider?: string;
  /** Resolved endpoints (preset ⊕ explicit `oidc { ... }` overrides). */
  oidc: OidcConfigIR;
  /** How the app holds the post-login session. */
  sessions: "cookie" | "jwt";
  /** IdP-claim → user-field projections. */
  claims: ClaimMappingIR[];
  /** Default-deny posture.  `denyByDefault` (the language default since
   *  M-T3.1) forces every client-reachable command and read on an
   *  `auth: required` deployable to declare a gate; `opt` (written
   *  explicitly) keeps the per-`requires` opt-in. */
  enforcement: "denyByDefault" | "opt";
}

/** System-level tenancy declaration (tenancy.md).  Lowered from
 *  `tenancy by user.<claimField> of <registryName>`: `claimField` names
 *  the `user { … }` claim that partitions the data; `registryName` the
 *  aggregate acting as the tenant registry.  Both are plain names here,
 *  read off real cross-references at lowering — existence is the
 *  linker's job, singularity the tenancy validators', and
 *  an aggregate's tenancy *stance* is derived on demand from
 *  `crossTenant` + capabilities (derive-don't-stamp), never stored on
 *  the IR. */
export interface TenancyIR {
  claimField: string;
  registryName: string;
}

/** End-to-end test that targets a running deployable. */
export interface TestE2EIR {
  name: string;
  /** "api" — typed-fetch HTTP test (default).  "ui" — Playwright
   * test driven through the auto-generated page objects in the
   * target react deployable's `e2e/pages/`. */
  kind: "api" | "ui";
  deployableName: string;
  statements: TestStmtIR[];
  /** Traceability back-link — see `TestIR.verifiesTestCase`. */
  verifiesTestCase?: string;
  /** The `as { … }` principal — see `TestIR.principal`.  The suite sends it as
   *  the dev-stub claims override for every request of this block. */
  principal?: TestPrincipalIR;
}
