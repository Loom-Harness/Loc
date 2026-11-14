import { polymorphicReadFor } from "../../../ir/enrich/read-scope.js";
import {
  createInputFields,
  isRequiredCreateInput,
  wireCreateDefault,
} from "../../../ir/enrich/wire-projection.js";
import { routedPolymorphicRead } from "../../../ir/plan/index.js";
import { PAGED_MAX_PAGE, PAGED_MAX_PAGE_SIZE, pagedReturn } from "../../../ir/stdlib/generics.js";
import type {
  AggregateIR,
  DeployableIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EnrichedEntityPartIR,
  EnumIR,
  FieldIR,
  ParamIR,
  PayloadIR,
  RouteIR,
  SystemIR,
  TypeIR,
  ValueObjectIR,
  WireField,
  WorkflowIR,
} from "../../../ir/types/loom-ir.js";
import {
  workflowCanAnswerNotFound,
  workflowEmitsCommandRoute,
  workflowIsGuarded,
} from "../../../ir/types/loom-ir.js";
import {
  peelCollection,
  peelNullable,
  type WirePrimitive,
  wireTypeInfo,
} from "../../../ir/types/wire-types.js";
import {
  type ApiOperationIR,
  apiStatusContext,
  deriveAggregateOperations,
  relativeOpPath,
} from "../../../ir/util/api-surface.js";
import { AUDIT_ENTRY_TYPE, auditEntryWireShape } from "../../../ir/util/audit-history.js";
import { commandBodyOptional } from "../../../ir/util/command-body.js";
import { entryResult } from "../../../ir/util/entry-result.js";
import { foreignValueTypeSeeds, foreignValueTypes } from "../../../ir/util/foreign-event-types.js";
import { normalizeHandlerReturn, requestRecordFor } from "../../../ir/util/handler-contracts.js";
import { isMergePatchUpdate } from "../../../ir/util/merge-patch.js";
import { errorStatuses, type OpErrorKind, PROBLEM_JSON } from "../../../ir/util/openapi-errors.js";
import {
  camelId,
  opCreate,
  opDestroy,
  opFind,
  opGetById,
  opList,
  opOperation,
  opWorkflow,
  opWorkflowInstanceById,
  opWorkflowInstances,
} from "../../../ir/util/openapi-ids.js";
import { responseWireFor } from "../../../ir/util/response-wire.js";
import { routedErrorStatuses, routedParamSource } from "../../../ir/util/routed-handler.js";
import {
  commandCreateEntryResult,
  commandCreateResult,
} from "../../../ir/util/workflow-command-route.js";
import { emissionSink, rewrite } from "../../../util/emission-sink.js";
import { elixirString, snake, upperFirst } from "../../../util/naming.js";
import { routeSegmentFor } from "../../../util/storage-names.js";
import { isReserved } from "../../../util/target-identifiers.js";
import {
  type RequestComponentOwner,
  requestComponentNamerFor,
} from "../../_openapi/request-component-names.js";
import { PROVENANCE_VALUE_FIELD, provenancedEntries } from "../../_payload/provenanced-wire.js";
import {
  type OpUnionErrorArm,
  opUnionResponses,
  type UnionMember,
} from "../../_payload/union-wire.js";
import { workflowParamPayloads } from "../../_payload/workflow-param-payloads.js";
import type { ApiRoute } from "../api-emit.js";
import { exReasonPhrase, exStatus } from "../wire-policy-ex.js";
import { servedOperationEntries, servesHistory } from "./api-emit.js";
import { exInt32Range } from "./codec-spelling-ex.js";
import { denialOverrides, denialStatus } from "./denial.js";
import { isAbstractBase, isTphBase } from "./inheritance-emit.js";
import { emitsRestDelete } from "./rest-surface.js";

/** Substitute a literal 404 with the `httpStatus`-resolved `NotFound` status.
 *
 *  `errorStatuses()` now resolves the rung itself on all five backends, so the
 *  sets that come THROUGH it arrive already-resolved and this is a no-op on
 *  them (there is no 404 left to substitute).  What it still does the work for
 *  is the HAND-ROLLED sets beside them — the audit-history read and the
 *  `?? [404]` fallback below, neither of which is lifted into
 *  `deriveContextOperations` (`apiSurfaceCoverage.notLifted`). */
function withResolvedNotFound(statuses: readonly number[], notFoundStatus: number): number[] {
  const stdlib = exStatus("not-found");
  if (notFoundStatus === stdlib) return [...statuses];
  return [...new Set(statuses.map((s) => (s === stdlib ? notFoundStatus : s)))].sort(
    (a, b) => a - b,
  );
}

// ---------------------------------------------------------------------------
// OpenApiSpex emission for Phoenix.
//
// Emits:
//   lib/<app>_web/api/<api>_spec.ex          — spec module; paths from the router
//   `operation` specs on the routed API controller actions (annotateApiControllers)
//   lib/<app>_web/api/schemas/<name>.ex      — per request/response schema module
//   lib/<app>_web/controllers/openapi_controller.ex — JSON spec controller
//
// Schema naming convention (mirrors wire-spec.json for the parity test):
//   Aggregate response:        <Agg>Response
//   Aggregate list response:   <Agg>ListResponse
//   Entity part response:      <Part>Response
//   Value object:              <Vo>
//   Create request:            Create<Agg>Request
//   Operation request:         <Op><Agg>Request  (aggregate-qualified — an
//                              op name like `update` is shared across
//                              aggregates, e.g. via crudish, so the DTO must
//                              be qualified to avoid a schema-id collision)
//   Workflow request:          <Wf>Request   (Pascal-cased workflow name)
//   View response:             <View>Response
// ---------------------------------------------------------------------------

/** Elixir module alias for an operation-return union's 200 schema
 *  (`operation reject(): string or NotFound`).
 *
 *  `unionInstanceName` yields a lower-camel stem whenever the union's FIRST
 *  variant is a primitive — `string or NotFound` → `stringOrNotFound` — because
 *  `variantTag` returns a primitive's own lowercase name.  That is a valid class
 *  name on the other backends (Java emits it as a lowercase `sealed interface`,
 *  TS as a const), but an Elixir module alias MUST be uppercase-first —
 *  `defmodule …Api.Schemas.stringOrNotFound` fails to compile (`invalid module
 *  name`).  Uppercase the first char for the module segment only; the wire
 *  `type` discriminator tags come from `variantTag` and are untouched, so the
 *  serialized union stays byte-identical to every other backend.
 *
 *  The 200 body is the whole union, or `<Union>Success` when the union has an
 *  error arm (M-FT.24, `opUnionResponses`). */
function opUnionSuccessAlias(variants: TypeIR[], ctx: EnrichedBoundedContextIR): string {
  return upperFirst(opUnionResponses(variants, ctx).successName);
}

export interface OpenApiEmitArgs {
  contexts: EnrichedBoundedContextIR[];
  deployable: DeployableIR;
  sys: SystemIR;
  /** snake_case application name, e.g. "phoenix_app" */
  appName: string;
  /** PascalCase module prefix, e.g. "PhoenixApp" */
  appModule: string;
}

export interface OpenApiEmitResult {
  files: Map<string, string>;
  /** New api routes to splice into the router under the existing /api scope. */
  routes: ApiRoute[];
  /** The documented operations, for `annotateApiControllers` to declare on
   *  the routed controller actions once every controller is emitted. */
  operations: ElixirApiOperation[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function emitOpenApiSpec(args: OpenApiEmitArgs): OpenApiEmitResult {
  const { contexts, deployable, appName, appModule } = args;
  const files = emissionSink("generator/elixir/vanilla/openapi-emit");
  const routes: ApiRoute[] = [];

  const webModule = `${appModule}Web`;

  // Collect all aggregates, workflows across all contexts.
  const allAggregates: Array<{ ctx: EnrichedBoundedContextIR; agg: EnrichedAggregateIR }> = [];
  const allWorkflows: Array<{ ctx: EnrichedBoundedContextIR; wf: WorkflowIR }> = [];

  // Observable workflows (instanceWireShape) expose the two read-only
  // instance routes + the `<Wf>Instance[List]Response` schemas — independent
  // of the command surface (an event-triggered saga has no POST route but
  // is still observable).
  const observableWorkflows: WorkflowIR[] = [];

  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) allAggregates.push({ ctx, agg });
    // Event-triggered-only workflows expose no HTTP route (dispatch-only).
    for (const wf of ctx.workflows.filter(workflowEmitsCommandRoute))
      allWorkflows.push({ ctx, wf });
    for (const wf of ctx.workflows) if (wf.instanceWireShape) observableWorkflows.push(wf);
  }

  // Request-component names, resolved ONCE over the whole deployable (F-026).
  //
  // Two independent rules mint these names -- `<Op><Agg>Request` for an
  // aggregate operation, `<Workflow>Request` for a workflow -- so `schedule` on
  // `WorkOrder` and workflow `scheduleWorkOrder` both spell
  // `ScheduleWorkOrderRequest`.  On Phoenix that collision landed on the FILE
  // PATH: the two schemas were written to the same `<snake>_request.ex`, the
  // workflow loop ran second, and `files.set` clobbered the operation's module.
  // One module survived, carrying the workflow's fields, and BOTH paths in
  // `<api>_spec.ex` referenced it.
  //
  // Resolved across every hosted context, not per context, because
  // `<App>Web.Api.Schemas` is ONE namespace (and `schemaDir` one directory) for
  // the whole deployable -- a per-context scope would leave two contexts free to
  // collide in it.
  const requestComponentOwners: RequestComponentOwner[] = [
    // The canonical create request, listed for EVERY aggregate because this
    // backend emits `create_<agg>_request.ex` unconditionally (the schema loop
    // below has no gate; only the SPEC's reference to it is gated, on the
    // derived create entry).  The minter's contract is "the owners this backend
    // actually publishes", and an occupied file path is occupied whether or not
    // the document links to it -- so gating this on `emitsRestCreate` the way
    // the Hono side does would leave a `create<Agg>` workflow free to clobber
    // an orphan create schema.
    ...allAggregates.map(
      ({ agg }): RequestComponentOwner => ({ kind: "create", aggregate: agg.name }),
    ),
    ...allAggregates.flatMap(({ agg }) =>
      agg.operations
        .filter((o) => o.visibility === "public")
        .map(
          (op): RequestComponentOwner => ({
            kind: "operation",
            aggregate: agg.name,
            operation: op.name,
          }),
        ),
    ),
    // `allWorkflows` is already filtered to the command-route-bearing ones,
    // which is exactly the set that gets a request schema.
    ...allWorkflows.map(
      ({ wf }): RequestComponentOwner => ({ kind: "workflow", workflow: wf.name }),
    ),
  ];
  const reqNameFor = requestComponentNamerFor(requestComponentOwners);

  // --- Per-Api spec module ---------------------------------------------------
  // In Loom v0, there is one spec module per deployable (one api per deployable),
  // named after the served `api` when the deployable declares one.
  //
  // `serves:` is OPTIONAL, and it only ever named the module: every path and
  // schema below is derived from the hosted `contexts`, not from the `api`
  // declaration.  So a deployable declared with `contexts:` alone falls back to
  // the app name and still publishes the same route-derived document the other
  // four backends publish either way (F15,
  // `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/schemathesis-findings-2026-08.md`).  Without the fallback such
  // a deployable emits no spec module, no OpenapiController and no
  // `/openapi.json` route at all.
  const servedApi = deployable.serves?.[0];
  const apiSnake = servedApi ? snake(servedApi) : appName;
  const apiPascal = servedApi ? upperFirst(servedApi) : appModule;

  const operations = apiOperations(
    webModule,
    allAggregates,
    allWorkflows,
    observableWorkflows,
    reqNameFor,
    servedRoutes(args),
  );
  files.set(
    `lib/${appName}_web/api/${apiSnake}_spec.ex`,
    renderApiSpec(appModule, webModule, apiPascal),
  );

  // --- Schema modules -------------------------------------------------------
  // Collect schemas: value objects, aggregate parts, aggregate response/request,
  // workflow request.
  const schemaDir = `lib/${appName}_web/api/schemas`;

  // Value objects (referenced in multiple contexts — deduplicate by name)
  const emittedVOs = new Set<string>();
  for (const ctx of contexts) {
    for (const vo of ctx.valueObjects) {
      if (emittedVOs.has(vo.name)) continue;
      emittedVOs.add(vo.name);
      files.set(`${schemaDir}/${snake(vo.name)}.ex`, renderValueObjectSchema(vo, webModule));
    }
  }

  // Shared RFC 7807 error body — referenced by every operation's declared
  // 4xx/5xx responses (see errorResponseEntries).
  files.set(`${schemaDir}/problem_details.ex`, renderProblemDetailsSchema(webModule));

  // Enum schemas — a named string schema carrying the allowed value-set,
  // referenced by `$ref` from any enum-typed property.  De-duplicated by
  // name (a root-level enum is folded into every context's enum list by
  // the enrich pass, so the same enum can appear more than once).
  const emittedEnums = new Set<string>();
  for (const ctx of contexts) {
    for (const en of ctx.enums) {
      if (emittedEnums.has(en.name)) continue;
      emittedEnums.add(en.name);
      files.set(`${schemaDir}/${snake(en.name)}.ex`, renderEnumSchema(en, webModule));
    }
  }

  // Sibling-context value objects / enums a hosted declaration references but
  // no hosted context declares (claims D15): an aggregate in context B typed
  // `kind: Kind` against `enum Kind` in an unhosted sibling context A.  The
  // response / request schemas `$ref` them, so the deployable must declare
  // them — the same shared closure the four typed backends declare foreign
  // value types through (`src/ir/util/foreign-event-types.ts`).
  const unhosted = foreignValueTypes(foreignValueTypeSeeds([], contexts), args.sys, {
    valueObjects: contexts.flatMap((c) => c.valueObjects),
    enums: contexts.flatMap((c) => c.enums),
  });
  for (const vo of unhosted.valueObjects) {
    if (emittedVOs.has(vo.name)) continue;
    emittedVOs.add(vo.name);
    files.set(`${schemaDir}/${snake(vo.name)}.ex`, renderValueObjectSchema(vo, webModule));
  }
  for (const en of unhosted.enums) {
    if (emittedEnums.has(en.name)) continue;
    emittedEnums.add(en.name);
    files.set(`${schemaDir}/${snake(en.name)}.ex`, renderEnumSchema(en, webModule));
  }

  // Entity parts (deduplication by name)
  const emittedParts = new Set<string>();
  for (const { ctx, agg } of allAggregates) {
    for (const part of agg.parts) {
      if (emittedParts.has(part.name)) continue;
      emittedParts.add(part.name);
      files.set(
        `${schemaDir}/${snake(part.name)}_response.ex`,
        renderPartResponseSchema(part, webModule, ctx.payloads),
      );
    }
  }

  // Aggregate response + list response + create request + operation requests
  for (const { ctx, agg } of allAggregates) {
    // Response — an abstract base's is the tagged union of its concretes'.
    const poly = isAbstractBase(agg) ? polymorphicReadFor(agg, ctx.aggregates) : undefined;
    files.set(
      `${schemaDir}/${snake(agg.name)}_response.ex`,
      poly
        ? renderPolymorphicResponseSchema(
            agg,
            poly.variants.map((v) => v.tag),
            webModule,
          )
        : renderAggregateResponseSchema(agg, webModule, ctx.payloads),
    );
    if (poly) {
      files.set(
        `${schemaDir}/${snake(agg.name)}_paged.ex`,
        renderAggregatePagedResponseSchema(agg, `${agg.name}Paged`, webModule, true),
      );
    }
    // List response — an abstract base's list is the paged envelope instead.
    if (!poly) {
      files.set(
        `${schemaDir}/${snake(agg.name)}_list_response.ex`,
        renderAggregateListResponseSchema(agg, webModule),
      );
    }
    // Paged envelope schema — emitted when this aggregate's implicit
    // `findAll` (or an explicit find) returns the `paged` wire, so the list
    // endpoint's 200 references `<Agg>Paged` (an object envelope) instead of
    // the bare-array `<Agg>ListResponse`.  Only reaches the served spec when a
    // path references it (OpenApiSpex.resolve_schema_modules), matching the
    // Hono/.NET add-when-used behavior.
    const pagedName = pagedFindName(ctx, agg);
    if (pagedName) {
      files.set(
        `${schemaDir}/${snake(pagedName)}.ex`,
        renderAggregatePagedResponseSchema(agg, pagedName, webModule),
      );
    }
    // Create request — path and module name both from the resolved name, for
    // the same reason as the operation loop below (F-026).
    const createReqName = reqNameFor({ kind: "create", aggregate: agg.name });
    files.set(
      `${schemaDir}/${snake(createReqName)}.ex`,
      renderCreateRequestSchema(agg, webModule, createReqName),
    );
    // Create response — `{ id }`, matching Hono/.NET's Create<Agg>Response
    files.set(
      `${schemaDir}/create_${snake(agg.name)}_response.ex`,
      renderCreateResponseSchema(agg, webModule),
    );
    // Per-operation request schemas
    for (const op of agg.operations.filter((o) => o.visibility === "public")) {
      // The PATH is derived from the resolved name, not from op+agg: the
      // collision lands here too, and two schemas sharing a path means one
      // silently overwrites the other.  `snake(resolvedName)` equals the old
      // `${snake(op)}_${snake(agg)}_request` for every non-colliding name, so
      // this is a no-op except exactly where it must not be.
      const reqName = reqNameFor({
        kind: "operation",
        aggregate: agg.name,
        operation: op.name,
      });
      files.set(
        `${schemaDir}/${snake(reqName)}.ex`,
        renderOperationRequestSchema(op, webModule, reqName),
      );
    }
    void ctx;
  }

  // Operation-return union DTOs (`operation reserve(): Project or
  // ProjectNotFound`) — the tagged wire union the op's 200 carries,
  // matching Hono's discriminatedUnion / .NET's Application union DTO.
  // De-duplicated by instance name (one union can back several ops).
  //
  // A union with an `error` arm is split (M-FT.24): the 200 carries the
  // success arms only (`<Union>Success`), and each error arm publishes its
  // problem body (`<Tag>Problem`) for the status it answers.
  const emittedOpUnions = new Set<string>();
  // A workflow `create(…): T or E` answers the same split union.
  const unionReturns = [
    ...allAggregates.flatMap(({ ctx, agg }) =>
      agg.operations
        .filter((o) => o.visibility === "public")
        .map((op) => ({ ctx, type: op.returnType })),
    ),
    ...allWorkflows.map(({ ctx, wf }) => ({
      ctx,
      type: commandCreateEntryResult(wf) ? commandCreateResult(wf)?.type : undefined,
    })),
    ...contexts.flatMap((ctx) =>
      [...(ctx.commandHandlers ?? []), ...(ctx.queryHandlers ?? [])]
        .filter((h) => !h.extern && entryResult(h))
        .map((h) => ({ ctx, type: h.returnType })),
    ),
  ];
  for (const { ctx, type } of unionReturns) {
    {
      if (type?.kind !== "union") continue;
      const split = opUnionResponses(type.variants, ctx);
      const unionName = opUnionSuccessAlias(type.variants, ctx);
      if (emittedOpUnions.has(unionName)) continue;
      emittedOpUnions.add(unionName);
      files.set(
        `${schemaDir}/${snake(unionName)}.ex`,
        renderOperationUnionSchema(unionName, split.success, ctx, webModule),
      );
      for (const arm of split.errors) {
        if (emittedOpUnions.has(arm.problemName)) continue;
        emittedOpUnions.add(arm.problemName);
        files.set(
          `${schemaDir}/${snake(arm.problemName)}.ex`,
          renderErrorArmProblemSchema(arm, webModule),
        );
      }
    }
  }

  // Entity history (docs/audit.md) — the `AuditEntry` body of
  // `GET /<plural>/{id}/history`.  One shared schema built from the SAME
  // platform-neutral wire shape the mapper emits, so spec and runtime cannot
  // describe different keys.  Emitted only when some served aggregate actually
  // has the route.
  if (allAggregates.some(({ ctx, agg }) => servesHistory(ctx, agg))) {
    files.set(`${schemaDir}/${snake(AUDIT_ENTRY_TYPE)}.ex`, renderAuditEntrySchema(webModule));
  }

  // CanResponse `{ allowed }` — the side-effect-free `can_<op>` companion of a
  // `when`-gated operation (criterion.md, use site 2).  One shared schema,
  // emitted when any served op carries a `when` gate.
  if (
    allAggregates.some(({ agg }) => agg.operations.some((o) => o.visibility === "public" && o.when))
  ) {
    files.set(`${schemaDir}/can_response.ex`, renderCanResponseSchema(webModule));
  }

  // Declared record payloads a workflow param names — the
  // `create(c: FileClaim)` explicit-command form.  The workflow request
  // schema below references `<Payload>Response` (the `entity` spelling
  // `schemaRefFor` produces), and a payload has no owning aggregate, so no
  // per-aggregate pass emits that module — without this pass the request
  // schema names an undefined module.  Deduplicated by name
  // like the value objects above, since a payload is context-scoped but the
  // schema directory is per-project.
  const emittedPayloads = new Set<string>();
  for (const ctx of contexts) {
    for (const pl of workflowParamPayloads(ctx)) {
      if (emittedPayloads.has(pl.name)) continue;
      emittedPayloads.add(pl.name);
      files.set(
        `${schemaDir}/${snake(pl.name)}_response.ex`,
        renderPayloadResponseSchema(pl, webModule),
      );
    }
  }

  // Workflow request schemas
  for (const { wf } of allWorkflows) {
    // Path from the resolved name -- see the operation loop above.
    const reqName = reqNameFor({ kind: "workflow", workflow: wf.name });
    files.set(
      `${schemaDir}/${snake(reqName)}.ex`,
      renderWorkflowRequestSchema(wf, webModule, reqName),
    );
  }

  // Observable-workflow instance schemas — `<Wf>InstanceResponse` (the
  // instanceWireShape projection) + its named `<Wf>InstanceListResponse`
  // array carrier, matching Hono / .NET / Python / Java.
  for (const wf of observableWorkflows) {
    files.set(
      `${schemaDir}/${snake(wf.name)}_instance_response.ex`,
      renderWorkflowInstanceResponseSchema(wf, webModule),
    );
    files.set(
      `${schemaDir}/${snake(wf.name)}_instance_list_response.ex`,
      renderWorkflowInstanceListResponseSchema(wf, webModule),
    );
  }

  // --- OpenAPI controller ---------------------------------------------------
  const controllerPath = `lib/${appName}_web/controllers/openapi_controller.ex`;
  files.set(controllerPath, renderOpenapiController(appModule, webModule, apiPascal));

  // --- Route entry ----------------------------------------------------------
  // Served at the router ROOT (`!root:` sentinel — like /health, /ready), not
  // inside `scope "/api"`, so the spec sits at /openapi.json on every backend
  // (cross-backend alignment) and stays off the same-origin `/api` surface.
  routes.push({
    method: "get",
    path: "!root:/openapi.json",
    controller: "OpenapiController",
    action: ":index",
  });

  // A `File` field references the one named `FileRef` component every backend
  // publishes; the module exists only when some schema reaches for it.
  if ([...files.values()].some((c) => c.includes(`${webModule}.Api.Schemas.FileRef`))) {
    files.set(`${schemaDir}/file_ref.ex`, renderFileRefSchema(webModule));
  }

  for (const [path, content] of files) {
    const fixed = withoutStructOnReservedKey(content);
    if (fixed !== content) files.replace(path, fixed);
  }
  return { files, routes, operations };
}

/** `OpenApiSpex.schema/1` derives a STRUCT from the schema's property keys and
 *  binds each key as a variable in its own expansion, so a property named after
 *  an elixir reserved word (`fn`, `do`, `end`) fails `mix compile` inside the
 *  macro ("fn is not allowed in matches") — the key itself is a legal atom.
 *  These modules only describe the published document (no controller casts a
 *  body into the struct), so such a schema opts out of the struct with
 *  `struct?: false`.  Every schema without a reserved key keeps the default
 *  and stays byte-identical. */
function withoutStructOnReservedKey(content: string): string {
  if (!content.includes("OpenApiSpex.schema(%{")) return content;
  const keys = [...content.matchAll(/^ {6}([a-z_][a-zA-Z0-9_]*): /gm)].map((m) => m[1] as string);
  if (!keys.some((k) => isReserved("elixir", k))) return content;
  return content.replace(/\n {2}\}\)\nend\n$/, "\n  }, struct?: false)\nend\n");
}

// ---------------------------------------------------------------------------
// Operation specs — one OpenApiSpex `operation` per routed API controller action
// ---------------------------------------------------------------------------

/** One documented API operation: the router route it describes and the
 *  OpenApiSpex `operation` spec its controller action declares.
 *
 *  `path` is relative to `scope "/api"` with params spelled `{name}`.  It only
 *  locates the router route (method + path) whose controller action carries
 *  the spec; the document's `paths` come from `OpenApiSpex.Paths.from_router`
 *  over the real router, so the spec cannot publish a path the router does not
 *  serve (D-OPENAPI-FRAMEWORK-NATIVE). */
export interface ElixirApiOperation {
  method: ApiRoute["method"];
  path: string;
  summary: string;
  operationId: string;
  tags: string[];
  /** `%OpenApiSpex.Parameter{…}` literals. */
  parameters: string[];
  /** A `%OpenApiSpex.RequestBody{…}` literal. */
  requestBody?: string;
  /** `<status> => %OpenApiSpex.Response{…}` entries. */
  responses: string[];
}

function jsonResponse(status: number, description: string, schema: string): string {
  return `${status} => %OpenApiSpex.Response{description: ${elixirString(description)}, content: %{"application/json" => %OpenApiSpex.MediaType{schema: ${schema}}}}`;
}

const NO_CONTENT_RESPONSE = `204 => %OpenApiSpex.Response{description: "No Content"}`;

function jsonRequestBody(schema: string, required: boolean): string {
  return `%OpenApiSpex.RequestBody{required: ${required}, content: %{"application/json" => %OpenApiSpex.MediaType{schema: ${schema}}}}`;
}

function pathIdParam(): string {
  return `%OpenApiSpex.Parameter{name: :id, in: :path, required: true, schema: ${OPENAPI_ID_SCHEMA}}`;
}

/** RFC 7807 error responses for an operation kind, from the shared matrix.
 *  Each declared 4xx/5xx response carries the `ProblemDetails` schema MODULE
 *  under `application/problem+json` — matching Hono/.NET so the conformance
 *  gate's error-response dimension compares equal. */
function errorResponses(
  kind: OpErrorKind,
  schemasModule: string,
  guarded = false,
  /** Structural-conflict resolver — routes the destroy FK-restrict
   *  409 (`ReferencedInUse`) through the `httpStatus` mapper so the OpenAPI
   *  declaration moves with the runtime arm.  Omitted ⇒ literal 409. */
  resolve?: (name: string) => number,
  /** Body facts the `kind` cannot carry — `readsAggregate` for the workflow
   *  arm's conditional not-found rung.  See `errorStatuses`. */
  opts?: { readsAggregate?: boolean },
): string[] {
  return statusResponses(errorStatuses(kind, guarded, resolve, opts), schemasModule);
}

/** The same ProblemDetails responses for an explicit status list — used where
 *  the status set isn't a matrix kind. */
function statusResponses(
  statuses: readonly number[],
  schemasModule: string,
  /** An operation-return union's error arms by status (M-FT.24): such a
   *  status declares ProblemDetails OR the arms' problem bodies. */
  armsByStatus?: ReadonlyMap<number, readonly OpUnionErrorArm[]>,
): string[] {
  return statuses.map((s) => {
    const arms = armsByStatus?.get(s) ?? [];
    const schema = arms.length
      ? `%OpenApiSpex.Schema{anyOf: [${[
          `${schemasModule}.ProblemDetails`,
          ...arms.map((a) => `${schemasModule}.${a.problemName}`),
        ].join(", ")}]}`
      : `${schemasModule}.ProblemDetails`;
    return `${s} => %OpenApiSpex.Response{description: "${exReasonPhrase(s)}", content: %{"${PROBLEM_JSON}" => %OpenApiSpex.MediaType{schema: ${schema}}}}`;
  });
}

/** Every operation the deployable's API controllers document. */
function apiOperations(
  webModule: string,
  allAggregates: Array<{ ctx: EnrichedBoundedContextIR; agg: EnrichedAggregateIR }>,
  allWorkflows: Array<{ ctx: EnrichedBoundedContextIR; wf: WorkflowIR }>,
  observableWorkflows: WorkflowIR[],
  /** The deployable-wide request-component name lookup (F-026) -- passed in
   *  rather than re-derived, so the operations' `$ref`s and the emitted
   *  schema modules cannot disagree about a name. */
  reqNameFor: (owner: RequestComponentOwner) => string,
  /** The explicit `route`s of the apis this deployable serves, each with the
   *  hosted context its handler lives in. */
  explicitRoutes: readonly { route: RouteIR; ctx: EnrichedBoundedContextIR }[],
): ElixirApiOperation[] {
  const schemasModule = `${webModule}.Api.Schemas`;
  const ops: ElixirApiOperation[] = [];

  // Workflow commands: POST /workflows/<slug>.  `create(…): T` answers 200
  // with the value (`respond_result`), typed by the same type→schema map a
  // scalar-returning operation uses.
  for (const { wf, ctx } of allWorkflows) {
    const result = commandCreateResult(wf);
    // `create(…): T or E` answers the split union's success arms.
    const entryUnion =
      commandCreateEntryResult(wf) && result?.type.kind === "union" ? result.type : undefined;
    ops.push({
      method: "post",
      path: `/workflows/${snake(wf.name)}`,
      summary: `Run ${wf.name} workflow`,
      operationId: camelId(opWorkflow(wf.name)),
      tags: ["workflows"],
      parameters: [],
      requestBody: jsonRequestBody(
        `${schemasModule}.${reqNameFor({ kind: "workflow", workflow: wf.name })}`,
        !commandBodyOptional(wf.params),
      ),
      responses: [
        result
          ? jsonResponse(
              200,
              "OK",
              entryUnion
                ? `${schemasModule}.${opUnionSuccessAlias(entryUnion.variants, ctx)}`
                : openApiType(result.type, schemasModule),
            )
          : NO_CONTENT_RESPONSE,
        ...errorResponses("workflow", schemasModule, workflowIsGuarded(wf), undefined, {
          readsAggregate: workflowCanAnswerNotFound(wf, ctx),
        }),
      ],
    });
  }

  // Observable-workflow instance reads: the named `<Wf>InstanceListResponse`
  // carrier and the single `<Wf>InstanceResponse` (404 when absent) — the
  // read-only saga-state surface every backend serves.
  for (const wf of observableWorkflows) {
    const slug = snake(wf.name);
    const T = upperFirst(wf.name);
    ops.push(
      {
        method: "get",
        path: `/workflows/${slug}/instances`,
        summary: `List ${wf.name} instances`,
        operationId: camelId(opWorkflowInstances(wf.name)),
        tags: ["workflows"],
        parameters: [],
        responses: [jsonResponse(200, "OK", `${schemasModule}.${T}InstanceListResponse`)],
      },
      {
        method: "get",
        path: `/workflows/${slug}/instances/{id}`,
        summary: `Get ${wf.name} instance by correlation id`,
        operationId: camelId(opWorkflowInstanceById(wf.name)),
        tags: ["workflows"],
        parameters: [pathIdParam()],
        responses: [
          jsonResponse(200, "OK", `${schemasModule}.${T}InstanceResponse`),
          ...errorResponses("getById", schemasModule),
        ],
      },
    );
  }

  for (const { ctx, agg } of allAggregates) {
    const aggSlug = routeSegmentFor(agg.name);
    const tags = [aggSlug];
    // THE UNIFICATION SEAM (api-surface.ts): the documented operations and
    // every declared error set below come from the same derived list the
    // router mounts (api-emit.ts, via `servedOperationEntries`).  An abstract
    // base derives nothing; its read-only list/show stay the elixir-local
    // extra the router also keeps.
    const specRepo = ctx.repositories.find((r) => r.aggregateName === agg.name);
    const derivedOps = isAbstractBase(agg)
      ? []
      : deriveAggregateOperations(agg, specRepo, apiStatusContext(ctx));
    const notFoundStatus = denialStatus("notFound", denialOverrides(ctx));
    const served = servedOperationEntries(agg, derivedOps);
    const opPath = (o: ApiOperationIR): string => `/${aggSlug}${relativeOpPath(o)}`;
    const resolved = (statuses: readonly number[]) =>
      statusResponses(withResolvedNotFound(statuses, notFoundStatus), schemasModule);

    if (isAbstractBase(agg)) {
      ops.push(...polymorphicOperations(agg, ctx, aggSlug, schemasModule));
    } else {
      // The implicit findAll is paged for plain single-table relational
      // aggregates: the list 200 carries the `<Agg>Paged` envelope and the
      // endpoint accepts `page`/`pageSize`/`sort`/`dir` query controls.  A
      // non-paged findAll (document / embedded / inheritance subtype) keeps
      // the bare-array `<Agg>ListResponse`.
      const listPagedName = pagedFindName(ctx, agg);
      ops.push({
        method: "get",
        path: `/${aggSlug}`,
        summary: `List ${agg.name}`,
        operationId: camelId(opList(agg.name)),
        tags,
        parameters: listPagedName ? pagingQueryParams() : [],
        responses: [
          jsonResponse(200, "OK", `${schemasModule}.${listPagedName ?? `${agg.name}ListResponse`}`),
          ...resolved(
            derivedOps.find((o) => o.kind === "find" && o.find?.name === "all")?.errorStatuses ??
              [],
          ),
        ],
      });
      // Create is documented iff the derived create entry exists — the same
      // gate the router mounts.
      const createEntry = derivedOps.find((o) => o.kind === "create");
      if (createEntry) {
        ops.push({
          method: "post",
          path: `/${aggSlug}`,
          summary: `Create ${agg.name}`,
          operationId: camelId(opCreate(agg.name)),
          tags,
          parameters: [],
          requestBody: jsonRequestBody(
            `${schemasModule}.${reqNameFor({ kind: "create", aggregate: agg.name })}`,
            !commandBodyOptional(createInputFields(agg)),
          ),
          responses: [
            jsonResponse(201, "Created", `${schemasModule}.Create${agg.name}Response`),
            ...statusResponses([...createEntry.errorStatuses], schemasModule),
          ],
        });
      }
      ops.push({
        method: "get",
        path: `/${aggSlug}/{id}`,
        summary: `Get ${agg.name} by id`,
        operationId: camelId(opGetById(agg.name)),
        tags,
        parameters: [pathIdParam()],
        responses: [
          jsonResponse(200, "OK", `${schemasModule}.${agg.name}Response`),
          ...resolved(
            derivedOps.find((o) => o.kind === "getById")?.errorStatuses ?? [exStatus("not-found")],
          ),
        ],
      });
      // DELETE is documented iff the ROUTER mounts it: the derived destroy
      // entry AND the elixir-local `emitsRestDelete` stance (ES exclusion).
      const destroyEntry = derivedOps.find((o) => o.kind === "destroy");
      if (destroyEntry && emitsRestDelete(agg)) {
        ops.push({
          method: "delete",
          path: `/${aggSlug}/{id}`,
          summary: `Destroy ${agg.name}`,
          operationId: camelId(opDestroy(agg.name)),
          tags,
          parameters: [pathIdParam()],
          responses: [NO_CONTENT_RESPONSE, ...resolved(destroyEntry.errorStatuses)],
        });
      }
    }

    // Entity history (docs/audit.md) — `GET /<plural>/{id}/history`, declared
    // off the SAME `servesHistory` predicate that mounts the route.  The 403
    // is declared only when the inherited read gate exists to produce one.
    // The by-id read's set comes from the shared matrix: history parses the
    // same `{id}` every other by-id route does.
    const historyFind = servesHistory(ctx, agg)
      ? (ctx.repositories ?? []).find((r) => r.aggregateName === agg.name)?.historyFind
      : undefined;
    if (historyFind) {
      ops.push({
        method: "get",
        path: `/${aggSlug}/{id}/history`,
        summary: `History of ${agg.name}`,
        operationId: camelId(opFind(agg.name, "history")),
        tags,
        parameters: [pathIdParam()],
        responses: [
          jsonResponse(
            200,
            "OK",
            `%OpenApiSpex.Schema{type: :array, items: ${schemasModule}.${AUDIT_ENTRY_TYPE}}`,
          ),
          ...resolved(
            historyFind.requires
              ? [denialStatus("forbidden", denialOverrides(ctx)), ...errorStatuses("getById")]
              : [...errorStatuses("getById")],
          ),
        ],
      });
    }

    // Per-operation routes — the SERVED entries, so router parity holds by
    // construction.
    for (const entry of served.opEntries) {
      const op = entry.operation!;
      // A returning op answers 200 with its value; a void op stays 204.  A
      // union return carries the tagged union DTO; a scalar return its own
      // wire schema via the SAME type→schema map a field uses (`openApiType`).
      const success = op.returnType
        ? jsonResponse(
            200,
            "OK",
            op.returnType.kind === "union"
              ? `${schemasModule}.${opUnionSuccessAlias(op.returnType.variants, ctx)}`
              : openApiType(op.returnType, schemasModule),
          )
        : NO_CONTENT_RESPONSE;
      ops.push({
        method: "post",
        path: opPath(entry),
        summary: `${op.name} on ${agg.name}`,
        operationId: camelId(opOperation(agg.name, op.name)),
        tags,
        parameters: [pathIdParam()],
        requestBody: jsonRequestBody(
          `${schemasModule}.${reqNameFor({ kind: "operation", aggregate: agg.name, operation: op.name })}`,
          !commandBodyOptional(op.params),
        ),
        responses: [
          success,
          ...statusResponses(
            withResolvedNotFound(entry.errorStatuses, notFoundStatus),
            schemasModule,
            op.returnType?.kind === "union"
              ? new Map(
                  opUnionResponses(op.returnType.variants, ctx).errorStatuses.map(
                    (e) => [e.status, e.arms] as const,
                  ),
                )
              : undefined,
          ),
        ],
      });
      // The auto-exposed `GET /<plural>/{id}/can_<op>` companion of a
      // `when`-gated op — returns `{ allowed }` (criterion.md, use site 2).
      const probe = served.probeByOp.get(op);
      if (probe) {
        ops.push({
          method: "get",
          path: opPath(probe),
          summary: `can_${op.name} on ${agg.name}`,
          operationId: camelId(opOperation(agg.name, `can_${op.name}`)),
          tags,
          parameters: [pathIdParam()],
          responses: [
            jsonResponse(200, "OK", `${schemasModule}.CanResponse`),
            ...resolved(probe.errorStatuses),
          ],
        });
      }
    }
  }

  // Explicit routes.  A path a derived operation above already documents is
  // skipped: the explicit route claims a derived slot only by answering it
  // the same way.
  const published = new Set(ops.map((o) => o.path));
  for (const { route, ctx } of explicitRoutes) {
    if (published.has(route.path)) continue;
    const op = routedOperation(route, ctx, schemasModule);
    if (op) ops.push(op);
  }
  return ops;
}

/** The spec module: the document's `paths` derive from the router through
 *  `OpenApiSpex.Paths.from_router/1`, which reads the `operation` spec of
 *  every routed action that declares one; `resolve_schema_modules/1` then
 *  registers every schema module those operations reach in `components`. */
function renderApiSpec(appModule: string, webModule: string, apiPascal: string): string {
  return `# Auto-generated.
defmodule ${webModule}.Api.${apiPascal}Spec do
  @moduledoc """
  OpenApiSpex-based API spec for this deployable.

  The paths come from the router: every routed controller action that
  declares an \`operation\` spec is documented.  Consumed by
  OpenapiController to serve GET /openapi.json.
  """

  alias OpenApiSpex.{Info, OpenApi, Paths}

  @behaviour OpenApi

  @impl OpenApi
  def spec do
    %OpenApi{
      info: %Info{
        title: "${appModule}",
        version: "1.0.0"
      },
      paths: Paths.from_router(${webModule}.Router)
    }
    |> OpenApiSpex.resolve_schema_modules()
  end
end
`;
}

/** Render one action's `operation` declaration (2-space controller indent). */
function renderOperation(action: string, op: ElixirApiOperation): string {
  const list = (items: readonly string[]) => items.map((i) => `      ${i}`).join(",\n");
  const keys = [
    `summary: ${elixirString(op.summary)}`,
    `operation_id: ${elixirString(op.operationId)}`,
    `tags: [${op.tags.map(elixirString).join(", ")}]`,
    ...(op.parameters.length ? [`parameters: [\n${list(op.parameters)}\n    ]`] : []),
    ...(op.requestBody ? [`request_body: ${op.requestBody}`] : []),
    `responses: %{\n${list(op.responses)}\n    }`,
  ];
  return `  operation :${action},\n${keys.map((k) => `    ${k}`).join(",\n")}\n`;
}

/** The api-relative route key a documented operation is matched by. */
function routeKey(method: string, path: string): string {
  return `${method} ${path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")}`;
}

/** Declare each documented operation on the controller action the router
 *  mounts it at: `use OpenApiSpex.ControllerSpecs` plus an `operation` before
 *  the action's first clause.  A routed action of the same controller that is
 *  not documented declares `operation :<action>, false`, so `from_router`
 *  skips it.  A controller with no documented action is left alone: it does
 *  not export `open_api_operation/1`, and `from_router` skips its routes.
 *
 *  An operation whose route the router does not mount — a derived slot an
 *  explicit route took over under another param name — is declared nowhere,
 *  so the document cannot advertise a route the router does not serve.
 *
 *  Annotation only — no action body or route changes.  Throws when a routed
 *  action has no clause in its controller to sit on. */
export function annotateApiControllers(
  out: Map<string, string>,
  apiRoutes: readonly ApiRoute[],
  operations: readonly ElixirApiOperation[],
  webModule: string,
): void {
  if (operations.length === 0) return;
  const byKey = new Map<string, ElixirApiOperation>();
  for (const op of operations) {
    const key = routeKey(op.method, op.path);
    if (byKey.has(key)) throw new Error(`elixir openapi: two operations document ${key}`);
    byKey.set(key, op);
  }
  // controller → action → its documented operation (null = routed, undocumented)
  const perController = new Map<string, Map<string, ElixirApiOperation | null>>();
  for (const r of apiRoutes) {
    const action = r.action.replace(/^:/, "");
    const actions = perController.get(r.controller) ?? new Map();
    perController.set(r.controller, actions);
    const scoped = !r.path.startsWith("!root:") && !r.path.startsWith("!sse:");
    const key = routeKey(r.method, r.path);
    const op = scoped ? byKey.get(key) : undefined;
    if (op) {
      const prior = actions.get(action);
      if (prior && prior !== op)
        throw new Error(`elixir openapi: ${r.controller}.${action} mounts two documented routes`);
      actions.set(action, op);
    } else if (!actions.has(action)) actions.set(action, null);
  }

  for (const [controller, actions] of perController) {
    if (![...actions.values()].some((op) => op !== null)) continue;
    const header = new RegExp(`^defmodule ${webModule}\\.${controller} do$`, "m");
    const path = [...out.keys()].find((p) => header.test(out.get(p)!));
    if (!path) throw new Error(`elixir openapi: no module ${webModule}.${controller}`);
    rewrite(out, path, withOperations(out.get(path)!, webModule, controller, actions));
  }
}

function withOperations(
  content: string,
  webModule: string,
  controller: string,
  actions: ReadonlyMap<string, ElixirApiOperation | null>,
): string {
  const lines = content.split("\n");
  const inserts: Array<{ at: number; text: string }> = [];
  const useAt = lines.indexOf(`  use ${webModule}, :controller`);
  if (useAt < 0) throw new Error(`elixir openapi: ${controller} has no \`use … :controller\``);
  inserts.push({ at: useAt + 1, text: "  use OpenApiSpex.ControllerSpecs" });
  for (const [action, op] of actions) {
    let at = lines.findIndex((l) => l.startsWith(`  def ${action}(`));
    if (at < 0) throw new Error(`elixir openapi: ${controller} has no action ${action}`);
    // Sit above the clause's leading `@doc` / comment run, so the doc stays
    // on the action.
    while (at > 0) {
      const prev = lines[at - 1]!;
      if (prev.startsWith("  @doc") || prev.startsWith("  #")) at--;
      else if (prev === '  """') {
        let open = at - 2;
        while (open >= 0 && !lines[open]!.startsWith('  @doc """')) open--;
        if (open < 0) break;
        at = open;
      } else break;
    }
    inserts.push({
      at,
      text: op ? renderOperation(action, op) : `  operation :${action}, false\n`,
    });
  }
  for (const { at, text } of inserts.sort((a, b) => b.at - a.at)) lines.splice(at, 0, text);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Schema module renderers
// ---------------------------------------------------------------------------

/** The published schema of a declared `int` — the DECLARED int32 range, not a
 *  bare `{type: :integer}` (Schemathesis F11).
 *
 *  An `int` persists as Postgres `integer`, so a value outside int32 cannot be
 *  stored; publishing no bound told every generated client, and every contract
 *  fuzzer, that `9543751572142` was a legal request — which reached the column
 *  and 500ed.  node publishes `format: int32` plus the zod `.min()/.max()`,
 *  python `Field(ge=, le=)` + `format: int32`, and .NET/java have always bound
 *  it through `int`/`Integer`; elixir was the last bare one.  The numbers come
 *  from `src/util/numeric-range.ts`, the single statement of the contract, so
 *  the schema, the changeset guard and the column cannot drift apart.
 *
 *  `long` is deliberately NOT given the same treatment here: its declared
 *  ceiling is the `D-LONG-AVG-DEFAULTS` 2^53 one rather than int64, and moving
 *  it is a cross-backend ruling, not this row. */
const INT32_SCHEMA =
  `%OpenApiSpex.Schema{type: :integer, format: :int32, ` +
  `minimum: ${exInt32Range().min}, maximum: ${exInt32Range().max}}`;

/** Wire-primitive → OpenApiSpex %Schema{} literal.  Money crosses as
 *  `{type: string, format: decimal}` for cross-backend wire parity
 *  (see `.loom/wire-spec.json`).  Datetime is `:'date-time'`, guid is
 *  `:uuid`, decimal is `:double` — matching .NET's Swashbuckle mapping for
 *  `System.Decimal` (double is the least-lossy JSON-number hint; `:float`
 *  diverged from .NET and threw away precision). */
const OPENAPI_PRIMITIVE: Record<WirePrimitive, string> = {
  int: INT32_SCHEMA,
  long: "%OpenApiSpex.Schema{type: :integer}",
  decimal: "%OpenApiSpex.Schema{type: :number, format: :double}",
  money: "%OpenApiSpex.Schema{type: :string, format: :decimal}",
  string: "%OpenApiSpex.Schema{type: :string}",
  bool: "%OpenApiSpex.Schema{type: :boolean}",
  datetime: "%OpenApiSpex.Schema{type: :string, format: :'date-time'}",
  date: "%OpenApiSpex.Schema{type: :string, format: :date}",
  guid: "%OpenApiSpex.Schema{type: :string, format: :uuid}",
  json: "%OpenApiSpex.Schema{type: :object}",
  // Never read: `openApiType` answers a `File` with the named `FileRef` module.
  File: "%OpenApiSpex.Schema{type: :object}",
};

/** The OpenApiSpex %Schema{} literal of an `X id` — every identity is a
 *  guid, a uuid-format string — the shape Hono and .NET emit for an id body
 *  field and an `{id}` path param, so the parity diff's path-param dimension
 *  agrees (`pathParamSignatures` in test/_helpers/openapi-normalize.ts). */
const OPENAPI_ID_SCHEMA = "%OpenApiSpex.Schema{type: :string, format: :uuid}";

/** Map a TypeIR to an OpenApiSpex %Schema{} literal snippet.
 *  `schemasModule` is the `<Web>.Api.Schemas` prefix: enum / entity /
 *  value-object refs are emitted as the bare schema MODULE atom (not a raw
 *  `%OpenApiSpex.Reference{}`) so OpenApiSpex's `resolve_schema_modules`
 *  pulls them into `components.schemas`.  A raw `$ref` string is never
 *  registered by anything: it is left dangling, and a client that resolves
 *  the document (Schemathesis, any code generator) refuses every operation
 *  whose body or response reaches it. */
/** The explicit routes of every api the deployable serves whose handler
 *  lives in a hosted context. */
function servedRoutes(args: OpenApiEmitArgs): { route: RouteIR; ctx: EnrichedBoundedContextIR }[] {
  const byName = new Map(args.contexts.map((c) => [c.name, c]));
  return (args.deployable.serves ?? []).flatMap((apiName) =>
    (args.sys.apis.find((a) => a.name === apiName)?.routes ?? []).flatMap((route) => {
      const ctx = byName.get(route.target.context);
      return ctx ? [{ route, ctx }] : [];
    }),
  );
}

/** One explicit route's operation — the contract its routed handler declares:
 *  the bare lower-first handler name as operationId, path / query params from
 *  the route template, an inline JSON body of the remaining params, the
 *  `<Agg>Response` body of a single entity return (any other return untyped,
 *  a void command 204), then 400, the context's not-found status, and 415
 *  where a body is read. */
function routedOperation(
  route: RouteIR,
  ctx: EnrichedBoundedContextIR,
  schemasModule: string,
): ElixirApiOperation | undefined {
  const h =
    (ctx.commandHandlers ?? []).find((x) => x.name === route.target.handler) ??
    (ctx.queryHandlers ?? []).find((x) => x.name === route.target.handler);
  if (!h) return undefined;
  const paged = !!h.returnType && !!pagedReturn(h.returnType);
  const params = paged || h.extern ? h.params : flatRoutedParams(h.params, ctx);
  const source = (name: string) => routedParamSource(name, route, false);
  const required = (t: TypeIR) => (wireTypeInfo(t, "request").isNullable ? "false" : "true");
  const parameters = params
    .filter((p) => source(p.name) !== "body" || paged)
    .map((p) => {
      const where = source(p.name) === "path" ? "path" : "query";
      const req = where === "path" ? "true" : required(p.type);
      return `%OpenApiSpex.Parameter{name: :${p.name}, in: :${where}, required: ${req}, schema: ${openApiType(p.type, schemasModule)}}`;
    });
  if (paged) parameters.push(...pagingQueryParams());
  const bodyParams = paged ? [] : params.filter((p) => source(p.name) === "body");
  const requestBody =
    bodyParams.length > 0
      ? jsonRequestBody(
          `%OpenApiSpex.Schema{type: :object, properties: %{${bodyParams
            .map((p) => `${p.name}: ${openApiType(p.type, schemasModule)}`)
            .join(", ")}}, required: [${bodyParams
            .filter((p) => required(p.type) === "true")
            .map((p) => `:${p.name}`)
            .join(", ")}]}`,
          true,
        )
      : undefined;
  const ret = normalizeHandlerReturn(h.returnType, ctx);
  let successSchema: string | undefined;
  if (ret?.kind === "union" && !h.extern) {
    // An expected-failure result (`T or E`): the split union's success arms.
    successSchema = `${schemasModule}.${opUnionSuccessAlias(ret.variants, ctx)}`;
  } else if (ret && !h.extern && !paged) {
    const info = wireTypeInfo(ret, "response");
    const owning =
      info.refKind === "entity" && !info.isCollection
        ? (ctx.aggregates.find((a) => a.name === info.base) ??
          ctx.aggregates.find((a) => a.parts.some((p) => p.name === info.base)))
        : undefined;
    if (owning) successSchema = `${schemasModule}.${info.base}Response`;
  }
  const success = !ret
    ? NO_CONTENT_RESPONSE
    : successSchema
      ? jsonResponse(200, "OK", successSchema)
      : `200 => %OpenApiSpex.Response{description: "OK"}`;
  return {
    method: route.method.toLowerCase() as ApiRoute["method"],
    path: route.path,
    summary: h.name,
    operationId: `${h.name.charAt(0).toLowerCase()}${h.name.slice(1)}`,
    tags: [route.path.split("/")[1] ?? ""],
    parameters,
    requestBody,
    responses: [success, ...statusResponses(routedErrorStatuses(route, h, ctx), schemasModule)],
  };
}

/** A routed handler's params with each `command`/`query` record param
 *  flattened into its fields — the shape every backend binds on the wire. */
function flatRoutedParams(
  params: readonly { name: string; type: TypeIR }[],
  ctx: EnrichedBoundedContextIR,
): { name: string; type: TypeIR }[] {
  return params.flatMap((p) => {
    const rec = requestRecordFor(p.type, ctx);
    return rec
      ? rec.fields.map((f) => ({ name: f.name, type: f.type }))
      : [{ name: p.name, type: p.type }];
  });
}

function openApiType(t: TypeIR, schemasModule: string): string {
  const info = wireTypeInfo(t, "response");
  // Nullable rides on the parent property (`required[]`), not the
  // child schema — peel through.
  if (info.isNullable) return openApiType(peelNullable(t), schemasModule);
  if (info.isCollection) {
    return `%OpenApiSpex.Schema{type: :array, items: ${openApiType(peelCollection(t), schemasModule)}}`;
  }
  switch (info.refKind) {
    case "primitive":
      if (info.primitive === "File") return `${schemasModule}.FileRef`;
      return OPENAPI_PRIMITIVE[info.primitive!];
    case "id":
      return OPENAPI_ID_SCHEMA;
    case "enum":
      // Named string schema carrying the value-set.  Module atom → the
      // resolver registers it in components and rewrites to a `$ref`.
      return `${schemasModule}.${info.base}`;
    case "valueObject":
      // Module atom → `renderValueObjectSchema`'s module is registered in
      // components under the VO's name, so the `$ref` resolves.
      return `${schemasModule}.${info.base}`;
    case "entity":
      // Containment part → its `<Part>Response`, as a module atom so the
      // part schema is registered in components.
      return `${schemasModule}.${info.base}Response`;
    case "provenanced": {
      // The `Provenanced<T>` carrier, inlined like a value object — the
      // value's own schema plus the opaque nullable lineage object.  Publishing
      // a provenanced field as a bare `T` would make the OpenAPI document
      // disagree with the JSON the controller actually serves.
      const props = provenancedEntries(
        openApiType(info.carried!, schemasModule),
        `${OPENAPI_PRIMITIVE.json}`,
      )
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return `%OpenApiSpex.Schema{type: :object, properties: %{${props}}, required: [:${PROVENANCE_VALUE_FIELD}]}`;
    }
  }
}

/** Declare a nullable property `nullable: true`.
 *
 *  Absence from `required[]` says the key may be OMITTED; it does not say the
 *  value may be `null`.  The emitted serializer builds `"sku" => record.sku` for
 *  every row, nil included, so an optional field's key is ALWAYS present and its
 *  value is `null` — a body the published schema would otherwise forbid.  The three
 *  backends that declare it: node `z.string().nullish()` (a null union), .NET
 *  `string?` under `SupportNonNullableReferenceTypes()` (`nullable: true`), and
 *  python `str | None` (a pydantic anyOf-with-null).
 *
 *  `nullable: true` is the OpenAPI 3.0 spelling, which is the dialect
 *  `OpenApiSpex` emits — and the parity normalizer's `propTypeSig` already folds
 *  it out (`{type: "string", nullable: true}` and `{type: "string"}` sign the
 *  same), so this is documentation-only as far as the cross-backend diff is
 *  concerned.
 *
 *  DELIBERATELY NOT applied to a `$ref`-shaped property (a nullable enum, value
 *  object or containment part).  3.0 forbids a sibling keyword beside `$ref`, so
 *  the valid spelling is `allOf: [$ref] + nullable: true` — and `propTypeSig`
 *  does not fold `allOf`, so it would read as `object` where the other backends
 *  read `ref:<Name>` and the parity gate would report a spurious divergence.
 *  Those properties keep the bare `$ref`. */
function nullableSchema(schema: string, isNullable: boolean): string {
  if (!isNullable) return schema;
  if (!schema.startsWith("%OpenApiSpex.Schema{") || !schema.endsWith("}")) return schema;
  return `${schema.slice(0, -1)}, nullable: true}`;
}

/** Render a list of fields into OpenApiSpex properties + required list.
 *  The `create` slot drops non-nullable `bool` fields from the `required`
 *  list: Phoenix's controller (like Hono's `z.boolean().default(false)` and
 *  .NET's model-binding) treats an omitted CREATE bool as `false`, so no
 *  backend marks create bools required — matching keeps the parity gate
 *  green.  `operation` bodies require them (RS-26). */
/** Which wire slot a schema describes.  Only `create` gets the implicit-bool
 *  optionality (RS-6); `operation` bodies require every declared field (RS-26). */
type SchemaSlot = "response" | "create" | "operation";

function renderProperties(
  fields: Array<{ name: string; type: TypeIR; optional: boolean; wireDefault?: boolean }>,
  schemasModule: string,
  slot: SchemaSlot = "response",
): {
  propsLines: string[];
  requiredAtoms: string[];
} {
  const propsLines: string[] = [];
  const requiredAtoms: string[] = [];

  // Field names land in the spec as the source-level identifier from the
  // `.ddd` source (camelCase by convention, e.g. `createdAt`,
  // `pipelineCount`).  The runtime wire shape — produced by the
  // per-resource `defimpl Jason.Encoder` introduced in PR C — emits the
  // same casing, so the spec and the response body agree.  Snake-casing
  // here would re-introduce the divergence the parity harness reports
  // as `only-phoenix=[created_at,...]`.
  for (const f of fields) {
    const key = f.name;
    const info = wireTypeInfo(f.type, slot === "response" ? "response" : "request");
    propsLines.push(
      `      ${key}: ${nullableSchema(openApiType(f.type, schemasModule), info.isNullable)}`,
    );
    // RS-26: scoped to CREATE.  An omitted create bool is well-defined
    // (`hasImplicitDefault`), but on an OPERATION body — `update` included —
    // there is nothing to construct, so an omitted field is a missing required
    // one.  Marking it optional here would make the SPEC disagree with this
    // backend's own runtime: `@update_required` in the emitted changeset
    // lists every bool, so a client trusting the spec and omitting
    // `active` would get a 422 the spec said would not happen.
    // Consume the create-input seam rather than re-deciding from the type: a
    // hand-rolled copy of `hasImplicitDefault`'s bool arm misses its `array`
    // arm, so the served spec would call a COLLECTION required while this
    // backend's own runtime accepts its omission (`cast_assoc` over an absent
    // key casts no children; a scalar array takes the changeset `__default`).
    // That is the same "document promising what the runtime does not check"
    // failure the RS-26 note above describes, inverted.
    const optionalCreateInput =
      slot === "create" && !isRequiredCreateInput({ optional: f.optional, type: f.type });
    // An explicitly-defaulted request field is optional input (Ash applies
    // the default on omission), so it drops from the required set too.
    if (!f.optional && !optionalCreateInput && !f.wireDefault) requiredAtoms.push(`:${key}`);
  }

  return { propsLines, requiredAtoms };
}

/** Convert WireField[] to the uniform shape renderProperties expects.  A
 *  `mask unless` field is redacted to null for a caller who fails the
 *  predicate, so — like an optional field — it is not required (the same
 *  required set every other backend serves). */
function wireFieldsToProps(
  fields: WireField[],
): Array<{ name: string; type: TypeIR; optional: boolean }> {
  return fields.map((f) => ({
    name: f.name,
    type: f.type,
    optional: f.optional || f.maskUnless !== undefined,
  }));
}

/** Property keys that break the `Jason.Encoder` derive `OpenApiSpex.schema`
 *  performs (a `key: key` match pattern — see `renderSchemaModule`).  Probed
 *  against Elixir 1.18 over every Elixir keyword / special form a `.ddd`
 *  field can be named: only `fn` fails. */
const JASON_DERIVE_UNSAFE_KEYS: ReadonlySet<string> = new Set(["fn"]);

function renderSchemaModule(
  moduleName: string,
  schemaTitle: string,
  fields: Array<{ name: string; type: TypeIR; optional: boolean; wireDefault?: boolean }>,
  schemasModule: string,
  slot: SchemaSlot = "response",
): string {
  const { propsLines, requiredAtoms } = renderProperties(fields, schemasModule, slot);
  const propsBlock = propsLines.length > 0 ? propsLines.join(",\n") : "      # no properties";
  const requiredBlock = requiredAtoms.length > 0 ? `[${requiredAtoms.join(", ")}]` : "[]";
  // `OpenApiSpex.schema` defines a struct over the property keys and, by
  // default, `@derive`s `Jason.Encoder` for it — and Jason's deriving builds a
  // match pattern binding each key to a same-named VARIABLE.  A property named
  // `fn` (a legal `.ddd` field) makes that pattern `fn: fn`, which Elixir
  // rejects ("fn is not allowed in matches").  These schema structs are spec
  // documentation only (never instantiated or encoded), so the derive is
  // dropped for exactly those modules; every other module stays byte-identical.
  const deriveOpt = fields.some((f) => JASON_DERIVE_UNSAFE_KEYS.has(f.name))
    ? ", derive?: false"
    : "";

  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${schemaTitle}",
    type: :object,
    properties: %{
${propsBlock}
    },
    required: ${requiredBlock}
  }${deriveOpt})
end
`;
}

/** The `FileRef` schema module — the wire object a `File` field crosses as. */
function renderFileRefSchema(webModule: string): string {
  return `# Auto-generated.
defmodule ${webModule}.Api.Schemas.FileRef do
  @moduledoc "Reference to a stored file — the wire shape of a \`File\` field."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "FileRef",
    type: :object,
    properties: %{
      url: %OpenApiSpex.Schema{type: :string},
      key: %OpenApiSpex.Schema{type: :string},
      contentType: %OpenApiSpex.Schema{type: :string},
      size: %OpenApiSpex.Schema{type: :integer}
    },
    required: [:url, :key, :contentType, :size]
  })
end
`;
}

/** RFC 7807 ProblemDetails schema module — the shared error body.  Base 5
 *  spec fields + the §3.2 `errors[]` extension (per-field `{ pointer,
 *  message }` array) that the runtime emits on 422 validation responses.
 *  All fields optional — base 5 per the spec core; `errors` is only
 *  present on 422 validation responses (consumed by the frontend ACL's
 * `applyServerErrors`).  validation-error-extension.md —
 *  all three backends (Hono / .NET / Phoenix) declare the same shape in
 *  lockstep so the cross-backend parity gate stays green. */
function renderProblemDetailsSchema(webModule: string): string {
  return `# Auto-generated.
defmodule ${webModule}.Api.Schemas.ProblemDetails do
  @moduledoc "RFC 7807 problem details — the shared cross-backend error body."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "ProblemDetails",
    type: :object,
    properties: %{
      type: %OpenApiSpex.Schema{type: :string},
      title: %OpenApiSpex.Schema{type: :string},
      status: %OpenApiSpex.Schema{type: :integer},
      detail: %OpenApiSpex.Schema{type: :string},
      instance: %OpenApiSpex.Schema{type: :string},
      code: %OpenApiSpex.Schema{type: :string},
      params: %OpenApiSpex.Schema{type: :object, additionalProperties: true, nullable: true},
      errors: %OpenApiSpex.Schema{
        type: :array,
        items: %OpenApiSpex.Schema{
          type: :object,
          required: [:pointer, :message],
          properties: %{
            pointer: %OpenApiSpex.Schema{type: :string},
            message: %OpenApiSpex.Schema{type: :string},
            code: %OpenApiSpex.Schema{type: :string},
            params: %OpenApiSpex.Schema{type: :object, additionalProperties: true, nullable: true}
          }
        }
      }
    }
  })
end
`;
}

function renderEnumSchema(en: EnumIR, webModule: string): string {
  const moduleName = `${webModule}.Api.Schemas.${en.name}`;
  const values = en.values.map((v) => `"${v}"`).join(", ");
  return [
    "# Auto-generated.",
    `defmodule ${moduleName} do`,
    `  @moduledoc "OpenApiSpex schema for #{__MODULE__}."`,
    "",
    "  require OpenApiSpex",
    "",
    "  OpenApiSpex.schema(%{",
    `    title: "${en.name}",`,
    `    type: :string,`,
    `    enum: [${values}]`,
    `  })`,
    `end`,
    "",
  ].join("\n");
}

function renderValueObjectSchema(vo: ValueObjectIR, webModule: string): string {
  const moduleName = `${webModule}.Api.Schemas.${vo.name}`;
  const fields: Array<{ name: string; type: TypeIR; optional: boolean }> = vo.fields.map(
    (f: FieldIR) => ({
      name: f.name,
      type: f.type,
      optional: f.optional,
    }),
  );
  return renderSchemaModule(moduleName, vo.name, fields, `${webModule}.Api.Schemas`);
}

/** The `<Payload>Response` schema module for a declared record payload used as
 *  a workflow command param.  Structurally identical to a value object's
 *  schema (a payload IS a flat record) — only the module name differs, and it
 *  carries the `Response` suffix because that is the name every backend's
 *  wire-type mapper already renders for an `entity` reference. */
function renderPayloadResponseSchema(pl: PayloadIR, webModule: string): string {
  const moduleName = `${webModule}.Api.Schemas.${pl.name}Response`;
  const fields: Array<{ name: string; type: TypeIR; optional: boolean }> = pl.fields.map(
    (f: FieldIR) => ({
      name: f.name,
      type: f.type,
      optional: f.optional,
    }),
  );
  return renderSchemaModule(moduleName, `${pl.name}Response`, fields, `${webModule}.Api.Schemas`);
}

function renderPartResponseSchema(
  part: EnrichedEntityPartIR,
  webModule: string,
  payloads: readonly PayloadIR[],
): string {
  const moduleName = `${webModule}.Api.Schemas.${part.name}Response`;
  // The declared response record's rows — what the controller serves.
  const wireFields = responseWireFor(payloads, part);
  return renderSchemaModule(
    moduleName,
    `${part.name}Response`,
    wireFieldsToProps(wireFields),
    `${webModule}.Api.Schemas`,
  );
}

function renderAggregateResponseSchema(
  agg: EnrichedAggregateIR,
  webModule: string,
  payloads: readonly PayloadIR[],
): string {
  const moduleName = `${webModule}.Api.Schemas.${agg.name}Response`;
  // The declared response record's rows — the read contract the controller's
  // serializer renders too.
  const props = wireFieldsToProps(responseWireFor(payloads, agg));
  return renderSchemaModule(moduleName, `${agg.name}Response`, props, `${webModule}.Api.Schemas`);
}

/** Create-response schema — `{ id }` only, matching Hono/.NET's
 *  `Create<Agg>Response`.  The create endpoint returns just the new id. */
function renderCanResponseSchema(webModule: string): string {
  return `# Auto-generated.
defmodule ${webModule}.Api.Schemas.CanResponse do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "CanResponse",
    type: :object,
    properties: %{
      allowed: %OpenApiSpex.Schema{type: :boolean}
    },
    required: [:allowed]
  })
end
`;
}

/** `AuditEntry` — one entry in an entity's history (docs/audit.md).
 *
 *  Built from the platform-neutral `auditEntryWireShape()`, the same list the
 *  controller's mapper projects, so the published contract and the emitted
 *  bytes cannot describe different keys.  `changes` stays `array of json`
 *  because the shape says so: `before`/`after` hold whatever the aggregate's
 *  wire DTO held for that key, and a typed element would need one schema per
 *  field per aggregate — which is exactly what lets ONE `Timeline` render the
 *  history of ANY audited aggregate. */
function renderAuditEntrySchema(webModule: string): string {
  return renderSchemaModule(
    `${webModule}.Api.Schemas.${AUDIT_ENTRY_TYPE}`,
    AUDIT_ENTRY_TYPE,
    wireFieldsToProps(auditEntryWireShape()),
    `${webModule}.Api.Schemas`,
  );
}

function renderCreateResponseSchema(agg: AggregateIR, webModule: string): string {
  const moduleName = `${webModule}.Api.Schemas.Create${agg.name}Response`;
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "Create${agg.name}Response",
    type: :object,
    properties: %{
      id: ${OPENAPI_ID_SCHEMA}
    },
    required: [:id]
  })
end
`;
}

function renderAggregateListResponseSchema(agg: AggregateIR, webModule: string): string {
  const moduleName = `${webModule}.Api.Schemas.${agg.name}ListResponse`;
  // Array-type schema — wraps the item schema reference
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${agg.name}ListResponse",
    type: :array,
    items: %OpenApiSpex.Reference{"$ref": "#/components/schemas/${agg.name}Response"}
  })
end
`;
}

/** `<Base>Response` — the tagged union of the concretes' responses: each row
 *  is one concrete's own body plus its `type` tag (docs/payloads.md). */
function renderPolymorphicResponseSchema(
  base: AggregateIR,
  tags: readonly string[],
  webModule: string,
): string {
  const moduleName = `${webModule}.Api.Schemas.${base.name}Response`;
  const arms = tags.map(
    (t) => `      %OpenApiSpex.Schema{
        allOf: [
          %OpenApiSpex.Reference{"$ref": "#/components/schemas/${t}Response"},
          %OpenApiSpex.Schema{
            type: :object,
            properties: %{type: %OpenApiSpex.Schema{type: :string, enum: ["${t}"]}},
            required: [:type]
          }
        ]
      }`,
  );
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${base.name}Response",
    anyOf: [
${arms.join(",\n")}
    ]
  })
end
`;
}

/** The documented polymorphic base read: `GET /<bases>` (paged, `page` /
 *  `pageSize` only — the read has one global `id` order) and, on TPH,
 *  `GET /<bases>/{id}`.  Empty when the router does not mount it
 *  (`routedPolymorphicRead`). */
function polymorphicOperations(
  base: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
  aggSlug: string,
  schemasModule: string,
): ElixirApiOperation[] {
  if (!routedPolymorphicRead(base, ctx)) return [];
  const out: ElixirApiOperation[] = [
    {
      method: "get",
      path: `/${aggSlug}`,
      summary: `List ${base.name}`,
      operationId: camelId(opList(base.name)),
      tags: [aggSlug],
      parameters: pagingQueryParams().slice(0, 2),
      responses: [
        jsonResponse(200, "OK", `${schemasModule}.${base.name}Paged`),
        ...statusResponses([422], schemasModule),
      ],
    },
  ];
  if (isTphBase(base, ctx.aggregates)) {
    out.push({
      method: "get",
      path: `/${aggSlug}/{id}`,
      summary: `Get ${base.name} by id`,
      operationId: camelId(opGetById(base.name)),
      tags: [aggSlug],
      parameters: [pathIdParam()],
      responses: [
        jsonResponse(200, "OK", `${schemasModule}.${base.name}Response`),
        ...statusResponses([404, 422], schemasModule),
      ],
    });
  }
  return out;
}

/** The `<Agg>Paged` schema name if any of this aggregate's repository finds
 *  (the implicit `all` included) returns the `paged` wire, else null.  Every
 *  paged find over one aggregate shares the same `<Agg>Paged` envelope, so one
 *  schema module covers them all. */
function pagedFindName(ctx: EnrichedBoundedContextIR, agg: EnrichedAggregateIR): string | null {
  const repo = ctx.repositories.find((r) => r.aggregateName === agg.name);
  for (const find of repo?.finds ?? []) {
    const paged = pagedReturn(find.returnType);
    if (paged) return paged.name;
  }
  return null;
}

/** The four shared paging query controls (`page`/`pageSize`/`sort`/`dir`) as
 *  OpenApiSpex parameter literals — the Phoenix analogue of the Hono
 *  `AllQuery` schema.  All optional (defaulted server-side); the parity
 *  normalizer compares name + type + required only.
 *
 *  `page` / `pageSize` publish the same declared `minimum` / `maximum` the
 *  other four backends do (`PAGED_MAX_PAGE` / `PAGED_MAX_PAGE_SIZE`); the
 *  controller's `page_param/4` bounds to the same ceiling, so an unbounded
 *  `page * pageSize` cannot overflow the SQL `OFFSET` (schemathesis F4). */
function pagingQueryParams(): string[] {
  return [
    `%OpenApiSpex.Parameter{name: :page, in: :query, required: false, schema: %OpenApiSpex.Schema{type: :integer, minimum: 1, maximum: ${PAGED_MAX_PAGE}}}`,
    `%OpenApiSpex.Parameter{name: :pageSize, in: :query, required: false, schema: %OpenApiSpex.Schema{type: :integer, minimum: 1, maximum: ${PAGED_MAX_PAGE_SIZE}}}`,
    "%OpenApiSpex.Parameter{name: :sort, in: :query, required: false, schema: %OpenApiSpex.Schema{type: :string}}",
    "%OpenApiSpex.Parameter{name: :dir, in: :query, required: false, schema: %OpenApiSpex.Schema{type: :string}}",
  ];
}

/** The `<Agg>Paged` envelope schema — an object of
 *  `{ items: <Agg>Response[], page, pageSize, total, totalPages }` with all
 *  five fields required.  Mirrors the Hono zod / .NET `Paged<T>` / Python
 *  `PagedResult` shapes so the conformance-parity property-type + required
 *  sets agree cross-backend (the integer counters carry no `format`, which the
 *  parity normalizer already folds away). */
function renderAggregatePagedResponseSchema(
  agg: AggregateIR,
  pagedName: string,
  webModule: string,
  /** Reference the item schema by module atom, so OpenApiSpex registers it
   *  even where no other operation names it (a TPC base has no by-id read). */
  atomItems = false,
): string {
  const moduleName = `${webModule}.Api.Schemas.${pagedName}`;
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${pagedName}",
    type: :object,
    properties: %{
      items: %OpenApiSpex.Schema{
        type: :array,
        items: ${atomItems ? `${webModule}.Api.Schemas.${agg.name}Response` : `%OpenApiSpex.Reference{"$ref": "#/components/schemas/${agg.name}Response"}`}
      },
      page: %OpenApiSpex.Schema{type: :integer},
      pageSize: %OpenApiSpex.Schema{type: :integer},
      total: %OpenApiSpex.Schema{type: :integer},
      totalPages: %OpenApiSpex.Schema{type: :integer}
    },
    required: [:items, :page, :pageSize, :total, :totalPages]
  })
end
`;
}

function renderCreateRequestSchema(
  agg: AggregateIR,
  webModule: string,
  /** Resolved by the caller over the whole deployable (F-026). */
  schemaName: string,
): string {
  const moduleName = `${webModule}.Api.Schemas.${schemaName}`;
  // Create request carries the canonical create-input set the client may
  // supply.  `createInputFields` = `forCreateInput` (drops `managed`,
  // `token`, `internal`; keeps `immutable` and `secret`) INCLUDING
  // optionals — which ride their own type nullability into the `required`
  // list (see `renderProperties`).  Matches the .NET / Hono / React
  // CreateRequest shapes so the parity gate's property + required sets agree.
  const fields: Array<{ name: string; type: TypeIR; optional: boolean; wireDefault?: boolean }> =
    createInputFields(agg).map((f: FieldIR) => ({
      name: f.name,
      type: f.type,
      optional: f.optional,
      wireDefault: wireCreateDefault(f) !== undefined,
    }));
  return renderSchemaModule(moduleName, schemaName, fields, `${webModule}.Api.Schemas`, "create");
}

function renderOperationRequestSchema(
  op: import("../../../ir/types/loom-ir.js").OperationIR,
  webModule: string,
  /** Resolved by the caller over the whole deployable (F-026) -- owner-qualified
   *  when this name would otherwise collide with a workflow's. */
  schemaName: string,
): string {
  const moduleName = `${webModule}.Api.Schemas.${schemaName}`;
  // Optionality rides on the param's own type nullability — a nullable
  // param (`description?` etc., as crudish's `update` carries through from
  // a nullable field) is NOT required.  Hono derives the same from
  // `zodFor` (nullable → `.nullish()` → optional in OpenAPI); hardcoding
  // `false` here made Phoenix mark those params required and tripped the
  // parity gate's required-set dimension (UpdateProjectRequest drift).
  // A merge-patch update (RS-47) requires no key.
  const patch = isMergePatchUpdate(op);
  const fields: Array<{ name: string; type: TypeIR; optional: boolean }> = op.params.map(
    (p: ParamIR) => ({
      name: p.name,
      type: p.type,
      optional: patch || wireTypeInfo(p.type, "request").isNullable,
    }),
  );
  return renderSchemaModule(
    moduleName,
    schemaName,
    fields,
    `${webModule}.Api.Schemas`,
    "operation",
  );
}

function renderWorkflowRequestSchema(
  wf: import("../../../ir/types/loom-ir.js").WorkflowIR,
  webModule: string,
  /** Resolved by the caller over the whole deployable (F-026). */
  schemaName: string,
): string {
  const moduleName = `${webModule}.Api.Schemas.${schemaName}`;
  const fields: Array<{ name: string; type: TypeIR; optional: boolean }> = wf.params.map(
    (p: ParamIR) => ({
      name: p.name,
      type: p.type,
      optional: false,
    }),
  );
  return renderSchemaModule(
    moduleName,
    schemaName,
    fields,
    `${webModule}.Api.Schemas`,
    "operation",
  );
}

/** Operation-return union DTO — the tagged wire union an exception-less
 *  op's 200 carries (`operation reserve(): Project or ProjectNotFound`).
 *  One `oneOf` arm per variant: the `type` discriminator literal plus the
 *  variant's wire fields (`unionMembers` — the same member specs Hono's
 *  discriminatedUnion and .NET's Application union DTO render), so the
 *  spec's component set + response bodies agree across backends. */
function renderOperationUnionSchema(
  unionName: string,
  members: readonly UnionMember[],
  _ctx: EnrichedBoundedContextIR,
  webModule: string,
): string {
  const schemasModule = `${webModule}.Api.Schemas`;
  const arms = members.map((m) => {
    const tagProp = `        type: %OpenApiSpex.Schema{type: :string, enum: ["${m.tag}"]}`;
    if (m.shape === "none") {
      return `      %OpenApiSpex.Schema{
        type: :object,
        properties: %{
${tagProp}
        },
        required: [:type]
      }`;
    }
    if (m.shape === "scalar") {
      return `      %OpenApiSpex.Schema{
        type: :object,
        properties: %{
${tagProp},
        value: ${openApiType(m.type, schemasModule)}
        },
        required: [:type, :value]
      }`;
    }
    const { propsLines, requiredAtoms } = renderProperties(
      m.fields.map((f) => ({ name: f.name, type: f.type, optional: f.optional })),
      schemasModule,
    );
    const indented = propsLines.map((l) => `  ${l}`);
    return `      %OpenApiSpex.Schema{
        type: :object,
        properties: %{
${[tagProp, ...indented].join(",\n")}
        },
        required: [${[":type", ...requiredAtoms].join(", ")}]
      }`;
  });
  return `# Auto-generated.
defmodule ${schemasModule}.${unionName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${unionName}",
    oneOf: [
${arms.join(",\n")}
    ]
  })
end
`;
}

/** An operation-return union's error-arm problem body (M-FT.24): the shared
 *  ProblemDetails plus the arm's fields, required — the controller merges the
 *  arm's whole value into the problem it answers. */
function renderErrorArmProblemSchema(arm: OpUnionErrorArm, webModule: string): string {
  const schemasModule = `${webModule}.Api.Schemas`;
  const { propsLines, requiredAtoms } = renderProperties(
    arm.fields.map((f) => ({ name: f.name, type: f.type, optional: f.optional })),
    schemasModule,
  );
  const indented = propsLines.map((l) => `    ${l}`);
  return `# Auto-generated.
defmodule ${schemasModule}.${arm.problemName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${arm.problemName}",
    allOf: [
      ${schemasModule}.ProblemDetails,
      %OpenApiSpex.Schema{
        type: :object,
        properties: %{
${indented.join(",\n")}
        },
        required: [${requiredAtoms.join(", ")}]
      }
    ]
  })
end
`;
}

/** Observable-workflow instance response — the `instanceWireShape`
 *  projection (correlation id + folded state fields), the saga analogue of
 *  an aggregate's `<Agg>Response`.  Required set mirrors Hono/Python: every
 *  non-optional wire field. */
function renderWorkflowInstanceResponseSchema(
  wf: import("../../../ir/types/loom-ir.js").WorkflowIR,
  webModule: string,
): string {
  const schemasModule = `${webModule}.Api.Schemas`;
  const schemaName = `${upperFirst(wf.name)}InstanceResponse`;
  return renderSchemaModule(
    `${schemasModule}.${schemaName}`,
    schemaName,
    wireFieldsToProps(wf.instanceWireShape ?? []),
    schemasModule,
  );
}

/** The named array carrier for the instance list — items reference the
 *  instance response MODULE so OpenApiSpex registers + `$ref`s it (same
 *  pattern as `renderViewResponseSchema`). */
function renderWorkflowInstanceListResponseSchema(
  wf: import("../../../ir/types/loom-ir.js").WorkflowIR,
  webModule: string,
): string {
  const schemasModule = `${webModule}.Api.Schemas`;
  const schemaName = `${upperFirst(wf.name)}InstanceListResponse`;
  return `# Auto-generated.
defmodule ${schemasModule}.${schemaName} do
  @moduledoc "OpenApiSpex schema for #{__MODULE__}."

  require OpenApiSpex

  OpenApiSpex.schema(%{
    title: "${schemaName}",
    type: :array,
    items: ${schemasModule}.${upperFirst(wf.name)}InstanceResponse
  })
end
`;
}

// ---------------------------------------------------------------------------
// OpenAPI controller renderer
// ---------------------------------------------------------------------------

function renderOpenapiController(_appModule: string, webModule: string, apiPascal: string): string {
  const specModule = `${webModule}.Api.${apiPascal}Spec`;
  return `# Auto-generated.
defmodule ${webModule}.OpenapiController do
  use ${webModule}, :controller

  @moduledoc """
  Serves the OpenAPI spec as JSON.

  GET /openapi.json → returns the full spec generated by #{${specModule}}.
  """

  @doc "GET /openapi.json"
  def index(conn, _params) do
    spec = ${specModule}.spec()
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, Jason.encode!(spec))
  end
end
`;
}
