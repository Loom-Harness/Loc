// ---------------------------------------------------------------------------
// The mock's routers beyond the aggregates: explicit api routes to command /
// query handlers, workflow start and instance routes, projection reads, and
// the auth session routes a frontend signs in through.
//
// Paths, methods, operationIds, request schemas and declared statuses follow
// the node backend's builders.  A handler's answer is a stored row where the
// route reads one aggregate, else a generated value valid for the declared
// response; a command changes nothing.
// ---------------------------------------------------------------------------

import { requestComponentNamer } from "../../generator/_openapi/request-component-names.js";
import {
  camelId,
  opHandler,
  opProjection,
  opProjectionGet,
  opProjectionList,
  opWorkflow,
  opWorkflowInstanceById,
  opWorkflowInstances,
  SCHEMA_NAMES,
} from "../../generator/_symbols/plan.js";
import { projectionQueryParams } from "../../ir/plan/projection-params.js";
import { commandCreateReturnsSelf } from "../../ir/plan/workflow-result.js";
import { workflowRouteErrorStatuses } from "../../ir/plan/workflow-route-status.js";
import {
  PAGED_DEFAULT_PAGE,
  PAGED_DEFAULT_PAGE_SIZE,
  PAGED_MAX_PAGE,
  PAGED_MAX_PAGE_SIZE,
  pagedReturn,
} from "../../ir/stdlib/generics.js";
import {
  type CommandHandlerIR,
  type EnrichedBoundedContextIR,
  type ExprIR,
  isMaterializedProjection,
  isQueryTimeProjection,
  type QueryHandlerIR,
  type RouteIR,
  type SystemIR,
  type TypeIR,
} from "../../ir/types/loom-ir.js";
import { peelCollection, peelNullable, wireTypeInfo } from "../../ir/types/wire-types.js";
import { normalizeHandlerReturn, requestRecordFor } from "../../ir/util/handler-contracts.js";
import {
  pagedRunArgs,
  pagedRunFindName,
  pagedRunSortDefault,
  pagedRunStmt,
  requirePagedRunStmt,
} from "../../ir/util/paged-run.js";
import { projectionReadShape } from "../../ir/util/projection-read.js";
import { enumPool, valueObjectPool } from "../../ir/util/reachable-types.js";
import { routedParamSource } from "../../ir/util/routed-handler.js";
import { reasonPhrase, wireStatus } from "../../ir/util/wire-policy.js";
import { commandCreateResult, emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { lines } from "../../util/code-builder.js";
import { lowerFirst, snake, upperFirst } from "../../util/naming.js";
import {
  RETURN_TO_PARAM,
  RETURN_TO_PATH_PATTERN,
  RETURN_TO_URL_PATTERN,
} from "../../util/return-to.js";
import {
  pathParamZod,
  routedProblemResponseLines,
} from "../hono/shared/explicit-handlers-builder.js";
import { emitWireSchema, zodFor, zodForResponse } from "../hono/shared/routes-builder.js";
import {
  emitInstanceResponseSchemas,
  zodForWorkflowParam,
} from "../hono/shared/workflow-builder.js";
import { singleFieldRules } from "./aggregate-routes.js";
import { specForType } from "./shape.js";

type Handler = CommandHandlerIR | QueryHandlerIR;

/** A router file and the factory it exports. */
export interface MockRouterFile {
  path: string;
  content: string;
  fn: string;
}

/** The schema declarations a router body names but does not declare: the
 *  `<Vo>Schema` / `<Enum>Schema` value schemas and the `<Entity>Response`
 *  rows, each emitted (or imported, for an aggregate's or part's response,
 *  from its router) before anything that reads it. */
function scopeFor(
  body: string,
  ctx: EnrichedBoundedContextIR,
): { decls: string[]; imports: Map<string, Set<string>> } {
  const decls: string[] = [];
  const imports = new Map<string, Set<string>>();
  const done = new Set<string>();
  const vos = valueObjectPool(ctx);
  const enums = enumPool(ctx);
  const ownerOf = (name: string): string | undefined =>
    ctx.aggregates.find((a) => a.name === name || a.parts.some((p) => p.name === name))?.name;
  const refsIn = (text: string): string[] => [
    ...new Set([...text.matchAll(/\b([A-Z][A-Za-z0-9_]*)(Schema|Response)\b/g)].map((m) => m[0])),
  ];
  const need = (ref: string): void => {
    if (done.has(ref)) return;
    done.add(ref);
    const isSchema = ref.endsWith("Schema");
    const name = ref.slice(0, isSchema ? -"Schema".length : -"Response".length);
    let decl: string[] = [];
    if (isSchema) {
      const e = enums.find((x) => x.name === name);
      const vo = vos.find((x) => x.name === name);
      if (e) {
        decl = [
          `const ${ref} = z.enum([${e.values.map((v) => JSON.stringify(v)).join(", ")}]).openapi("${name}");`,
        ];
      } else if (vo) {
        const names = new Set(vo.fields.map((f) => f.name));
        decl = emitWireSchema(
          `const ${ref}`,
          name,
          vo.fields.map((f) => ({ name: f.name, base: zodFor(f.type) })),
          singleFieldRules(vo.invariants, names),
          names,
        );
      }
    } else {
      const owner = ownerOf(name);
      if (owner) {
        const module = `./${lowerFirst(owner)}.routes`;
        imports.set(module, new Set([...(imports.get(module) ?? []), ref]));
        return;
      }
      const record = ctx.payloads.find((p) => p.name === name && !p.variants);
      if (record) {
        decl = [
          `const ${ref} = z.object({`,
          ...record.fields.map((f) => `  ${f.name}: ${zodForResponse(f.type, f.optional)},`),
          `}).openapi("${ref}");`,
        ];
      }
    }
    for (const r of refsIn(decl.join("\n"))) if (r !== ref) need(r);
    decls.push(...decl);
  };
  for (const r of refsIn(body)) need(r);
  return { decls, imports };
}

/** Assemble a router file: the scope its body needs, then the body. */
function routerFile(
  path: string,
  fn: string,
  ctx: EnrichedBoundedContextIR,
  preamble: string[],
  routes: string[],
): MockRouterFile {
  const body = [
    ...preamble,
    "",
    `export function ${fn}(store: MockStore): OpenAPIHono {`,
    "  const app = newApp();",
    "  void store;",
    "",
    ...routes,
    "  return app;",
    "}",
  ].join("\n");
  const { decls, imports } = scopeFor(body, ctx);
  const full = [...decls, body].join("\n");
  const problem = ["ProblemDetails", "UuidString", "newApp", "requireJsonContentType"].filter(
    (n) => n === "newApp" || new RegExp(`\\b${n}\\b`).test(full),
  );
  const runtime = [
    "filterRows",
    "notFound",
    "notImplemented",
    "pageOf",
    "sample",
    "sampleMany",
  ].filter((n) => new RegExp(`\\b${n}\\(`).test(full));
  const content = lines(
    "// Auto-generated by Loom: the mock target.  Do not edit by hand.",
    ...(/\bmoneySchema\b/.test(full) ? ['import { moneySchema } from "../lib/schemas";'] : []),
    'import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";',
    `import { ${problem.join(", ")} } from "./problem-details";`,
    `import { type MockStore${runtime.map((n) => `, ${n}`).join("")} } from "./mock-runtime";`,
    ...[...imports].map(([m, names]) => `import { ${[...names].sort().join(", ")} } from "${m}";`),
    "",
    full,
    "",
  );
  return { path, content, fn };
}

/** The aggregate (and whether a list of it) a handler's return reads, when it
 *  reads one: the route then answers stored rows. */
function returnAggregate(
  t: TypeIR | undefined,
  ctx: EnrichedBoundedContextIR,
): { agg: string; many: boolean; optional: boolean } | undefined {
  const norm = normalizeHandlerReturn(t, ctx);
  if (!norm || norm.kind === "union" || norm.kind === "genericInstance") return undefined;
  const info = wireTypeInfo(norm, "response");
  if (info.refKind !== "entity") return undefined;
  if (!ctx.aggregates.some((a) => a.name === info.base)) return undefined;
  return { agg: info.base, many: info.isCollection, optional: info.isNullable };
}

/** The answer lines of a route whose declared result is `t`: stored rows when
 *  it reads an aggregate, else a generated value valid for `schema`. */
function answerLines(
  t: TypeIR,
  ctx: EnrichedBoundedContextIR,
  schema: string,
  key: string,
  status: number,
  input: string,
): string[] {
  const read = returnAggregate(t, ctx);
  if (read) {
    const A = JSON.stringify(read.agg);
    if (read.many)
      return [`    return c.json(filterRows(store.rows(${A}), ${input}) as never, ${status});`];
    return [
      `    const row = filterRows(store.rows(${A}), ${input})[0];`,
      `    if (!row) return notFound(c, ${A}, ${JSON.stringify(key)});`,
      `    return c.json(row as never, ${status});`,
    ];
  }
  return [
    `    return c.json(sample(${schema}, ${JSON.stringify(specForType(t, ctx))}, ${JSON.stringify(key)}) as never, ${status});`,
  ];
}

function findHandler(ctx: EnrichedBoundedContextIR, name: string): Handler | undefined {
  return (
    (ctx.commandHandlers ?? []).find((h) => h.name === name) ??
    (ctx.queryHandlers ?? []).find((h) => h.name === name)
  );
}

/** The field a side of an equality reads off the row, when it reads one. */
function rowFieldOf(e: ExprIR): string | undefined {
  if (e.kind === "ref") return e.refKind === "this-prop" ? e.name : undefined;
  if (e.kind === "member") return e.receiver.kind === "this" ? e.member : undefined;
  return undefined;
}

/** \`param -> field\` for every top-level \`field == param\` conjunct of a
 *  read's filter: the equalities the mock can apply to its stored rows. */
function equalityBindings(e: ExprIR | undefined, out: Map<string, string>): Map<string, string> {
  if (e?.kind !== "binary") return out;
  if (e.op === "&&") {
    equalityBindings(e.left, out);
    return equalityBindings(e.right, out);
  }
  if (e.op !== "==") return out;
  for (const [row, other] of [
    [e.left, e.right],
    [e.right, e.left],
  ] as const) {
    const field = rowFieldOf(row);
    if (field !== undefined && other.kind === "ref" && other.refKind === "param")
      out.set(other.name, field);
  }
  return out;
}

/** The criteria object a paged-run route filters its rows by: each handler
 *  param the read's filter compares a row field to, under that field's
 *  name.  Undefined when the read compares none. */
function runCriteria(h: Handler, ctx: EnrichedBoundedContextIR): string | undefined {
  const run = pagedRunStmt(h);
  if (!run) return undefined;
  const find = ctx.repositories
    .find((r) => r.aggregateName === run.aggName)
    ?.finds.find((f) => f.name === pagedRunFindName(run));
  const retrieval =
    run.kind === "repo-run"
      ? (ctx.retrievals ?? []).find((r) => r.name === run.retrievalName)
      : undefined;
  const read = find
    ? { params: find.params, predicate: find.filter }
    : retrieval
      ? { params: retrieval.params, predicate: retrieval.where }
      : undefined;
  if (!read) return undefined;
  const byParam = equalityBindings(read.predicate, new Map());
  const entries: string[] = [];
  pagedRunArgs(run).forEach((arg, i) => {
    const param = read.params[i]?.name;
    const field = param !== undefined ? byParam.get(param) : undefined;
    if (field !== undefined && arg.kind === "ref")
      entries.push(
        `${/^[A-Za-z_$][\w$]*$/.test(field) ? field : JSON.stringify(field)}: input.${arg.name}`,
      );
  });
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : undefined;
}

function pagedRunRoute(
  apiName: string,
  route: RouteIR,
  h: Handler,
  ctx: EnrichedBoundedContextIR,
): string[] {
  const pathNames = new Set([...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
  const pathParams = h.params.filter((p) => pathNames.has(p.name));
  const queryParams = h.params.filter((p) => !pathNames.has(p.name));
  const run = requirePagedRunStmt(h, ctx.name);
  const req: string[] = [];
  if (pathParams.length > 0) {
    req.push(
      `params: z.object({ ${pathParams.map((p) => `${p.name}: ${pathParamZod(p.type, ctx)}`).join(", ")} })`,
    );
  }
  req.push(
    `query: z.object({ ${[
      ...queryParams.map((p) => `${p.name}: ${zodFor(p.type, "query")}`),
      `page: z.coerce.number().int().min(1).max(${PAGED_MAX_PAGE}).default(${PAGED_DEFAULT_PAGE})`,
      `pageSize: z.coerce.number().int().min(1).max(${PAGED_MAX_PAGE_SIZE}).default(${PAGED_DEFAULT_PAGE_SIZE})`,
      `sort: z.string().default(${JSON.stringify(pagedRunSortDefault(h, ctx))})`,
      `dir: z.string().default("asc")`,
    ].join(", ")} })`,
  );
  return [
    "  app.openapi(",
    "    createRoute({",
    `      method: "${route.method.toLowerCase()}",`,
    `      path: "${route.path}",`,
    `      tags: ["${apiName}"],`,
    `      operationId: "${camelId(opHandler(h.name))}",`,
    `      request: { ${req.join(", ")} },`,
    "      responses: {",
    '        200: { description: "OK", content: { "application/json": { schema: z.unknown() } } },',
    ...routedProblemResponseLines(route, h, ctx).map((l) => `  ${l}`),
    "      },",
    "    }),",
    "    async (c) => {",
    `      const query = c.req.valid("query") as Record<string, unknown> & { page: number; pageSize: number; sort?: string; dir?: string };`,
    ...(pathParams.length > 0
      ? [
          '      const input: Record<string, unknown> = { ...query, ...(c.req.valid("param") as Record<string, unknown>) };',
        ]
      : ["      const input: Record<string, unknown> = query;"]),
    `      return c.json(pageOf(filterRows(store.rows(${JSON.stringify(run.aggName)}), ${runCriteria(h, ctx) ?? "input"}), query), 200);`,
    "    },",
    "  );",
    "",
  ];
}

function routedHandlerRoute(
  apiName: string,
  route: RouteIR,
  h: Handler,
  ctx: EnrichedBoundedContextIR,
): string[] {
  const slots: { name: string; type: TypeIR; source: "path" | "query" | "body" }[] = [];
  for (const p of h.params) {
    const rec = requestRecordFor(p.type, ctx);
    const add = (name: string, type: TypeIR): void => {
      slots.push({ name, type, source: routedParamSource(name, route, false) });
    };
    if (rec) for (const f of rec.fields) add(f.name, f.type);
    else add(p.name, p.type);
  }
  const pathSlots = slots.filter((s) => s.source === "path");
  const querySlots = slots.filter((s) => s.source === "query");
  const bodySlots = slots.filter((s) => s.source === "body");
  const req: string[] = [];
  if (pathSlots.length > 0)
    req.push(
      `params: z.object({ ${pathSlots.map((s) => `${s.name}: ${pathParamZod(s.type, ctx)}`).join(", ")} })`,
    );
  if (querySlots.length > 0)
    req.push(
      `query: z.object({ ${querySlots.map((s) => `${s.name}: ${pathParamZod(s.type, ctx)}`).join(", ")} })`,
    );
  if (bodySlots.length > 0) {
    req.push(
      `body: { content: { "application/json": { schema: z.object({ ${bodySlots.map((s) => `${s.name}: ${zodFor(s.type)}`).join(", ")} }) } } }`,
    );
  }
  const hasReturn = h.extern ? !!h.returnType : !!h.returnValue;
  const union = h.returnType?.kind === "union";
  const read = hasReturn && !union ? returnAggregate(h.returnType, ctx) : undefined;
  const typed = read && !read.many ? `${read.agg}Response` : undefined;
  const sampleSchema =
    hasReturn && !union && h.returnType && !read ? zodForResponse(h.returnType, false) : undefined;
  const input = [
    ...(pathSlots.length > 0 ? ['...c.req.valid("param")'] : []),
    ...(querySlots.length > 0 ? ['...c.req.valid("query")'] : []),
    ...(bodySlots.length > 0 ? ['...(c.req.valid("json") as Record<string, unknown>)'] : []),
  ];
  return [
    "  app.openapi(",
    "    createRoute({",
    `      method: "${route.method.toLowerCase()}",`,
    `      path: "${route.path}",`,
    `      tags: ["${apiName}"],`,
    `      operationId: "${camelId(opHandler(h.name))}",`,
    ...(req.length > 0 ? [`      request: { ${req.join(", ")} },`] : []),
    "      responses: {",
    hasReturn
      ? `        200: { description: "OK", content: { "application/json": { schema: ${typed ?? "z.unknown()"} } } },`
      : '        204: { description: "No content" },',
    ...routedProblemResponseLines(route, h, ctx).map((l) => `  ${l}`),
    "      },",
    "    }),",
    "    async (c) => {",
    ...(bodySlots.length > 0 ? ["      requireJsonContentType(c);"] : []),
    `      const input: Record<string, unknown> = { ${input.join(", ")} };`,
    ...(union
      ? [
          `      void input;`,
          `      return notImplemented(c, ${JSON.stringify(`the result of ${h.name}`)});`,
        ]
      : hasReturn && h.returnType
        ? answerLines(
            h.returnType,
            ctx,
            sampleSchema ?? "z.unknown()",
            h.name,
            200,
            runCriteria(h, ctx) ?? "input",
          ).map((l) => `  ${l}`)
        : [
            "      // The handler's effects are not simulated.",
            "      void input;",
            "      return c.body(null, 204);",
          ]),
    "    },",
    "  );",
    "",
  ];
}

/** `http/<api>-routes.ts` — an api's explicit `route` bindings. */
export function buildMockExplicitRoutesFile(
  apiName: string,
  routes: readonly RouteIR[],
  ctx: EnrichedBoundedContextIR,
): MockRouterFile | undefined {
  const blocks: string[] = [];
  for (const r of routes) {
    const h = findHandler(ctx, r.target.handler);
    if (!h) continue;
    blocks.push(
      ...(!h.extern && h.returnType && pagedReturn(h.returnType)
        ? pagedRunRoute(apiName, r, h, ctx)
        : routedHandlerRoute(apiName, r, h, ctx)),
    );
  }
  if (blocks.length === 0) return undefined;
  const slug = lowerFirst(apiName);
  return routerFile(`http/${slug}-routes.ts`, `${slug}Routes`, ctx, [], blocks);
}

/** `http/workflows.ts` — each workflow's start route and, for an observable
 *  workflow, its instance reads (always empty: no workflow runs here). */
export function buildMockWorkflowsFile(ctx: EnrichedBoundedContextIR): MockRouterFile | undefined {
  const reqNameFor = requestComponentNamer(ctx);
  const preamble: string[] = [];
  const routes: string[] = [];
  const notFound = wireStatus("not-found", ctx.structuralErrorStatuses);
  const invalid = wireStatus("field-invalid");
  for (const wf of ctx.workflows) {
    if (wf.instanceWireShape) preamble.push(...emitInstanceResponseSchemas(wf));
    if (emitsCommandRoute(wf)) {
      const reqName = reqNameFor({ kind: "workflow", workflow: wf.name });
      preamble.push(
        `const ${reqName} = z.object({`,
        ...wf.params.map((p) => `  ${p.name}: ${zodForWorkflowParam(p.type, ctx)},`),
        `}).openapi("${reqName}");`,
      );
      const result = commandCreateResult(wf);
      const union = result?.type.kind === "union";
      const self = !!result && commandCreateReturnsSelf(wf);
      const schema = !result
        ? undefined
        : union
          ? "z.unknown()"
          : self
            ? SCHEMA_NAMES.instanceResponse(wf.name)
            : zodForResponse(result.type, false);
      const key = `workflow:${wf.name}`;
      routes.push(
        "  app.openapi(",
        "    createRoute({",
        '      method: "post",',
        `      path: "/${snake(wf.name)}",`,
        '      tags: ["workflows"],',
        `      operationId: "${camelId(opWorkflow(wf.name))}",`,
        "      request: {",
        `        body: { content: { "application/json": { schema: ${reqName} } }${wf.params.length === 0 ? ", required: false" : ""} },`,
        "      },",
        "      responses: {",
        schema
          ? `        200: { description: "OK", content: { "application/json": { schema: ${schema} } } },`
          : '        204: { description: "No content" },',
        ...workflowRouteErrorStatuses(wf, ctx).map(
          (s) =>
            `        ${s}: { description: ${JSON.stringify(reasonPhrase(s))}, content: { "application/problem+json": { schema: ProblemDetails } } },`,
        ),
        "      },",
        "    }),",
        "    async (c) => {",
        "      requireJsonContentType(c);",
        '      void c.req.valid("json");',
        "      // The workflow's steps are not simulated.",
        ...(!result || !schema
          ? ["      return c.body(null, 204);"]
          : union
            ? [
                `      return notImplemented(c, ${JSON.stringify(`the result of workflow ${wf.name}`)});`,
              ]
            : [
                `      return c.json(sample(${schema}, ${JSON.stringify(self ? { k: "obj", f: (wf.instanceWireShape ?? []).map((f) => ({ n: f.name, t: f.source === "id" ? { k: "guid" } : specForType(f.type, ctx) })) } : specForType(result.type, ctx))}, ${JSON.stringify(key)}) as never, 200);`,
              ]),
        "    },",
        "  );",
        "",
      );
    }
    if (wf.instanceWireShape) {
      const slug = snake(wf.name);
      routes.push(
        "  app.openapi(",
        "    createRoute({",
        '      method: "get",',
        `      path: "/${slug}/instances",`,
        '      tags: ["workflows"],',
        `      operationId: "${camelId(opWorkflowInstances(wf.name))}",`,
        "      responses: {",
        `        200: { description: "OK", content: { "application/json": { schema: ${SCHEMA_NAMES.instanceListResponse(wf.name)} } } },`,
        "      },",
        "    }),",
        "    // No workflow runs here, so none has an instance.",
        "    async (c) => c.json([], 200),",
        "  );",
        "",
        "  app.openapi(",
        "    createRoute({",
        '      method: "get",',
        `      path: "/${slug}/instances/{id}",`,
        '      tags: ["workflows"],',
        `      operationId: "${camelId(opWorkflowInstanceById(wf.name))}",`,
        "      request: { params: z.object({ id: UuidString }) },",
        "      responses: {",
        `        200: { description: "OK", content: { "application/json": { schema: ${SCHEMA_NAMES.instanceResponse(wf.name)} } } },`,
        `        ${notFound}: { description: ${JSON.stringify(reasonPhrase(notFound))}, content: { "application/problem+json": { schema: ProblemDetails } } },`,
        `        ${invalid}: { description: ${JSON.stringify(reasonPhrase(invalid))}, content: { "application/problem+json": { schema: ProblemDetails } } },`,
        "      },",
        "    }),",
        `    async (c) => notFound(c, ${JSON.stringify(upperFirst(wf.name))}, c.req.valid("param").id),`,
        "  );",
        "",
      );
    }
  }
  if (routes.length === 0) return undefined;
  return routerFile("http/workflows.ts", "workflowsRoutes", ctx, preamble, routes);
}

/** `http/projections.ts` — each projection's read, answering generated rows
 *  of its declared shape. */
export function buildMockProjectionsFile(
  ctx: EnrichedBoundedContextIR,
): MockRouterFile | undefined {
  const preamble: string[] = [];
  const routes: string[] = [];
  for (const p of ctx.projections) {
    const T = upperFirst(p.name);
    const slug = snake(p.name);
    const shape = p.wireShape ?? [];
    preamble.push(
      `const ${T}Row = z.object({`,
      ...shape.map(
        (f) =>
          `  ${f.name}: ${f.source === "id" ? "z.string()" : zodForResponse(f.type, f.optional)},`,
      ),
      `}).openapi("${T}Row");`,
    );
    const rowSpec = JSON.stringify({
      k: "obj",
      f: shape.map((f) => ({
        n: f.name,
        t: f.source === "id" ? { k: "guid" } : specForType(f.type, ctx),
      })),
    });
    const key = `projection:${p.name}`;
    if (isQueryTimeProjection(p)) {
      const one = projectionReadShape(p) === "one";
      preamble.push(
        one
          ? `const ${T}Response = ${T}Row.openapi("${T}Response");`
          : `const ${T}Response = z.array(${T}Row).openapi("${T}Response");`,
      );
      const params = projectionQueryParams(p, ctx);
      if (params.length > 0) {
        preamble.push(
          `const ${T}Query = z.object({`,
          ...params.map((q) => `  ${q.name}: ${zodFor(q.type, "query")},`),
          `}).openapi("${T}Query");`,
        );
      }
      routes.push(
        "  app.openapi(",
        "    createRoute({",
        '      method: "get",',
        `      path: "/${slug}",`,
        `      tags: ["projections"],`,
        `      operationId: "${camelId(opProjection(T))}",`,
        ...(params.length > 0 ? [`      request: { query: ${T}Query },`] : []),
        "      responses: {",
        `        200: { description: "OK", content: { "application/json": { schema: ${T}Response } } },`,
        "      },",
        "    }),",
        one
          ? `    async (c) => c.json(sample(${T}Row, ${rowSpec}, ${JSON.stringify(key)}) as never, 200),`
          : `    async (c) => c.json(sampleMany(${T}Row, ${rowSpec}, ${JSON.stringify(key)}, 5) as never, 200),`,
        "  );",
        "",
      );
    } else if (isMaterializedProjection(p)) {
      preamble.push(
        `const ${T}Response = ${T}Row.openapi("${T}Response");`,
        `const ${SCHEMA_NAMES.listResponse(p.name)} = z.array(${T}Row).openapi("${SCHEMA_NAMES.listResponse(p.name)}");`,
      );
      routes.push(
        "  app.openapi(",
        "    createRoute({",
        '      method: "get",',
        `      path: "/${slug}",`,
        '      tags: ["projections"],',
        `      operationId: "${camelId(opProjectionList(T))}",`,
        `      responses: { 200: { description: "OK", content: { "application/json": { schema: ${SCHEMA_NAMES.listResponse(p.name)} } } } },`,
        "    }),",
        `    async (c) => c.json(sampleMany(${T}Row, ${rowSpec}, ${JSON.stringify(key)}, 5) as never, 200),`,
        "  );",
        "",
        "  app.openapi(",
        "    createRoute({",
        '      method: "get",',
        `      path: "/${slug}/{key}",`,
        '      tags: ["projections"],',
        `      operationId: "${camelId(opProjectionGet(T))}",`,
        "      request: { params: z.object({ key: z.string() }) },",
        `      responses: { 200: { description: "OK", content: { "application/json": { schema: ${T}Response } } } },`,
        "    }),",
        `    async (c) => c.json(sample(${T}Row, ${rowSpec}, \`${key}:\${c.req.valid("param").key}\`) as never, 200),`,
        "  );",
        "",
      );
    }
  }
  if (routes.length === 0) return undefined;
  return routerFile("http/projections.ts", "projectionsRoutes", ctx, preamble, routes);
}

/** A default user's claim value, by the claim's declared type. */
function defaultClaim(name: string, t: TypeIR, permissions: readonly string[]): unknown {
  const info = wireTypeInfo(t, "response");
  if (info.isNullable) return defaultClaim(name, peelNullable(t), permissions);
  if (info.isCollection) {
    return name === "permissions"
      ? [...permissions]
      : [defaultClaim(name, peelCollection(t), permissions)];
  }
  if (info.refKind === "id") return `mock-${name}`;
  if (info.refKind !== "primitive") return null;
  switch (info.primitive) {
    case "int":
    case "long":
    case "decimal":
      return 0;
    case "bool":
      return true;
    case "datetime":
      return "2025-01-01T00:00:00.000Z";
    case "date":
      return "2025-01-01";
    case "guid":
      return "00000000-0000-4000-8000-000000000001";
    default:
      return name === "email" ? "mock.user@example.test" : name === "role" ? "admin" : "mock-user";
  }
}

/** `http/auth.ts` — the session routes a frontend's sign-in gate calls.  The
 *  session is always the one default user, holding every declared
 *  permission. */
export function buildMockAuthFile(sys: SystemIR): string {
  const permissions = sys.subdomains.flatMap((s) => s.permissions.map((p) => p.runtimeString));
  const user: Record<string, unknown> = {};
  for (const f of sys.user?.fields ?? []) user[f.name] = defaultClaim(f.name, f.type, permissions);
  return lines(
    "// Auto-generated by Loom: the mock target.",
    "// There is no identity provider: every request is the one default user.",
    'import { Hono } from "hono";',
    "",
    "/** The signed-in user every session reads.  Edit it to try another role. */",
    `export const DEFAULT_USER = ${JSON.stringify(user, null, 2)};`,
    "",
    `const RETURN_TO_PATH = new RegExp(${JSON.stringify(RETURN_TO_PATH_PATTERN)});`,
    `const RETURN_TO_URL = new RegExp(${JSON.stringify(RETURN_TO_URL_PATTERN)});`,
    "",
    "/** Where sign-in and sign-out return to: a same-origin path, or an absolute",
    " *  URL on the origin the request came from; `/` otherwise. */",
    "function returnTarget(requestUrl: string, value: string | undefined): string {",
    '  if (value === undefined) return "/";',
    "  if (RETURN_TO_PATH.test(value)) return value;",
    "  const m = RETURN_TO_URL.exec(value);",
    '  return m !== null && m[1] === new URL(requestUrl).origin ? value : "/";',
    "}",
    "",
    "export function authRoutes(): Hono {",
    "  const app = new Hono();",
    '  app.get("/me", (c) => c.json(DEFAULT_USER));',
    '  app.post("/refresh", (c) => c.json({ ok: true }));',
    `  app.get("/login", (c) => c.redirect(returnTarget(c.req.url, c.req.query(${JSON.stringify(RETURN_TO_PARAM)}))));`,
    `  app.get("/callback", (c) => c.redirect("/"));`,
    `  app.get("/logout", (c) => c.redirect("/"));`,
    "  return app;",
    "}",
    "",
  );
}
