import {
  type StreamTenantMetadataField,
  streamTenancyFor,
} from "../../ir/enrich/stream-tenancy.js";
import { pagedReturn } from "../../ir/stdlib/generics.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EventIR,
  FindIR,
  RepositoryIR,
} from "../../ir/types/loom-ir.js";
import { aggregateUsesMoneyDeep, findUsesCurrentUser } from "../../ir/types/loom-ir.js";
import { valueObjectPool } from "../../ir/util/reachable-types.js";
import { lines } from "../../util/code-builder.js";
import { escapeTsIdent, lowerFirst } from "../../util/naming.js";
import { renderHonoStoreLogCall } from "../_obs/render-hono.js";
import { stampImportLine, stampInsertCall } from "./emit/audit-stamp.js";
import { eventLogRunMethods } from "./in-memory-run.js";
import {
  blobGetByIdLines,
  deserializeField,
  docFieldType,
  findPredicate,
  inMemoryPagedLocals,
  inMemoryPagedTailLines,
  PAGED_TAIL_PARAMS,
  pagedReturnType,
  serializeField,
  tsParamType,
} from "./repository-document-builder.js";
import {
  aggregateHasStreamScope,
  drizzleStreamScopeCall,
  drizzleStreamScopeRef,
} from "./repository-find-predicate.js";
import { collectEnums, collectValueObjects } from "./repository-imports-builder.js";
import { repoPortImportLine, repoPortName } from "./repository-port-builder.js";
import { aggHasFieldMask, toWireMaskedMethod, toWireMethod } from "./repository-wire-builder.js";
import { T, TT } from "./ts-symbols.js";

// ---------------------------------------------------------------------------
// Event-sourced (`persistedAs: eventLog`) repository for the Hono/Drizzle
// backend (appliers A2, fold-from-zero MVP).
//
// The aggregate's truth is its event stream — one append-only
// `<agg>_events` table keyed by `(stream_id, version)`.  There is no state
// table: state is reconstructed by folding the stream through the
// aggregate's appliers (`Agg._fromEvents(id, events)`).
//
//   - `findById` reads the stream in version order and folds it.
//   - `save` appends the aggregate's pending events (`pullEvents()`) with
//     gap-free versions continuing the stream, then dispatches them.
//   - `findAll` / repo finds load every stream, fold each, and filter
//     in-memory (MVP — no projection/read-model yet).
//
// Event payloads round-trip through the same field (de)serialisers the
// document repository uses; `toWire` is reused unchanged (it reads the
// rehydrated domain instance's getters, so the wire contract matches the
// state-based and document paths).
// ---------------------------------------------------------------------------

export function buildEventSourcedRepositoryFile(
  agg: EnrichedAggregateIR,
  repo: RepositoryIR | undefined,
  ctx: EnrichedBoundedContextIR,
  _emitTrace = false,
): string {
  const idVar = `${TT.Ids}.${agg.name}Id`;
  // The single per-context event log (event-log-architecture.md); this
  // aggregate's stream is the subset tagged `stream_type = "<Agg>"`.
  const table = `${lowerFirst(ctx.name)}Events`;
  const streamType = agg.name;
  // `toWireMasked(root, currentUser: User | null)` NAMES `User` — the mask is
  // a second reason this file needs the import, as on the relational builder.
  const repoUsesUser = (repo?.finds ?? []).some(findUsesCurrentUser) || aggHasFieldMask(agg);

  // Every event type that can appear in this aggregate's stream — the
  // events its appliers fold.  Looked up in the context for field types.
  const streamEvents: EventIR[] = (agg.appliers ?? [])
    .map((ap) => ctx.events.find((e) => e.name === ap.event))
    .filter((e): e is EventIR => e != null);

  // Stream tenancy (`stream-tenancy.ts`): a `tenantOwned` stream carries its
  // tenant as stored-event metadata.  Every load is scoped by the read-scope
  // fact's tenancy restrictions, lowered over the log's metadata columns.
  // Every load is scoped by the generated `<agg>StreamScope` helper
  // (`db/read-scopes.ts`), rendered from the fact's tenancy restrictions.
  const tenancy = streamTenancyFor(agg, ctx.aggregates);
  const scoped = aggregateHasStreamScope(agg, ctx);
  const streamScope = drizzleStreamScopeCall(agg, ctx);
  const metaOf = (row: string): string =>
    `{ ${(tenancy?.metadata ?? []).map((m) => `${m.field}: ${row}.${m.field}`).join(", ")} }`;
  const findMethods = (repo?.finds ?? []).map((find) =>
    eventSourcedFindMethod(
      agg,
      find,
      ctx,
      scoped ? drizzleStreamScopeCall(agg, ctx, find) : undefined,
    ),
  );
  const runMethods = eventLogRunMethods(agg, ctx);

  const bodyStr = lines(
    `export class ${agg.name}Repository implements ${repoPortName(agg.name)} {`,
    // Explicit field declarations + constructor assignments, not
    // parameter properties — see emit/value-objects.ts's renderValueObject.
    `  private readonly db: Db;`,
    `  private readonly events: DomainEventDispatcher;`,
    `  constructor(`,
    `    db: Db,`,
    `    events: DomainEventDispatcher,`,
    `  ) {`,
    `    this.db = db;`,
    `    this.events = events;`,
    `  }`,
    "",
    `  async findById(id: ${idVar}): Promise<${agg.name} | null> {`,
    `    const rows = await this.db`,
    `      .select()`,
    `      .from(schema.${table})`,
    `      .where(and(eq(schema.${table}.streamType, "${streamType}"), eq(schema.${table}.streamId, id as string)${scoped ? `, ${streamScope}` : ""}))`,
    `      .orderBy(schema.${table}.version);`,
    `    ${renderHonoStoreLogCall("aggregateLoaded", `aggregate: "${agg.name}", id: id as string, found: rows.length > 0`)}`,
    `    if (rows.length === 0) return null;`,
    ...(tenancy
      ? [
          `    const inst = ${agg.name}._fromEvents(`,
          `      id,`,
          `      rows.map((r) => rowToEvent({ type: r.type, data: r.data })),`,
          `    );`,
          `    inst._adoptStreamTenant(${metaOf("rows[0]")});`,
          `    return inst;`,
        ]
      : [
          `    return ${agg.name}._fromEvents(`,
          `      id,`,
          `      rows.map((r) => rowToEvent({ type: r.type, data: r.data })),`,
          `    );`,
        ]),
    `  }`,
    "",
    // Command load — carries the write-scope check when the write scope is
    // narrower than the read scope (F2-ADP-5); a bare load otherwise.
    ...blobGetByIdLines(agg, idVar),
    "",
    `  async findManyByIds(ids: ${idVar}[]): Promise<${agg.name}[]> {`,
    `    if (ids.length === 0) return [];`,
    `    const out: ${agg.name}[] = [];`,
    `    for (const id of ids) {`,
    `      const found = await this.findById(id);`,
    `      if (found) out.push(found);`,
    `    }`,
    `    return out;`,
    `  }`,
    "",
    `  async save(aggregate: ${agg.name}): Promise<void> {`,
    `    const pending = aggregate.pullEvents();`,
    `    if (pending.length > 0) {`,
    // Expected-version append (M-T6.98): continue from the version THIS handle
    // was folded to, not from a `max(version)` re-read here — a re-read lets a
    // handle loaded before another append commit a decision taken on its
    // stale fold.
    `      let version = aggregate._streamVersion;`,
    // A new stream is stamped with the principal's tenant (the capability's
    // `onCreate` stamp); every later append carries the loaded stream's tenant
    // forward — never the caller's.
    ...(tenancy
      ? [
          `      const meta = aggregate._streamVersion === 0`,
          `        ? ${stampInsertCall(agg, metaOf("aggregate"))}`,
          `        : ${metaOf("aggregate")};`,
          `      aggregate._adoptStreamTenant(meta);`,
        ]
      : []),
    `      const rows = pending.map((event) => ({`,
    `        streamType: "${streamType}",`,
    `        streamId: aggregate.id as string,`,
    `        version: ++version,`,
    `        type: event.type,`,
    `        data: eventToData(event),`,
    ...(tenancy ? [`        ...meta,`] : []),
    `      }));`,
    // The `(stream_id, version)` PK IS this stream's optimistic-concurrency
    // control: an append from a handle folded at a version some other append
    // has since moved past inserts a version that exists and loses with a
    // Postgres unique-violation (SQLSTATE 23505).  Map it to `ConcurrencyError` → 409 (the shared
    // `onError` arm), mirroring the `versioned` guarded write's stale-write
    // rejection.  The pg error's `.code` is read directly or off `.cause`:
    // drizzle wraps a failed query in a `DrizzleQueryError` whose `.cause` is
    // the driver error (the same two-place read the routes `onError` uses for
    // the `unique (...)` arm) — reading `.code` alone never matched, so a lost
    // append surfaced as a 500.
    `      try {`,
    `        await this.db.insert(schema.${table}).values(rows);`,
    `      } catch (err) {`,
    `        if (err && typeof err === "object" && ((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505") {`,
    `          throw new ConcurrencyError("${agg.name}", aggregate.id as string);`,
    `        }`,
    `        throw err;`,
    `      }`,
    `      aggregate._streamVersion = version;`,
    `    }`,
    `    ${renderHonoStoreLogCall("repositorySave", `aggregate: "${agg.name}", id: aggregate.id as string`)}`,
    ...(tenancy
      ? [
          // The events' origin is their STREAM's tenant (`eventTenantMetadataFor`):
          // the outbox capture and the CloudEvents envelope (`tenantid` /
          // `loomorgpath`) read the ambient origin, so when the raising
          // principal's tenant is not the stream's (a `policy`-widened subtree
          // append) the dispatch runs in the stream tenant's frame.  The common
          // case — same tenant — keeps the request's own frame.
          `    const dispatchAll = async (): Promise<void> => {`,
          `      for (const event of pending) {`,
          `        ${renderHonoStoreLogCall("eventDispatched", `event_type: event.type, aggregate: "${agg.name}", id: aggregate.id as string`)}`,
          `        await this.events.dispatch(event);`,
          `      }`,
          `    };`,
          `    const origin = ${T.currentEventOrigin}();`,
          `    if ((origin?.tenant ?? null) === aggregate.tenantId) {`,
          `      await dispatchAll();`,
          `    } else {`,
          `      await ${T.runAsEventOrigin}({ tenant: aggregate.tenantId, orgPath: aggregate.dataKey, causedBy: origin?.causedBy ?? null }, dispatchAll);`,
          `    }`,
        ]
      : [
          `    for (const event of pending) {`,
          `      ${renderHonoStoreLogCall("eventDispatched", `event_type: event.type, aggregate: "${agg.name}", id: aggregate.id as string`)}`,
          `      await this.events.dispatch(event);`,
          `    }`,
        ]),
    `  }`,
    "",
    ...(tenancy
      ? [
          // A find whose `ignoring` drops the tenancy restriction passes its
          // own scope — `null` when it drops all of it (an explicit
          // `undefined` would re-trigger the default).
          `  private async _loadAll(${scoped ? `scope: ReturnType<typeof ${drizzleStreamScopeRef(agg)}> | null = ${streamScope} ?? null` : ""}): Promise<${agg.name}[]> {`,
          `    const rows = await this.db`,
          `      .select()`,
          `      .from(schema.${table})`,
          `      .where(and(eq(schema.${table}.streamType, "${streamType}")${scoped ? ", scope ?? undefined" : ""}))`,
          `      .orderBy(schema.${table}.streamId, schema.${table}.version);`,
          `    const byStream = new Map<string, { meta: ${tenantMetaType(tenancy.metadata)}; events: Events.DomainEvent[] }>();`,
          `    for (const r of rows) {`,
          `      const stream = byStream.get(r.streamId) ?? { meta: ${metaOf("r")}, events: [] };`,
          `      stream.events.push(rowToEvent({ type: r.type, data: r.data }));`,
          `      byStream.set(r.streamId, stream);`,
          `    }`,
          `    return [...byStream.entries()].map(([id, stream]) => {`,
          `      const inst = ${agg.name}._fromEvents(${idVar}(id), stream.events);`,
          `      inst._adoptStreamTenant(stream.meta);`,
          `      return inst;`,
          `    });`,
          `  }`,
        ]
      : [
          `  private async _loadAll(): Promise<${agg.name}[]> {`,
          `    const rows = await this.db`,
          `      .select()`,
          `      .from(schema.${table})`,
          `      .where(eq(schema.${table}.streamType, "${streamType}"))`,
          `      .orderBy(schema.${table}.streamId, schema.${table}.version);`,
          `    const byStream = new Map<string, Events.DomainEvent[]>();`,
          `    for (const r of rows) {`,
          `      const list = byStream.get(r.streamId) ?? [];`,
          `      list.push(rowToEvent({ type: r.type, data: r.data }));`,
          `      byStream.set(r.streamId, list);`,
          `    }`,
          `    return [...byStream.entries()].map(([id, evs]) => ${agg.name}._fromEvents(${idVar}(id), evs));`,
          `  }`,
        ]),
    "",
    ...findMethods.flatMap((m) => [m, ""]),
    ...runMethods.flatMap((m) => [m, ""]),
    toWireMethod(agg, ctx),
    "",
    // `mask unless` response redaction — the routes call
    // `repo.toWireMasked(row, __maskUser)` for every masked aggregate,
    // event-sourced ones included: the mask applies to the FOLDED state's wire
    // projection, not to the stream (pairwise F2).
    ...(aggHasFieldMask(agg) ? [toWireMaskedMethod(agg), ""] : []),
    `}`,
    "",
    // Stream (de)serialisers — module-level switch over the event types
    // this aggregate folds.  `eventToData` strips the `type` tag and
    // serialises domain values to JSON; `rowToEvent` rebuilds the tagged,
    // domain-typed event the appliers consume.
    eventToDataFn(streamEvents, ctx),
    "",
    rowToEventFn(streamEvents, ctx),
  );

  // Import narrowing — mirror buildRepositoryFile / the document builder so
  // the header stays free of dead names (generated-code Biome gate).
  const bodyScan = bodyStr
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
  // The stream (de)serialisers spell the event fields' types too, so those
  // types count as references alongside the aggregate's own fields.
  const eventFieldTypes = streamEvents.flatMap((e) => e.fields.map((f) => f.type));
  const voOrEnumImports = [
    ...collectValueObjects(agg, ctx, eventFieldTypes),
    ...collectEnums(agg, ctx, eventFieldTypes),
  ];
  const isValueUsed = (n: string): boolean =>
    new RegExp(`new\\s+${n}\\(|\\b${n}\\.\\w`).test(bodyScan);
  const voOrEnumReferenced = voOrEnumImports.filter((n) => new RegExp(`\\b${n}\\b`).test(bodyScan));
  let voOrEnumImportLine: string | false = false;
  if (voOrEnumReferenced.length > 0) {
    const anyValue = voOrEnumReferenced.some(isValueUsed);
    voOrEnumImportLine = anyValue
      ? `import { ${voOrEnumReferenced.map((n) => (isValueUsed(n) ? n : `type ${n}`)).join(", ")} } from "../../domain/value-objects";`
      : `import type { ${voOrEnumReferenced.join(", ")} } from "../../domain/value-objects";`;
  }
  const domainImports = [agg.name].join(", ");

  return lines(
    "// Auto-generated.  Do not edit by hand.",
    aggregateUsesMoneyDeep(agg, valueObjectPool(ctx)) && `import Decimal from "decimal.js";`,
    // Domain-side repository PORT this concrete implements (audit S7).
    repoPortImportLine(agg.name),
    `import type { NodePgDatabase } from "drizzle-orm/node-postgres";`,
    `import { and, eq } from "drizzle-orm";`,
    tenancy && stampImportLine(agg, { update: false }),
    `import * as schema from "../schema";`,
    repoUsesUser && `import type { User } from "../../auth/user-types";`,
    `import { ${domainImports} } from "../../domain/${lowerFirst(agg.name)}";`,
    voOrEnumImportLine,
    `import * as Ids from "../../domain/ids";`,
    `import type * as Events from "../../domain/events";`,
    // A principal-referencing WRITE scope binds the ambient accessor in the
    // `getById` command load — key the import off the emitted body (F2-ADP-5).
    authImportLine(bodyScan),
    `import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";`,
    `import type { DomainEventDispatcher } from "../../domain/events";`,
    `import { requestLog } from "../../obs/als";`,
    "",
    `type Db = NodePgDatabase<typeof schema>;`,
    "",
    bodyStr,
    "",
  );
}

/** The ambient principal accessor of a write scope / stream scope, imported
 *  when the emitted body calls it. */
function authImportLine(bodyScan: string): string | false {
  return (
    /\brequireCurrentUser\(/.test(bodyScan) &&
    `import { requireCurrentUser } from "../../auth/middleware";`
  );
}

// --- finds (in-memory over the folded streams) ----------------------------

function tenantMetaType(metadata: readonly StreamTenantMetadataField[]): string {
  return `{ ${metadata.map((m) => `${m.field}: string | null`).join("; ")} }`;
}

function eventSourcedFindMethod(
  agg: EnrichedAggregateIR,
  find: FindIR,
  ctx: EnrichedBoundedContextIR,
  /** The find's stream-scope call when the stream is scoped. */
  scope?: string,
): string {
  // The parameter default already is the unbypassed scope.
  const load = `await this._loadAll(${
    scope === undefined || scope === drizzleStreamScopeCall(agg, ctx)
      ? ""
      : scope === "undefined"
        ? "null"
        : scope
  })`;
  const usesUser = findUsesCurrentUser(find);
  const baseParams = find.params.map((p) => `${escapeTsIdent(p.name)}: ${tsParamType(p.type)}`);
  const params = (usesUser ? [...baseParams, "currentUser: User"] : baseParams).join(", ");
  const pred = findPredicate(agg, find, ctx);
  const isArray = find.returnType.kind === "array";
  const isOptional = find.returnType.kind === "optional";
  const ret = isArray ? `${agg.name}[]` : isOptional ? `${agg.name} | null` : agg.name;
  const selector = isArray
    ? pred
      ? `all.filter(${pred})`
      : `all`
    : isOptional
      ? `all.find(${pred ?? "() => true"}) ?? null`
      : `all.find(${pred ?? "() => true"})!`;
  const rowsExpr = isArray ? "result.length" : "result == null ? 0 : 1";
  // `find … paged` — the route is built for the paged contract, so the
  // repository has to answer it (F2-CB-C1).  No queryable columns on a stream,
  // so the page is taken in-memory over the folded list, exactly as the
  // document shape (and java's event store) does.
  if (pagedReturn(find.returnType)) {
    const pagedParams = [...baseParams, ...PAGED_TAIL_PARAMS];
    const pagedAll = (usesUser ? [...pagedParams, "currentUser: User"] : pagedParams).join(", ");
    const L = inMemoryPagedLocals(find.params);
    return lines(
      `  async ${find.name}(${pagedAll}): Promise<${pagedReturnType(agg.name)}> {`,
      `    const all = ${load};`,
      `    const ${L.matched} = ${pred ? `all.filter(${pred})` : "all"};`,
      ...inMemoryPagedTailLines(agg, L, find.name),
      `  }`,
    );
  }
  return lines(
    `  async ${find.name}(${params}): Promise<${ret}> {`,
    `    const all = ${load};`,
    `    const result = ${selector};`,
    `    ${renderHonoStoreLogCall("findExecuted", `aggregate: "${agg.name}", find: "${find.name}", rows: ${rowsExpr}`)}`,
    `    return result;`,
    `  }`,
  );
}

// --- stream (de)serialisers -----------------------------------------------

export function eventToDataFn(events: EventIR[], ctx: EnrichedBoundedContextIR): string {
  const arms = events.flatMap((e) => {
    const entries = e.fields.map(
      (f) => `${f.name}: ${serializeField(f.type, `ev.${f.name}`, ctx)}`,
    );
    return [`    case ${JSON.stringify(e.name)}:`, `      return { ${entries.join(", ")} };`];
  });
  return lines(
    `function eventToData(ev: Events.DomainEvent): Record<string, unknown> {`,
    `  switch (ev.type) {`,
    ...arms,
    `    default:`,
    `      return {};`,
    `  }`,
    `}`,
  );
}

export function rowToEventFn(events: EventIR[], ctx: EnrichedBoundedContextIR): string {
  const arms = events.flatMap((e) => {
    const entries = [
      `type: ${JSON.stringify(e.name)}`,
      ...e.fields.map((f) => `${f.name}: ${deserializeField(f.type, `d.${f.name}`, ctx)}`),
    ];
    const dType = e.fields.map((f) => `${f.name}: ${docFieldType(f.type, ctx)}`).join("; ");
    return [
      `    case ${JSON.stringify(e.name)}: {`,
      `      const d = data as { ${dType} };`,
      `      return { ${entries.join(", ")} } as Events.${e.name};`,
      `    }`,
    ];
  });
  return lines(
    `function rowToEvent(row: { type: string; data: unknown }): Events.DomainEvent {`,
    `  const data = row.data;`,
    `  switch (row.type) {`,
    ...arms,
    `    default:`,
    `      throw new Error(\`unknown event type: \${row.type}\`);`,
    `  }`,
    `}`,
  );
}
