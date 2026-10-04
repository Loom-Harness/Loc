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
import { aggregateIsVersioned } from "../../ir/util/versioned-capability.js";
import { lines } from "../../util/code-builder.js";
import { snake } from "../../util/naming.js";
import { PY_IMPORTS, pyRef } from "../_imports/python.js";
import { numericEncode } from "../_numeric/target.js";
import { PY_NUMERIC, pyEventSourcedDecimalDecode } from "./numeric-codec.js";
import { contextEventRowClassName } from "./py-columns.js";
import { PY, pyIdType, pyVoOrEnum } from "./py-symbols.js";
import { renderPyExpr } from "./render-expr.js";
import {
  aggHasFieldMask,
  aggRef,
  emittableFinds,
  findExecutedLine,
  PY_PAGED_FIND_PARAMS,
  pyInMemoryPagedFind,
  R,
  schemaRow,
  toWireMaskedMethod,
  writeGuardInApp,
} from "./repository-builder.js";

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
                .where(${row}.stream_type == "${agg.name}", ${row}.stream_id == id)
                .order_by(${row}.version)`,
    "            )",
    "        ).scalars().all()",
    "        if not rows:",
    "            return None",
    `        return ${agg.name}._from_events(id, [self._row_to_event(row) for row in rows])`,
    "",
    `    async def get_by_id(self, id: ${pyIdType(agg.name)}) -> ${aggRef(agg)}:`,
    "        found = await self.find_by_id(id)",
    `        ${PY.log}("debug", "aggregate_loaded", aggregate=${JSON.stringify(agg.name)}, id=str(id), found=found is not None)`,
    "        if found is None:",
    `            raise ${R.AggregateNotFoundError}(f"${agg.name} {id} not found")`,
    "        return found",
    // Command load (authorization): an event stream has no
    // queryable state columns, so the write-scope guard is checked IN-APP over
    // the FOLDED aggregate.
    ...writeGuardInApp(agg),
    "",
    `    async def all(self) -> list[${aggRef(agg)}]:`,
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
    ...emittableFinds(repo).flatMap((f) => ["", inMemoryFind(agg, f)]),
    "",
    // `expected_version` (pairwise F8): the routes emit
    // `repo.save(found, expected_version=_expected)` for EVERY `versioned`
    // aggregate (`versionedSave`, routes-builder.ts) regardless of saving shape,
    // and this signature did not accept it — mypy `call-arg`.
    //
    // The guard is NOT the relational/document one.  Those default the
    // expectation to `aggregate.version`; an event-sourced aggregate cannot,
    // because `_from_events` folds the stream with `_version = 0` and never
    // increments it, so `.version` is ALWAYS 0 here.  The authoritative version
    // of an event-sourced aggregate is its STREAM HEAD, which is `prior` below.
    // So an explicit expectation (the `If-Match` echo) is compared against the
    // head, and absent one there is nothing to compare — the (stream_id,
    // version) PK already rejects a concurrent append on its own.
    aggregateIsVersioned(agg)
      ? `    async def save(self, aggregate: ${aggRef(agg)}, expected_version: int | None = None) -> None:`
      : `    async def save(self, aggregate: ${aggRef(agg)}) -> None:`,
    "        pending = aggregate.pull_events()",
    "        if pending:",
    "            prior = (",
    "                await self._session.execute(",
    `                    ${R.select}(${R.func}.max(${row}.version)).where(
                        ${row}.stream_type == "${agg.name}", ${row}.stream_id == aggregate.id
                    )`,
    "                )",
    "            ).scalar()",
    "            version = prior or 0",
    ...(aggregateIsVersioned(agg)
      ? [
          "            if expected_version is not None and version != expected_version:",
          `                raise ${R.ConcurrencyError}(f"${agg.name} {aggregate.id} was modified concurrently")`,
        ]
      : []),
    "            for ev in pending:",
    "                version += 1",
    // The (stream_id, version) PK IS the event stream's optimistic-concurrency
    // control: a competing append that read the same max(version) inserts the
    // same version and loses with a Postgres unique_violation (SQLSTATE 23505).
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
    "                        )",
    "                    )",
    `                except ${R.IntegrityError} as err:`,
    '                    if getattr(getattr(err, "orig", None), "sqlstate", None) == "23505":',
    `                        raise ${R.ConcurrencyError}(f"${agg.name} {aggregate.id} was modified concurrently") from err`,
    "                    raise",
    "                await self._events.dispatch(ev)",
    "        await self._session.flush()",
    `        ${PY.log}("debug", "repository_save", aggregate=${JSON.stringify(agg.name)}, id=str(aggregate.id))`,
    "",
    rowToEvent(agg, events, row),
    "",
    eventToData(events),
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
    body,
    "",
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
function inMemoryFind(agg: EnrichedAggregateIR, find: FindIR): string {
  const params = find.params.map((p) => `${snake(p.name)}: ${pyParam(p.type)}`);
  const sig = ["self", ...params].join(", ");
  const pred = find.filter ? renderPyExpr(find.filter, { thisName: "a" }) : "True";
  // `find … paged` over an event-log carrier — the four wire controls join the
  // signature and the body pages in memory (`pyInMemoryPagedFind`, F2-CB-C1).
  if (pagedReturn(find.returnType)) {
    return pyInMemoryPagedFind(agg, find, {
      sig: ["self", ...params, ...PY_PAGED_FIND_PARAMS].join(", "),
      loadLines: ["        items = await self.all()"],
      filteredExpr: `[a for a in items if ${pred}]`,
    });
  }
  if (find.returnType.kind === "array") {
    return lines(
      `    async def ${snake(find.name)}(${sig}) -> list[${aggRef(agg)}]:`,
      `        result = [a for a in await self.all() if ${pred}]`,
      findExecutedLine(agg, find.name, "len(result)"),
      "        return result",
    );
  }
  return lines(
    `    async def ${snake(find.name)}(${sig}) -> ${aggRef(agg)} | None:`,
    `        matches = [a for a in await self.all() if ${pred}]`,
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
function rowToEvent(agg: EnrichedAggregateIR, events: EventIR[], row: string): string {
  const arms = events.flatMap((ev, i) => [
    `        ${i === 0 ? "if" : "elif"} row.type == "${ev.name}":`,
    `            return ${eventRef(ev.name)}(${ev.fields
      .map((f) => `${snake(f.name)}=${fromData(f.name, f.type)}`)
      .join(", ")})`,
  ]);
  return lines(
    `    def _row_to_event(self, row: ${row}) -> ${R.DomainEvent}:`,
    `        data = ${PY.cast}(dict[str, object], row.data)`,
    ...(arms.length > 0 ? arms : []),
    `        raise ValueError(f"unknown ${agg.name} event type: {row.type}")`,
  );
}

export function fromData(name: string, t: TypeIR): string {
  const access = `data["${name}"]`;
  const inner = t.kind === "optional" ? t.inner : t;
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
        default:
          return `${PY.cast}(str, ${access})`;
      }
    case "id":
      return `${pyIdType(inner.targetName)}(${PY.cast}(str, ${access}))`;
    case "enum":
      return `${pyVoOrEnum(inner.name)}(${PY.cast}(str, ${access}))`;
    default:
      return `${PY.cast}(str, ${access})`;
  }
}

/** Event dataclass → the JSONB payload (DSL-keyed, JSON-safe values). */
function eventToData(events: EventIR[]): string {
  const arms = events.flatMap((ev, i) => [
    `        ${i === 0 ? "if" : "elif"} isinstance(ev, ${eventRef(ev.name)}):`,
    `            return {${ev.fields.map((f) => `"${f.name}": ${toData(`ev.${snake(f.name)}`, f.type)}`).join(", ")}}`,
  ]);
  return lines(
    `    def _event_to_data(self, ev: ${R.DomainEvent}) -> dict[str, object]:`,
    ...(arms.length > 0 ? arms : []),
    `        raise ValueError(f"unknown event: {type(ev).__name__}")`,
  );
}

export function toData(expr: string, t: TypeIR): string {
  const inner = t.kind === "optional" ? t.inner : t;
  if (inner.kind === "primitive" && inner.name === "datetime") return `${expr}.isoformat()`;
  if (inner.kind === "primitive" && inner.name === "money") return `str(${expr})`;
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
    const access = `root.${snake(wf.name)}`;
    const inner = wf.type.kind === "optional" ? wf.type.inner : wf.type;
    if (inner.kind === "primitive" && inner.name === "datetime") {
      pairs.push(`"${wf.name}": ${R.iso}(${access})`);
      continue;
    }
    if (inner.kind === "primitive" && inner.name === "money") {
      // Precise-decimal string on the wire (parity with the other backends).
      pairs.push(`"${wf.name}": ${numericEncode(PY_NUMERIC, "money", "dto-map", access)}`);
      continue;
    }
    if (inner.kind === "valueobject") {
      const vo = ctx.valueObjects.find((v) => v.name === inner.name);
      if (vo) {
        const fields = vo.fields
          .map((vf) => `"${vf.name}": ${access}.${snake(vf.name)}`)
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
