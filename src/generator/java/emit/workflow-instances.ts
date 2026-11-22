import {
  eventSourcedWorkflows,
  observableWorkflows,
  workflowStreamType,
} from "../../../ir/plan/index.js";
import type { EnrichedBoundedContextIR, WireField, WorkflowIR } from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { workflowCorrWireField } from "../../../ir/util/workflow-instances.js";
import { lines } from "../../../util/code-builder.js";
import { snake } from "../../../util/naming.js";
import { javaRef } from "../../_imports/java.js";
import {
  camelId,
  DOMAIN_NAMES,
  opWorkflowInstanceById,
  opWorkflowInstances,
} from "../../_symbols/plan.js";
import { jsonProp } from "../java-ident.js";
import { J } from "../java-symbols.js";
import { renderJavaExpr } from "../render-expr.js";
import { javaNotFoundThrow } from "./common.js";
import {
  javaRecordSchemaAnnotation,
  javaWorkflowInstanceByIdDoc,
  requiredWireFields,
} from "./openapi-docs.js";
import { domainToWire, javaIdValueType, wireJavaType } from "./wire.js";
import {
  esEventLogTable,
  esWorkflowCorrIdClass,
  esWorkflowStateClass,
} from "./workflow-eventsourced.js";
import { workflowStateClass } from "./workflow-state.js";

// ---------------------------------------------------------------------------
// Read-only workflow-instance endpoints (workflow-instance-visibility.md),
// Java saga.  For every observable workflow (a correlation-state row +
// enriched `instanceWireShape`) emit an instance Response record and a
// controller exposing `GET /workflows/<snake>/instances` (list) +
// `/instances/{id}` (one by correlation id, 404 if absent) over the persisted
// `<Wf>State` saga row the dispatcher upserts.  The read-side analogue of an
// aggregate's GET list / GET-by-id, mirroring the .NET / python / Hono /
// elixir-vanilla instance reads.  Driven off `instanceWireShape` independently
// of the command route, so an event-triggered-only saga is still observed.
//
// The row is read through the saga-state Spring Data `<Wf>StateRepository`
// `findAll()` for the list, `findById(<Corr>Id)` for one.  Each row
// projects through `instanceWireShape` (the same camelCase wire key the .NET
// `<Wf>InstanceResponse` uses), id → `.value()`, datetime/money ISO-/plain-
// coded exactly like the aggregate `<Agg>Response`.
// ---------------------------------------------------------------------------

export interface WorkflowInstancesCtx {
  basePkg: string;
  /** Instance-response DTO package (application.workflows). */
  pkg: string;
  /** Route prefix ("/api" — the shared API base path). */
  routePrefix?: string;
  /** Saga-state Spring Data repository package (infrastructure.repositories). */
  stateRepoPkg: string;
  /** The workflows' owning-context Postgres schema — qualifies the ES saga
   *  stream in native SQL to match the migration.  Undefined ⇒ unqualified. */
  contextSchema?: string;
}

/** The saga-state repository field name (`orderFulfillmentStateRepository`). */
function stateRepoField(wf: WorkflowIR): string {
  return `${DOMAIN_NAMES.java.stem(wf.name)}StateRepository`;
}

/** The correlation field's wire row (`source: "id"`) — its id targetName +
 *  value type drive the `{id}` path-param type and `new <Corr>Id(id)` wrap.
 *  Shared with the other backends via `ir/util/workflow-instances.ts`. */
const corrWireField = workflowCorrWireField;

export function renderJavaWorkflowInstanceReads(
  ctx: EnrichedBoundedContextIR,
  wctx: WorkflowInstancesCtx,
): Map<string, { category: "workflow-service" | "api-common"; content: string }> | null {
  const observable = observableWorkflows(ctx.workflows);
  if (observable.length === 0) return null;
  const out = new Map<string, { category: "workflow-service" | "api-common"; content: string }>();

  for (const wf of observable) {
    out.set(`${DOMAIN_NAMES.java.type(wf.name)}InstanceResponse.java`, {
      category: "workflow-service",
      content: renderInstanceResponseDto(wf, wctx),
    });
  }
  const readsOut = { content: "" };
  out.set(`${ctx.name}WorkflowInstancesController.java`, {
    category: "api-common",
    content: renderInstancesController(ctx, observable, wctx, readsOut),
  });
  out.set(`${javaInstanceReadsClass(ctx)}.java`, {
    category: "workflow-service",
    content: readsOut.content,
  });
  return out;
}

/** The instance Response record — `instanceWireShape` projected to wire types,
 *  the workflow-instance analogue of an aggregate's `<Agg>Response`. */
function renderInstanceResponseDto(wf: WorkflowIR, wctx: WorkflowInstancesCtx): string {
  const shape = wf.instanceWireShape ?? [];
  const wireImports = new Set<string>();
  const components = shape.map((f) => {
    guardInstanceField(wf, f);
    return `${jsonProp(f.name, wireImports)}${wireJavaType(f.type, "Response")} ${DOMAIN_NAMES.java.prop(f.name)}`;
  });
  return lines(
    `package ${wctx.pkg};`,
    ``,
    ...[...wireImports].sort().map((i) => `import ${i};`),
    wireImports.size > 0 ? `` : null,
    `import ${wctx.basePkg}.domain.enums.*;`,
    `import ${wctx.basePkg}.domain.ids.*;`,
    `import ${wctx.basePkg}.domain.valueobjects.*;`,
    ``,
    javaRecordSchemaAnnotation({ required: requiredWireFields(shape) }),
    `public record ${DOMAIN_NAMES.java.type(wf.name)}InstanceResponse(${components.join(", ")}) {`,
    `}`,
    ``,
  );
}

/** One controller per context exposing every observable workflow's instances
 *  as `GET workflows/<snake>/instances` + `.../instances/{id}`, reading the
 *  saga-state via its Spring Data repository and projecting each row through
 *  `instanceWireShape`. */
function renderInstancesController(
  ctx: EnrichedBoundedContextIR,
  workflows: WorkflowIR[],
  wctx: WorkflowInstancesCtx,
  /** Receives the `<Ctx>WorkflowInstanceReads` service the controller calls. */
  readsOut: { content: string },
): string {
  const className = `${ctx.name}WorkflowInstancesController`;
  const forbidden = javaRef(`${wctx.basePkg}.domain.common`, "ForbiddenException");
  const accessor = javaRef(`${wctx.basePkg}.auth`, "CurrentUserAccessor");
  const stateWfs = workflows.filter((wf) => !wf.eventSourced);
  const esWfs = eventSourcedWorkflows(workflows);
  // ES instance reads fold the `<wf>_events` stream over a shared JdbcTemplate
  // (no mutable state repo); needs `ArrayList` for the fold accumulator.
  const esPresent = esWfs.length > 0;

  // The instance-READ gate (`workflow X requires <expr>`): bind the principal
  // (only when the predicate reads it), then 403 BEFORE the read.  Collected
  // across workflows because the import set and the accessor injection are
  // controller-wide decisions — the same shape the projections controller uses.
  let anyGateUsesUser = false;
  for (const wf of workflows) {
    const g = wf.instanceReadGate;
    if (g && exprUsesCurrentUser(g)) anyGateUsesUser = true;
  }
  const gateLines = (wf: WorkflowIR): string[] => {
    const g = wf.instanceReadGate;
    if (!g) return [];
    const gl: string[] = [];
    if (exprUsesCurrentUser(g)) gl.push(`        var currentUser = currentUserAccessor.user();`);
    gl.push(
      `        if (!(${renderJavaExpr(g, { thisName: "this" })})) throw new ${forbidden}(${JSON.stringify(
        `Forbidden: workflow ${wf.name} instances`,
      )});`,
    );
    return gl;
  };

  const routes: string[] = [];
  const reads: string[] = [];
  const readsField = "instanceReads";
  for (const wf of workflows) {
    const T = `${DOMAIN_NAMES.java.type(wf.name)}InstanceResponse`;
    const slug = snake(wf.name);
    const corr = corrWireField(wf);
    const idJava = javaIdValueType();
    // The `{id}` param binds the correlation id's Java value type (UUID / int /
    // long / String), so springdoc emits the matching param schema — parity
    // with Hono / .NET / Python / Phoenix by construction.
    const paramJava = idJava;
    const shape = wf.instanceWireShape ?? [];
    const proj = (rowVar: string): string =>
      shape
        .map((f) => domainToWire(f.type, `${rowVar}.${DOMAIN_NAMES.java.prop(f.name)}()`))
        .join(", ");
    // The read bodies live in `<Ctx>WorkflowInstanceReads`, which the routes and
    // an explicit query handler's instance read both call.  They diverge on
    // `wf.eventSourced`: a state-based saga reads its `<Wf>State` Spring Data
    // repository, while an event-sourced workflow folds the per-correlation
    // `<wf>_events` stream — the list groups every event row by stream_id and
    // folds each via `_fromEvents`; the by-id read folds one stream (empty →
    // absent).  Projection, operationIds and paths are identical either way.
    if (wf.eventSourced) {
      const cls = esWorkflowStateClass(wf);
      const corrId = esWorkflowCorrIdClass(wf);
      // The single per-context event log; this workflow's instances are the
      // rows tagged `stream_type = "<Wf>"`.
      const table = esEventLogTable(ctx.name, wctx.contextSchema);
      const streamType = workflowStreamType(wf);
      reads.push(
        `    public List<${T}> ${javaInstancesReadMethod(wf)}() {`,
        `        var __rows = jdbc.queryForList(`,
        `            "select stream_id, type, data from ${table} where stream_type = ? order by stream_id, version", "${streamType}");`,
        `        var __byStream = new ${LINKED_HASH_MAP}<String, List<DomainEvent>>();`,
        `        for (var __r : __rows) {`,
        `            var __sid = (String) __r.get("stream_id");`,
        `            __byStream.computeIfAbsent(__sid, __k -> new ${ARRAY_LIST}<>())`,
        `                .add(${cls}._rowToEvent((String) __r.get("type"), String.valueOf(__r.get("data"))));`,
        `        }`,
        `        return __byStream.entrySet().stream()`,
        `            .map(__e -> ${cls}._fromEvents(new ${corrId}(${idFromString("__e.getKey()", idJava)}), __e.getValue()))`,
        `            .map(x -> new ${T}(${proj("x")}))`,
        `            .toList();`,
        `    }`,
        ``,
        `    public ${OPTIONAL}<${T}> ${javaInstanceReadMethod(wf)}(${paramJava} id) {`,
        `        var __sid = ${idJava === "String" ? "id" : "String.valueOf(id)"};`,
        `        var __rows = jdbc.queryForList(`,
        `            "select type, data from ${table} where stream_type = ? and stream_id = ? order by version", "${streamType}", __sid);`,
        `        if (__rows.isEmpty()) return ${OPTIONAL}.empty();`,
        `        var __loaded = new ${ARRAY_LIST}<DomainEvent>();`,
        `        for (var __r : __rows) __loaded.add(${cls}._rowToEvent((String) __r.get("type"), String.valueOf(__r.get("data"))));`,
        `        var x = ${cls}._fromEvents(new ${corrId}(id), __loaded);`,
        `        return ${OPTIONAL}.of(new ${T}(${proj("x")}));`,
        `    }`,
        ``,
      );
    } else {
      const repo = stateRepoField(wf);
      const idClass = `${idTargetName(corr)}Id`;
      reads.push(
        `    public List<${T}> ${javaInstancesReadMethod(wf)}() {`,
        `        return ${repo}.findAll().stream()`,
        `            .map(x -> new ${T}(${proj("x")}))`,
        `            .toList();`,
        `    }`,
        ``,
        `    public ${OPTIONAL}<${T}> ${javaInstanceReadMethod(wf)}(${paramJava} id) {`,
        `        return ${repo}.findById(new ${idClass}(id)).map(x -> new ${T}(${proj("x")}));`,
        `    }`,
        ``,
      );
    }
    routes.push(
      `    @GetMapping("/${slug}/instances")`,
      `    public List<${T}> ${camelId(opWorkflowInstances(wf.name))}() {`,
      ...gateLines(wf),
      `        return ${readsField}.${javaInstancesReadMethod(wf)}();`,
      `    }`,
      ``,
      `    @GetMapping("/${slug}/instances/{id}")`,
      ...javaWorkflowInstanceByIdDoc(ctx, wctx.basePkg),
      `    public ResponseEntity<${T}> ${camelId(opWorkflowInstanceById(wf.name))}(@PathVariable ${paramJava} id) {`,
      ...gateLines(wf),
      // M-T6.31 — the shared carrier, not Spring's own empty-bodied 404: the
      // instance show answers the same envelope as every other 404, with the
      // node/python sentence (`<Wf> <id> not found`).
      `        return ${readsField}.${javaInstanceReadMethod(wf)}(id)`,
      `            .map(ResponseEntity::ok)`,
      `            .orElseThrow(() -> ${javaNotFoundThrow(DOMAIN_NAMES.java.type(wf.name), "id")});`,
      `    }`,
      ``,
    );
  }
  while (routes[routes.length - 1] === "") routes.pop();
  while (reads[reads.length - 1] === "") reads.pop();

  // The reads class injects a Spring Data repo per state-based saga + a single
  // shared JdbcTemplate when any ES workflow folds its stream.
  const readsFields = [
    ...stateWfs.map(
      (wf) => `    private final ${workflowStateClass(wf)}Repository ${stateRepoField(wf)};`,
    ),
    ...(esPresent ? [`    private final ${JDBC_TEMPLATE} jdbc;`] : []),
  ];
  const readsCtorParams = [
    ...stateWfs.map((wf) => `${workflowStateClass(wf)}Repository ${stateRepoField(wf)}`),
    ...(esPresent ? [`${JDBC_TEMPLATE} jdbc`] : []),
  ].join(", ");
  const readsCtorAssigns = [
    ...stateWfs.map((wf) => `        this.${stateRepoField(wf)} = ${stateRepoField(wf)};`),
    ...(esPresent ? ["        this.jdbc = jdbc;"] : []),
  ];
  const readsClass = javaInstanceReadsClass(ctx);
  readsOut.content = lines(
    `package ${wctx.pkg};`,
    ``,
    `import java.util.List;`,
    ``,
    `import org.springframework.stereotype.Service;`,
    `import org.springframework.transaction.annotation.Transactional;`,
    ``,
    stateWfs.length > 0 ? `import ${wctx.stateRepoPkg}.*;` : null,
    esPresent ? `import ${wctx.basePkg}.domain.events.*;` : null,
    `import ${wctx.basePkg}.domain.ids.*;`,
    ``,
    `/** The observable workflows' instance reads — called by the instance routes`,
    ` *  and by an explicit query handler's instance read. */`,
    `@Service`,
    `@Transactional(readOnly = true)`,
    `public class ${readsClass} {`,
    ...readsFields,
    ``,
    `    public ${readsClass}(${readsCtorParams}) {`,
    ...readsCtorAssigns,
    `    }`,
    ``,
    ...reads,
    `}`,
    ``,
  );

  const fieldDecls = [
    `    private final ${readsClass} ${readsField};`,
    ...(anyGateUsesUser ? [`    private final ${accessor} currentUserAccessor;`] : []),
  ];
  const ctorParams = [
    `${readsClass} ${readsField}`,
    ...(anyGateUsesUser ? [`${accessor} currentUserAccessor`] : []),
  ].join(", ");
  const ctorAssigns = [
    `        this.${readsField} = ${readsField};`,
    ...(anyGateUsesUser ? ["        this.currentUserAccessor = currentUserAccessor;"] : []),
  ];

  return lines(
    `package ${wctx.basePkg}.api;`,
    ``,
    `import java.util.List;`,
    ``,
    `import org.springframework.http.ResponseEntity;`,
    `import org.springframework.web.bind.annotation.*;`,
    ``,
    // The 404 carrier the instance show raises — unconditional, since every
    // instance-bearing workflow emits a show route.
    `import ${wctx.basePkg}.domain.common.AggregateNotFoundException;`,
    `import ${wctx.pkg}.*;`,
    ``,
    `@RestController`,
    `@RequestMapping("${wctx.routePrefix ?? ""}/workflows")`,
    `public class ${className} {`,
    ...fieldDecls,
    ``,
    `    public ${className}(${ctorParams}) {`,
    ...ctorAssigns,
    `    }`,
    ``,
    ...routes,
    `}`,
    ``,
  );
}

/** `<Ctx>WorkflowInstanceReads` — the context's instance-read service. */
export function javaInstanceReadsClass(ctx: { name: string }): string {
  return `${ctx.name}WorkflowInstanceReads`;
}

/** The field an explicit query handler injects the instance-read service under. */
export const JAVA_INSTANCE_READS_FIELD = "workflowInstanceReads";

/** `list<Wf>Instances` — the instance list read. */
export function javaInstancesReadMethod(wf: { name: string }): string {
  return `list${DOMAIN_NAMES.java.type(wf.name)}Instances`;
}

/** `find<Wf>Instance` — the by-correlation-id read (`Optional`). */
export function javaInstanceReadMethod(wf: { name: string }): string {
  return `find${DOMAIN_NAMES.java.type(wf.name)}Instance`;
}

const OPTIONAL = javaRef("java.util", "Optional");
const ARRAY_LIST = javaRef("java.util", "ArrayList");
const LINKED_HASH_MAP = javaRef("java.util", "LinkedHashMap");
const JDBC_TEMPLATE = javaRef("org.springframework.jdbc.core", "JdbcTemplate");

/** Convert a stream_id `String` back to the correlation id's value type so a
 *  folded ES instance can wrap it in `new <Corr>Id(...)`.  The stream_id column
 *  stores `String.valueOf(key.value())`, so the inverse depends on the value
 *  type (UUID → `UUID.fromString`, numeric → parse, string → identity). */
function idFromString(expr: string, idJava: string): string {
  switch (idJava) {
    case J.UUID:
      return `${J.UUID}.fromString(${expr})`;
    case "int":
      return `Integer.parseInt(${expr})`;
    case "long":
      return `Long.parseLong(${expr})`;
    default:
      return expr;
  }
}

function idTargetName(f: WireField): string {
  const t = f.type.kind === "optional" ? f.type.inner : f.type;
  if (t.kind !== "id")
    throw new Error("java workflow-instances: correlation field must be id-typed");
  return t.targetName;
}

/** A VO-typed saga-state field projects through its `<Vo>Response` record,
 *  which `renderReadModelVoResponseDtos` co-locates in `application.workflows`
 *  (`domainToWire` emits `<Vo>Response.from(...)`).  An entity (containment
 *  part) type would need a `<Part>Response` DTO — but a part type never
 *  resolves in workflow scope (parts are private to their aggregate — the rule
 *  lives in `ddd-scope.ts`, so `workflow W { line: Line }` never links), so this
 *  arm is an INTERNAL INVARIANT, not a backend gap.  The
 *  `loom.java-workflow-instance-field-unsupported` code that used to mirror it
 *  was retired as a phantom (M-T6.36); the unreachability is pinned instead by
 *  `test/generator/java/generator-java-readmodel-gates.test.ts`. */
function guardInstanceField(wf: WorkflowIR, f: WireField): void {
  const t = f.type.kind === "optional" ? f.type.inner : f.type;
  const leaf =
    t.kind === "array" ? (t.element.kind === "optional" ? t.element.inner : t.element) : t;
  if (leaf.kind === "entity") {
    throw new Error(
      `java workflow-instances: instance field '${f.name}' of '${wf.name}' is entity-typed — unreachable: a part type never resolves in workflow scope.`,
    );
  }
}
