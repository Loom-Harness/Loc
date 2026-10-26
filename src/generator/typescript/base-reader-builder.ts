// Polymorphic base reader for an aggregate-inheritance hierarchy
// (aggregate-inheritance.md), either layout, plus the route that serves it.
//
// An abstract base has no user repository (the validator forbids one — abstract
// aggregates aren't instantiated), but the point of inheritance is polymorphic
// access: "reference any Vehicle, query all Vehicles".  This emitter generates a
// read-only `<Base>Repository` returning the `Car | Truck` union, and the
// `GET /api/<bases>` route that answers it as a paged list of tagged rows.
//
// The read is the polymorphic-read fact (`polymorphicReadFor`,
// `src/ir/enrich/read-scope.ts`) rendered on drizzle, which has no inheritance
// mapping and no global filter, so every restriction is spelled here:
//
//   - TPH: ONE select over the shared table.  The root's restrictions apply to
//     every row; each concrete's own restrictions apply root-hosted and
//     `kind`-guarded (`kind <> 'Car' OR <pred>`), so a filtered row of any
//     subtype never reaches the result.  The order (`id`) and the page window
//     are the database's, over the whole hierarchy.  Each row hydrates as the
//     concrete its `kind` names.
//   - TPC: one table per concrete, so the reader runs each concrete's own read
//     (which applies that concrete's whole scope) and merges them in the one
//     global order before it pages.

import { type PolymorphicRead, polymorphicReadRouted } from "../../ir/enrich/read-scope.js";
import type { EnrichedAggregateIR, EnrichedBoundedContextIR } from "../../ir/types/loom-ir.js";
import { isValueCollectionType } from "../../ir/util/value-collections.js";
import { API_BASE_PATH } from "../../util/api-base.js";
import { lines } from "../../util/code-builder.js";
import { lowerFirst, plural, snake } from "../../util/naming.js";
import { drizzleImportLine, stripStringLiterals } from "./drizzle-imports.js";
import { isRefCollection } from "./repository-associations-builder.js";
import { hydrateRootExpr } from "./repository-find-hydrate.js";
import {
  drizzleOrderBy,
  drizzleScopeCall,
  drizzleScopeFnName,
  repoTableName,
} from "./repository-find-predicate.js";
import { collectEnums, collectValueObjects } from "./repository-imports-builder.js";

/** The `<Base> = Concrete | …` discriminated-union type (TS structural union
 *  of the concrete domain classes). Lives in `domain/<base>.ts`.  `layout`
 *  only tunes the explanatory comment: TPH discriminates on a shared `kind`
 *  column; TPC discriminates structurally across per-concrete tables. */
export function buildBaseUnionFile(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
  layout: "sharedTable" | "ownTable" = "sharedTable",
): string {
  const imports = concretes.map((c) => `import type { ${c.name} } from "./${lowerFirst(c.name)}";`);
  const discriminatorNote =
    layout === "sharedTable"
      ? "// (discriminated by the shared table's `kind` column at the data layer)."
      : "// (each concrete is its own table; the union is resolved per-table by the base reader).";
  return lines(
    "// Auto-generated.  Do not edit by hand.",
    ...imports,
    "",
    `// Polymorphic ${base.name} — the tagged union of its concrete subtypes`,
    discriminatorNote,
    `export type ${base.name} = ${concretes.map((c) => c.name).join(" | ")};`,
    "",
  );
}

/** True when `base`'s polymorphic read is routed (`GET /api/<bases>`) on the
 *  drizzle adapter — the shared gate (`polymorphicReadRouted`). */
export function routesPolymorphicRead(
  base: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
): boolean {
  return polymorphicReadRouted(base, ctx);
}

/** True when a concrete hydrates from its root row alone — no contained part,
 *  `X id[]` reference or value-object collection to load from another table. */
function hydratesFromRow(agg: EnrichedAggregateIR): boolean {
  return (
    agg.contains.length === 0 &&
    !agg.fields.some((f) => isRefCollection(f.type) || isValueCollectionType(f.type))
  );
}

/** One module a generated file may import from: the names it offers, each a
 *  value (`import { X }`) or type-only; or a whole-module / default import. */
interface ImportSpec {
  from: string;
  values?: readonly string[];
  types?: readonly string[];
  namespace?: string;
  defaultName?: string;
}

/** The import block DERIVED from the rendered body: a module is imported iff a
 *  name it offers is used in `body` (string contents ignored), and its line
 *  names exactly the used ones — so an import and its usage cannot drift. */
function derivedImports(body: string, specs: readonly ImportSpec[]): string[] {
  const scan = stripStringLiterals(body);
  const used = (n: string): boolean => new RegExp(`(^|[^\\w$.])${n}\\b`).test(scan);
  return specs.flatMap((spec) => renderImport(spec, used));
}

function renderImport(spec: ImportSpec, used: (n: string) => boolean): string[] {
  if (spec.namespace) {
    return used(spec.namespace) ? [`import * as ${spec.namespace} from "${spec.from}";`] : [];
  }
  if (spec.defaultName) {
    return used(spec.defaultName) ? [`import ${spec.defaultName} from "${spec.from}";`] : [];
  }
  const values = (spec.values ?? []).filter(used);
  const types = (spec.types ?? []).filter(used);
  if (values.length === 0 && types.length === 0) return [];
  if (values.length === 0) return [`import type { ${types.join(", ")} } from "${spec.from}";`];
  const names = [...values, ...types.map((t) => `type ${t}`)];
  return [`import { ${names.join(", ")} } from "${spec.from}";`];
}

const repoCtor = (n: string): string => `${n}Repository`;
const repoField = (n: string): string => `${lowerFirst(n)}Repo`;

/** The read-only `<Base>Repository` for a TPH (`sharedTable`) hierarchy: one
 *  select over the shared table per read, dispatching each row on `kind`. */
export function buildBaseReaderFile(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
  ctx: EnrichedBoundedContextIR,
  read: PolymorphicRead,
): string {
  const table = repoTableName(base, ctx);
  // The root's restrictions and each subtype's own, kind-guarded: the generated
  // scope helper of the polymorphic read (`db/read-scopes.ts`).
  const scope = drizzleScopeCall(base, ctx);
  const where = (extra?: string): string => {
    const terms = [extra, scope].filter((t): t is string => !!t);
    if (terms.length === 0) return "";
    return `.where(${terms.length === 1 ? terms[0] : `and(${terms.join(", ")})`})`;
  };
  const orderBy = drizzleOrderBy(table);
  const byConcrete = new Map(concretes.map((c) => [c.name, c]));
  // A concrete with child tables loads them through its own repository's bulk
  // loader (`findManyByIds`) for the ids this read selected; one round-trip per
  // such concrete, never per row.
  const childLoaded = read.variants
    .map((v) => byConcrete.get(v.aggregate)!)
    .filter((c) => !hydratesFromRow(c));
  const dispatchArms = read.variants.flatMap((v) => {
    const c = byConcrete.get(v.aggregate)!;
    const arm = JSON.stringify(v.discriminator);
    return hydratesFromRow(c)
      ? [`        case ${arm}: return [${hydrateRootExpr(c, "root", ctx)}];`]
      : [
          `        case ${arm}: {`,
          `          const hit = ${lowerFirst(c.name)}ById.get(root.id);`,
          `          return hit ? [hit] : [];`,
          `        }`,
        ];
  });
  const body = lines(
    `// Polymorphic ${base.name} reader (TPH / sharedTable): ONE select over the`,
    `// shared table applies the root's restrictions and each subtype's own,`,
    `// kind-guarded, in one global order; each row hydrates as its \`kind\`.`,
    `// Read-only; writes go through the per-concrete repos.`,
    `export class ${base.name}Repository {`,
    `  private readonly db: Db;`,
    ...concretes.map((c) => `  private readonly ${repoField(c.name)}: ${repoCtor(c.name)};`),
    `  constructor(db: Db, events: DomainEventDispatcher) {`,
    `    this.db = db;`,
    ...concretes.map((c) => `    this.${repoField(c.name)} = new ${repoCtor(c.name)}(db, events);`),
    `  }`,
    "",
    `  async findById(id: Ids.${base.name}Id): Promise<${base.name} | null> {`,
    `    const rows = await this.db.select().from(schema.${table})${where(`eq(schema.${table}.id, id)`)};`,
    `    return (await this.hydrate(rows))[0] ?? null;`,
    `  }`,
    "",
    `  async findAll(): Promise<${base.name}[]> {`,
    `    const rows = await this.db.select().from(schema.${table})${where()}.orderBy(${orderBy});`,
    `    return this.hydrate(rows);`,
    `  }`,
    "",
    `  async findPage(page: number, pageSize: number): Promise<{ items: ${base.name}[]; page: number; pageSize: number; total: number; totalPages: number }> {`,
    `    const offset = (page - 1) * pageSize;`,
    `    const countRows = await this.db.select({ value: count() }).from(schema.${table})${where()};`,
    `    const total = Number(countRows[0]?.value ?? 0);`,
    `    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;`,
    `    const rows = await this.db.select().from(schema.${table})${where()}.orderBy(${orderBy}).limit(pageSize).offset(offset);`,
    `    return { items: await this.hydrate(rows), page, pageSize, total, totalPages };`,
    `  }`,
    "",
    ...toWireLines(base, read),
    "",
    `  private async hydrate(rows: (typeof schema.${table}.$inferSelect)[]): Promise<${base.name}[]> {`,
    ...childLoaded.flatMap((c) => [
      `    const ${lowerFirst(c.name)}Ids = rows.filter((r) => r.kind === ${JSON.stringify(c.name)}).map((r) => Ids.${c.name}Id(r.id));`,
      `    const ${lowerFirst(c.name)}ById = new Map((await this.${repoField(c.name)}.findManyByIds(${lowerFirst(c.name)}Ids)).map((a) => [a.id as string, a]));`,
    ]),
    `    return rows.flatMap((root): ${base.name}[] => {`,
    `      switch (root.kind) {`,
    ...dispatchArms,
    `        default: return [];`,
    `      }`,
    `    });`,
    `  }`,
    `}`,
  );
  // A value object / enum is a value import when the body constructs it or
  // reads a member off it, otherwise type-only.
  const scan = stripStringLiterals(body);
  const voOrEnum = [
    ...new Set(concretes.flatMap((c) => [...collectValueObjects(c, ctx), ...collectEnums(c, ctx)])),
  ];
  const isValueUsed = (n: string): boolean => new RegExp(`new\\s+${n}\\(|\\b${n}\\.\\w`).test(scan);
  const fullBody = lines(`type Db = NodePgDatabase<typeof schema>;`, "", body);
  return lines(
    "// Auto-generated.  Do not edit by hand.",
    ...derivedImports(fullBody, [
      { from: "decimal.js", defaultName: "Decimal" },
      { from: "drizzle-orm/node-postgres", types: ["NodePgDatabase"] },
    ]),
    drizzleImportLine(body),
    ...derivedImports(fullBody, [
      { from: "../schema", namespace: "schema" },
      { from: "../read-scopes", values: [drizzleScopeFnName(base)] },
      { from: "../../domain/events", types: ["DomainEventDispatcher"] },
      { from: "../../domain/ids", namespace: "Ids" },
      ...concretes.map((c) => ({ from: `../../domain/${lowerFirst(c.name)}`, values: [c.name] })),
      {
        from: "../../domain/value-objects",
        values: voOrEnum.filter(isValueUsed),
        types: voOrEnum.filter((n) => !isValueUsed(n)),
      },
      ...concretes.map((c) => ({
        from: `./${lowerFirst(c.name)}-repository`,
        values: [repoCtor(c.name)],
      })),
      { from: `../../domain/${lowerFirst(base.name)}`, types: [base.name] },
    ]),
    "",
    fullBody,
    "",
  );
}

/** `toWire(root)` — the row's tagged wire body: `{ type: "<Concrete>", …the
 *  concrete's own wire fields }`, the tagged-union shape (docs/payloads.md). */
function toWireLines(base: EnrichedAggregateIR, read: PolymorphicRead): string[] {
  return [
    `  toWire(root: ${base.name}): unknown {`,
    ...read.variants.map(
      (v) =>
        `    if (root instanceof ${v.aggregate}) return { type: ${JSON.stringify(v.tag)}, ...(this.${repoField(v.aggregate)}.toWire(root) as object) };`,
    ),
    `    throw new Error("unknown ${base.name} subtype");`,
    `  }`,
  ];
}

/** The read-only `<Base>Repository` for a TPC (`ownTable`) hierarchy.
 *
 *  A TPC base has NO table — each concrete is a standalone table with its own
 *  fully-featured repository, so each concrete's own read applies its whole
 *  scope and loads its whole tree.  `findAll` merges those reads in the one
 *  global order (`id`), and `findPage` pages the merge, so a page spans
 *  subtypes exactly as one query over a union would. */
export function buildTpcBaseReaderFile(
  base: EnrichedAggregateIR,
  concretes: EnrichedAggregateIR[],
  read: PolymorphicRead,
): string {
  const body = lines(
    `type Db = NodePgDatabase<typeof schema>;`,
    "",
    `// Polymorphic ${base.name} reader (TPC / ownTable): each concrete's own read`,
    `// applies that concrete's whole scope; the reads merge in one global \`id\``,
    `// order before paging.  Read-only; writes go through the per-concrete repos.`,
    `export class ${base.name}Repository {`,
    ...concretes.map((c) => `  private readonly ${repoField(c.name)}: ${repoCtor(c.name)};`),
    `  constructor(db: Db, events: DomainEventDispatcher) {`,
    ...concretes.map((c) => `    this.${repoField(c.name)} = new ${repoCtor(c.name)}(db, events);`),
    `  }`,
    "",
    `  async findById(id: Ids.${base.name}Id): Promise<${base.name} | null> {`,
    ...concretes.flatMap((c) => [
      `    const ${repoField(c.name)}Hit = await this.${repoField(c.name)}.findById(id as unknown as Ids.${c.name}Id);`,
      `    if (${repoField(c.name)}Hit) return ${repoField(c.name)}Hit;`,
    ]),
    `    return null;`,
    `  }`,
    "",
    `  async findAll(): Promise<${base.name}[]> {`,
    `    const results = await Promise.all([`,
    ...concretes.map((c) => `      this.${repoField(c.name)}.all(),`),
    `    ]);`,
    `    const merged: ${base.name}[] = results.flat();`,
    `    return merged.sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : (a.id as string) > (b.id as string) ? 1 : 0));`,
    `  }`,
    "",
    `  async findPage(page: number, pageSize: number): Promise<{ items: ${base.name}[]; page: number; pageSize: number; total: number; totalPages: number }> {`,
    `    const offset = (page - 1) * pageSize;`,
    `    const merged = await this.findAll();`,
    `    const total = merged.length;`,
    `    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;`,
    `    return { items: merged.slice(offset, offset + pageSize), page, pageSize, total, totalPages };`,
    `  }`,
    "",
    ...toWireLines(base, read),
    `}`,
  );
  return lines(
    "// Auto-generated.  Do not edit by hand.",
    ...derivedImports(body, [
      { from: "drizzle-orm/node-postgres", types: ["NodePgDatabase"] },
      { from: "../schema", namespace: "schema" },
      { from: "../../domain/events", types: ["DomainEventDispatcher"] },
      { from: "../../domain/ids", namespace: "Ids" },
      ...concretes.map((c) => ({ from: `../../domain/${lowerFirst(c.name)}`, values: [c.name] })),
      ...concretes.map((c) => ({
        from: `./${lowerFirst(c.name)}-repository`,
        values: [repoCtor(c.name)],
      })),
      { from: `../../domain/${lowerFirst(base.name)}`, types: [base.name] },
    ]),
    "",
    body,
    "",
  );
}

/** `http/<base>.routes.ts` — `GET /api/<bases>?page=&pageSize=`, the paged
 *  polymorphic read.  Each item is the tagged union of the concretes' own
 *  response DTOs (`{ type: "Car", …CarResponse }`), so a client reads a row's
 *  subtype off `type` exactly as it reads any tagged union. */
export function buildBaseRoutesFile(base: EnrichedAggregateIR, read: PolymorphicRead): string {
  const B = base.name;
  const members = read.variants.map(
    (v) => `${v.aggregate}Response.extend({ type: z.literal(${JSON.stringify(v.tag)}) })`,
  );
  const body = lines(
    `const ${B}PageQuery = z.object({`,
    `  page: z.coerce.number().int().min(1).max(1000000).default(1),`,
    `  pageSize: z.coerce.number().int().min(1).max(500).default(20),`,
    `}).openapi("${B}PageQuery");`,
    `export const ${B}Response = z.discriminatedUnion("type", [${members.join(", ")}]).openapi("${B}Response");`,
    `export const ${B}Paged = z.object({ items: z.array(${B}Response), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("${B}Paged");`,
    "",
    `export function ${lowerFirst(B)}Routes(repo: ${B}Repository): OpenAPIHono {`,
    `  const app = newApp();`,
    "",
    `  app.openapi(`,
    `    createRoute({`,
    `      method: "get",`,
    `      path: "/",`,
    `      tags: ["${snake(plural(B))}"],`,
    `      operationId: "all${B}",`,
    `      request: { query: ${B}PageQuery },`,
    `      responses: {`,
    `        200: { description: "OK", content: { "application/json": { schema: ${B}Paged } } },`,
    `        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },`,
    `      },`,
    `    }),`,
    `    async (c) => {`,
    `      const params = c.req.valid("query");`,
    `      const result = await repo.findPage(params.page, params.pageSize);`,
    `      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof ${B}Paged>, 200);`,
    `    },`,
    `  );`,
    "",
    ...(read.layout === "sharedTable" ? byIdRouteLines(B) : []),
    `  return app;`,
    `}`,
  );
  return lines(
    "// Auto-generated.  Do not edit by hand.",
    ...derivedImports(body, [
      { from: "@hono/zod-openapi", values: ["OpenAPIHono", "createRoute", "z"] },
      { from: "./problem-details", values: ["ProblemDetails", "UuidString", "newApp"] },
      { from: `../db/repositories/${lowerFirst(B)}-repository`, types: [`${B}Repository`] },
      { from: "../domain/ids", namespace: "Ids" },
      { from: "../domain/errors", values: ["AggregateNotFoundError"] },
      ...read.variants.map((v) => ({
        from: `./${lowerFirst(v.aggregate)}.routes`,
        values: [`${v.aggregate}Response`],
      })),
    ]),
    "",
    body,
    "",
  );
}

/** The `createApp` imports of a routed polymorphic read: its router and its
 *  reader. */
export function baseRoutesImports(base: EnrichedAggregateIR): string[] {
  return [
    `import { ${lowerFirst(base.name)}Routes } from "./${lowerFirst(base.name)}.routes";`,
    `import { ${base.name}Repository } from "../db/repositories/${lowerFirst(base.name)}-repository";`,
  ];
}

/** `GET /api/<bases>/{id}` — TPH only: the shared table carries one identity,
 *  so a base id names exactly one row.  (TPC ids are per concrete.)  The same
 *  restrictions as the list read apply; a row they hide is a 404. */
function byIdRouteLines(B: string): string[] {
  return [
    `  app.openapi(`,
    `    createRoute({`,
    `      method: "get",`,
    `      path: "/{id}",`,
    `      tags: ["${snake(plural(B))}"],`,
    `      operationId: "get${B}ById",`,
    `      request: { params: z.object({ id: UuidString }) },`,
    `      responses: {`,
    `        200: { description: "OK", content: { "application/json": { schema: ${B}Response } } },`,
    `        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },`,
    `        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },`,
    `      },`,
    `    }),`,
    `    async (c) => {`,
    `      const { id } = c.req.valid("param");`,
    `      const found = await repo.findById(Ids.${B}Id(id));`,
    `      if (!found) throw new AggregateNotFoundError(\`${B} \${id} not found\`);`,
    `      return c.json(repo.toWire(found) as z.infer<typeof ${B}Response>, 200);`,
    `    },`,
    `  );`,
    "",
  ];
}

/** The `createApp` mount line for a routed polymorphic read. */
export function baseRoutesMount(base: EnrichedAggregateIR): string {
  return `  app.route("${API_BASE_PATH}/${snake(plural(base.name))}", ${lowerFirst(base.name)}Routes(new ${base.name}Repository(db, events)));`;
}
