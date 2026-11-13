import { reasonPhrase } from "../../../ir/enrich/wire-policy.js";
import type { EnrichedBoundedContextIR, WireField, WorkflowIR } from "../../../ir/types/loom-ir.js";
import {
  workflowCanAnswerNotFound,
  workflowEmitsCommandRoute,
  workflowIsGuarded,
} from "../../../ir/types/loom-ir.js";
import { commandBodyOptional } from "../../../ir/util/command-body.js";
import { errorStatuses, PROBLEM_JSON, PROBLEM_SCHEMA } from "../../../ir/util/openapi-errors.js";
import {
  commandCreateEntryResult,
  commandCreateResult,
} from "../../../ir/util/workflow-command-route.js";
import { lines } from "../../../util/code-builder.js";
import { resolveErrorStatus } from "../../../util/error-defaults.js";
import { lowerFirst } from "../../../util/naming.js";
import type { RequestComponentOwner } from "../../_openapi/request-component-names.js";
import {
  type OpUnionResponses,
  opUnionResponses,
  type UnionMember,
} from "../../_payload/union-wire.js";
import { wireJavaType } from "./wire.js";

// ---------------------------------------------------------------------------
// The OpenAPI document springdoc publishes is built from source metadata only
// (D-OPENAPI-FRAMEWORK-NATIVE): `application.yml` sets the success media type,
// each controller method carries `@ApiResponse` / `@Operation` /
// `@RequestBody` annotations derived from the same `ApiOperationIR` entry the
// method renders, records carry `@Schema(requiredProperties = …)`, enums
// `@Schema(enumAsRef = true)`, and the bodies springdoc cannot read off a
// method's return type (the RFC 7807 problem body, an operation-return
// union's success arms and error-arm problems, the empty request of a
// param-less command) are declared as schema-only Java types it reads through
// `implementation =`.  Nothing edits the generated document.
//
// Every swagger annotation and contract type is spelled fully qualified: a
// controller imports its feature packages on demand, and a user aggregate
// named `Schema`, `Content` or `Operation` would otherwise shadow it.
// ---------------------------------------------------------------------------

const OAS = "io.swagger.v3.oas.annotations";
const SCHEMA = `${OAS}.media.Schema`;

/** Package of the schema-only contract types (ProblemDetails, empty requests). */
export function javaContractPkg(basePkg: string): string {
  return `${basePkg}.api.contract`;
}

/** The fully-qualified class springdoc reads the RFC 7807 body from. */
function javaProblemDetailsClass(basePkg: string): string {
  return `${javaContractPkg(basePkg)}.${PROBLEM_SCHEMA}`;
}

/** What one controller method publishes, beyond what springdoc infers from
 *  its mapping and signature. */
export interface JavaRouteDoc {
  /** The 2xx the route answers.  Its body is inferred from the return type
   *  unless `schemaClass` / `arrayOf` names it (a `ResponseEntity<?>` route). */
  success: { status: number; schemaClass?: string; arrayOf?: string };
  /** RFC 7807 statuses the route declares, each carrying ProblemDetails. */
  errors: readonly number[];
  /** Statuses whose problem body is `anyOf` ProblemDetails and these
   *  extension classes (an operation-return union's error arms). */
  errorExtensions?: ReadonlyMap<number, readonly string[]>;
  operationId?: string;
  /** Request body class for a route whose method binds no typed body (a
   *  param-less command publishes its named empty request). */
  requestBodyClass?: string;
}

const SUCCESS_PHRASE: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
};

/** The annotation lines for one controller method (4-space indent).  Every
 *  response is listed explicitly: springdoc drops its inferred 2xx as soon as a
 *  method declares any `@ApiResponse`. */
export function javaRouteDocAnnotations(basePkg: string, doc: JavaRouteDoc): string[] {
  const out: string[] = [];
  if (doc.operationId)
    out.push(`    @${OAS}.Operation(operationId = ${JSON.stringify(doc.operationId)})`);
  if (doc.requestBodyClass) {
    out.push(
      `    @${OAS}.parameters.RequestBody(content = @${OAS}.media.Content(schema = @${SCHEMA}(implementation = ${doc.requestBodyClass}.class)))`,
    );
  }
  const { success } = doc;
  const successContent = success.schemaClass
    ? `, content = @${OAS}.media.Content(schema = @${SCHEMA}(implementation = ${success.schemaClass}.class))`
    : success.arrayOf
      ? `, content = @${OAS}.media.Content(array = @${OAS}.media.ArraySchema(schema = @${SCHEMA}(implementation = ${success.arrayOf}.class)))`
      : "";
  out.push(
    `    @${OAS}.responses.ApiResponse(responseCode = "${success.status}", description = ${JSON.stringify(SUCCESS_PHRASE[success.status] ?? "OK")}${successContent})`,
  );
  const problem = javaProblemDetailsClass(basePkg);
  for (const status of [...new Set(doc.errors)].sort((a, b) => a - b)) {
    const ext = doc.errorExtensions?.get(status);
    const schema = ext?.length
      ? `@${SCHEMA}(anyOf = {${[problem, ...ext].map((c) => `${c}.class`).join(", ")}})`
      : `@${SCHEMA}(implementation = ${problem}.class)`;
    out.push(
      `    @${OAS}.responses.ApiResponse(responseCode = "${status}", description = ${JSON.stringify(reasonPhrase(status))}, content = @${OAS}.media.Content(mediaType = ${JSON.stringify(PROBLEM_JSON)}, schema = ${schema}))`,
    );
  }
  return out;
}

/** `@Schema(…)` line placed above a record: its published name when it
 *  differs from the class name, and the fields every other backend marks
 *  required (springdoc marks only `@NotNull` members on its own).  `null`
 *  when there is nothing to say. */
export function javaRecordSchemaAnnotation(opts: {
  name?: string;
  required?: readonly string[];
  extra?: string;
}): string | null {
  const parts: string[] = [];
  if (opts.name) parts.push(`name = ${JSON.stringify(opts.name)}`);
  if (opts.extra) parts.push(opts.extra);
  if (opts.required && opts.required.length > 0) {
    parts.push(
      `requiredProperties = {${[...opts.required]
        .sort()
        .map((f) => JSON.stringify(f))
        .join(", ")}}`,
    );
  }
  return parts.length > 0 ? `@${SCHEMA}(${parts.join(", ")})` : null;
}

/** The required list for a response/wire record: the id (always present) plus
 *  every non-optional field.  A `mask unless` field is redacted to null for a
 *  caller who fails the predicate, so it is nullable and not required. */
export function requiredWireFields(fields: readonly WireField[]): string[] {
  return fields
    .filter((w) => w.source === "id" || (!w.optional && w.maskUnless === undefined))
    .map((w) => w.name);
}

/** Required params of a command request record: every param that is not
 *  optional-typed (an omitted body-bool is a missing required param, not a
 *  `false`, because a command body constructs nothing). */
export function requiredParams(
  params: readonly { name: string; type: { kind: string } }[],
): string[] {
  return params.filter((p) => p.type.kind !== "optional").map((p) => p.name);
}

export interface JavaContractFile {
  /** Class name (the file is `<name>.java`). */
  name: string;
  content: string;
}

/** The RFC 7807 body every error response declares: the core members, the
 *  `code` / `params` a client localizes by, and the §3.2 `errors[]`
 *  validation extension.  Schema-only — the runtime body is Spring's
 *  `ProblemDetail`, whose extension members springdoc cannot see. */
export function renderJavaProblemDetailsFiles(basePkg: string): JavaContractFile[] {
  const pkg = javaContractPkg(basePkg);
  return [
    {
      name: PROBLEM_SCHEMA,
      content: lines(
        `package ${pkg};`,
        ``,
        `import java.util.List;`,
        `import java.util.Map;`,
        ``,
        `/** The RFC 7807 problem body the API answers errors with (OpenAPI schema). */`,
        `@${SCHEMA}(name = ${JSON.stringify(PROBLEM_SCHEMA)})`,
        `public record ${PROBLEM_SCHEMA}(String type, String title, Integer status, String detail, String instance, String code,`,
        `        @${SCHEMA}(nullable = true) Map<String, Object> params,`,
        `        @${SCHEMA}(nullable = true) List<${PROBLEM_SCHEMA}Error> errors) {`,
        `}`,
        ``,
      ),
    },
    {
      name: `${PROBLEM_SCHEMA}Error`,
      content: lines(
        `package ${pkg};`,
        ``,
        `import java.util.Map;`,
        ``,
        `/** One entry of a problem body's \`errors[]\` validation extension (OpenAPI schema). */`,
        `@${SCHEMA}(name = ${JSON.stringify(`${PROBLEM_SCHEMA}Error`)}, requiredProperties = {"message", "pointer"})`,
        `public record ${PROBLEM_SCHEMA}Error(String pointer, String message, String code,`,
        `        @${SCHEMA}(nullable = true) Map<String, Object> params) {`,
        `}`,
        ``,
      ),
    },
  ];
}

/** The named empty request a param-less command publishes (the other backends
 *  bind `{}` under this name; the method itself binds no typed body). */
export function renderJavaEmptyRequestFile(basePkg: string, name: string): JavaContractFile {
  return {
    name,
    content: lines(
      `package ${javaContractPkg(basePkg)};`,
      ``,
      `/** The empty request body of a param-less command (OpenAPI schema). */`,
      `@${SCHEMA}(name = ${JSON.stringify(name)}, type = "object")`,
      `public record ${name}() {`,
      `}`,
      ``,
    ),
  };
}

/** Published names of the empty requests the deployable's param-less public
 *  operations and command workflows bind. */
export function javaEmptyRequestNames(
  contexts: readonly EnrichedBoundedContextIR[],
  reqNameFor: (owner: RequestComponentOwner) => string,
): string[] {
  const names = new Set<string>();
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      if (agg.isAbstract) continue;
      for (const op of agg.operations) {
        if (op.visibility === "public" && commandBodyOptional(op.params)) {
          names.add(reqNameFor({ kind: "operation", aggregate: agg.name, operation: op.name }));
        }
      }
    }
    for (const wf of ctx.workflows) {
      if (workflowEmitsCommandRoute(wf) && commandBodyOptional(wf.params)) {
        names.add(reqNameFor({ kind: "workflow", workflow: wf.name }));
      }
    }
  }
  return [...names].sort();
}

/** Class names of an operation-return union's schema-only types, in the
 *  package of its wire records. */
export function unionSuccessClass(split: OpUnionResponses): string {
  return `${split.successName}Schema`;
}
function unionProblemClass(problemName: string): string {
  return `${problemName}Schema`;
}

/** The schema-only types of an operation-return union's OpenAPI split: the
 *  200 body (`<Success>` = `oneOf` over the success arms, each tagged by its
 *  `type`) and each error arm's problem body (`<Tag>Problem` = ProblemDetails
 *  plus the arm's fields, required).  The runtime wire is the Jackson
 *  `<Union>Response` family; springdoc cannot read the split off it, because
 *  the controller answers `ResponseEntity<?>`. */
export function renderJavaUnionDocFiles(
  split: OpUnionResponses,
  pkg: string,
  basePkg: string,
): JavaContractFile[] {
  const files: JavaContractFile[] = [];
  const successClass = unionSuccessClass(split);
  const armClass = (m: UnionMember): string => `${successClass}_${m.tag}`;
  files.push({
    name: successClass,
    content: lines(
      `package ${pkg};`,
      ``,
      `/** The 200 body of the \`${split.unionName}\` union: its success arms (OpenAPI schema). */`,
      `@${SCHEMA}(name = ${JSON.stringify(split.successName)}, oneOf = {${split.success.map((m) => `${armClass(m)}.class`).join(", ")}})`,
      `public sealed interface ${successClass} permits ${split.success.map(armClass).join(", ")} {`,
      `}`,
      ``,
    ),
  });
  for (const m of split.success) {
    const comps = [`@${SCHEMA}(allowableValues = {${JSON.stringify(m.tag)}}) String type`];
    const required = ["type"];
    if (m.shape === "scalar") {
      comps.push(`${wireJavaType(m.type, "Response")} value`);
      required.push("value");
    } else if (m.shape === "record") {
      for (const f of m.fields) {
        const t =
          f.optional && f.type.kind !== "optional"
            ? { kind: "optional" as const, inner: f.type }
            : f.type;
        comps.push(`${wireJavaType(t, "Response")} ${f.name}`);
        if (!f.optional) required.push(f.name);
      }
    }
    files.push({
      name: armClass(m),
      content: lines(
        `package ${pkg};`,
        ``,
        `import ${basePkg}.domain.enums.*;`,
        ``,
        javaRecordSchemaAnnotation({ name: `${split.successName}_${m.tag}`, required }),
        `public record ${armClass(m)}(${comps.join(", ")}) implements ${successClass} {`,
        `}`,
        ``,
      ),
    });
  }
  const problem = javaProblemDetailsClass(basePkg);
  for (const arm of split.errors) {
    const comps = arm.fields.map((f) => {
      const t =
        f.optional && f.type.kind !== "optional"
          ? { kind: "optional" as const, inner: f.type }
          : f.type;
      return `${wireJavaType(t, "Response")} ${f.name}`;
    });
    files.push({
      name: unionProblemClass(arm.problemName),
      content: lines(
        `package ${pkg};`,
        ``,
        `import ${basePkg}.domain.enums.*;`,
        ``,
        `/** The problem body of the \`${arm.tag}\` arm: ProblemDetails plus the arm's fields (OpenAPI schema). */`,
        javaRecordSchemaAnnotation({
          name: arm.problemName,
          extra: `allOf = {${problem}.class}`,
          required: arm.fields.filter((f) => !f.optional).map((f) => f.name),
        }),
        `public record ${unionProblemClass(arm.problemName)}(${comps.join(", ")}) {`,
        `}`,
        ``,
      ),
    });
  }
  return files;
}

/** The `errorExtensions` of a route answering an operation-return union:
 *  each error-arm status lists the arms' problem classes (in `pkg`). */
export function unionErrorExtensions(split: OpUnionResponses, pkg: string): Map<number, string[]> {
  return new Map(
    split.errorStatuses.map((e) => [
      e.status,
      e.arms.map((a) => `${pkg}.${unionProblemClass(a.problemName)}`),
    ]),
  );
}

/** The `httpStatus` resolver for statuses a route derives outside the
 *  aggregate-operation surface (workflow commands, workflow instances). */
function statusResolver(ctx: EnrichedBoundedContextIR): (name: string) => number {
  return (name) =>
    resolveErrorStatus(name, { ...ctx.errorStatusOverrides, ...ctx.structuralErrorStatuses });
}

/** `GET /workflows/<slug>/instances/{id}`: a by-id read. */
export function javaWorkflowInstanceByIdDoc(
  ctx: EnrichedBoundedContextIR,
  basePkg: string,
): string[] {
  return javaRouteDocAnnotations(basePkg, {
    success: { status: 200 },
    errors: errorStatuses("getById", false, statusResolver(ctx)),
  });
}

/** `POST /workflows/<slug>`: the workflow's command route.  Its operationId
 *  carries the `Workflow` suffix every backend publishes; an expected-failure
 *  result (`T or E`) publishes the union split, its schema types in `pkg`. */
export function javaWorkflowCommandDoc(
  wf: WorkflowIR,
  ctx: EnrichedBoundedContextIR,
  basePkg: string,
  pkg: string,
  publishedReqName: string,
): string[] {
  const result = commandCreateResult(wf);
  const split =
    result?.type.kind === "union" && commandCreateEntryResult(wf)
      ? opUnionResponses(result.type.variants, ctx)
      : undefined;
  const errors = new Set([
    ...errorStatuses("workflow", workflowIsGuarded(wf), statusResolver(ctx), {
      readsAggregate: workflowCanAnswerNotFound(wf, ctx),
    }),
    ...(split?.errorStatuses.map((e) => e.status) ?? []),
  ]);
  return javaRouteDocAnnotations(basePkg, {
    operationId: `${lowerFirst(wf.name)}Workflow`,
    ...(commandBodyOptional(wf.params)
      ? { requestBodyClass: `${javaContractPkg(basePkg)}.${publishedReqName}` }
      : {}),
    success: split
      ? { status: 200, schemaClass: `${pkg}.${unionSuccessClass(split)}` }
      : { status: result ? 200 : 204 },
    errors: [...errors],
    ...(split ? { errorExtensions: unionErrorExtensions(split, pkg) } : {}),
  });
}
