// ---------------------------------------------------------------------------
// The mock's per-aggregate router, `http/<agg>.routes.ts`.
//
// The route set, each route's path, method, operationId, request and response
// schemas, success status and declared error statuses are the node backend's:
// the set and the statuses come from the shared api-surface derivation, the
// schemas from the Hono builders' own text helpers.  Only the handler bodies
// differ — they read and write wire rows in the in-memory store.
// ---------------------------------------------------------------------------

import { isServerSourcedDefault } from "../../generator/_frontend/server-default.js";
import { requestComponentNamer } from "../../generator/_openapi/request-component-names.js";
import {
  camelId,
  opCreate,
  opDestroy,
  opFind,
  opGetById,
  opOperation,
  SCHEMA_NAMES,
} from "../../generator/_symbols/plan.js";
import { takeSingleFieldChain } from "../../generator/zod-refine.js";
import {
  destroyVersionCheck,
  operationVersionCheck,
  readsIfMatch,
} from "../../ir/enrich/version-check.js";
import { createInputFields, wireCreateDefault } from "../../ir/enrich/wire-projection.js";
import {
  PAGED_DEFAULT_PAGE,
  PAGED_DEFAULT_PAGE_SIZE,
  PAGED_MAX_PAGE,
  PAGED_MAX_PAGE_SIZE,
  pagedReturn,
} from "../../ir/stdlib/generics.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  ExprIR,
  FindIR,
  InvariantIR,
  OperationIR,
  RepositoryIR,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import { wireTypeInfo } from "../../ir/types/wire-types.js";
import {
  type ApiOperationIR,
  apiStatusContext,
  deriveAggregateOperations,
  findValidatesRequest,
  servedOperations,
} from "../../ir/util/api-surface.js";
import { emitsRestCreate } from "../../ir/util/canonical-lifecycle.js";
import { commandBodyOptional } from "../../ir/util/command-body.js";
import { partsChildrenFirst } from "../../ir/util/containment-parent.js";
import { isMergePatchUpdate } from "../../ir/util/merge-patch.js";
import { sortableFields } from "../../ir/util/sortable-fields.js";
import { lines } from "../../util/code-builder.js";
import { lowerFirst, upperFirst } from "../../util/naming.js";
import { routeSegmentFor } from "../../util/storage-names.js";
import {
  collectUsedEnums,
  collectUsedValueObjects,
  emitResponseDtoSchema,
  emitWireSchema,
  honoPath,
  preconditionsAsInvariants,
  problemResponseLines,
  wireDefaultLiteral,
  zodFor,
  zodForResponse,
} from "../hono/shared/routes-builder.js";
import { labelField, specForType, wireSpecs } from "./shape.js";

/** The wire rules a mock request schema keeps: the single-field bounds the
 *  node backend folds into each field's own zod chain (so the published
 *  `minLength` / `pattern` agree).  A cross-field rule is the domain's, and
 *  the mock runs no domain rule. */
export function singleFieldRules(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): InvariantIR[] {
  return invariants.filter((inv) => !inv.message && takeSingleFieldChain(inv, { available }));
}

/** The value-object and enum schemas a router file declares. */
function valueSchemaLines(
  agg: EnrichedAggregateIR,
  repo: RepositoryIR | undefined,
  ctx: EnrichedBoundedContextIR,
): string[] {
  const out: string[] = [];
  for (const e of collectUsedEnums(agg, repo, ctx)) {
    out.push(
      `const ${e.name}Schema = z.enum([${e.values.map((v) => JSON.stringify(v)).join(", ")}]).openapi("${e.name}");`,
    );
  }
  for (const vo of collectUsedValueObjects(agg, repo, ctx)) {
    const names = new Set(vo.fields.map((f) => f.name));
    out.push(
      ...emitWireSchema(
        `const ${vo.name}Schema`,
        vo.name,
        vo.fields.map((f) => ({ name: f.name, base: zodFor(f.type) })),
        singleFieldRules(vo.invariants, names),
        names,
      ),
    );
  }
  return out;
}

interface CreateField {
  name: string;
  type: TypeIR;
  default?: ExprIR;
}

function createFields(agg: EnrichedAggregateIR): CreateField[] {
  const esCreate = agg.persistedAs === "eventLog" ? agg.creates?.[0] : undefined;
  return esCreate
    ? esCreate.params.map((p) => ({ name: p.name, type: p.type }))
    : createInputFields(agg).map((f) => ({
        name: f.name,
        type: f.type,
        default: wireCreateDefault(f),
      }));
}

function createRequestLines(agg: EnrichedAggregateIR, reqName: string): string[] {
  const fields = createFields(agg);
  const names = new Set(fields.map((f) => f.name));
  return [
    ...emitWireSchema(
      `const ${reqName}`,
      reqName,
      fields.map((f) => {
        const d = f.default;
        const serverSourced = d !== undefined && isServerSourcedDefault(d);
        const info = wireTypeInfo(f.type, "request");
        const plainBool =
          info.refKind === "primitive" &&
          info.primitive === "bool" &&
          !info.isNullable &&
          !info.isCollection;
        return {
          name: f.name,
          base:
            plainBool && d !== undefined && !serverSourced
              ? "z.boolean()"
              : zodFor(f.type, "create-body"),
          default: d && !serverSourced ? wireDefaultLiteral(f.type, d) : undefined,
          optional: serverSourced || undefined,
        };
      }),
      singleFieldRules(agg.invariants, names),
      names,
    ),
    `const Create${agg.name}Response = z.object({ id: z.string() }).openapi("Create${agg.name}Response");`,
  ];
}

function operationRequestLines(
  agg: EnrichedAggregateIR,
  op: OperationIR,
  reqName: string,
): string[] {
  const mergePatch = isMergePatchUpdate(op);
  const names = new Set(op.params.map((p) => p.name));
  return emitWireSchema(
    `const ${reqName}`,
    reqName,
    op.params.map((p) => ({
      name: p.name,
      base: zodFor(p.type),
      optional: mergePatch && p.type.kind !== "optional",
    })),
    singleFieldRules([...agg.invariants, ...preconditionsAsInvariants(op)], names),
    names,
    "server-only",
    mergePatch,
  );
}

function findQueryLines(agg: EnrichedAggregateIR, find: FindIR): string[] {
  const paged = pagedReturn(find.returnType);
  return [
    `const ${upperFirst(find.name)}Query = z.object({`,
    ...find.params.map((p) => `  ${p.name}: ${zodFor(p.type, "query")},`),
    ...(paged
      ? [
          `  page: z.coerce.number().int().min(1).max(${PAGED_MAX_PAGE}).default(${PAGED_DEFAULT_PAGE}),`,
          `  pageSize: z.coerce.number().int().min(1).max(${PAGED_MAX_PAGE_SIZE}).default(${PAGED_DEFAULT_PAGE_SIZE}),`,
          `  sort: z.enum([${[...sortableFields(agg), ""].map((f) => JSON.stringify(f)).join(", ")}]).default("id"),`,
          `  dir: z.string().default("asc"),`,
        ]
      : []),
    `}).openapi("${upperFirst(find.name)}Query");`,
  ];
}

/** The `createRoute({...})` head every route shares, up to `responses`. */
function routeHead(
  entry: ApiOperationIR,
  tag: string,
  operationId: string,
  request: string[],
): string[] {
  return [
    "  app.openapi(",
    "    createRoute({",
    `      method: "${entry.method}",`,
    `      path: "${honoPath(entry)}",`,
    `      tags: ["${tag}"],`,
    `      operationId: "${operationId}",`,
    ...request,
    "      responses: {",
  ];
}

/** The `If-Match` precondition lines of a write whose contract reads it. */
function ifMatchLines(agg: string, token: string, pad: string): string[] {
  return [
    `${pad}const expected = parseIfMatch(c.req.header("if-match"), row.${token} as number);`,
    `${pad}if (expected !== row.${token}) return versionConflict(c, ${JSON.stringify(agg)}, id);`,
  ];
}

/** Which names the router file's body reads from `./problem-details`. */
function problemImports(body: string): string[] {
  return [
    "ProblemDetails",
    "UuidString",
    "newApp",
    "parseIfMatch",
    "requireJsonContentType",
    "versionETag",
  ].filter((n) => n === "newApp" || new RegExp(`\\b${n}\\b`).test(body));
}

/** Which helpers the router file's body reads from `./mock-runtime`. */
function runtimeImports(body: string): string[] {
  return ["filterRows", "notFound", "notImplemented", "pageOf", "sample", "versionConflict"].filter(
    (n) => new RegExp(`\\b${n}\\(`).test(body),
  );
}

export interface MockAggregateRouter {
  /** `http/<agg>.routes.ts`. */
  path: string;
  content: string;
  /** The exported router factory and the segment it mounts under. */
  fn: string;
  segment: string;
}

/** One aggregate's router file. */
export function buildMockRoutesFile(
  agg: EnrichedAggregateIR,
  repo: RepositoryIR | undefined,
  ctx: EnrichedBoundedContextIR,
): MockAggregateRouter {
  const tag = routeSegmentFor(agg.name);
  const A = JSON.stringify(agg.name);
  const reqNameFor = requestComponentNamer(ctx);
  const ops = servedOperations(deriveAggregateOperations(agg, repo, apiStatusContext(ctx)));
  const create = emitsRestCreate(agg) ? ops.find((o) => o.kind === "create") : undefined;
  const getById = ops.find((o) => o.kind === "getById");
  const destroy = ops.find((o) => o.kind === "destroy");
  const opEntries = ops.filter((o) => o.kind === "operation" || o.kind === "gateProbe");
  const findEntries = ops.filter((o) => o.kind === "find" && o.find);
  const token = agg.fields.find((f) => f.access === "token")?.name;
  const opVersionReads = readsIfMatch(operationVersionCheck(agg));

  const schemas: string[] = [...valueSchemaLines(agg, repo, ctx), ""];
  if (create) {
    schemas.push(...createRequestLines(agg, reqNameFor({ kind: "create", aggregate: agg.name })));
  }
  for (const op of agg.operations.filter((o) => o.visibility === "public")) {
    schemas.push(
      ...operationRequestLines(
        agg,
        op,
        reqNameFor({ kind: "operation", aggregate: agg.name, operation: op.name }),
      ),
    );
  }
  for (const entry of findEntries) {
    if (!entry.find!.synthesized && findValidatesRequest(entry.find!))
      schemas.push(...findQueryLines(agg, entry.find!));
  }
  for (const part of partsChildrenFirst(agg.parts))
    schemas.push(...emitResponseDtoSchema(part, ctx));
  schemas.push(...emitResponseDtoSchema(agg, ctx));
  schemas.push(
    `export const ${SCHEMA_NAMES.listResponse(agg.name)} = z.array(${agg.name}Response).openapi("${SCHEMA_NAMES.listResponse(agg.name)}");`,
  );
  const pagedSeen = new Set<string>();
  for (const entry of findEntries) {
    const paged = pagedReturn(entry.find!.returnType);
    if (!paged || pagedSeen.has(paged.name)) continue;
    pagedSeen.add(paged.name);
    schemas.push(
      `export const ${paged.name} = z.object({ items: z.array(${zodForResponse(paged.arg, false)}), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("${paged.name}");`,
    );
  }
  const fields = wireSpecs(ctx, agg, true);
  const label = labelField(fields);
  const display = fields.some((f) => f.n === "display" && f.t.k === "text");
  schemas.push(
    "",
    `/** The store's description of a ${agg.name} row. */`,
    `export const ${agg.name}Model: AggregateModel = {`,
    `  name: ${A},`,
    `  schema: ${agg.name}Response,`,
    `  fields: ${JSON.stringify(fields)},`,
    ...(token ? [`  token: ${JSON.stringify(token)},`] : []),
    ...(display ? ["  display: true,"] : []),
    ...(display && label ? [`  label: ${JSON.stringify(label)},`] : []),
    "};",
  );

  const routes: string[] = [];
  if (create) {
    const reqName = reqNameFor({ kind: "create", aggregate: agg.name });
    routes.push(
      ...routeHead(create, tag, camelId(opCreate(agg.name)), [
        "      request: {",
        `        body: { content: { "application/json": { schema: ${reqName} } }${commandBodyOptional(createInputFields(agg)) ? ", required: false" : ""} },`,
        "      },",
      ]),
      `        201: { description: "Created", content: { "application/json": { schema: Create${agg.name}Response } } },`,
      ...problemResponseLines(create, "        "),
      "      },",
      "    }),",
      "    async (c) => {",
      "      requireJsonContentType(c);",
      `      const row = store.create(${A}, c.req.valid("json") as Record<string, unknown>);`,
      "      return c.json({ id: row.id as string }, 201);",
      "    },",
      "  );",
      "",
    );
  }
  if (getById) {
    routes.push(
      ...routeHead(getById, tag, camelId(opGetById(agg.name)), [
        "      request: { params: z.object({ id: UuidString }) },",
      ]),
      `        200: { description: "OK", content: { "application/json": { schema: ${agg.name}Response } } },`,
      ...problemResponseLines(getById, "        "),
      "      },",
      "    }),",
      "    async (c) => {",
      '      const { id } = c.req.valid("param");',
      `      const row = store.get(${A}, id);`,
      `      if (!row) return notFound(c, ${A}, id);`,
      ...(opVersionReads && token
        ? [`      c.header("etag", versionETag(row.${token} as number));`]
        : []),
      `      return c.json(row as z.infer<typeof ${agg.name}Response>, 200);`,
      "    },",
      "  );",
      "",
    );
  }
  if (destroy) {
    const destroyIfMatch = readsIfMatch(destroyVersionCheck(agg)) && token;
    routes.push(
      ...routeHead(destroy, tag, camelId(opDestroy(agg.name)), [
        "      request: { params: z.object({ id: UuidString }) },",
      ]),
      `        204: { description: "No Content" },`,
      ...problemResponseLines(destroy, "        "),
      "      },",
      "    }),",
      "    async (c) => {",
      '      const { id } = c.req.valid("param");',
      `      const row = store.get(${A}, id);`,
      `      if (!row) return notFound(c, ${A}, id);`,
      ...(destroyIfMatch ? ifMatchLines(agg.name, token, "      ") : []),
      `      store.remove(${A}, id);`,
      "      return c.body(null, 204);",
      "    },",
      "  );",
      "",
    );
  }
  for (const entry of opEntries) {
    const op = entry.operation!;
    if (entry.kind === "gateProbe") {
      routes.push(
        ...routeHead(entry, tag, camelId(opOperation(agg.name, `can_${op.name}`)), [
          "      request: {",
          "        params: z.object({ id: UuidString }),",
          "      },",
        ]),
        '        200: { description: "OK", content: { "application/json": { schema: z.object({ allowed: z.boolean() }) } } },',
        ...problemResponseLines(entry, "        "),
        "      },",
        "    }),",
        "    async (c) => {",
        '      const { id } = c.req.valid("param");',
        `      if (!store.get(${A}, id)) return notFound(c, ${A}, id);`,
        "      // Permissions are not simulated: every caller may.",
        "      return c.json({ allowed: true }, 200);",
        "    },",
        "  );",
        "",
      );
      continue;
    }
    const reqName = reqNameFor({ kind: "operation", aggregate: agg.name, operation: op.name });
    const returnsUnion = op.returnType?.kind === "union";
    const returns = op.returnType !== undefined && !op.extern;
    const successSchema =
      returns && !returnsUnion ? zodForResponse(op.returnType!, false) : "z.unknown()";
    const versionReads = readsIfMatch(operationVersionCheck(agg, op)) && token;
    routes.push(
      ...routeHead(entry, tag, camelId(opOperation(agg.name, op.name)), [
        "      request: {",
        "        params: z.object({ id: UuidString }),",
        `        body: { content: { "application/json": { schema: ${reqName} } }${commandBodyOptional(op.params) ? ", required: false" : ""} },`,
        "      },",
      ]),
      returns
        ? `        200: { description: "OK", content: { "application/json": { schema: ${successSchema} } } },`
        : `        204: { description: "No content" },`,
      ...problemResponseLines(entry, "        "),
      "      },",
      "    }),",
      "    async (c) => {",
      '      const { id } = c.req.valid("param");',
      "      requireJsonContentType(c);",
      '      const body = c.req.valid("json") as Record<string, unknown>;',
      `      const row = store.get(${A}, id);`,
      `      if (!row) return notFound(c, ${A}, id);`,
      ...(versionReads ? ifMatchLines(agg.name, token, "      ") : []),
      ...(isMergePatchUpdate(op)
        ? [`      store.merge(${A}, row, body);`]
        : [
            "      // The operation's rules and effects are not simulated: the row is unchanged.",
            "      void body;",
          ]),
      ...(returnsUnion
        ? [
            `      return notImplemented(c, ${JSON.stringify(`the result of ${agg.name}.${op.name}`)});`,
          ]
        : returns
          ? [
              `      return c.json(sample(${successSchema}, ${JSON.stringify(specForType(op.returnType!, ctx))}, ${JSON.stringify(`${agg.name}.${op.name}`)}) as never, 200);`,
            ]
          : ["      return c.body(null, 204);"]),
      "    },",
      "  );",
      "",
    );
  }
  for (const entry of findEntries) {
    const find = entry.find!;
    const paged = pagedReturn(find.returnType);
    const isList = find.returnType.kind === "array";
    const responseSchema = paged
      ? paged.name
      : isList
        ? SCHEMA_NAMES.listResponse(agg.name)
        : `${agg.name}Response`;
    const hasQuery = findValidatesRequest(find);
    const answer = paged
      ? `      return c.json(pageOf(filterRows(store.rows(${A}), q), q) as z.infer<typeof ${responseSchema}>, 200);`
      : isList
        ? `      return c.json(filterRows(store.rows(${A}), q) as z.infer<typeof ${responseSchema}>, 200);`
        : undefined;
    routes.push(
      ...routeHead(
        entry,
        tag,
        camelId(opFind(agg.name, find.name)),
        hasQuery ? [`      request: { query: ${upperFirst(find.name)}Query },`] : [],
      ),
      `        200: { description: "OK", content: { "application/json": { schema: ${responseSchema} } } },`,
      ...problemResponseLines(entry, "        "),
      "      },",
      "    }),",
      "    async (c) => {",
      hasQuery
        ? '      const q = c.req.valid("query") as Record<string, unknown> & { page: number; pageSize: number; sort?: string; dir?: string };'
        : "      const q = { page: 1, pageSize: Number.MAX_SAFE_INTEGER };",
      ...(answer !== undefined
        ? [answer]
        : [
            `      const row = filterRows(store.rows(${A}), q)[0];`,
            `      if (!row) return notFound(c, ${A}, ${JSON.stringify(find.name)});`,
            `      return c.json(row as z.infer<typeof ${responseSchema}>, 200);`,
          ]),
      "    },",
      "  );",
      "",
    );
  }

  const fn = `${lowerFirst(agg.name)}Routes`;
  const body = [
    ...schemas,
    "",
    `export function ${fn}(store: MockStore): OpenAPIHono {`,
    "  const app = newApp();",
    "",
    ...routes,
    "  return app;",
    "}",
  ].join("\n");
  const runtime = runtimeImports(body);
  const money = /\bmoneySchema\b/.test(body);
  const decimal = /\bDecimal\b/.test(body);
  const content = lines(
    "// Auto-generated by Loom: the mock target.  Do not edit by hand.",
    ...(decimal ? ['import Decimal from "decimal.js";'] : []),
    ...(money ? ['import { moneySchema } from "../lib/schemas";'] : []),
    'import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";',
    `import { ${problemImports(body).join(", ")} } from "./problem-details";`,
    `import { type AggregateModel, type MockStore${runtime.map((n) => `, ${n}`).join("")} } from "./mock-runtime";`,
    "",
    body,
    "",
  );
  return { path: `http/${lowerFirst(agg.name)}.routes.ts`, content, fn, segment: tag };
}
