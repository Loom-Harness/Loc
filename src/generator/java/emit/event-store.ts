import { streamTenancyFor } from "../../../ir/enrich/stream-tenancy.js";
import { foldedEventNames } from "../../../ir/plan/index.js";
import type { EnrichedAggregateIR, ExprIR, RepositoryIR } from "../../../ir/types/loom-ir.js";
import type { AggPool } from "../../../ir/util/inheritance.js";
import { lines } from "../../../util/code-builder.js";
import { desugarAuthzFilterInApp } from "../../_expr/authz-filter-inapp.js";
import { javaRef } from "../../_imports/java.js";
import { javaLogEvent } from "../../_obs/render-java.js";
import type { FilterBypass } from "../capability-filter.js";
import { javaJsonSqlType } from "../codec-spelling.js";
import { javaLocals, localOf } from "../java-ident.js";
import { J } from "../java-symbols.js";
import { javaValueTypeForId, renderJavaExpr, renderJavaType } from "../render-expr.js";
import { javaNotFoundThrow } from "./common.js";
import type { JavaRepoCtx } from "./repository.js";
import {
  declaredFinds,
  IN_MEMORY_READ_NAMES,
  inMemoryPagedSortLines,
  inMemoryParamExpr,
  inMemoryRetrievalLines,
  isPagedFind,
  unionFindAsOptionalTwin,
} from "./repository.js";
import { esEventLogTable } from "./workflow-eventsourced.js";
import { javaBlobWriteGuardLines, writeScopeUsesPrincipal } from "./write-scope.js";

// ---------------------------------------------------------------------------
// Event-sourced persistence (`persistedAs: eventLog`, appliers A2) — the
// java counterpart of the Hono / .NET event store.  No state table and
// no Spring Data interface: the repository impl reads/appends the single
// per-context `<ctx>_events` log (stream_type, stream_id, version, type,
// data jsonb, occurred_at — emitted by the shared MigrationsIR) through
// JdbcTemplate — every read/append filters + stamps `stream_type = "<Agg>"`
// so two aggregates sharing the log each fold only their own events —
// folds streams via the entity's `_fromEvents` (appliers),
// and serialises events with Jackson (records round-trip natively; the
// same mapper writes and reads, so the storage dialect is consistent).
// Finds fold every stream and filter in memory (the .NET `_LoadAllAsync`
// shape) — the event log is the source of truth, not a query target.
//
// A `tenantOwned` stream (`stream-tenancy.ts`) carries its tenant as stored-event
// metadata (`tenant_id`): a new stream is stamped from the principal,
// the fold adopts it, and every read applies the fact's tenancy restrictions
// IN-APP over the folded aggregate (the document shape's rule) — the by-id load
// answers empty (404) for a foreign tenant's stream, lists never include it, and
// a command load rides the by-id load.
// ---------------------------------------------------------------------------

export function renderJavaEventSourcedRepositoryImpl(
  agg: EnrichedAggregateIR,
  repo: RepositoryIR | undefined,
  ctx: JavaRepoCtx,
  idClass: string,
  schema: string | undefined,
  contextName: string,
  /** The context's aggregates — the pool the stream-tenancy fact resolves in. */
  pool: AggPool,
): string {
  // The single per-context event log (event-log-architecture.md): this
  // aggregate's stream is the subset tagged `stream_type = "<Agg>"`, so every
  // read/append filters + stamps `stream_type` to fold only its own events.
  const table = esEventLogTable(contextName, schema);
  const streamType = agg.name;
  const idJava = javaValueTypeForId();
  const parseId =
    idJava === "UUID"
      ? `${J.UUID}.fromString(sid)`
      : idJava === "int"
        ? "Integer.parseInt(sid)"
        : idJava === "long"
          ? "Long.parseLong(sid)"
          : "sid";
  // The event types this stream can contain — the events the appliers fold.
  const eventNames = foldedEventNames(agg);
  const finds = declaredFinds(repo).map((f) => unionFindAsOptionalTwin(f, agg.name));

  // --- stream tenancy (stream-tenancy.ts) ------------------------------------
  const tenancy = streamTenancyFor(agg, pool);
  const renderPred = (p: ExprIR, varName: string): string =>
    `(${renderJavaExpr(desugarAuthzFilterInApp(p, agg.name), { thisName: varName, agg, accessorProps: true })})`;
  /** The in-app tenancy predicate of a read with `bypass`, over `varName`;
   *  fail-closed on a null principal.  Null when the read is unscoped. */
  const scopeBody = (bypass: FilterBypass | undefined, varName: string): string | null => {
    if (!tenancy) return null;
    const kept = streamTenancyFor(agg, pool, { ignoring: bypass })?.restrictions ?? [];
    if (kept.length === 0) return null;
    return `currentUser != null && ${kept.map((r) => renderPred(r.predicate!, varName)).join(" && ")}`;
  };
  const scopeClause = (bypass: FilterBypass | undefined, varName: string): string => {
    const body = scopeBody(bypass, varName);
    return body ? `.filter(${varName} -> ${body})` : "";
  };
  const scopePrelude = (bypass: FilterBypass | undefined): string[] =>
    scopeBody(bypass, "x") ? [`        var currentUser = currentUserAccessor.user();`] : [];
  /** What a declared find / retrieval streams off: the unscoped fold under
   *  tenancy (each read conjoins the restrictions it does not bypass). */
  const baseCall = tenancy ? "loadAll()" : "findAll()";
  const metaCols = tenancy ? tenancy.metadata.map((m) => m.column) : [];

  const paged = javaRef(`${ctx.basePkg}.domain.common`, "Paged");
  const accessorType = javaRef(`${ctx.basePkg}.auth`, "CurrentUserAccessor");

  // find_executed (debug) per declared find — `rows` is an integer count
  // (paged → total, list → size, single → 0/1).  Mirrors the relational repo +
  // .NET/Hono event-store emission.
  const findExecutedLog = (name: string, rowsExpr: string): string =>
    `        CatalogLog.event(${javaLogEvent("findExecuted")}, "aggregate", "${agg.name}", "find", "${name}", "rows", ${rowsExpr});`;
  const findLines = finds.flatMap((f) => {
    // Keyword-escaped (`jid`), and moved off the `x` predicate lambda / the
    // method's own locals on a collision.
    const locals = javaLocals(
      f.params.map((p) => p.name),
      IN_MEMORY_READ_NAMES,
    );
    const params = f.params.map((p) => `${renderJavaType(p.type)} ${localOf(locals, p.name)}`);
    // A clause-less find still filters — by its implicit key match.
    const own = f.filter;
    const bypass: FilterBypass = { bypassAll: f.bypassAll, bypassCaps: f.bypassCaps };
    const filter =
      (own
        ? `.filter(x -> ${renderJavaExpr(own, { thisName: "x", agg, accessorProps: true, ...inMemoryParamExpr(locals) })})`
        : "") + scopeClause(bypass, "x");
    const prelude = scopePrelude(bypass);
    if (isPagedFind(f)) {
      const sig = [...params, "int page", "int pageSize", "String sort", "String dir"].join(", ");
      return [
        `    @Override`,
        `    public ${paged}<${agg.name}> ${f.name}(${sig}) {`,
        ...prelude,
        `        var all = ${baseCall}.stream()${filter}.toList();`,
        ...inMemoryPagedSortLines(agg),
        `        var items = all.stream().sorted(__cmp).skip((long) (page - 1) * pageSize).limit(pageSize).toList();`,
        findExecutedLog(f.name, "all.size()"),
        `        return new Paged<>(items, page, pageSize, all.size(), (all.size() + pageSize - 1) / pageSize);`,
        `    }`,
        ``,
      ];
    }
    if (f.returnType.kind !== "array") {
      return [
        `    @Override`,
        `    public ${agg.name} ${f.name}(${params.join(", ")}) {`,
        ...prelude,
        `        var result = ${baseCall}.stream()${filter}.findFirst().orElse(null);`,
        findExecutedLog(f.name, "result == null ? 0 : 1"),
        `        return result;`,
        `    }`,
        ``,
      ];
    }
    return [
      `    @Override`,
      `    public List<${agg.name}> ${f.name}(${params.join(", ")}) {`,
      ...prelude,
      `        var result = ${baseCall}.stream()${filter}.toList();`,
      findExecutedLog(f.name, "result.size()"),
      `        return result;`,
      `    }`,
      ``,
    ];
  });
  // Retrievals can't query the event log, so each `run<Name>` folds every
  // stream via findAll() then evaluates its `where` + `sort` in memory
  // (the .NET `_LoadAllAsync` shape).
  const retrievalLines = inMemoryRetrievalLines(
    agg,
    ctx.retrievals ?? [],
    tenancy
      ? (retrievalName, varName) => scopeClause(ctx.bypassByRetrieval?.get(retrievalName), varName)
      : undefined,
    baseCall,
    tenancy
      ? (retrievalName) => scopePrelude(ctx.bypassByRetrieval?.get(retrievalName))
      : undefined,
  );

  // aggregate_loaded (debug) — shared by the plain and the write-scoped command
  // load so the two emissions stay one log line, not two spellings.
  const aggregateLoadedLog = `        CatalogLog.event(${javaLogEvent("aggregateLoaded")}, "aggregate", "${agg.name}", "id", String.valueOf(id.value()), "found", found.isPresent());`;
  const writeGuardLines = javaBlobWriteGuardLines(agg, idClass, aggregateLoadedLog);
  const needsAccessor =
    writeScopeUsesPrincipal(agg) || (tenancy !== undefined && scopeBody(undefined, "x") !== null);

  const methodLines = [...findLines, ...retrievalLines];
  while (methodLines.length > 0 && methodLines[methodLines.length - 1] === "") methodLines.pop();

  return lines(
    `package ${ctx.infraPkg};`,
    ``,
    `import java.util.ArrayList;`,
    `import java.util.LinkedHashMap;`,
    `import java.util.List;`,
    `import java.util.Optional;`,
    ``,
    `import tools.jackson.databind.ObjectMapper;`,
    `import tools.jackson.databind.json.JsonMapper;`,
    `import org.springframework.jdbc.core.JdbcTemplate;`,
    `import org.springframework.stereotype.Repository;`,
    ``,
    `import ${ctx.basePkg}.domain.common.AggregateNotFoundException;`,
    // DomainEvent rides the events wildcard (it lives in domain.events).
    `import ${ctx.basePkg}.domain.events.*;`,
    `import ${ctx.basePkg}.domain.ids.*;`,
    // The enums wildcard, matching the RELATIONAL impl (repository.ts:305) and
    // the document twin.  A declared find's params render through
    // `renderJavaType`, which spells an enum param as the bare enum name, so
    // this file had the same "cannot find symbol" hole the document store did.
    `import ${ctx.basePkg}.domain.enums.*;`,
    `import ${ctx.basePkg}.config.CatalogLog;`,
    ``,
    `/** Event-sourced repository — appends to ${table}, folds on load`,
    ` *  via ${agg.name}._fromEvents (the appliers). */`,
    `@Repository`,
    `public class ${agg.name}RepositoryImpl implements ${javaRef(ctx.domainPkg, `${agg.name}Repository`)} {`,
    `    private static final ObjectMapper JSON = JsonMapper.builder().findAndAddModules().build();`,
    ``,
    `    private final JdbcTemplate jdbc;`,
    // The in-app write-scope guard reads the request principal, so the
    // impl injects the same CurrentUserAccessor bean the relational path uses.
    // Only wired when the write scope references it — otherwise no field, no
    // ctor param, no import (byte-identical emission).
    needsAccessor ? `    private final ${accessorType} currentUserAccessor;` : null,
    ``,
    needsAccessor
      ? `    public ${agg.name}RepositoryImpl(JdbcTemplate jdbc, ${accessorType} currentUserAccessor) {`
      : `    public ${agg.name}RepositoryImpl(JdbcTemplate jdbc) {`,
    `        this.jdbc = jdbc;`,
    needsAccessor ? `        this.currentUserAccessor = currentUserAccessor;` : null,
    `    }`,
    ``,
    `    @Override`,
    `    public ${javaRef(ctx.entityPkg, agg.name)} save(${agg.name} aggregate) {`,
    // Appending must not drain: the service publishes the same events afterwards and owns the `event_dispatched` line.
    `        var pending = aggregate._unappendedEvents();`,
    `        if (!pending.isEmpty()) {`,
    `            var sid = String.valueOf(aggregate.id().value());`,
    // Expected-version append (M-T6.98): continue from the version THIS handle
    // was folded to, not from a `max(version)` re-read here — a re-read lets a
    // handle loaded before another append keep a decision taken on its stale
    // fold.
    `            int version = aggregate._streamVersion();`,
    // A NEW stream is stamped from the principal (the capability's `onCreate`
    // stamp); every later append carries the loaded stream's tenant forward.
    tenancy ? `            if (version == 0) {` : null,
    tenancy ? `                aggregate._stampOnCreate();` : null,
    tenancy ? `            }` : null,
    `            for (var ev : pending) {`,
    `                version++;`,
    `                try {`,
    `                    jdbc.update(`,
    `                        "insert into ${table} (stream_type, stream_id, version, type, data${metaCols.map((c) => `, ${c}`).join("")}) values (?, ?, ?, ?, ?::${javaJsonSqlType()}${metaCols.map(() => ", ?").join("")})",`,
    `                        "${streamType}", sid, version, ev.getClass().getSimpleName(), JSON.writeValueAsString(ev)${(tenancy?.metadata ?? []).map((m) => `, aggregate.${m.field}()`).join("")});`,
    // The (stream_id, version) PK IS the event stream's optimistic-concurrency
    // control: a stale handle's append re-inserts a version that exists and
    // loses with a Postgres 23505, which JdbcTemplate maps to
    // DuplicateKeyException.  Rethrow the SAME exception the `versioned` service
    // raises so the ApiExceptionAdvice 409 arm maps it to Conflict.
    `                } catch (org.springframework.dao.DuplicateKeyException e) {`,
    `                    throw new org.springframework.orm.ObjectOptimisticLockingFailureException(`,
    `                        ${agg.name}.class, aggregate.id().value());`,
    `                } catch (tools.jackson.core.JacksonException e) {`,
    `                    throw new IllegalStateException("event serialization failed", e);`,
    `                }`,
    `            }`,
    `            aggregate._streamVersion(version);`,
    `            aggregate._markAppended();`,
    `        }`,
    // repository_save (debug) — after the stream append; (aggregate, id) prefix
    // mirrors the relational repo + .NET/Hono emission (children omitted).
    `        CatalogLog.event(${javaLogEvent("repositorySave")}, "aggregate", "${agg.name}", "id", String.valueOf(aggregate.id().value()));`,
    `        return aggregate;`,
    `    }`,
    ``,
    `    @Override`,
    `    public Optional<${agg.name}> findById(${idClass} id) {`,
    ...(tenancy
      ? [
          // A foreign tenant's stream reads as empty (404): no existence leak.
          // `getById` (the command / append load) rides this.
          `        var rows = jdbc.queryForList(`,
          `            "select type, data${metaCols.map((c) => `, ${c}`).join("")} from ${table} where stream_type = ? and stream_id = ? order by version", "${streamType}", String.valueOf(id.value()));`,
          `        if (rows.isEmpty()) {`,
          `            return Optional.empty();`,
          `        }`,
          `        var events = new ArrayList<DomainEvent>();`,
          `        for (var row : rows) {`,
          `            events.add(rowToEvent((String) row.get("type"), String.valueOf(row.get("data"))));`,
          `        }`,
          `        var inst = ${agg.name}._fromEvents(id, events);`,
          `        inst._adoptStreamTenant(${(tenancy.metadata ?? []).map((m) => `(String) rows.get(0).get("${m.column}")`).join(", ")});`,
          ...scopePrelude(undefined),
          `        return Optional.of(inst)${scopeClause(undefined, "x")};`,
        ]
      : [
          `        var events = loadStream(String.valueOf(id.value()));`,
          `        return events.isEmpty() ? Optional.empty() : Optional.of(${agg.name}._fromEvents(id, events));`,
        ]),
    `    }`,
    ``,
    // `getById` IS the command load on java (the read route calls `findById`;
    // every mutation calls this), so the write-scope guard lives here.  An
    // event stream has no queryable state columns for a `findByIdForWrite`
    // @Query, so the scope is checked IN-APP over the FOLDED aggregate.  Without
    // a write scope the load stays byte-identical.
    ...(writeGuardLines ?? [
      `    @Override`,
      `    public ${agg.name} getById(${idClass} id) {`,
      `        var found = findById(id);`,
      // aggregate_loaded (debug) — `found` is a bool so a downstream filter can
      // grep failed loads by (event="aggregate_loaded", found=false).
      aggregateLoadedLog,
      `        return found.orElseThrow(() ->`,
      `            ${javaNotFoundThrow(agg.name)});`,
      `    }`,
    ]),
    ``,
    ...(tenancy
      ? [
          `    @Override`,
          `    public List<${agg.name}> findAll() {`,
          ...(scopeBody(undefined, "x")
            ? [
                ...scopePrelude(undefined),
                `        return loadAll().stream()${scopeClause(undefined, "x")}.toList();`,
              ]
            : [`        return loadAll();`]),
          `    }`,
          ``,
          `    /** Every stream, folded and unscoped — the base each tenant-scoped read narrows. */`,
          `    private List<${agg.name}> loadAll() {`,
        ]
      : [`    @Override`, `    public List<${agg.name}> findAll() {`]),
    `        var rows = jdbc.queryForList(`,
    `            "select stream_id, type, data${metaCols.map((c) => `, ${c}`).join("")} from ${table} where stream_type = ? order by stream_id, version", "${streamType}");`,
    ...(tenancy
      ? [
          `        var byStream = new LinkedHashMap<String, List<DomainEvent>>();`,
          `        var meta = new LinkedHashMap<String, ${J.Map}<String, Object>>();`,
          `        for (var row : rows) {`,
          `            var sid = (String) row.get("stream_id");`,
          `            meta.putIfAbsent(sid, row);`,
          `            byStream.computeIfAbsent(sid, k -> new ArrayList<>())`,
          `                .add(rowToEvent((String) row.get("type"), String.valueOf(row.get("data"))));`,
          `        }`,
          `        var out = new ArrayList<${agg.name}>();`,
          `        for (var entry : byStream.entrySet()) {`,
          `            var sid = entry.getKey();`,
          `            var inst = ${agg.name}._fromEvents(new ${idClass}(${parseId}), entry.getValue());`,
          `            inst._adoptStreamTenant(${(tenancy.metadata ?? []).map((m) => `(String) meta.get(sid).get("${m.column}")`).join(", ")});`,
          `            out.add(inst);`,
          `        }`,
          `        return out;`,
        ]
      : [
          `        var byStream = new LinkedHashMap<String, List<DomainEvent>>();`,
          `        for (var row : rows) {`,
          `            byStream.computeIfAbsent((String) row.get("stream_id"), k -> new ArrayList<>())`,
          `                .add(rowToEvent((String) row.get("type"), String.valueOf(row.get("data"))));`,
          `        }`,
          `        var out = new ArrayList<${agg.name}>();`,
          `        for (var entry : byStream.entrySet()) {`,
          `            var sid = entry.getKey();`,
          `            out.add(${agg.name}._fromEvents(new ${idClass}(${parseId}), entry.getValue()));`,
          `        }`,
          `        return out;`,
        ]),
    `    }`,
    ``,
    `    @Override`,
    `    public void delete(${agg.name} aggregate) {`,
    `        jdbc.update("delete from ${table} where stream_type = ? and stream_id = ?", "${streamType}", String.valueOf(aggregate.id().value()));`,
    `    }`,
    ``,
    ...(tenancy
      ? []
      : [
          `    private List<DomainEvent> loadStream(String sid) {`,
          `        var rows = jdbc.queryForList(`,
          `            "select type, data from ${table} where stream_type = ? and stream_id = ? order by version", "${streamType}", sid);`,
          `        var out = new ArrayList<DomainEvent>();`,
          `        for (var row : rows) {`,
          `            out.add(rowToEvent((String) row.get("type"), String.valueOf(row.get("data"))));`,
          `        }`,
          `        return out;`,
          `    }`,
          ``,
        ]),
    `    private static DomainEvent rowToEvent(String type, String data) {`,
    `        try {`,
    `            return switch (type) {`,
    ...eventNames.map((e) => `                case "${e}" -> JSON.readValue(data, ${e}.class);`),
    `                default -> throw new IllegalStateException("unknown event type: " + type);`,
    `            };`,
    `        } catch (tools.jackson.core.JacksonException e) {`,
    `            throw new IllegalStateException("event deserialization failed", e);`,
    `        }`,
    `    }`,
    methodLines.length > 0 ? `` : null,
    ...methodLines,
    `}`,
    ``,
  );
}
