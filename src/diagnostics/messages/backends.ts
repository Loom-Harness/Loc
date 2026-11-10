// The `backends` family of the diagnostic-message catalog: backend-specific refusals and the per-target unsupported register (Phoenix, vanilla Elixir, .NET, MikroORM, Dapper).
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["target", "elixir", "vanilla", "dotnet", "mikroorm", "dapper"] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/ir/validate/checks/store-checks.ts
  // ----------------------------------------------------------------------
  // The statement `match` RENDERS on elixir (a value-producing `record = case …
  // end` in an operation, a tail `case` in a domain service, a `{:ok, _} <-
  // (case … end)` with-clause in a workflow / handler).  What is left are the
  // sub-shapes that rendering cannot express, each named by its slug.
  "loom.elixir-match-stmt-unsupported#return-in-arm": (p: { where: unknown; name: unknown }) =>
    `A \`return\` appears inside a \`match\` arm in ${p.where}, whose context is hosted by the ` +
    `Phoenix/Elixir deployable '${p.name}'.  The statement \`match\` renders on Elixir, but a ` +
    `\`return\` inside an arm is an EARLY EXIT, and an Elixir body has no early return — its ` +
    `value is its tail expression, so the statements after the \`match\` would still run (a ` +
    `domain-service body may \`return\` from every arm of a TAIL \`match\` that covers its ` +
    `subject).  Assign in the arms and return once after the \`match\`, or host this context ` +
    `on a node / dotnet / java / python backend.`,
  "loom.elixir-match-stmt-unsupported#guard-in-arm": (p: { where: unknown; name: unknown }) =>
    `A \`precondition\` / \`requires\` guard appears inside a \`match\` arm in ${p.where}, ` +
    `whose context is hosted by the Phoenix/Elixir deployable '${p.name}'.  The Phoenix ` +
    `operation path HOISTS an operation's guards into a leading \`with :ok <- ensure(…)\` ` +
    `chain so a failed guard answers 403 / 422; a guard nested inside an arm cannot be ` +
    `hoisted and would raise instead, answering 500 where the other four backends answer a ` +
    `typed denial.  Lift the guard to the top of the body, or host this context on a node / ` +
    `dotnet / java / python backend.`,
  "loom.elixir-match-stmt-unsupported#arm-statement": (p: { where: unknown; name: unknown }) =>
    `A \`match\` arm in ${p.where} contains a statement the Phoenix/Elixir deployable ` +
    `'${p.name}' cannot render THERE — an \`emit\` or a \`provenanced\` write.  The statement ` +
    `\`match\` renders on Elixir; an arm may hold what an \`if\` branch may (assignments, ` +
    `collection mutations, \`let\`, a call, a nested \`if\` or \`match\`), because the ` +
    `emitters decide an operation's supporting machinery by scanning its TOP-LEVEL ` +
    `statements: a conditional \`emit\` would be invisible to that scan and could not be ` +
    `hoisted past the commit, and a nested \`provenanced\` write would capture lineage in an ` +
    `operation never put into provenance-flush mode.  Move the statement out of the arm ` +
    `(compute a value inside the \`match\`, act on it after), or host this context on a ` +
    `node / dotnet / java / python backend.`,
  "loom.elixir-match-stmt-unsupported#event-sourced": (p: { where: unknown; name: unknown }) =>
    `A statement \`match\` is used in ${p.where} — an EVENT-SOURCED command body or workflow ` +
    `handler — whose context is hosted by the Phoenix/Elixir deployable '${p.name}'.  Such a ` +
    `body is not rendered as a statement sequence on Phoenix: its guards become ` +
    `\`with :ok <- ensure(…)\` clauses and its \`emit\`s one \`events = […]\` list, so an ` +
    `arm has nowhere to render.  Compute the choice as a VALUE (an expression ` +
    `\`match\` inside the emitted event's fields), or host this context on a node / dotnet / ` +
    `java / python backend.`,
  "loom.elixir-match-stmt-unsupported#multi-success": (p: { where: unknown; name: unknown }) =>
    `A statement \`match\` in ${p.where} matches a union with more than one non-error ` +
    `variant, and its context is hosted by the Phoenix/Elixir deployable '${p.name}'.  On ` +
    `Elixir an \`or\`-returning call answers \`{:ok, value}\` for its success variant and ` +
    `\`{:error, "Tag", fields}\` for an \`error\` one — the success value carries no tag, so ` +
    `two success variants cannot be told apart at runtime.  Make all but one of the variants ` +
    `\`error\` records, or host this context on a node / dotnet / java / python backend.`,

  // ----------------------------------------------------------------------
  // src/generator/flutter/riverpod-emit.ts
  //
  // Phase ⑧ give-ups, not phase ④/⑦ checks: they are worded here (and route
  // through `giveUp`, so they carry the shared degradation sentinel) because
  // the emitter is the only layer that knows a Riverpod Notifier method cannot
  // express the statement.  Before this they were bare `TODO(flutter
  // full-parity)` comments with no code and no sentinel.
  // ----------------------------------------------------------------------
  "loom.target-unsupported#datagrid": (p: { what: unknown; dName: unknown; target: unknown }) =>
    `${p.what} uses 'DataGrid', which deployable '${p.dName}' can't render ` +
    `(frontend '${p.target}'). DataGrid is a TanStack row model, so it ships wherever ` +
    `TanStack can run: react, vue, svelte, angular and feliz. It is a permanent gap on flutter ` +
    `(the native target has no JS runtime) and on heex (LiveView could only re-implement the ` +
    `row model, forking its sort, filter and pagination semantics). Use 'Table' — it supports ` +
    `column sort and pagination on every frontend, server-driven on Phoenix and Flutter — or ` +
    `host this page on one of the five above.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.target-unsupported#chart": (p: { what: unknown; dName: unknown; target: unknown }) =>
    `${p.what} uses 'Chart', which deployable '${p.dName}' can't render ` +
    `(frontend '${p.target}'). Chart ships on every shipping frontend — react, vue, ` +
    `svelte, angular, feliz, flutter and phoenixLiveView — so this names a frontend the ` +
    `chart renderer has not been written for yet. Bind the grouped projection to 'Table' ` +
    `meanwhile: it renders the same rows on every frontend.`,
  "loom.target-unsupported#money-locale-format": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} uses \`Money { …, format: "locale" }\`, which deployable '${p.dName}' can't ` +
    `render (frontend '${p.target}'): its \`Money\` shows the value's own text and has no ` +
    `locale-aware number formatter. Drop \`format:\` for the verbatim digits, or host this ` +
    `page on a frontend that formats money in the active locale — react, vue, svelte, ` +
    `angular, feliz or flutter.`,
  "loom.target-unsupported#entity-history-read": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} reads an entity's audit history (\`QueryView { of: <Agg>.history(id) }\`), ` +
    `which deployable '${p.dName}' can't serve (frontend '${p.target}'): its read layer does ` +
    `not collect the history read or render 'Timeline'. Host this page on a frontend that does, ` +
    `or read the history through a backend query.`,
  "loom.target-unsupported#match-await-standard-op": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} awaits a STANDARD aggregate operation, which deployable '${p.dName}' can't ` +
    `render (frontend '${p.target}'): its action renderer resolves \`match await\` only against ` +
    `a DECLARED \`operation\`, so the effect cannot be emitted. Declare an \`operation\` that ` +
    `does the work and await that, or drive the standard op through a form primitive ` +
    `(\`DestroyForm\` / \`CreateForm\`).`,
  // An EVENT-SOURCED `create` gate.  Not a "not yet" gap: the create body
  // renders into the domain `_init`, which has no principal in scope, so the
  // guard cannot be evaluated there at all.  Phoenix hoists the gate to its
  // context function and binds a principal, so only the other four refuse.
  "loom.target-unsupported#lifecycle-guard-event-sourced": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what}: a \`requires\` in an event-sourced \`create\` cannot be enforced on deployable '${p.dName}' (backend '${p.target}'). The create body renders into the domain \`_init\`, which has no principal in scope — \`currentUser\` is a free identifier there, so the guard does not compile rather than deny. Gate the caller instead: put the \`requires\` on the named \`operation\` (or \`workflow\`) that issues the create, where the request principal is bound. (Phoenix/\`elixir\` hoists the gate to its context function and binds a principal, so it enforces this one.)`,
  // A tenant-scoped event stream on a backend whose event store does not yet
  // carry the stream tenant: it would serve every tenant every stream.
  "loom.target-unsupported#tenant-owned-event-sourced": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what}: deployable '${p.dName}' (backend '${p.target}') can't yet scope an event stream by tenant — its event store would neither stamp the stream's tenant nor filter stream loads and lists by it, so every tenant would read every stream. Host the aggregate on a node deployable (its default Drizzle persistence), or keep it state-sourced (drop persistedAs: eventLog).`,
  "loom.target-unsupported#resource-kind-unrealized": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} binds a resource kind that deployable '${p.dName}' (backend '${p.target}') can't realize: no backend emits a read-replica connection, a read-through cache (#4440), an event-sourced snapshot store or a Kafka-held event log, so the context would run on its primary Postgres alone and the declared resource would change nothing. Bind the context to a \`state\` resource (and, for an event-sourced aggregate, an \`eventLog\` resource) on a \`type: postgres\` storage.`,
  "loom.target-unsupported#resource-knob-unrealized": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} — a resource knob that deployable '${p.dName}' (backend '${p.target}') can't realize: no emitter reads \`ttl\`, \`keyPrefix\`, \`every\`, \`retain\` or \`readonly\` (each gates an adapter that does not exist: a cache, a snapshot policy, a replica-aware connection), so the value would be accepted and change nothing. Drop the knob.`,
  "loom.target-unsupported#feature-composition-broken": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} — deployable '${p.dName}' (backend '${p.target}') generates code for this combination that compiles but does not behave as either feature promises. Drop one of the two features on this aggregate, or host it on a backend that supports the pair.`,
  "loom.target-unsupported#feature-composition-unwitnessed": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} — no behavioural test proves this combination on deployable '${p.dName}' (backend '${p.target}'), so the generated code may compile and still misbehave. Drop one of the two features on this aggregate until the pair is supported.`,
  "loom.target-unsupported#storage-type-unbound": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} binds to no kind that deployable '${p.dName}' (backend '${p.target}') can realize: no dataSource, channelSource or resource can use it and no backend emits anything for it, so the declaration is a no-op. Use a supported type (postgres for state, redis for a cache transport, rabbitmq / kafka for queues and channels, s3 / localDisk for objects, restApi, smtp / ses / sendgrid), or drop the declaration.`,
  "loom.target-unsupported#storage-type-unrealized": (p: {
    what: unknown;
    dName: unknown;
    target: unknown;
  }) =>
    `${p.what} binds a persistence resource to a storage type that deployable '${p.dName}' (backend '${p.target}') can't realize: every backend emits Postgres (its migrations, ORM mapping and compose \`db\` service), so the generated project would run on Postgres instead of the declared database. Use \`type: postgres\`.`,
  "loom.vanilla-document-unsupported": (p: { ctxName: unknown; name: unknown; bits: unknown }) =>
    `aggregate '${p.ctxName}.${p.name}' is shape: document on elixir, which emits ` +
    `scalar custom finds + named operations but not ${p.bits} ` +
    `(provenanced ops, derived / dereferenced-entity reads, value-object METHOD calls, ` +
    `or a collection op over a REFERENCE collection — 'X id[]' needs a join table a jsonb ` +
    `blob has no equivalent for; a collection op over the aggregate's OWN containment or a ` +
    `scalar array is fine). Simplify them to scalar form, host this ` +
    `aggregate on a backend with full document support (node / dotnet / python / java), ` +
    `or use shape: relational / shape: embedded.`,
  "loom.elixir-invariant-unenforced": (p: {
    ctxName: unknown;
    name: unknown;
    source: unknown;
    reason: unknown;
  }) =>
    `invariant '${p.source}' on '${p.ctxName}.${p.name}' is NOT ENFORCED on the ` +
    `elixir backend: ${p.reason}. node / dotnet / python / java all assert it at ` +
    `their domain floor, so hosting this context on elixir silently drops the rule ` +
    `— this warning is the drop, made visible. Rewrite the predicate so the ` +
    `changeset can evaluate it against the proposed row (a comparison over stored ` +
    `fields, a contained collection, a derived value, or a scalar intrinsic all ` +
    `work), move the rule into an operation 'precondition' (which runs in the ` +
    `domain body where the full aggregate is in scope), or host this context on a ` +
    `backend that enforces it.`,
  "loom.vanilla-op-call-position": (p: {
    ctxName: unknown;
    name: unknown;
    opName: unknown;
    eName: unknown;
  }) =>
    `operation '${p.ctxName}.${p.name}.${p.opName}' calls sibling operation ` +
    `'${p.eName}' outside 'return' tail position, which the elixir backend can't ` +
    `lower — an operation compiles to a context function returning a tagged ` +
    `{:ok,_}|{:error,_} tuple, so its result can only be passed through as the ` +
    `whole 'return' value, not composed into a larger expression or bound with ` +
    `'let'. Use a bare 'return ${p.eName}(...)', or host this context on a backend ` +
    `with full support (node / dotnet / python / java).`,
  "loom.vanilla-op-call-actor": (p: {
    ctxName: unknown;
    name: unknown;
    opName: unknown;
    eName: unknown;
  }) =>
    `operation '${p.ctxName}.${p.name}.${p.opName}' calls '${p.eName}', whose body reads ` +
    `'currentUser' — the elixir backend can't thread the request principal into it. A bare ` +
    `call to a private operation lowers to a module-local pure transform ` +
    `('record = __op_${p.eName}(record, ...)'), and the calling function binds the actor only ` +
    `when its OWN body reads it, so the callee's 'current_user' would be unbound and the ` +
    `generated project would not compile. Move the 'currentUser' read up into ` +
    `'${p.opName}' (the routed operation, which receives the actor), or host this context on ` +
    `a backend with full support (node / dotnet / python / java).`,
  "loom.elixir-part-timestamp-field": (p: {
    owner: unknown;
    name: unknown;
    column: unknown;
    ctxName: unknown;
  }) =>
    `'${p.ctxName}.${p.owner}' declares the field '${p.name}', whose column '${p.column}' is ` +
    `one of the two columns Ecto's bundled 'timestamps()' macro defines on every relational entity-part ` +
    `schema, so the generated Phoenix project defines the field twice and fails to compile. ` +
    `Rename the field (e.g. '${p.name}Value'), or host this context on a non-elixir deployable.`,
  "loom.dotnet-name-collision": (p: {
    what: unknown;
    owner: unknown;
    name: unknown;
    member: unknown;
    ctxName: unknown;
  }) =>
    `'${p.ctxName}.${p.owner}' declares ${p.what} '${p.name}', which the dotnet backend emits ` +
    `as the C# member '${p.member}' on a class that also references the type '${p.member}' by ` +
    `simple name. C# resolves a simple name in expression position against the enclosing ` +
    `class's members first, so the member hides the type and the generated C# stops compiling ` +
    `(CS0119 for a method, CS1061 for a property). Rename the declaration to something other ` +
    `than '${p.member}' (an operation reads well as 'add${p.member}'), or host this context on ` +
    `a node / python / elixir / java deployable.`,
  "loom.dotnet-name-collision#generated-member": (p: {
    what: unknown;
    owner: unknown;
    name: unknown;
    member: unknown;
    ctxName: unknown;
  }) =>
    `'${p.ctxName}.${p.owner}' declares ${p.what} '${p.name}', which the dotnet backend emits ` +
    `as the C# member '${p.member}' — a name the backend already GENERATES on that class ` +
    `(the root's 'Inspect' / 'ToString()' / 'DomainEvents' / 'PullEvents()', a part's ` +
    `'ParentId'). Two members of one name in one class do not compile (CS0102 / CS0111). ` +
    `Rename the declaration, or host this context on a node / python / elixir / java deployable.`,
  "loom.dotnet-name-collision#package-namespace": (p: {
    what: unknown;
    name: unknown;
    ctxName: unknown;
    resource: unknown;
    package: unknown;
  }) =>
    `${p.what} '${p.name}' in context '${p.ctxName}' is emitted as the C# type '${p.name}', but the dotnet ` +
    `deployable also references the NuGet package ${p.package} (for resource '${p.resource}'), whose root ` +
    `namespace is '${p.name}'. A namespace declared at the global level wins a simple-name lookup over ` +
    `the imported domain type, so every file that names it stops compiling (CS0118). Rename the ` +
    `${p.what} (e.g. '${p.name}Unit'), or drop the resource from the dotnet deployable.`,
  "loom.dotnet-name-collision#member-pair": (p: {
    what: unknown;
    owner: unknown;
    name: unknown;
    member: unknown;
    other: unknown;
    ctxName: unknown;
  }) =>
    `'${p.ctxName}.${p.owner}' declares ${p.what} '${p.name}' and ${p.other}, which the dotnet backend ` +
    `both emits as the C# member '${p.member}' (it upper-cases the first letter). Two members of one name ` +
    `in one class do not compile (CS0102 / CS0111). Rename one, or host this context on a node / python / ` +
    `elixir / java deployable.`,
  "loom.dapper-unsupported": (p: { name: unknown; subject: unknown; reason: unknown }) =>
    `Deployable '${p.name}' selects 'persistence: dapper', but ${p.subject} ${p.reason}. ` +
    `The Dapper adapter is at full parity with EF Core; the only shapes it now ` +
    `rejects have no relational persistence mapping at all (efcore included) — restructure ` +
    `the model as the message suggests.`,
  // The self-provisioning-adapter migration gate.  Not the blanket message
  // above: this is not "no relational mapping anywhere" — the sibling adapter
  // (drizzle) applies the very same migration chain fine.  What mikroorm lacks
  // is a migration chain AT ALL: it syncs the schema itself at boot, so a
  // declared `migration` block is "resolved" as a drop+add, which deletes
  // data.  (Dapper had a twin until it gained the chain — D-DAPPER-ALTER.)
  "loom.mikroorm-unsupported#migrations": (p: {
    name: unknown;
    migration: unknown;
    step: unknown;
    count: unknown;
  }) =>
    `Deployable '${p.name}' selects 'persistence: mikroorm', but the model declares ` +
    `${p.count} migration step(s) it can never apply (first: '${p.step}' in migration ` +
    `'${p.migration}'). The MikroORM adapter emits no migration chain — it syncs its schema ` +
    `with 'orm.schema.update()' at boot, which has no rename intent to consult and ` +
    `resolves a rename as DROP + ADD, destroying the column's data. Use ` +
    `'persistence: drizzle' on this deployable, or host these contexts elsewhere.`,
  // The second consequence of self-provisioning (F2-ADP-3): the same
  // boot-time `CREATE TABLE IF NOT EXISTS` that has no migration chain also
  // names every table UNQUALIFIED, while every migration-chain adapter routes
  // it into the binding's Postgres schema — which defaults to `snake(<context>)`
  // even when the DSL declares no `schema:` at all.  Two tables, two
  // deployables, no error: the split-brain gets its own wording because "no
  // relational mapping anywhere" is the opposite of true here (the sibling
  // adapter maps it fine; that is exactly why they disagree).
  "loom.mikroorm-unsupported#schema-split": (p: {
    name: unknown;
    ctxName: unknown;
    other: unknown;
    otherAdapter: unknown;
  }) =>
    `Deployable '${p.name}' selects 'persistence: mikroorm' and hosts context ` +
    `'${p.ctxName}', which deployable '${p.other}' (${p.otherAdapter}) also hosts. ` +
    `The MikroORM adapter syncs its tables at boot and names them UNQUALIFIED (public), ` +
    `while '${p.other}' routes the same tables into the dataSource's Postgres schema ` +
    `(default: the snake-cased context name). Both deployables would start against ` +
    `DIFFERENT physical tables and each would see an empty database. Use ` +
    `'persistence: drizzle' on '${p.name}' so both share one schema, or give the two ` +
    `deployables separate contexts.`,
  // Dapper honours a `schema:` (its migrations create the tables there and its
  // connection's `search_path` names the schema), so its only dropped request
  // is a `tablePrefix:` — a rename its unqualified repository SQL never applies.
  "loom.dapper-unsupported#schema-ignored": (p: {
    name: unknown;
    binding: unknown;
    asked: unknown;
  }) =>
    `Deployable '${p.name}' selects 'persistence: dapper', but its dataSource binding ` +
    `'${p.binding}' declares '${p.asked}'. The Dapper repositories name every table ` +
    `UNQUALIFIED and unprefixed, so the migrations would create prefixed tables that no ` +
    `statement ever reads. Use 'persistence: efcore' on this deployable, or drop the clause.`,
  "loom.mikroorm-shared-database": (p: { name: unknown; storage: unknown; others: unknown }) =>
    `Deployable '${p.name}' selects 'persistence: mikroorm' and binds storage '${p.storage}', ` +
    `whose database it shares with ${p.others}. Deployables on one storage share its ` +
    `database and one migration chain, applied by the first of them; the MikroORM adapter ` +
    `has no migration chain and syncs only its own entities with 'orm.schema.update()' at ` +
    `boot, so it can neither create the other deployables' tables nor leave the chain's ` +
    `columns alone. Use 'persistence: drizzle' on '${p.name}', or bind it to a storage of ` +
    `its own.`,
  "loom.dapper-shared-database": (p: { name: unknown; storage: unknown; others: unknown }) =>
    `Deployable '${p.name}' selects 'persistence: dapper' and binds storage '${p.storage}', ` +
    `whose database it shares with ${p.others}. Deployables on one storage share its ` +
    `database and the tables its first deployable migrates; the Dapper adapter lays those ` +
    `tables out its own way (a value object folds into one jsonb column), so it and ` +
    `${p.others} would each read tables the other never created. Select the same ` +
    `persistence on every deployable of '${p.storage}', or bind '${p.name}' to a storage of ` +
    `its own.`,
  "loom.mikroorm-unsupported#schema-ignored": (p: {
    name: unknown;
    binding: unknown;
    asked: unknown;
  }) =>
    `Deployable '${p.name}' selects 'persistence: mikroorm', but its dataSource binding ` +
    `'${p.binding}' declares '${p.asked}'. The MikroORM adapter emits a bare ` +
    `'tableName' on each entity and syncs the schema at boot, so the placement you asked ` +
    `for is silently dropped and the tables land in 'public'. Use 'persistence: drizzle' ` +
    `on this deployable, or drop the clause.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  // `let r = a.withdraw(x)` / `let r = Transfer.run(…)` in a body the Phoenix
  // backend emits — the bound form of a mutating call is not rendered there.
  "loom.elixir-entry-result-unsupported": (p: { where: unknown; deployable: unknown }) =>
    `${p.where} declares an expected-failure result ('T or E'), and the Phoenix/Elixir ` +
    `deployable '${p.deployable}' hosts its context.  The Phoenix workflow and handler emitters ` +
    `have no tagged result yet, nor the rollback that undoes the whole command when the answer ` +
    `is an error.  Drop the error variant (answer the failure with 'notFound', or from an ` +
    `operation route), or host this context on a node / dotnet / java / python backend.`,
  "loom.elixir-entry-result-unsupported#workflow-state": (p: {
    where: unknown;
    deployable: unknown;
  }) =>
    `${p.where} answers the workflow itself ('return this'), and the Phoenix/Elixir deployable ` +
    `'${p.deployable}' hosts its context.  The Phoenix command route has no instance-state ` +
    `answer yet.  Answer the correlation id and read the instance through ` +
    `'GET /workflows/<name>/instances/{id}', or host this context on a node / dotnet / java / ` +
    `python backend.`,
  "loom.elixir-bound-mutating-call-unsupported": (p: {
    where: unknown;
    name: unknown;
    call: unknown;
    deployable: unknown;
  }) =>
    `${p.where} binds the result of the mutating call '${p.call}(…)' to '${p.name}', which ` +
    `the elixir deployable '${p.deployable}' cannot render yet: a Phoenix context operation ` +
    `persists inside its own function, and the bound form is not wired through it. Host the ` +
    `context on a node, dotnet, java or python deployable.`,
} satisfies Record<string, MessageEntry>;
