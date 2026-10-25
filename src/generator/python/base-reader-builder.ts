import type { EnrichedAggregateIR, EnrichedBoundedContextIR } from "../../ir/types/loom-ir.js";
import { isTpcBase, isTphBase, tpcConcretesOf, tphConcretesOf } from "../../ir/util/inheritance.js";
import { lines } from "../../util/code-builder.js";
import { snake } from "../../util/naming.js";
import { PY_IMPORTS, pyRef } from "../_imports/python.js";
import { rowClassName } from "./py-columns.js";
import { pyIdType } from "./py-symbols.js";
import { aggRef, R, schemaRow } from "./repository-builder.js";

/** `from app.db.repositories.<snake(agg)>_repository import <Agg>Repository`. */
const repoRef = (name: string): string =>
  pyRef(`app.db.repositories.${snake(name)}_repository`, `${name}Repository`);

// ---------------------------------------------------------------------------
// Polymorphic base reader (aggregate-inheritance.md).
//
// An abstract base has no user repository, but the point of inheritance
// is polymorphic access — "query all Parties, dereference any
// `Party id`".  Two artifacts per abstract base:
//
//   app/domain/<base>.py                  — `Party = Customer | Supplier`
//   app/db/repositories/<base>_repository.py — read-only reader
//
// TPH: scan the shared table, dispatch hydration on `kind` by
// delegating to the concrete repository (loads parts/joins properly —
// a deliberate completeness>speed trade vs Hono's scalar-only shared-
// row hydrate).  TPC: union the concrete repositories' reads.
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

/** Read-only `<Base>Repository` — `find_by_id` + `all` over the
 *  hierarchy, returning the union. */
export function buildPyBaseReaderFile(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
  ctx: EnrichedBoundedContextIR,
): string {
  const tph = isTphBase(base, ctx.aggregates);
  const body = tph ? tphReader(base, concretes) : tpcReader(base, concretes);
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

function tphReader(base: EnrichedAggregateIR, concretes: EnrichedAggregateIR[]): string {
  const row = schemaRow(rowClassName(base.name));
  return lines(
    `class ${base.name}Repository:`,
    `    def __init__(self, session: ${R.AsyncSession}, events: ${R.DomainEventDispatcher}) -> None:`,
    "        self._session = session",
    "        self._events = events",
    "",
    `    async def find_by_id(self, id: str) -> ${aggRef(base)} | None:`,
    `        row = await self._session.get(${row}, id)`,
    "        if row is None:",
    "            return None",
    "        return await self._dispatch(row)",
    "",
    `    async def all(self) -> list[${aggRef(base)}]:`,
    `        rows = (await self._session.execute(${R.select}(${row}))).scalars().all()`,
    "        return [await self._dispatch(row) for row in rows]",
    "",
    // Dispatch on the kind discriminator, delegating to the concrete
    // repository so contained parts / join tables hydrate fully.
    `    async def _dispatch(self, row: ${row}) -> ${aggRef(base)}:`,
    ...concretes.flatMap((c, i) => [
      `        ${i === 0 ? "if" : "elif"} row.kind == "${c.name}":`,
      `            return await ${repoRef(c.name)}(self._session, self._events).get_by_id(${pyIdType(c.name)}(row.id))`,
    ]),
    `        raise ValueError(f"unknown ${base.name} kind: {row.kind}")`,
  );
}

function tpcReader(base: EnrichedAggregateIR, concretes: EnrichedAggregateIR[]): string {
  return lines(
    `class ${base.name}Repository:`,
    `    def __init__(self, session: ${R.AsyncSession}, events: ${R.DomainEventDispatcher}) -> None:`,
    "        self._session = session",
    "        self._events = events",
    "",
    `    async def find_by_id(self, id: str) -> ${aggRef(base)} | None:`,
    ...concretes.flatMap((c) => [
      `        ${snake(c.name)} = await ${repoRef(c.name)}(self._session, self._events).find_by_id(${pyIdType(c.name)}(id))`,
      `        if ${snake(c.name)} is not None:`,
      `            return ${snake(c.name)}`,
    ]),
    "        return None",
    "",
    `    async def all(self) -> list[${aggRef(base)}]:`,
    `        out: list[${aggRef(base)}] = []`,
    ...concretes.map(
      (c) => `        out.extend(await ${repoRef(c.name)}(self._session, self._events).all())`,
    ),
    "        return out",
  );
}
