import { type PolymorphicRead, polymorphicReadFor } from "../../ir/enrich/read-scope.js";
import { type WireRejectionClass, wireStatus } from "../../ir/enrich/wire-policy.js";
import {
  polymorphicReadGates,
  polymorphicReadMasked,
  routedPolymorphicRead,
} from "../../ir/plan/index.js";
import {
  type EnrichedAggregateIR,
  type EnrichedBoundedContextIR,
  exprUsesCurrentUser,
} from "../../ir/types/loom-ir.js";
import { isTpcBase, isTphBase, tpcConcretesOf, tphConcretesOf } from "../../ir/util/inheritance.js";
import { lines } from "../../util/code-builder.js";
import { snake } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import { PY_IMPORTS, pyRef } from "../_imports/python.js";
import { rowClassName } from "./py-columns.js";
import { PY, pyIdType } from "./py-symbols.js";
import { renderPyNegatedGuard } from "./render-expr.js";
import { aggRef, R, schemaRow } from "./repository-builder.js";
import {
  PY_HTTP as H,
  ID_PARAM,
  PY_PAGED_CONTROLS,
  PY_REQUEST_PARAM,
  PY_SESSION_DEP,
  PY_USER_BIND,
} from "./routes-builder.js";
import { pyNotFoundRaise, pyProblemResponseEntry } from "./wire-policy-py.js";

/** `from app.db.repositories.<snake(agg)>_repository import <Agg>Repository`. */
const repoRef = (name: string): string =>
  pyRef(`app.db.repositories.${snake(name)}_repository`, `${name}Repository`);

// ---------------------------------------------------------------------------
// Polymorphic base reader (aggregate-inheritance.md), and the route that
// serves it.
//
// An abstract base has no user repository, but the point of inheritance is
// polymorphic access — "query all Equipment, dereference any `Equipment id`".
// Three artifacts per abstract base:
//
//   app/domain/<base>.py                     — `Equipment = Crane | Forklift`
//   app/db/repositories/<base>_repository.py — the read-only reader
//   app/http/<base>_routes.py                — `GET /<bases>` (+ `/{id}` on TPH)
//
// The read is the polymorphic-read fact (`polymorphicReadFor`,
// `src/ir/enrich/read-scope.ts`) rendered on SQLAlchemy:
//
//   - TPH: ONE `select(<Base>Row)` per read.  The root row class is mapped
//     `polymorphic_on` its `kind`, so each row loads as its concrete's
//     subclass, and the read-scope hook applies the root's restrictions and
//     every concrete's own, kind-guarded — no restriction is spelled here.  The
//     order (`id`) and the page window are the database's, over the whole
//     hierarchy.  Each row hydrates through its concrete repository, which
//     loads its contained parts and join tables.
//   - TPC: one table per concrete, so the reader runs each concrete's own read
//     (the hook applies that concrete's whole scope) and merges them in the one
//     global `id` order before it pages.
// ---------------------------------------------------------------------------

export function abstractBasesOf(ctx: EnrichedBoundedContextIR): EnrichedAggregateIR[] {
  return ctx.aggregates.filter((a) => isTphBase(a, ctx.aggregates) || isTpcBase(a, ctx.aggregates));
}

export function concretesOf(
  base: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
): EnrichedAggregateIR[] {
  return (
    isTphBase(base, ctx.aggregates)
      ? tphConcretesOf(base, ctx.aggregates)
      : tpcConcretesOf(base, ctx.aggregates)
  ) as EnrichedAggregateIR[];
}

/** `app/domain/<snake(base)>.py` — the tagged union of concrete subtypes. */
export function buildPyBaseUnionFile(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
): string {
  return lines(
    `"""Polymorphic ${base.name} — the union of its concrete subtypes.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    "",
    `${base.name} = ${concretes.map((c) => aggRef(c)).join(" | ")}`,
    "",
  );
}

/** Read-only `<Base>Repository` — `find_by_id` and `all` over the hierarchy,
 *  returning the union, plus its tagged `to_wire`.  `find_page` exists only
 *  for its one caller, the `GET /<bases>` route, so it (and with it the
 *  `app.domain.paging` import) is rendered exactly when `routesPolymorphicRead`
 *  holds — the same predicate that decides whether `paging.py` is emitted. */
export function buildPyBaseReaderFile(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
  ctx: EnrichedBoundedContextIR,
): string {
  const read = polymorphicReadFor(base, ctx.aggregates);
  const paged = !!routedPolymorphicRead(base, ctx);
  const masked = new Set(polymorphicReadMasked(base, ctx));
  const body =
    read && isTphBase(base, ctx.aggregates)
      ? tphReader(base, read, paged, masked)
      : tpcReader(base, concretes, read, paged, masked);
  return lines(
    `"""Read-only polymorphic ${base.name} reader.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    "",
    "",
    body,
    "",
  );
}

const repoCall = (name: string): string => `${repoRef(name)}(self._session, self._events)`;

function readerHead(base: EnrichedAggregateIR): string[] {
  return [
    `class ${base.name}Repository:`,
    `    def __init__(self, session: ${R.AsyncSession}, events: ${R.DomainEventDispatcher}) -> None:`,
    "        self._session = session",
    "        self._events = events",
  ];
}

/** `find_page` over a list read already in the global order: the window and
 *  the global counters. */
function pagedResultLines(): string[] {
  return [
    "        total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0",
    `        return ${R.PagedResult}(items=items, page=page, page_size=page_size, total=total, total_pages=total_pages)`,
  ];
}

/** `to_wire(root)` — the row's tagged wire body: `{"type": "<Concrete>", …the
 *  concrete's own wire fields}`, the tagged-union shape (docs/payloads.md).  A
 *  concrete in `masked` serializes through its own `to_wire_masked` (which reads
 *  the ambient principal), so the base read redacts exactly what that
 *  concrete's own read does. */
function toWireLines(
  base: EnrichedAggregateIR,
  read: PolymorphicRead | undefined,
  masked: ReadonlySet<string>,
): string[] {
  if (!read) return [];
  return [
    "",
    `    def to_wire(self, root: ${aggRef(base)}) -> dict[str, object]:`,
    ...read.variants.flatMap((v) => [
      `        if isinstance(root, ${pyRef(`app.domain.${snake(v.aggregate)}`, v.aggregate)}):`,
      `            return {"type": ${JSON.stringify(v.tag)}, **${repoCall(v.aggregate)}.${masked.has(v.aggregate) ? "to_wire_masked" : "to_wire"}(root)}`,
    ]),
    `        raise ValueError(f"unknown ${base.name} subtype: {type(root).__name__}")`,
  ];
}

function tphReader(
  base: EnrichedAggregateIR,
  read: PolymorphicRead,
  paged: boolean,
  masked: ReadonlySet<string>,
): string {
  const row = schemaRow(rowClassName(base.name));
  const order = read.order.map((t) => `${row}.${snake(t.field)}.${t.direction}()`).join(", ");
  return lines(
    ...readerHead(base),
    "",
    `    async def find_by_id(self, id: str) -> ${aggRef(base)} | None:`,
    // A `select`, never `session.get`: the identity map would answer a row an
    // `ignoring` read loaded earlier without the hook narrowing it.
    `        row = (await self._session.execute(${R.select}(${row}).where(${row}.id == id).execution_options(populate_existing=True))).scalars().first()`,
    "        if row is None:",
    "            return None",
    "        return await self._hydrate(row)",
    "",
    `    async def all(self) -> list[${aggRef(base)}]:`,
    `        rows = (await self._session.execute(${R.select}(${row}).order_by(${order}))).scalars().all()`,
    "        return [await self._hydrate(row) for row in rows]",
    ...(paged
      ? [
          "",
          `    async def find_page(self, page: int, page_size: int) -> ${R.PagedResult}[${aggRef(base)}]:`,
          "        offset = (page - 1) * page_size",
          `        total = (await self._session.execute(${R.select}(${R.func}.count()).select_from(${row}))).scalar_one()`,
          "        rows = (",
          `            await self._session.execute(${R.select}(${row}).order_by(${order}).limit(page_size).offset(offset))`,
          "        ).scalars().all()",
          "        items = [await self._hydrate(row) for row in rows]",
          ...pagedResultLines(),
        ]
      : []),
    ...toWireLines(base, read, masked),
    "",
    // Each row is already its concrete's mapped subclass; its concrete
    // repository hydrates it (contained parts, join tables and all).
    `    async def _hydrate(self, row: ${row}) -> ${aggRef(base)}:`,
    ...read.variants.flatMap((v) => [
      `        if isinstance(row, ${schemaRow(rowClassName(v.aggregate))}):`,
      `            return await ${repoCall(v.aggregate)}._hydrate(row)`,
    ]),
    `        raise ValueError(f"unknown ${base.name} kind: {row.kind}")`,
  );
}

function tpcReader(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
  read: PolymorphicRead | undefined,
  paged: boolean,
  masked: ReadonlySet<string>,
): string {
  return lines(
    ...readerHead(base),
    "",
    `    async def find_by_id(self, id: str) -> ${aggRef(base)} | None:`,
    ...concretes.flatMap((c) => [
      `        ${snake(c.name)} = await ${repoCall(c.name)}.find_by_id(${pyIdType(c.name)}(id))`,
      `        if ${snake(c.name)} is not None:`,
      `            return ${snake(c.name)}`,
    ]),
    "        return None",
    "",
    // Each concrete's own read applies that concrete's whole scope; the merge
    // is the one global `id` order the base read answers in.
    `    async def all(self) -> list[${aggRef(base)}]:`,
    `        out: list[${aggRef(base)}] = []`,
    ...concretes.map((c) => `        out.extend(await ${repoCall(c.name)}.all())`),
    "        return sorted(out, key=lambda item: str(item.id))",
    ...(paged
      ? [
          "",
          `    async def find_page(self, page: int, page_size: int) -> ${R.PagedResult}[${aggRef(base)}]:`,
          "        merged = await self.all()",
          "        total = len(merged)",
          "        offset = (page - 1) * page_size",
          "        items = merged[offset : offset + page_size]",
          ...pagedResultLines(),
        ]
      : []),
    ...toWireLines(base, read, masked),
  );
}

/** `app/http/<snake(base)>_routes.py` — `GET /<bases>?page=&pageSize=`, the
 *  paged polymorphic read, and under TPH `GET /<bases>/{id}`.  Each item is the
 *  tagged union of the concretes' own response models (`{"type": "Crane",
 *  …CraneResponse}`), so a client reads a row's subtype off `type` exactly as it
 *  reads any tagged union. */
export function buildPyBaseRoutesFile(
  base: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
): string {
  const read = polymorphicReadFor(base, ctx.aggregates)!;
  const B = base.name;
  const route = routeSegmentFor(B);
  const literal = pyRef("typing", "Literal");
  const itemClass = (v: string): string => `${B}${v}Item`;
  const items = read.variants.map((v) =>
    lines(
      `class ${itemClass(v.aggregate)}(${pyRef(`app.http.${snake(v.aggregate)}_routes`, `${v.aggregate}Response`)}):`,
      `    type: ${literal}[${JSON.stringify(v.tag)}]`,
      "",
      "",
    ),
  );
  const union = read.variants.map((v) => itemClass(v.aggregate)).join(" | ");
  const responseAlias =
    read.variants.length > 1
      ? `${B}Response = ${H.Annotated}[${union}, ${pyRef("pydantic", "Field")}(discriminator="type")]`
      : `${B}Response = ${union}`;
  const problem = (cls: WireRejectionClass): string =>
    pyProblemResponseEntry(wireStatus(cls), H.ProblemDetails);
  // Every concrete's list-read gate, checked before the load: a caller who
  // fails any of them gets that concrete's own pre-load 403.
  const gates = polymorphicReadGates(base, ctx);
  const forbidden =
    gates.length > 0
      ? [
          pyProblemResponseEntry(
            wireStatus("forbidden", ctx.structuralErrorStatuses),
            H.ProblemDetails,
          ),
        ]
      : [];
  const gateUsesUser = gates.some((g) => exprUsesCurrentUser(g.find.requires));
  const gateLines = (): (string | null)[] => [
    gateUsesUser ? PY_USER_BIND : null,
    ...gates.flatMap((g) => [
      `    if ${renderPyNegatedGuard(g.find.requires)}:`,
      `        raise ${PY.ForbiddenError}(${JSON.stringify(`Forbidden: find ${g.find.name}`)})`,
    ]),
  ];
  const requestParam = gateUsesUser ? `${PY_REQUEST_PARAM}, ` : "";
  const byId =
    read.layout === "sharedTable"
      ? [
          "",
          "",
          `@router.get("/{id}", response_model=${B}Response, operation_id="get${B}ById", responses={${[...forbidden, problem("not-found"), problem("field-invalid")].join(", ")}})`,
          `async def get_${snake(B)}_by_id(${ID_PARAM}, ${requestParam}session: SessionDep) -> dict[str, object]:`,
          ...gateLines(),
          "    repo = _repo(session)",
          "    found = await repo.find_by_id(id)",
          "    if found is None:",
          `        ${pyNotFoundRaise(H.AggregateNotFoundError, B, "id")}`,
          "    return repo.to_wire(found)",
        ]
      : [];
  return lines(
    `"""Polymorphic ${B} read routes.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    "",
    PY_SESSION_DEP,
    "",
    "",
    ...items,
    responseAlias,
    "",
    "",
    `class ${B}Paged(${H.BaseModel}):`,
    `    items: list[${B}Response]`,
    "    page: int",
    "    pageSize: int",
    "    total: int",
    "    totalPages: int",
    "",
    "",
    `router = ${H.APIRouter}(prefix="/${route}", tags=["${route}"])`,
    "",
    "",
    `def _repo(session: ${H.AsyncSession}) -> ${repoRef(B)}:`,
    `    return ${repoRef(B)}(session, ${H.NoopDomainEventDispatcher}())`,
    "",
    "",
    `@router.get("", response_model=${B}Paged, operation_id="all${B}", responses={${[...forbidden, problem("field-invalid")].join(", ")}})`,
    `async def all_${route}(${requestParam}session: SessionDep, ${PY_PAGED_CONTROLS.join(", ")}) -> dict[str, object]:`,
    ...gateLines(),
    "    repo = _repo(session)",
    "    result = await repo.find_page(page, pageSize)",
    "    return {",
    '        "items": [repo.to_wire(root) for root in result.items],',
    '        "page": result.page,',
    '        "pageSize": result.page_size,',
    '        "total": result.total,',
    '        "totalPages": result.total_pages,',
    "    }",
    ...byId,
    "",
  );
}
