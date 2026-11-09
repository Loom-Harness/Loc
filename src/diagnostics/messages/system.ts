// The `system` family of the diagnostic-message catalog: system topology: platforms, deployables, apis, subdomains, resources, datasources and config.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "platform",
  "deployable",
  "targets",
  "serves",
  "api",
  "route",
  "subdomain",
  "hosted",
  "config",
  "resource",
  "datasource",
  "capability",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/datasource.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `datasource.ts` -------------------------------
  // Three codes for nine sites, because there are three RULES: the kind must
  // suit the storage, a knob must suit the kind, and a knob must suit the
  // storage.  The `#slug`s name which knob, so a reader still gets the exact
  // sentence and the Problems panel still gets one code per rule.
  "loom.resource-kind-storage-mismatch": (p: {
    name: unknown;
    kind: unknown;
    storageName: unknown;
    storageType: unknown;
    requires: unknown;
  }) =>
    `resource '${p.name}' kind '${p.kind}' is incompatible with storage '${p.storageName}' of type '${p.storageType}'. ` +
    `kind '${p.kind}' requires a storage of type ${p.requires}.`,
  "loom.resource-knob-kind-mismatch#ttl": (p: { name: unknown; kind: unknown }) =>
    `resource '${p.name}': 'ttl' is only meaningful on kind: cache. Got kind: ${p.kind}.`,
  "loom.resource-knob-kind-mismatch#every": (p: { name: unknown; kind: unknown }) =>
    `resource '${p.name}': 'every' is a snapshot-policy knob; valid on kind: eventLog or kind: snapshot. Got kind: ${p.kind}.`,
  "loom.resource-knob-kind-mismatch#retain": (p: { name: unknown; kind: unknown }) =>
    `resource '${p.name}': 'retain' is a snapshot-policy knob; valid on kind: eventLog or kind: snapshot. Got kind: ${p.kind}.`,
  "loom.resource-knob-kind-mismatch#isolation-on-cache": (p: { name: unknown }) =>
    `resource '${p.name}': 'isolationLevel' is not meaningful on kind: cache (no transactional semantics).`,
  "loom.resource-knob-storage-mismatch#schema": (p: { name: unknown; storageType: unknown }) =>
    `resource '${p.name}': 'schema' is only meaningful on a relational storage (postgres / mysql / sqlite / inMemory). Got '${p.storageType}'.`,
  "loom.resource-knob-storage-mismatch#table-prefix": (p: {
    name: unknown;
    storageType: unknown;
  }) =>
    `resource '${p.name}': 'tablePrefix' is only meaningful on a relational storage (postgres / mysql / sqlite / inMemory). Got '${p.storageType}'.`,
  "loom.resource-knob-storage-mismatch#key-prefix": (p: { name: unknown; storageType: unknown }) =>
    `resource '${p.name}': 'keyPrefix' is only meaningful on a key-value storage (redis / inMemory). Got '${p.storageType}'.`,
  "loom.resource-knob-storage-mismatch#isolation": (p: { name: unknown; storageType: unknown }) =>
    `resource '${p.name}': 'isolationLevel' is only meaningful on a relational storage (postgres / mysql / sqlite / inMemory). Got '${p.storageType}'.`,
  "loom.resource-api-target-kind": (p: { name: unknown; apiName: unknown; kind: unknown }) =>
    `resource '${p.name}' binds api '${p.apiName}', which is only valid on kind: api.  ` +
    `Got kind: ${p.kind}.  Bind a storage for kind '${p.kind}', or change the kind to 'api'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/deployable.ts
  // ----------------------------------------------------------------------
  "loom.platform-knob-out-of-menu": (p: {
    name: unknown;
    value: unknown;
    dName: unknown;
    reason: unknown;
    avail: unknown;
  }) => `'${p.name}: ${p.value}' on deployable '${p.dName}' ${p.reason}. ${p.avail}`,
  "loom.platform-knob-style-layout-mismatch": (p: {
    layout: unknown;
    name: unknown;
    style: unknown;
    supported: unknown;
  }) =>
    `'directoryLayout: ${p.layout}' on deployable '${p.name}' is not supported by the '${p.style}' emission style. Supported: ${p.supported}.`,
  "loom.targets-misplaced": (p: { frontends: unknown }) =>
    `'targets:' is only valid on a frontend deployable (${p.frontends}).`,
  "loom.platform-unknown": (p: { raw: unknown; name: unknown; menu: unknown }) =>
    `Unknown platform '${p.raw}' on deployable '${p.name}'. Valid: ${p.menu} (backends also accept a pinned form, e.g. 'node@v5').`,
  "loom.platform-version-unknown": (p: {
    raw: unknown;
    name: unknown;
    version: unknown;
    family: unknown;
    available: unknown;
  }) =>
    `Platform '${p.raw}' on deployable '${p.name}' — no version '${p.version}' of backend '${p.family}'. Available: ${p.available}.`,
  // Same code: the pin names a version that existed and was removed, so the
  // message names its replacement rather than only listing what exists.
  "loom.platform-version-unknown#retired": (p: {
    raw: unknown;
    name: unknown;
    successor: unknown;
  }) =>
    `Platform '${p.raw}' on deployable '${p.name}' was retired. Pin '${p.successor}' or use the bareword family name.`,
  "loom.datasource-context-unlisted": (p: { name: unknown; dsName: unknown; ctxName: unknown }) =>
    `Deployable '${p.name}' lists resource '${p.dsName}' whose 'for: ${p.ctxName}' is not in 'contexts:'. Add ${p.ctxName} to 'contexts:' or remove the resource.`,
  "loom.datasource-duplicate": (p: {
    name: unknown;
    ctxName: unknown;
    kind: unknown;
    prior: unknown;
    dsName: unknown;
  }) =>
    `Deployable '${p.name}' has two dataSources for (${p.ctxName}, kind: ${p.kind}): '${p.prior}' and '${p.dsName}'. Pick exactly one per (context, kind).`,
  "loom.serves-on-frontend": (p: { backends: unknown; platform: unknown }) =>
    `'serves:' is only valid on a backend deployable (${p.backends}). Got platform '${p.platform}'.`,
  "loom.serves-unknown-api": (p: { name: unknown; apiName: unknown }) =>
    `Deployable '${p.name}' serves undeclared api '${p.apiName}'. Declare 'api ${p.apiName} from <Module>' at system scope.`,
  "loom.serves-duplicate-api": (p: { name: unknown; apiName: unknown }) =>
    `Deployable '${p.name}' lists api '${p.apiName}' more than once in its 'serves:' list.`,

  // ----------------------------------------------------------------------
  // src/language/validators/duplicates.ts
  // ----------------------------------------------------------------------
  "loom.hosted-type-name-collision": (p: {
    kind: unknown;
    name: unknown;
    ctxName: unknown;
    first: unknown;
    deployable: unknown;
  }) =>
    `${p.kind} '${p.name}' in context '${p.ctxName}' has the same name as the ${p.kind} of that name in context ` +
    `'${p.first}', and both contexts are hosted by deployable '${p.deployable}'. A deployable generates one project ` +
    `with a single domain namespace per kind, so the two would write the same file or symbol (one is dropped, or ` +
    `generation crashes). Rename one, or host the contexts on separate deployables.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/api-checks.ts
  // ----------------------------------------------------------------------
  /** An `api` no backend deployable `serves:` — dead declaration (#29). */
  "loom.api-unserved": (p: { name: unknown; backends: unknown }) =>
    `api '${p.name}' is declared but no backend deployable serves it, so no deployable mounts its routes or carries its contract. Add it to a backend deployable's 'serves:' list (backends: ${p.backends}), or remove the declaration.`,
  "loom.route-handler-unresolved#api-route-targets-context": (p: {
    name: unknown;
    label: unknown;
    context: unknown;
  }) =>
    `api '${p.name}': route '${p.label}' targets context '${p.context}', ` +
    `which is not a bounded context in this model.`,
  "loom.route-handler-unresolved#api-route-targets-but-context": (p: {
    name: unknown;
    label: unknown;
    context: unknown;
    handler: unknown;
  }) =>
    `api '${p.name}': route '${p.label}' targets '${p.context}.${p.handler}', ` +
    `but context '${p.context}' has no commandHandler or queryHandler ` +
    `named '${p.handler}'.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.deployable-channel-unrelated": (p: {
    name: unknown;
    csName: unknown;
    channelName: unknown;
    ctxName: unknown;
    carries: unknown;
  }) =>
    `Deployable '${p.name}' lists channelSource '${p.csName}', but it neither ` +
    `hosts channel '${p.channelName}'\`s owning context ('${p.ctxName}') nor ` +
    `consumes any event it carries (${p.carries}). ` +
    `This wiring routes nothing — remove it, or host a producing/consuming context.`,
  "loom.datasource-binding-missing": (p: {
    name: unknown;
    ctxName: unknown;
    aggName: unknown;
    persistedAs: unknown;
    kind: unknown;
    ctxName2: unknown;
    kind2: unknown;
  }) =>
    `Deployable '${p.name}' hosts aggregate '${p.ctxName}.${p.aggName}' ` +
    `(persistedAs: ${p.persistedAs}, ` +
    `needs dataSource kind: ${p.kind}) but lists no matching dataSource. ` +
    `Declare ` +
    // The DECLARATION keyword is `resource`; `dataSource` is only the name of
    // the deployable's `dataSources:` clause.  This read `dataSource`, so a
    // reader who pasted the suggested line verbatim got a parse error
    // ("Expecting token of type '}' but found `dataSource`") — the one thing a
    // fix-it message must never do.  Its sibling `loom.datasource-unused` has
    // always said "resource".
    `\`resource ${p.ctxName2}${p.kind2} ` +
    `{ for: ${p.ctxName}, kind: ${p.kind}, use: <storage> }\` ` +
    `and add it to '${p.name}'\`s 'dataSources:' list.`,
  "loom.datasource-unused": (p: {
    name: unknown;
    dsName: unknown;
    kind: unknown;
    contextName: unknown;
    reason: unknown;
  }) =>
    `Deployable '${p.name}' lists resource '${p.dsName}' (kind: ${p.kind}) for ` +
    `context '${p.contextName}', but ${p.reason}.  This binding routes no data — ` +
    `remove it, or add an aggregate whose persistedAs needs kind: ${p.kind}.`,
  // (The generic `loom.mikroorm-unsupported` tail lived here — the one
  // `validateMikroOrmSupport` used for its SHAPE rejects.  Its last two
  // callers: the abstract-inheritance-base-with-`contains` shape, impossible
  // on every target and so promoted to the target-neutral
  // `loom.abstract-aggregate-contains` above; and the root SCALAR/ENUM
  // collection field (`#scalar-array`) — the one shape mikroorm was genuinely
  // behind drizzle on — drained when `columnsForType` (typescript/emit/
  // mikroorm.ts) grew an `"array"` arm mirroring drizzle's native Postgres
  // array column (M-T6.23).  The CODE stays live through the three
  // migration-checks.ts variants above (`#migrations`, `#schema-split`,
  // `#schema-ignored`) — the self-provisioning limits this adapter's
  // `orm.schema.update()` boot-time schema owner genuinely cannot
  // express.)
  "loom.resource-missing-capability": (p: {
    name: unknown;
    sourceType: unknown;
    missing: unknown;
    contextName: unknown;
    kind: unknown;
  }) =>
    `resource '${p.name}' (sourceType '${p.sourceType}') does not offer ` +
    `${p.missing} required by context ` +
    `'${p.contextName}' for kind '${p.kind}'.`,
  "loom.resource-api-unserved": (p: { name: unknown; apiName: unknown }) =>
    `resource '${p.name}' binds api '${p.apiName}', but no backend deployable serves it, ` +
    `so its address cannot be derived.  Add 'serves: ${p.apiName}' to the deployable that hosts it.`,
  "loom.resource-api-ambiguous-server": (p: {
    name: unknown;
    apiName: unknown;
    length: unknown;
    servers: unknown;
  }) =>
    `resource '${p.name}' binds api '${p.apiName}', which ${p.length} deployables serve ` +
    `(${p.servers}).  The caller's address would be ambiguous — ` +
    `have exactly one deployable serve it.`,
  "loom.resource-api-self-call": (p: { name: unknown; rName: unknown; apiName: unknown }) =>
    `deployable '${p.name}' wires resource '${p.rName}', which binds api '${p.apiName}' that ` +
    `'${p.name}' itself serves.  Call the context directly instead — it is already in-process.`,
  "loom.resource-index-non-state": (p: { label: unknown; kind: unknown }) =>
    `${p.label}: \`index:\` needs a relational table to sit on, so it is only valid on a \`kind: state\` binding (this is \`kind: ${p.kind}\`).`,
  "loom.resource-index-unknown-entity": (p: {
    label: unknown;
    entity: unknown;
    contextName: unknown;
  }) =>
    `${p.label}: \`index:\` targets '${p.entity}', which is not an aggregate or contained part in context '${p.contextName}'.`,
  "loom.resource-index-unknown-column": (p: {
    label: unknown;
    entity: unknown;
    col: unknown;
    suggestion?: unknown;
  }) =>
    `${p.label}: \`index:\` references '${p.entity}.${p.col}', but '${p.col}' is not a field on '${p.entity}'.` +
    didYouMean(p.suggestion),
  "loom.config-key-unknown": (p: {
    label: unknown;
    key: unknown;
    sourceType: unknown;
    suggestion?: unknown;
  }) =>
    `${p.label}: config key '${p.key}' is not recognised by sourceType '${p.sourceType}' — it will be ignored.` +
    didYouMean(p.suggestion),
  "loom.config-key-type": (p: { label: unknown; key: unknown; expected: unknown }) =>
    `${p.label}: config key '${p.key}' expects ${p.expected}.`,
  "loom.config-key-required": (p: { label: unknown; name: unknown; sourceType: unknown }) =>
    `${p.label}: required config key '${p.name}' (sourceType '${p.sourceType}') is missing.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.resource-verb-invalid": (p: {
    name: unknown;
    resourceName: unknown;
    verb: unknown;
    resourceKind: unknown;
    resourceKind2: unknown;
  }) =>
    `workflow '${p.name}': '${p.resourceName}.${p.verb}(...)' — '${p.verb}' is not a valid verb for a ${p.resourceKind} resource.  Available: ${p.resourceKind2}.`,
  "loom.resource-verb-invalid#api-bound": (p: {
    location: unknown;
    resourceName: unknown;
    verb: unknown;
    apiName: unknown;
  }) =>
    `${p.location}: '${p.resourceName}.${p.verb}(...)' — '${p.resourceName}' is bound to the in-system api '${p.apiName}', so its client is derived from that api's operations and has no raw '${p.verb}' verb.  Call one of the operations of '${p.apiName}' by its id instead (e.g. '${p.resourceName}.<operationId>(...)'), or bind the resource to a 'storage' (an external HTTP endpoint) to call it by raw verb.`,
  "loom.resource-op-in-transaction": (p: { name: unknown; resourceName: unknown; verb: unknown }) =>
    `workflow '${p.name}': resource operation '${p.resourceName}.${p.verb}(...)' cannot run inside a transactional workflow — external effects don't roll back with the database transaction.  Move it out of the transactional span, or publish through an outbox.`,
  "loom.resource-op-outside-workflow": (p: {
    location: unknown;
    resourceName: unknown;
    verb: unknown;
  }) =>
    `resource operation '${p.resourceName}.${p.verb}(...)' is only available inside a workflow body or a command/query handler body — no backend has the resource client in scope anywhere else, a domainService or a workflow 'function' included (.NET/Java/Phoenix fail codegen outright; TS/Python emit an unimported helper call). Found in ${p.location}; move the call into a workflow and have this member work on the value it produces.`,

  // --- the M-T9.56 drain of `ddd-validator.ts` ----------------------------
  "loom.api-unknown-subdomain": (p: { name: unknown; sub: unknown }) =>
    `api '${p.name}' references undeclared subdomain '${p.sub}'. Declare a 'subdomain ${p.sub} { … }' at system scope first.`,
  "loom.subdomain-conflicting-urlstyle": (p: {
    name: unknown;
    style: unknown;
    sub: unknown;
    prior: unknown;
  }) =>
    `api '${p.name}' sets urlStyle '${p.style}' on subdomain '${p.sub}', which another api already surfaces as '${p.prior}'.  The first-declared style ('${p.prior}') wins; route slugs use it.`,

  // ----------------------------------------------------------------------
  // src/macros/expander.ts
  // ----------------------------------------------------------------------
  "loom.capability-host-invalid": (p: { name: unknown; hostKind: unknown }) =>
    `Capability '${p.name}' can only be applied to an aggregate or context (got '${p.hostKind}').  ` +
    "A capability is a pure mixin over domain state, not a UI or API concern.",
} satisfies Record<string, MessageEntry>;
