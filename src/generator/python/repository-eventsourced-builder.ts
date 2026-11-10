import { streamTenancyFor } from "../../ir/enrich/stream-tenancy.js";
import { wireFieldsForAggregate } from "../../ir/enrich/wire-projection.js";
import { pagedReturn } from "../../ir/stdlib/generics.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EventIR,
  FindIR,
  RepositoryIR,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../ir/types/loom-ir.js";
import { enumPool, findValueObjectInScope } from "../../ir/util/reachable-types.js";
import { aggregateIsVersioned } from "../../ir/util/versioned-capability.js";
import { lines } from "../../util/code-builder.js";
import { pythonIdent, snake } from "../../util/naming.js";
import { refuseOutOfVocabulary } from "../_expr/target.js";
import { PY_IMPORTS, pyRef } from "../_imports/python.js";
import { numericEncode } from "../_numeric/target.js";
import { pyCalendarDateWire } from "./codec-spelling.js";
import { PY_CALENDAR_DATE } from "./emit/calendar-date.js";
import { lowerRestrictionToSqlAlchemy } from "./find-predicate.js";
import { PY_NUMERIC, pyEventSourcedDecimalDecode } from "./numeric-codec.js";
import { contextEventRowClassName } from "./py-columns.js";
import { PY, pyIdType, pyVoOrEnum } from "./py-symbols.js";
import { renderPyExpr } from "./render-expr.js";
import {
  aggHasFieldMask,
  aggRef,
  aggregateRetrievals,
  allFindOf,
  emittableFinds,
  findExecutedLine,
  PY_PAGED_FIND_PARAMS,
  pyInMemoryPagedFind,
  pyInMemoryRunMethod,
  R,
  schemaRow,
  toWireMaskedMethod,
  writeGuardInApp,
} from "./repository-builder.js";
import { pyConflictRaise, pyNotFoundRaise } from "./wire-policy-py.js";

const sa = (name: string): string => pyRef("sqlalchemy", name);
const COLLECTION = pyRef("collections.abc", "Collection");
const authUser = (name: string): string => pyRef("app.auth.user", name);

/** `from app.domain.events import <Event>` — an event dataclass. */
const eventRef = (name: string): string => pyRef("app.domain.events", name);

// ---------------------------------------------------------------------------
// Event-sourced repository — `persistedAs: eventLog` aggregates persist
// to an append-only `<agg>_events` stream keyed by (stream_id, version);
// there is no state table (fold-from-zero MVP, parity with Hono/.NET):
//
//   - find_by_id reads the stream in version order, maps rows to event
//     dataclasses, folds via `<Agg>._from_events`.
//   - save appends the pulled events with gap-free versions continuing
//     the stream, dispatching each.
//   - all() scans (stream_id, version)-ordered and folds per stream.
//   - finds filter the folded aggregates in memory (no state columns
//     to query — the documented eventLog trade).
// ---------------------------------------------------------------------------

export function buildPyEventSourcedRepositoryFile(
  agg: EnrichedAggregateIR,
  repo: RepositoryIR | undefined,
  ctx: EnrichedBoundedContextIR,
): string {
  // The single per-context event log (event-log-architecture.md); this
  // aggregate's stream is the subset tagged `stream_type = "<Agg>"`, so every
  // read filters on it and every append stamps it — two aggregates sharing one
  // table must each fold only their own events.
  const row = schemaRow(contextEventRowClassName(ctx.name));
  const events = (agg.appliers ?? [])
    .map((ap) => ctx.events.find((ev) => ev.name === ap.event))
    .filter((ev): ev is EventIR => ev != null);

  // Stream tenancy (`stream-tenancy.ts`): a `tenantOwned` stream carries its
  // tenant as stored-event metadata.  Every load applies the read-scope fact's
  // tenancy restrictions over the log's metadata columns (`_stream_scope`),
  // and adopts the stream's tenant onto the folded instance.
  const tenancy = streamTenancyFor(agg, ctx.aggregates);
  const scoped = (tenancy?.restrictions.length ?? 0) > 0;
  const adopt = (r: string): string =>
    `inst._adopt_stream_tenant(${(tenancy?.metadata ?? []).map((m) => `${r}.${m.column}`).join(", ")})`;
  const loadAll = (bypass?: IgnoringClause): string => `self._load_all(${ignoringSet(bypass)})`;

  const allFilter = allFindOf(repo)?.filter;
  const allCond = allFilter ? renderPyExpr(allFilter, { thisName: "a" }) : null;
  const allUsesPrincipal = exprUsesCurrentUser(allFilter);

  const body = lines(
    `class ${agg.name}Repository:`,
    `    def __init__(self, session: ${R.AsyncSession}, events: ${R.DomainEventDispatcher}) -> None:`,
    "        self._session = session",
    "        self._events = events",
    "",
    `    async def find_by_id(self, id: ${pyIdType(agg.name)}) -> ${aggRef(agg)} | None:`,
    "        rows = (",
    "            await self._session.execute(",
    `                ${R.select}(${row})
                .where(${row}.stream_type == "${agg.name}", ${row}.stream_id == id${scoped ? ", *_stream_scope()" : ""})
                .order_by(${row}.version)`,
    "            )",
    "        ).scalars().all()",
    "        if not rows:",
    "            return None",
    ...(tenancy
      ? [
          `        inst = ${agg.name}._from_events(id, [self._row_to_event(row) for row in rows])`,
          `        ${adopt("rows[0]")}`,
          "        return inst",
        ]
      : [`        return ${agg.name}._from_events(id, [self._row_to_event(row) for row in rows])`]),
    "",
    `    async def get_by_id(self, id: ${pyIdType(agg.name)}) -> ${aggRef(agg)}:`,
    "        found = await self.find_by_id(id)",
    `        ${PY.log}("debug", "aggregate_loaded", aggregate=${JSON.stringify(agg.name)}, id=str(id), found=found is not None)`,
    "        if found is None:",
    `            ${pyNotFoundRaise(R.AggregateNotFoundError, agg.name, "id")}`,
    "        return found",
    // Command load (authorization): an event stream has no
    // queryable state columns, so the write-scope guard is checked IN-APP over
    // the FOLDED aggregate.
    ...writeGuardInApp(agg),
    "",
    // A DECLARED `find all(): X[] where <pred>` keeps its predicate (B-A1 —
    // the event-sourced half of eval item 2).  A stream has no queryable
    // state columns, so the predicate runs in-app over the folded aggregates;
    // the unfiltered fold moves to `_all_unfiltered()`, which the declared
    // finds read so they are not narrowed by `all`'s own `where`.
    ...(allCond == null
      ? []
      : [
          `    async def all(self) -> list[${aggRef(agg)}]:`,
          ...(allUsesPrincipal ? [`        current_user = ${R.require_current_user}()`] : []),
          `        return [a for a in await self._all_unfiltered() if ${allCond}]`,
          "",
        ]),
    ...(tenancy
      ? [
          `    async def ${allCond == null ? "all" : "_all_unfiltered"}(self) -> list[${aggRef(agg)}]:`,
          `        return await ${loadAll(allFindOf(repo))}`,
          "",
          // The one stream scan: scoped by the tenancy restrictions (minus
          // what the read's `ignoring` drops), each folded stream adopting the
          // tenant its stored events carry.
          `    async def _load_all(self, ignoring: ${COLLECTION}[str] = frozenset()) -> list[${aggRef(agg)}]:`,
          "        rows = (",
          "            await self._session.execute(",
          `                ${R.select}(${row})
                .where(${row}.stream_type == "${agg.name}"${scoped ? ", *_stream_scope(ignoring)" : ""})
                .order_by(${row}.stream_id, ${row}.version)`,
          "            )",
          "        ).scalars().all()",
          `        by_stream: dict[str, list[${R.DomainEvent}]] = {}`,
          `        first_row: dict[str, ${row}] = {}`,
          "        for row_ in rows:",
          "            by_stream.setdefault(str(row_.stream_id), []).append(self._row_to_event(row_))",
          "            first_row.setdefault(str(row_.stream_id), row_)",
          `        out: list[${aggRef(agg)}] = []`,
          "        for sid, evs in by_stream.items():",
          `            inst = ${agg.name}._from_events(${pyIdType(agg.name)}(sid), evs)`,
          `            ${adopt("first_row[sid]")}`,
          "            out.append(inst)",
          "        return out",
        ]
      : [
          `    async def ${allCond == null ? "all" : "_all_unfiltered"}(self) -> list[${aggRef(agg)}]:`,
          "        rows = (",
          "            await self._session.execute(",
          `                ${R.select}(${row})
                .where(${row}.stream_type == "${agg.name}")
                .order_by(${row}.stream_id, ${row}.version)`,
          "            )",
          "        ).scalars().all()",
          `        by_stream: dict[str, list[${R.DomainEvent}]] = {}`,
          "        for row_ in rows:",
          "            by_stream.setdefault(str(row_.stream_id), []).append(self._row_to_event(row_))",
          "        return [",
          `            ${agg.name}._from_events(${pyIdType(agg.name)}(sid), evs) for sid, evs in by_stream.items()`,
          "        ]",
        ]),
    ...emittableFinds(repo).flatMap((f) => [
      "",
      inMemoryFind(
        agg,
        f,
        tenancy ? loadAll(f) : allCond == null ? "self.all()" : "self._all_unfiltered()",
      ),
    ]),
    // Criterion reads call `run_<retrieval>` whatever the saving shape.  A
    // stream has no state columns, so the runner filters the folded aggregates
    // in-app — over the same unfiltered fold the declared finds read.
    ...aggregateRetrievals(agg, ctx).flatMap((r) => [
      "",
      pyInMemoryRunMethod(agg, r, {
        loadLines: [
          `        items = await ${allCond == null ? "self.all()" : "self._all_unfiltered()"}`,
        ],
      }),
    ]),
    "",
    // `expected_version` (pairwise F8): the routes emit
    // `repo.save(found, expected_version=_expected)` for EVERY `versioned`
    // aggregate (`versionedSave`, routes-builder.ts) regardless of saving shape,
    // and this signature did not accept it — mypy `call-arg`.
    //
    // The guard is NOT the relational/document one.  Those default the
    // expectation to `aggregate.version`; an event-sourced aggregate cannot,
    // because `_from_events` folds the stream with `_version = 0` and never
    // increments it, so `.version` is ALWAYS 0 here.  The version an
    // event-sourced handle was loaded at is `_stream_version` (M-T6.98), and
    // the append continues from it: an explicit expectation (the `If-Match`
    // echo) is compared against it, and a stream some other append has moved
    // past rejects the first re-used version on the (stream_id, version) PK.
    aggregateIsVersioned(agg)
      ? `    async def save(self, aggregate: ${aggRef(agg)}, expected_version: int | None = None) -> None:`
      : `    async def save(self, aggregate: ${aggRef(agg)}) -> None:`,
    "        pending = aggregate.pull_events()",
    "        if pending:",
    // Expected-version append (M-T6.98): continue from the version THIS handle
    // was folded to, not from a `max(version)` re-read here — a re-read lets a
    // handle loaded before another append commit a decision taken on its
    // stale fold.
    "            version = aggregate._stream_version",
    // A new stream is stamped with the principal's tenant (the capability's
    // `onCreate` stamp, which refuses a principal with no tenant claim);
    // every later append carries the loaded stream's tenant forward — never
    // the caller's.
    ...(tenancy
      ? [
          "            if version == 0:",
          `                aggregate._stamp_on_create(${R.require_current_user}())`,
        ]
      : []),
    ...(aggregateIsVersioned(agg)
      ? [
          "            if expected_version is not None and version != expected_version:",
          `                ${pyConflictRaise(R.ConcurrencyError, agg.name, "aggregate.id")}`,
        ]
      : []),
    "            for ev in pending:",
    "                version += 1",
    // The (stream_id, version) PK IS the event stream's optimistic-concurrency
    // control: a stale handle's append re-inserts a version that exists and
    // loses with a Postgres unique_violation (SQLSTATE 23505).
    // Map it to ConcurrencyError → 409 (parity with the `versioned` guarded
    // write); asyncpg exposes `.sqlstate` on the `.orig` driver error.
    "                try:",
    "                    await self._session.execute(",
    `                        ${R.insert}(${row}).values(`,
    `                            stream_type="${agg.name}",`,
    "                            stream_id=aggregate.id,",
    "                            version=version,",
    "                            type=type(ev).type,",
    "                            data=self._event_to_data(ev),",
    `                            occurred_at=${PY.datetime}.now(${PY.UTC}),`,
    ...(tenancy?.metadata ?? []).map(
      (m) => `                            ${m.column}=aggregate.${m.column},`,
    ),
    "                        )",
    "                    )",
    `                except ${R.IntegrityError} as err:`,
    '                    if getattr(getattr(err, "orig", None), "sqlstate", None) == "23505":',
    `                        ${pyConflictRaise(R.ConcurrencyError, agg.name, "aggregate.id")} from err`,
    "                    raise",
    ...(tenancy
      ? [
          "                with self._origin_frame(aggregate):",
          "                    await self._events.dispatch(ev)",
        ]
      : ["                await self._events.dispatch(ev)"]),
    "            aggregate._stream_version = version",
    "        await self._session.flush()",
    `        ${PY.log}("debug", "repository_save", aggregate=${JSON.stringify(agg.name)}, id=str(aggregate.id))`,
    "",
    ...(tenancy ? [originFrameMethod(agg), ""] : []),
    rowToEvent(agg, events, row, ctx),
    "",
    eventToData(events, ctx),
    "",
    toWireStub(agg, ctx),
    // `mask unless` response redaction (pairwise F6 — the python half of F2).
    // Routes call `repo.to_wire_masked(x)` for every masked aggregate whatever
    // its saving shape; only the relational builder emitted it.  The shared
    // helper projects through `to_wire`, which `toWireStub` above emits, so an
    // event-sourced aggregate needs nothing shape-specific either.
    ...(aggHasFieldMask(agg) ? [toWireMaskedMethod(agg)] : []),
  );

  return lines(
    `"""${agg.name} event-store repository.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    "",
    "",
    ...(scoped ? [streamScopeFn(agg, ctx, row), "", ""] : []),
    body,
    "",
  );
}

/** The `ignoring` clause of a read, as the frozenset its stream load takes —
 *  "" when it drops nothing (the load's default applies every restriction). */
interface IgnoringClause {
  bypassAll?: boolean;
  bypassCaps?: readonly string[];
}
function ignoringSet(bypass: IgnoringClause | undefined): string {
  if (bypass?.bypassAll) return 'frozenset({"*"})';
  const caps = [...new Set(bypass?.bypassCaps ?? [])];
  return caps.length === 0 ? "" : `frozenset({${caps.map((c) => JSON.stringify(c)).join(", ")}})`;
}

/** `_stream_scope(ignoring)` — the tenancy restrictions of the aggregate's
 *  read-scope fact lowered over the event-log row's tenant metadata columns
 *  (the columns carry the `tenantOwned` field names, so the predicate is the
 *  one a `tenantOwned` table applies).  A read with no principal sees no
 *  stream, exactly like the read-scope hook of a relational aggregate. */
function streamScopeFn(
  agg: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
  row: string,
): string {
  const restrictions = streamTenancyFor(agg, ctx.aggregates)?.restrictions ?? [];
  const crit = `${sa("ColumnElement")}[bool]`;
  return lines(
    `def _stream_scope(ignoring: ${COLLECTION}[str] = frozenset()) -> list[${crit}]:`,
    `    """${agg.name}'s stream scope: its tenancy restrictions over the stream's tenant metadata."""`,
    `    user = ${authUser("current_user")}()`,
    `    out: list[${crit}] = []`,
    ...restrictions.flatMap((r) => {
      const lowered =
        lowerRestrictionToSqlAlchemy(r.predicate!, agg, ctx, row, "user") ??
        // Dropping this would ship an unscoped stream — a hard stop, not a fallback.
        refuseOutOfVocabulary("sqlalchemy-filter", `stream tenancy of '${agg.name}'`);
      const guard =
        r.bypassable && r.capability !== undefined
          ? `    if "*" not in ignoring and ${JSON.stringify(r.capability)} not in ignoring:`
          : undefined;
      const indent = guard ? "        " : "    ";
      return [
        ...(guard ? [guard] : []),
        `${indent}out.append(${sa("false")}() if user is None else ${lowered.expr})`,
      ];
    }),
    "    return out",
  );
}

/** `_origin_frame(aggregate)` — the events' origin is their STREAM's tenant
 *  (`eventTenantMetadataFor`): the outbox capture and the CloudEvents envelope
 *  (`tenantid`) read the ambient origin, so when the raising principal's
 *  tenant is not the stream's the dispatch runs in the stream tenant's frame.
 *  The common case — same tenant — keeps the request's own. */
function originFrameMethod(agg: EnrichedAggregateIR): string {
  return lines(
    `    def _origin_frame(self, aggregate: ${aggRef(agg)}) -> ${pyRef("contextlib", "AbstractContextManager")}[None]:`,
    `        origin = ${authUser("current_event_origin")}()`,
    '        if origin is not None and origin.get("tenant") == aggregate.tenant_id:',
    `            return ${pyRef("contextlib", "nullcontext")}()`,
    `        return ${authUser("event_origin_frame")}(`,
    "            {",
    '                "tenant": aggregate.tenant_id,',
    '                "causedBy": None if origin is None else origin.get("causedBy"),',
    "            }",
    "        )",
  );
}

function _idNamesOf(events: EventIR[]): string[] {
  const out = new Set<string>();
  for (const ev of events) {
    for (const f of ev.fields) {
      const t = f.type.kind === "optional" ? f.type.inner : f.type;
      if (t.kind === "id") out.add(`${t.targetName}Id`);
    }
  }
  return [...out];
}

/** In-memory find over the folded aggregates — eventLog has no state
 *  columns to query. */
function inMemoryFind(agg: EnrichedAggregateIR, find: FindIR, load = "self.all()"): string {
  const params = find.params.map((p) => `${pythonIdent(p.name)}: ${pyParam(p.type)}`);
  const sig = ["self", ...params].join(", ");
  const pred = find.filter ? renderPyExpr(find.filter, { thisName: "a" }) : "True";
  // `find … paged` over an event-log carrier — the four wire controls join the
  // signature and the body pages in memory (`pyInMemoryPagedFind`, F2-CB-C1).
  if (pagedReturn(find.returnType)) {
    return pyInMemoryPagedFind(agg, find, {
      sig: ["self", ...params, ...PY_PAGED_FIND_PARAMS].join(", "),
      loadLines: [`        items = await ${load}`],
      filteredExpr: `[a for a in items if ${pred}]`,
    });
  }
  if (find.returnType.kind === "array") {
    return lines(
      `    async def ${snake(find.name)}(${sig}) -> list[${aggRef(agg)}]:`,
      `        result = [a for a in await ${load} if ${pred}]`,
      findExecutedLine(agg, find.name, "len(result)"),
      "        return result",
    );
  }
  return lines(
    `    async def ${snake(find.name)}(${sig}) -> ${aggRef(agg)} | None:`,
    `        matches = [a for a in await ${load} if ${pred}]`,
    findExecutedLine(agg, find.name, "len(matches)"),
    "        return matches[0] if matches else None",
  );
}

function pyParam(t: TypeIR): string {
  switch (t.kind) {
    case "primitive":
      return t.name === "int" || t.name === "long"
        ? "int"
        : t.name === "bool"
          ? "bool"
          : t.name === "decimal"
            ? "float"
            : "str";
    case "id":
      return pyIdType(t.targetName);
    case "enum":
      return pyVoOrEnum(t.name);
    default:
      return "str";
  }
}

/** Stream row → event dataclass (wire keys are the DSL spellings). */
function rowToEvent(
  agg: EnrichedAggregateIR,
  events: EventIR[],
  row: string,
  ctx: EnrichedBoundedContextIR,
): string {
  const arms = events.flatMap((ev, i) => [
    `        ${i === 0 ? "if" : "elif"} row.type == "${ev.name}":`,
    `            return ${eventRef(ev.name)}(${ev.fields
      .map((f) => `${pythonIdent(f.name)}=${fromData(f.name, f.type, ctx)}`)
      .join(", ")})`,
  ]);
  return lines(
    `    def _row_to_event(self, row: ${row}) -> ${R.DomainEvent}:`,
    `        data = ${PY.cast}(dict[str, object], row.data)`,
    ...(arms.length > 0 ? arms : []),
    `        raise ValueError(f"unknown ${agg.name} event type: {row.type}")`,
  );
}

/** Decode the event field `name` from the JSONB payload `data`.  A stream
 *  written before the field existed has no such key: an optional field reads
 *  back `None`, a required one the type's zero value ({@link jsonZero}) — the
 *  same null-fill the other backends' replay gives, never a `KeyError`. */
export function fromData(name: string, t: TypeIR, ctx: EnrichedBoundedContextIR): string {
  if (t.kind === "optional") return decodeValue(`data.get("${name}")`, t, ctx);
  return decodeValue(`data.get("${name}", ${jsonZero(t, ctx)})`, t, ctx);
}

/** The JSON-shaped zero of `t` as a Python literal — the payload value
 *  {@link decodeValue} turns into the type's zero domain value. */
function jsonZero(t: TypeIR, ctx: EnrichedBoundedContextIR): string {
  switch (t.kind) {
    case "optional":
      return "None";
    case "primitive":
      switch (t.name) {
        case "int":
        case "long":
        case "decimal":
          return "0";
        case "money":
          return '"0"';
        case "bool":
          return "False";
        case "datetime":
          return '"1970-01-01T00:00:00+00:00"';
        case "date":
          return '"1970-01-01"';
        default:
          return '""';
      }
    case "array":
      return "[]";
    case "enum":
      return JSON.stringify(enumPool(ctx).find((e) => e.name === t.name)?.values[0] ?? "");
    case "valueobject": {
      const vo = findValueObjectInScope(ctx, t.name);
      if (!vo) return '""';
      return `{${vo.fields.map((vf) => `${JSON.stringify(vf.name)}: ${jsonZero(vf.type, ctx)}`).join(", ")}}`;
    }
    default:
      return '""';
  }
}

/** Decode the JSON value `access` to its domain type.  A value object is
 *  rebuilt through its constructor (which re-checks the invariant) from the
 *  nested `{"<field>": …}` map {@link encodeValue} wrote; an optional VO or a
 *  VO/other array decodes element-wise, `null` staying `None`. */
function decodeValue(access: string, t: TypeIR, ctx: EnrichedBoundedContextIR): string {
  const inner = t.kind === "optional" ? t.inner : t;
  // An optional scalar/id/enum stays `None` when the payload holds `null`;
  // the value-object and array arms below carry their own guard.
  if (t.kind === "optional" && inner.kind !== "valueobject" && inner.kind !== "array")
    return `(None if ${access} is None else ${decodeValue(access, inner, ctx)})`;
  switch (inner.kind) {
    case "primitive":
      switch (inner.name) {
        case "int":
          return numericEncode(PY_NUMERIC, "int", "repo-read", access);
        case "long":
          return numericEncode(PY_NUMERIC, "long", "repo-read", access);
        case "decimal":
          return pyEventSourcedDecimalDecode(access);
        case "money":
          return numericEncode(PY_NUMERIC, "money", "repo-read", access);
        case "bool":
          return `${PY.cast}(bool, ${access})`;
        case "datetime":
          return `${PY.datetime}.fromisoformat(${PY.cast}(str, ${access}))`;
        case "date":
          return `${PY_CALENDAR_DATE}.fromisoformat(${PY.cast}(str, ${access}))`;
        default:
          return `${PY.cast}(str, ${access})`;
      }
    case "id":
      return `${pyIdType(inner.targetName)}(${PY.cast}(str, ${access}))`;
    case "enum":
      return `${pyVoOrEnum(inner.name)}(${PY.cast}(str, ${access}))`;
    case "valueobject": {
      const vo = findValueObjectInScope(ctx, inner.name);
      if (!vo) return `${PY.cast}(str, ${access})`;
      const map = `${PY.cast}(dict[str, object], ${access})`;
      const args = vo.fields.map((vf) => decodeValue(`${map}["${vf.name}"]`, vf.type, ctx));
      const built = `${pyVoOrEnum(vo.name)}(${args.join(", ")})`;
      return t.kind === "optional" ? `(None if ${access} is None else ${built})` : built;
    }
    case "array": {
      const list = `${PY.cast}(list[object], ${access})`;
      const comp = `[${decodeValue("__e", inner.element, ctx)} for __e in ${list}]`;
      return t.kind === "optional" ? `(None if ${access} is None else ${comp})` : comp;
    }
    default:
      return `${PY.cast}(str, ${access})`;
  }
}

/** Event dataclass → the JSONB payload (DSL-keyed, JSON-safe values). */
function eventToData(events: EventIR[], ctx: EnrichedBoundedContextIR): string {
  const arms = events.flatMap((ev, i) => [
    `        ${i === 0 ? "if" : "elif"} isinstance(ev, ${eventRef(ev.name)}):`,
    `            return {${ev.fields.map((f) => `"${f.name}": ${toData(`ev.${pythonIdent(f.name)}`, f.type, ctx)}`).join(", ")}}`,
  ]);
  return lines(
    `    def _event_to_data(self, ev: ${R.DomainEvent}) -> dict[str, object]:`,
    ...(arms.length > 0 ? arms : []),
    `        raise ValueError(f"unknown event: {type(ev).__name__}")`,
  );
}

const ENCODED_SCALARS: ReadonlySet<string> = new Set(["datetime", "date", "money"]);

/** Encode the event field value `expr` to its JSON-safe payload form.  A value
 *  object becomes its nested `{"<field>": …}` map (the shape {@link decodeValue}
 *  reads back); an array encodes element-wise when its elements need it. */
export function toData(expr: string, t: TypeIR, ctx: EnrichedBoundedContextIR): string {
  const inner = t.kind === "optional" ? t.inner : t;
  const nullable = (v: string): string =>
    t.kind === "optional" ? `(None if ${expr} is None else ${v})` : v;
  // `.isoformat()` / `str()` on an unset optional would raise; guard it first.
  if (t.kind === "optional" && inner.kind === "primitive" && ENCODED_SCALARS.has(inner.name))
    return nullable(toData(expr, inner, ctx));
  if (inner.kind === "primitive" && (inner.name === "datetime" || inner.name === "date"))
    return `${expr}.isoformat()`;
  if (inner.kind === "primitive" && inner.name === "money") return `str(${expr})`;
  if (inner.kind === "valueobject") {
    const vo = findValueObjectInScope(ctx, inner.name);
    if (!vo) return expr;
    const fields = vo.fields.map(
      (vf) => `"${vf.name}": ${toData(`${expr}.${pythonIdent(vf.name)}`, vf.type, ctx)}`,
    );
    return nullable(`{${fields.join(", ")}}`);
  }
  if (inner.kind === "array") {
    const el = toData("__e", inner.element, ctx);
    return el === "__e" ? expr : nullable(`[${el} for __e in ${expr}]`);
  }
  return expr;
}

/** Wire projection over the FOLDED aggregate — same canonical shape the
 *  state-based repos project (the wire contract is persistence-
 *  agnostic), reusing the shared builder via a tiny local import would
 *  recreate a cycle, so the routes layer calls this method exactly like
 *  the state repos'. */
function toWireStub(agg: EnrichedAggregateIR, ctx: EnrichedBoundedContextIR): string {
  // The wire shape of an eventLog aggregate: id + properties + derived
  // (no containments — eventLog v1 gates parts off at the validator).
  const pairs: string[] = [`"id": root.id`];
  for (const wf of wireFieldsForAggregate(agg)) {
    if (wf.source === "id" || wf.source === "containment") continue;
    const access = `root.${pythonIdent(wf.name)}`;
    const inner = wf.type.kind === "optional" ? wf.type.inner : wf.type;
    if (inner.kind === "primitive" && inner.name === "datetime") {
      pairs.push(`"${wf.name}": ${R.iso}(${access})`);
      continue;
    }
    if (inner.kind === "primitive" && inner.name === "date") {
      pairs.push(`"${wf.name}": ${pyCalendarDateWire(access)}`);
      continue;
    }
    if (inner.kind === "primitive" && inner.name === "money") {
      // Precise-decimal string on the wire (parity with the other backends).
      pairs.push(`"${wf.name}": ${numericEncode(PY_NUMERIC, "money", "dto-map", access)}`);
      continue;
    }
    if (inner.kind === "valueobject") {
      const vo = findValueObjectInScope(ctx, inner.name);
      if (vo) {
        const fields = vo.fields
          .map((vf) => `"${vf.name}": ${access}.${pythonIdent(vf.name)}`)
          .join(", ");
        pairs.push(`"${wf.name}": {${fields}}`);
        continue;
      }
    }
    pairs.push(`"${wf.name}": ${access}`);
  }
  return lines(
    `    def to_wire(self, root: ${aggRef(agg)}) -> dict[str, object]:`,
    "        return {",
    pairs.map((p) => `            ${p},`),
    "        }",
  );
}
