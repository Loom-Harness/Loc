// The `projection` family of the diagnostic-message catalog: projections, query handlers and paged reads.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["projection", "query", "read", "paged", "envelope"] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.paged-param-reserved#find": (p: {
    name: unknown;
    findName: unknown;
    param: unknown;
    key: unknown;
    reserved: unknown;
  }) =>
    `repository '${p.name}' paged find '${p.findName}': parameter '${p.param}' collides with the ` +
    `paging query parameter '${p.key}' every paged read adds (${p.reserved}) — the request would carry ` +
    `two values for one query key, and every generated repository / controller signature a duplicate ` +
    `parameter.  Rename the parameter (e.g. '${p.param}Filter').`,
  "loom.paged-param-reserved#criterion": (p: {
    name: unknown;
    findName: unknown;
    param: unknown;
    key: unknown;
    reserved: unknown;
  }) =>
    `criterion '${p.name}' parameter '${p.param}' becomes a parameter of the paged read ` +
    `'${p.findName}' a paged queryHandler runs it through, where it collides with the paging query ` +
    `parameter '${p.key}' (${p.reserved}) — a duplicate parameter in every generated repository ` +
    `signature.  Rename the criterion parameter (e.g. '${p.param}Filter').`,
  "loom.paged-param-reserved#query-handler": (p: {
    name: unknown;
    param: unknown;
    key: unknown;
    reserved: unknown;
  }) =>
    `queryHandler '${p.name}' returns a \`paged\` result, and its parameter '${p.param}' collides with ` +
    `the paging query parameter '${p.key}' every paged read adds (${p.reserved}) — the request would ` +
    `carry two values for one query key, and the generated handler / route signature a duplicate ` +
    `parameter.  Rename the parameter (e.g. '${p.param}Filter').`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/api-checks.ts
  // ----------------------------------------------------------------------
  "loom.envelope-removed":
    "`T envelope` is removed: it meant exactly `T` (a single value), so the carrier added nothing. " +
    "Write `T` instead — the quick fix drops the `envelope`.",
  "loom.query-handler-saves": (p: { name: unknown; qName: unknown }) =>
    `context '${p.name}': queryHandler '${p.qName}' mutates state (a save, op-call, emit, ` +
    `create, or assignment). A queryHandler must be read-only — use a commandHandler or a ` +
    `workflow for anything that writes.`,
  "loom.read-context-repo-write": (p: {
    name: unknown;
    label: unknown;
    method: unknown;
    context: unknown;
    handler: unknown;
  }) =>
    `api '${p.name}': route '${p.label}' is a read (${p.method}) but targets ` +
    `commandHandler '${p.context}.${p.handler}', which writes. A read ` +
    `position (an api read route, a queryHandler, or a 'reading' service) may not reach the ` +
    `mutating repository face — bind the read to a queryHandler.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/projection-checks.ts
  // ----------------------------------------------------------------------
  "loom.projection-workflow-source-not-observable": (p: { name: unknown; wfName: unknown }) =>
    `projection '${p.name}': workflow '${p.wfName}' has no observable instance state ` +
    "(it needs a single id-shaped correlation/state field), so it can't be a projection source.",
  "loom.projection-workflow-source-eventsourced-invalid": (p: { name: unknown; wfName: unknown }) =>
    `projection '${p.name}': workflow '${p.wfName}' is event-sourced, whose instances are a ` +
    "per-request fold of its event stream (no state table). A projection over an event-sourced " +
    "workflow source is not emitted yet — source it from a state-backed (non-event-sourced) " +
    "workflow, or fold the events into a keyed 'projection' instead.",
  "loom.projection-workflow-source-join-invalid": (p: { name: unknown }) =>
    `projection '${p.name}': a 'join' follow over a workflow source is not supported ` +
    "(by-id joins resolve an aggregate's identity, not a workflow instance). Read the " +
    "workflow's instance fields directly in 'select', or source the projection from an aggregate.",
  "loom.projection-workflow-source-ignoring-no-effect": (p: { name: unknown }) =>
    `projection '${p.name}': an 'ignoring' capability-filter bypass over a workflow source ` +
    "has no effect — a workflow instance read carries no capability query-filters. Remove the " +
    "'ignoring' clause.",
  "loom.projection-source-self": (p: { name: unknown }) =>
    `projection '${p.name}': a projection cannot source itself ('from ${p.name}').`,
  "loom.projection-source-not-materialized": (p: { name: unknown; srcName: unknown }) =>
    `projection '${p.name}': source projection '${p.srcName}' is query-time (a live read with ` +
    "no persisted read-model table), so there is nothing to read `from`. Source it from a folded " +
    "('on(e) { … }') projection, or from the underlying aggregate directly.",
  "loom.projection-source-join-invalid": (p: { name: unknown }) =>
    `projection '${p.name}': a 'join' follow over a projection source is not supported ` +
    "(by-id joins resolve an aggregate's identity, not a read-model row). Read the source row's " +
    "fields directly in 'select', or source the projection from an aggregate.",
  "loom.projection-source-ignoring-no-effect": (p: { name: unknown }) =>
    `projection '${p.name}': an 'ignoring' capability-filter bypass over a projection source ` +
    "has no effect — a read-model row read carries no capability query-filters. Remove the " +
    "'ignoring' clause.",
  "loom.projection-query-and-fold-invalid": (p: { name: unknown; source: unknown }) =>
    `projection '${p.name}' declares both a 'from ${p.source}' query source ` +
    `and 'on(e)' event folds. A query source and event folds together ` +
    `(seed-then-update) is a reserved combination — use EITHER a query-time ` +
    `projection ('from … select …') OR a folded one ('on(e) { … }'), not both.`,
  "loom.projection-shorthand-nonaggregate": (p: {
    name: unknown;
    source: unknown;
    sourceKind: unknown;
  }) =>
    `projection '${p.name}': the shorthand (select-less) form is supported for an ` +
    `AGGREGATE source only; source '${p.source}' is a ${p.sourceKind}. Add an explicit ` +
    `'select' (its rows are already served directly by the ${p.sourceKind}'s own read).`,
  "loom.projection-fields-without-select": (p: { name: unknown; source: unknown }) =>
    `projection '${p.name}' declares row fields but no 'select' to fill them, so every ` +
    `row would be empty. Add a 'select <field> = <expr>, …', or drop the fields for the ` +
    `shorthand form (the row then mirrors the '${p.source}' source's wire shape).`,
  "loom.projection-groupby-missing": (p: {
    name: unknown;
    aggregating: unknown;
    perRow: unknown;
    perRow2: unknown;
    perRow3: unknown;
  }) =>
    `projection '${p.name}' mixes aggregation ` +
    `(${p.aggregating}) with per-row select(s) ` +
    `(${p.perRow}). That is a GROUP BY — one row per distinct ` +
    `${p.perRow2} — so declare the grouping: add ` +
    `'group by ${p.perRow3}' before the ` +
    `'select'. Or aggregate ALL fields (a single-row total), or select all ` +
    `of them per-row.`,
  "loom.projection-aggregate-arg-not-columnar": (p: {
    name: unknown;
    field: unknown;
    op: unknown;
    source: unknown;
  }) =>
    `projection '${p.name}': 'select ${p.field} = ${p.op}(…)' aggregates a ` +
    `computed expression. An aggregation argument must be a plain column of the ` +
    `'${p.source}' source, written '<alias>.<field>' (e.g. '${p.op}(o.total)') — ` +
    `SQL aggregates a column, not a per-row computation.`,
  "loom.projection-aggregate-type-mismatch": (p: {
    name: unknown;
    field: unknown;
    op: unknown;
    declared: unknown;
    result: unknown;
    hint: unknown;
  }) =>
    `projection '${p.name}': field '${p.field}' is declared '${p.declared}' but ` +
    `'${p.op}(…)' produces '${p.result}'. The DECLARED type is what the response ` +
    `schema and every backend's numeric coercion are built from, so the mismatch ` +
    `would silently re-code the value. Declare '${p.field}: ${p.result}'${p.hint}.`,
  "loom.projection-select-duration": (p: { name: unknown; field: unknown }) =>
    `projection '${p.name}' select '${p.field}' is a 'duration' (a 'datetime - datetime' ` +
    `span), and a duration is expression-only: it has no column and no wire form on any ` +
    `backend.  Select the two datetimes instead and compute the span where it is read.`,
  "loom.projection-aggregate-arity#count": (p: { name: unknown; field: unknown }) =>
    `projection '${p.name}': 'select ${p.field} = count(…)' passes a column to 'count', which ` +
    `takes none — 'count()' counts the rows (per group under 'group by'), never the values of ` +
    `a column. To count only the rows where a condition holds, narrow them with the ` +
    `projection's 'where' (in a projection of its own), or keep an int 0/1 column and 'sum' it.`,
  "loom.projection-aggregate-arity#column": (p: {
    name: unknown;
    field: unknown;
    op: unknown;
    argCount: unknown;
  }) =>
    `projection '${p.name}': 'select ${p.field} = ${p.op}(…)' passes ${p.argCount} argument(s), ` +
    `but '${p.op}' aggregates exactly one source column — write '${p.op}(<alias>.<field>)'.`,
  "loom.projection-select-unresolved": (p: {
    name: unknown;
    field: unknown;
    unresolved: unknown;
    source: unknown;
    hint: unknown;
  }) =>
    `projection '${p.name}': 'select ${p.field} = …' references '${p.unresolved}', which ` +
    `resolves to nothing — not a field of the '${p.source}' source, not a 'join' alias, ` +
    `not a parameter${p.hint}. It would be emitted as an undeclared identifier.`,
  "loom.projection-where-not-queryable": (p: { name: unknown; offending: unknown }) =>
    `projection '${p.name}': where-clause is not queryable (${p.offending}). ` +
    `Allowed: comparisons, &&/||/!, parens, '<alias>.<column>' / '<alias>.<vo>.<sub>' refs, ` +
    `parameter refs, literals — the 'where' is pushed down to SQL, so it carries the same ` +
    `subset a repository 'find … where' does.`,
  "loom.projection-groupby-source-invalid": (p: { name: unknown; why: unknown }) =>
    `projection '${p.name}' declares 'group by', but ${p.why}. A grouped ` +
    `projection reads (and groups) an AGGREGATE source's table in SQL — ` +
    `add 'from <Aggregate>'.`,
  "loom.projection-groupby-keyed-invalid": (p: { name: unknown; correlationField: unknown }) =>
    `projection '${p.name}' declares both 'keyed by ${p.correlationField}' and ` +
    `'group by'. A grouped projection's rows ARE the groups (one per distinct ` +
    `key combination), not id-keyed entities — drop the 'keyed by'.`,
  "loom.projection-groupby-join-invalid": (p: { name: unknown }) =>
    `projection '${p.name}': 'join' and 'group by' don't compose — a join is a ` +
    `by-id bulk load AFTER the query, so its columns can't participate in the SQL ` +
    `GROUP BY. Group by source columns only, or drop the 'group by'.`,
  "loom.projection-groupby-no-aggregate": (p: { name: unknown }) =>
    `projection '${p.name}' declares 'group by' but no aggregate 'select' ` +
    `(count/sum/avg/min/max) to compute per group — that is just DISTINCT. Add an ` +
    `aggregate select (e.g. 'orders = count()'), or drop the 'group by' for the ` +
    `per-row read.`,
  "loom.projection-groupby-key-not-columnar": (p: { name: unknown; source: unknown }) =>
    `projection '${p.name}': a 'group by' column must be a plain field of the ` +
    `'${p.source}' source (e.g. '<alias>.<field>'), optionally bucketed by a ` +
    `supported grouping transform ('<alias>.<datetime field>.startOfDay()'), so it ` +
    `can be grouped in SQL — other computed grouping keys are not supported yet.`,
  "loom.projection-groupby-select-not-grouped": (p: { name: unknown; field: unknown }) =>
    `projection '${p.name}': 'select ${p.field} = …' is per-row but not one of the ` +
    `'group by' columns, so it has no single value per group. Select a grouping ` +
    `column directly, aggregate it (sum/min/max/…), or add it to the 'group by'.`,
  // The direct-table arms (`select … = count()/sum(…)`, `group by`) push the
  // aggregation into SQL, so they name COLUMNS on the source aggregate's own
  // table.  A source that has no such columns — an event-sourced stream, a
  // `shape: document` jsonb blob, a TPC abstract base with no table of its own
  // — produced code that did not compile on EVERY backend, silently.  Not an
  // adapter boundary: the way out is the shape of the read, not the deployable.
  "loom.projection-columnless-source": (p: { name: unknown; ctxName: unknown; reason: unknown }) =>
    `Query-time projection '${p.ctxName}.${p.name}' ${p.reason}. The aggregating read is ` +
    `computed IN SQL — that is the point of the shape — so it can only name real columns. ` +
    `Drop the aggregation for the per-row read (which hydrates each row through the ` +
    `aggregate's repository), fold the number into a materialized projection ('on(e: …)'), ` +
    `or source the aggregation from a relationally-stored aggregate.`,
  // A direct-table aggregation over a `shape: document` source whose capability
  // filters (tenancy scope, soft-delete, any `filter` capability) would have to
  // be applied.  Those predicates name COLUMNS — `tenant_id`, `is_deleted` — and
  // a document table is `(id, data, version)`, so four backends emit a reference
  // that does not exist and the fifth, EF Core, emits NO PREDICATE AT ALL: a
  // document aggregate gets no `HasQueryFilter` (its filters run in-app inside
  // `_CapabilityVisible`), so the aggregation compiles clean and counts every
  // tenant's rows.  A silent cross-tenant read is why this is refused rather
  // than left to the per-backend compile.
  "loom.projection-document-source-capability-filtered": (p: {
    name: unknown;
    ctxName: unknown;
    source: unknown;
    caps: unknown;
  }) =>
    `Query-time projection '${p.ctxName}.${p.name}' aggregates IN SQL over 'shape: document' ` +
    `aggregate '${p.source}', which is read-filtered by ${p.caps}. A document table is ` +
    `'(id, data, version)', so those filter predicates have no column to name: four backends ` +
    `emit a reference that does not exist, and EF Core silently emits no filter at all — the ` +
    `aggregate would count rows every other read of '${p.source}' excludes. Drop the ` +
    `aggregation for the per-row read (the repository applies the filters when it hydrates ` +
    `each row), fold the number into a materialized projection ('on(e: …)'), store ` +
    `'${p.source}' relationally, or waive the filters explicitly with 'ignoring'.`,
  "loom.projection-key-unknown": (p: {
    name: unknown;
    correlationField: unknown;
    suggestion?: unknown;
  }) =>
    `projection '${p.name}' is keyed by '${p.correlationField}', ` +
    `which is not a declared state field.${didYouMean(p.suggestion)}  Declare it as an id-shaped field, ` +
    `e.g. '${p.correlationField}: <Aggregate> id'.`,
  "loom.projection-key-not-id": (p: { name: unknown; correlationField: unknown }) =>
    `projection '${p.name}' is keyed by '${p.correlationField}', ` +
    `which is not id-shaped.  A projection's routing key must be an 'id' field ` +
    `(the row's primary key), e.g. '${p.correlationField}: <Aggregate> id'.`,
  "loom.projection-duplicate-on": (p: { name: unknown; param: unknown; event: unknown }) =>
    `projection '${p.name}' declares more than one 'on(${p.param}: ${p.event})' handler. ` +
    `Fold each event type in a single handler.`,
  "loom.projection-event-unkeyed#no-key-field": (p: {
    name: unknown;
    event: unknown;
    correlationField: unknown;
    param: unknown;
  }) =>
    `projection '${p.name}' folds '${p.event}', but that event has no ` +
    `'${p.correlationField}' field to route by.  Add the field to the event, ` +
    `or supply an explicit 'by <expr>' that extracts the key from '${p.param}'.`,
  // The SINGLETON case — the projection declares no `keyed by` at all, so
  // `correlationField` is absent.  The variant above used to be rendered here
  // too, interpolating the missing field as the literal text `undefined`
  // ("has no 'undefined' field to route by") and asking for a field no one can
  // name (audit finding F30).  A keyless fold has no key by construction; the
  // fix is the `keyed by` clause, not a field on the event.
  "loom.projection-event-unkeyed#singleton": (p: { name: unknown; event: unknown }) =>
    `projection '${p.name}' folds '${p.event}' but declares no 'keyed by' — a fold ` +
    `writes one row per key, and there is no key to route to.  Add 'keyed by ` +
    `<id field>', or drop the 'on(...)' handlers and make it a query-time ` +
    `projection (a 'from'/'where'/'select' comprehension), which is what a keyless ` +
    `projection means.`,
  "loom.projection-key-assign": (p: {
    name: unknown;
    param: unknown;
    event: unknown;
    key: unknown;
  }) =>
    `projection '${p.name}' fold 'on(${p.param}: ${p.event})' assigns its key field ` +
    `'${p.key}'.  The key is immutable: the row is created with the key the fold ` +
    `routes by (\`e.${p.key}\`, or the handler's \`by <expr>\`), so the assignment is ` +
    `redundant at best and would move the row at worst.  Remove it; route by ` +
    `\`by <expr>\` if the event names the key differently.`,
  "loom.projection-fold-impure": (p: {
    name: unknown;
    param: unknown;
    event: unknown;
    impurity: unknown;
  }) =>
    `projection '${p.name}' fold 'on(${p.param}: ${p.event})' ${p.impurity}. ` +
    `A projection fold must be a pure, replayable function of the event — ` +
    `assignments and 'let' only.  To read a repository or emit, use a reactor ` +
    `('on(e: Event)' in a workflow) instead.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/query-checks.ts
  // ----------------------------------------------------------------------
  "loom.projection-gate-not-current-user": (p: { name: unknown; offending: unknown }) =>
    `projection '${p.name}': a \`requires\` gate runs before the query (no row exists ` +
    `yet), so it may only reference \`currentUser\` (and constants) — \`${p.offending}\` is not ` +
    "available here. Use `where` to scope which rows return; use `requires` to allow / deny " +
    "the caller.",

  // ----------------------------------------------------------------------
  // src/generator/flutter/riverpod-emit.ts
  //
  // Phase ⑧ give-ups, not phase ④/⑦ checks: they are worded here (and route
  // through `giveUp`, so they carry the shared degradation sentinel) because
  // the emitter is the only layer that knows a Riverpod Notifier method cannot
  // express the statement.  Before this they were bare `TODO(flutter
  // full-parity)` comments with no code and no sentinel.
  // ----------------------------------------------------------------------
  "loom.paged-query-handler-shape": (p: { name: unknown; hint: unknown }) =>
    `queryHandler '${p.name}' returns a \`paged\` envelope, but its body is not the supported paged shape \`let r = Repo.all(<Criterion | Retrieval>(args)); return r\`, so no backend can generate it. ${p.hint}`,
  "loom.paged-query-handler-shape#sorted-retrieval-shape": (p: {
    name: unknown;
    retrieval: unknown;
    aggName: unknown;
  }) =>
    `queryHandler '${p.name}' pages retrieval '${p.retrieval}', whose \`sort:\` is the page's default order — but '${p.aggName}' is not a single-table relational aggregate, and its paged read is taken in memory without that order. Drop the retrieval's \`sort:\` (the client orders through the route's \`sort\`/\`dir\`), or page a criterion instead.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.projection-cross-context-source-unsupported": (p: {
    name: unknown;
    ctxName: unknown;
    source: unknown;
    homeName: unknown;
    platform: unknown;
  }) =>
    `Query-time projection '${p.ctxName}.${p.name}' reads '${p.source}' row by row from ` +
    `context '${p.homeName}', but '${p.platform}' synthesises a per-row projection's source ` +
    `read only on a repository in the projection's own context. Declare the projection in ` +
    `'${p.homeName}', or aggregate it ('select n = count()', 'group by'), which reads the ` +
    `table directly.`,

  // --------------------------------------------------------------------
  // The BODY-WALKER GIVE-UP codes (M-T9.55).
  //
  // These four name the conditions under which the frontend body walker
  // declines to render a construct.  They are unusual in this catalog:
  // today they are attached at the EMISSION site (`giveUp()` in
  // `src/generator/_walker/give-up.ts` renders the code into the
  // `loom:unrendered [<code>] …` comment) rather than raised as a
  // diagnostic, because codegen has no diagnostic channel.  The wording
  // still lives here, for the one reason the catalog exists: the text a
  // user reads about a `loom.*` code must have exactly one home, whichever
  // phase puts it in front of them.  When `generate system` grows a
  // give-up-reporting pass these become ordinary reported diagnostics with
  // no change to the emitters.
  // --------------------------------------------------------------------
  "loom.paged-envelope-unknown-member": (p: { member: unknown; known: unknown }) =>
    `A page body reads '.${p.member}' off a 'QueryView { paged: true }' binding.  That binding ` +
    `is the paged ENVELOPE, not a row and not a collection, and it carries only ${p.known} — ` +
    `every frontend would print '.${p.member}' verbatim against an object that has no such ` +
    `member.  Read the rows through '.items' (e.g. 'rows.items.count') or one of the page fields.`,

  // ----------------------------------------------------------------------
  // src/generator/_expr/target.ts — QueryEmissionRefusal (§F2, Wave 2
  // packet 2.4).  A construct outside a query-language renderer's declared
  // vocabulary (see QUERY_EMISSION_VOCABULARY) reached codegen — a validator
  // gap or a compiler bug, never a user mistake (the IR validator's
  // `firstNonQueryableNode`, or a backend-specific queryable gate, is what
  // keeps an ordinary `.ddd` program off this path).
  // ----------------------------------------------------------------------
  "loom.query-emission-invalid": (p: { mode: unknown; what: unknown }) =>
    `${p.mode}: ${p.what} is outside the declared query-emission vocabulary — ` +
    `the IR validator should have rejected this filter before codegen reached it.`,
} satisfies Record<string, MessageEntry>;
