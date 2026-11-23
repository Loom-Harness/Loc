import { foldFloorTerms, foldTenancyFor } from "../../ir/enrich/fold-tenancy.js";
import type { EnrichedBoundedContextIR, ProjectionIR } from "../../ir/types/loom-ir.js";
import { exprUsesCurrentUser, isMaterializedProjection } from "../../ir/types/loom-ir.js";
import { wireStatusResolver } from "../../ir/util/wire-policy.js";
import { type LinesPart, lines } from "../../util/code-builder.js";
import { snake } from "../../util/naming.js";
import { pyRef } from "../_imports/python.js";
import {
  camelId,
  DOMAIN_NAMES,
  opProjectionGet,
  opProjectionList,
  SCHEMA_NAMES,
} from "../_symbols/plan.js";
import { responsePyType } from "./emit/http-models.js";
import { PY } from "./py-symbols.js";
import { renderPyNegatedGuard } from "./render-expr.js";
import { errorResponsesKwarg } from "./routes-builder.js";
import { pyNotFoundRaise } from "./wire-policy-py.js";
import { instanceFieldValue } from "./workflows-builder.js";

// ---------------------------------------------------------------------------
// Projection read-model routes — `app/http/projections_routes.py`, mounted at
// `/projections` (projection.md).  The read side of a projection: pure SELECTs
// over the `<Proj>Row` read-model table the dispatch fold upserts.
//
//   GET /projections/<snake>        → every row (list)
//   GET /projections/<snake>/{key}  → one row by correlation id (404 if absent)
//
// Row → wire projection reuses `instanceFieldValue` (the saga-instance
// projector), so datetime / money serialise identically to every other read.
// Non-key wire fields are optional (the read-model columns are nullable — a
// fold upserts partial rows).
// ---------------------------------------------------------------------------

export function buildPyProjectionsFile(ctx: EnrichedBoundedContextIR): string | null {
  // FOLDED (materialized) projections only — the event-folded read model with a
  // physical `<Proj>Row` table.  Query-time projections (read-path-architecture.md
  // rev.13) are emitted by `buildPyQueryProjectionsFile` instead.
  const folded = ctx.projections.filter(isMaterializedProjection);
  if (folded.length === 0) return null;

  const models = folded.map((p) => projectionResponseModels(p, ctx)).join("");
  const routeBlocks = folded.map((p) => projectionRoutes(p, ctx));
  const routes = routeBlocks.join("\n\n\n");
  const body = `${models}router = APIRouter(prefix="/projections", tags=["projections"])\n\n\n${routes}`;

  // FOLDED projections only.  A query-time projection has no `<Proj>Row` table
  // — it is computed per read — so listing it here emitted
  // `from app.db.schema import OpenOrdersRow` for a name `db/schema.py` never
  // defines: `ruff` F401'd it and `mypy --strict` failed with "Module
  // app.db.schema has no attribute OpenOrdersRow".  Any context declaring one of
  // each kind failed to compile on python; no fixture had that combination.
  const projRows = folded.map((p) => `${p.name}Row`).sort();

  return lines(
    `"""Projection read-model routes.  Auto-generated."""`,
    "",
    "from fastapi import APIRouter, Depends, Path",
    "from pydantic import BaseModel, RootModel",
    "from sqlalchemy import select",
    "from sqlalchemy.ext.asyncio import AsyncSession",
    "from typing import Annotated",
    "",
    "from app.db.engine import get_session",
    `from app.db.schema import ${projRows.join(", ")}`,
    "from app.domain.errors import AggregateNotFoundError",
    "",
    "SessionDep = Annotated[AsyncSession, Depends(get_session)]",
    "",
    "",
    body,
    "",
  );
}

/** The `<Proj>Response` (one row) + `<Proj>Response`-list carrier, walking the
 *  projection's wire shape — id-source rows are `str`, the rest go through
 *  `responsePyType`; every non-key field is optional (nullable read model). */
function projectionResponseModels(proj: ProjectionIR, ctx: EnrichedBoundedContextIR): string {
  const T = DOMAIN_NAMES.python.type(proj.name);
  const shape = proj.wireShape ?? [];
  const fieldLines = shape.map((f) => {
    if (f.source === "id") return `    ${f.name}: str`;
    const t = responsePyType(f.type, ctx);
    return `    ${f.name}: ${t.endsWith("| None") ? t : `${t} | None`} = None`;
  });
  return lines(
    `class ${T}Response(BaseModel):`,
    fieldLines.length > 0 ? fieldLines : ["    pass"],
    "",
    "",
    `class ${SCHEMA_NAMES.listResponse(proj.name)}(RootModel[list[${T}Response]]):`,
    "    pass",
    "",
    "",
  );
}

const REQUEST = pyRef("fastapi", "Request");
const USER = pyRef("app.auth.user", "User");

/** The list + by-key read routes for one projection. */
function projectionRoutes(proj: ProjectionIR, ctx: EnrichedBoundedContextIR): string {
  const T = DOMAIN_NAMES.python.type(proj.name);
  const slug = snake(proj.name);
  const fn = DOMAIN_NAMES.python.stem(proj.name);
  const row = `${proj.name}Row`;
  const shape = proj.wireShape ?? [];
  // Folded read-model columns are ALL nullable (a projection row is written
  // incrementally), so even a source-required `datetime`/`money` arrives off the
  // ORM row as `T | None`.  Serialize every non-key field as optional so
  // `iso()` / `money_str()` get their None-guard — otherwise `mypy --strict`
  // rejects `iso(row.<dt>)` on a `datetime | None` column.
  const project = (rowVar: string): string =>
    shape
      .map((f) => {
        const wf = f.source === "id" ? f : { ...f, optional: true };
        return `"${f.name}": ${instanceFieldValue(rowVar, wf)}`;
      })
      .join(", ");
  // The `requires` gate — 403 before the read, on BOTH read-model routes.  A
  // folded projection is a table of rows a client can GET; that it is written
  // by folds rather than queried live changes nothing about who may read it.
  const gate = proj.query?.requires;
  // Every read of a scoped fold applies its read scope (`fold-tenancy.ts`): the
  // row's tenant column equals the request principal's claim.
  const tenancy = foldTenancyFor(proj);
  const floor = tenancy ? foldFloorTerms(tenancy) : [];
  const scope = floor.map(
    (t) => `${row}.${DOMAIN_NAMES.python.prop(t.field)} == str(current_user.${snake(t.claim)})`,
  );
  const gateUsesUser = (!!gate && exprUsesCurrentUser(gate)) || floor.length > 0;
  const userParam = gateUsesUser ? `request: ${REQUEST}, ` : "";
  const userLine = gateUsesUser ? `    current_user: ${USER} = request.state.current_user` : null;
  const gateLines: LinesPart = gate
    ? [
        userLine,
        // renderPyNegatedGuard so a `.contains(...)` gate emits `x not in y`
        // rather than `not (x in y)` (ruff E713) — same helper as every other gate.
        `    if ${renderPyNegatedGuard(gate)}:`,
        `        raise ${PY.ForbiddenError}(${JSON.stringify(`Forbidden: projection ${proj.name}`)})`,
      ]
    : userLine;
  // Declared statuses come from the SHARED table, keyed exactly as a find's
  // are: the list read is a `findList` (nothing but the gate's 403), the by-key
  // read a `findOptional` (403 + the 404 it already declared).  Both resolve
  // `Forbidden` through the context's `httpStatus` map, so a remapped rung
  // moves the declaration and the handler together.  Ungated ⇒ byte-identical
  // to the previous `""` / `getById` kwargs.
  const resolve = wireStatusResolver(ctx.structuralErrorStatuses);
  const list = lines(
    `@router.get("/${slug}", response_model=${SCHEMA_NAMES.listResponse(proj.name)}, operation_id="${camelId(opProjectionList(T))}"${errorResponsesKwarg("findList", !!gate, [], resolve)})`,
    `async def ${fn}_list(${userParam}session: SessionDep) -> list[dict[str, object]]:`,
    gateLines,
    `    rows = await ${pyProjectionRowsReader(proj)}(session${floor.length > 0 ? ", current_user" : ""})`,
    `    return [${pyProjectionWire(proj)}(row) for row in rows]`,
  );
  const key = 'key: Annotated[str, Path(json_schema_extra={"format": "uuid"})]';
  const byKey = lines(
    `@router.get("/${slug}/{key}", response_model=${T}Response, operation_id="${camelId(opProjectionGet(T))}"${gate ? errorResponsesKwarg("findOptional", true, [], resolve) : errorResponsesKwarg("getById", false, [], resolve)})`,
    `async def ${fn}_get(${key}, ${userParam}session: SessionDep) -> dict[str, object]:`,
    // Gate first: a caller who fails it must not learn whether the key exists.
    gateLines,
    `    row = await ${pyProjectionRowReader(proj)}(session, key${floor.length > 0 ? ", current_user" : ""})`,
    "    if row is None:",
    // RS-27 extends here — a projection row read by correlation KEY is by-id.
    `        ${pyNotFoundRaise("AggregateNotFoundError", T, "key")}`,
    `    return ${pyProjectionWire(proj)}(row)`,
  );
  // The read bodies and the row's wire dict, at module scope: the routes above
  // and a query handler's `P.all()` / `P.get(k)` call the same functions.
  const userArg = floor.length > 0 ? `, current_user: ${USER}` : "";
  const readers = lines(
    `async def ${pyProjectionRowsReader(proj)}(session: AsyncSession${userArg}) -> list[${row}]:`,
    scope.length > 0
      ? `    return list((await session.execute(select(${row}).where(${scope.join(", ")}))).scalars().all())`
      : `    return list((await session.execute(select(${row}))).scalars().all())`,
    "",
    "",
    `async def ${pyProjectionRowReader(proj)}(session: AsyncSession, key: str${userArg}) -> ${row} | None:`,
    scope.length > 0
      ? `    return (await session.execute(select(${row}).where(${row}.${DOMAIN_NAMES.python.prop(proj.correlationField as string)} == key, ${scope.join(", ")}))).scalars().first()`
      : `    return await session.get(${row}, key)`,
    "",
    "",
    `def ${pyProjectionWire(proj)}(row: ${row}) -> dict[str, object]:`,
    `    return {${project("row")}}`,
  );
  return [readers, list, byKey].join("\n\n\n");
}

/** `read_<p>_rows` — every row of a folded projection, under its read scope. */
export function pyProjectionRowsReader(p: { name: string }): string {
  return `read_${DOMAIN_NAMES.python.stem(p.name)}_rows`;
}

/** `read_<p>_row` — one row by its key, `None` when absent. */
export function pyProjectionRowReader(p: { name: string }): string {
  return `read_${DOMAIN_NAMES.python.stem(p.name)}_row`;
}

/** `<p>_wire` — a row as the projection's wire dict. */
export function pyProjectionWire(p: { name: string }): string {
  return `${DOMAIN_NAMES.python.stem(p.name)}_wire`;
}
