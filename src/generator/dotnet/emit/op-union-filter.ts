// The .NET half of the operation-return union OpenAPI split (M-FT.24).
//
// `operation reject(): string or NotFound` answers its success arms at 200 and
// its `error` arm as an RFC 7807 problem at the arm's status, with the arm's
// fields on the body.  Swashbuckle documents the 200 from the action's
// `[ProducesResponseType(typeof(<Union>), 200)]`, which is the whole union, and
// every 4xx as plain `ProblemDetails`.  This document filter rewrites both from
// the shared split (`opUnionResponses`, `_payload/union-wire.ts`):
//
//   - registers `<Union>Success` (the success arms) and `<Tag>Problem` (each
//     error arm's problem body);
//   - points each split operation's 200 at `<Union>Success` and its error-arm
//     statuses at `anyOf: [ProblemDetails, <Tag>Problem]`;
//   - drops the whole-union component, which no route references any more.
//
// The schemas are baked from the same raw JSON schema the python and java
// backends inject, rendered as Microsoft.OpenApi 2.0 object construction.
// Emitted (and registered in Program.cs) only when some operation has an error
// arm, so every other project is unchanged.  The runtime wire is untouched.

import type { BoundedContextIR } from "../../../ir/types/loom-ir.js";
import { deriveContextOperations } from "../../../ir/util/api-surface.js";
import { PROBLEM_JSON, PROBLEM_SCHEMA } from "../../../ir/util/openapi-errors.js";
import { lines } from "../../../util/code-builder.js";
import { upperFirst } from "../../../util/naming.js";
import {
  errorArmProblemJsonSchema,
  errorStatusJsonSchema,
  opUnionResponses,
  unionMembersJsonSchema,
} from "../../_payload/union-wire.js";

/** Path of the emitted filter, relative to the project root. */
export const OP_UNION_FILTER_PATH = "Api/OpUnionResponsesFilter.cs";

interface SplitRoute {
  operationId: string;
  successName: string;
  errors: { status: number; schema: unknown }[];
}

interface OpUnionFilterPlan {
  components: Map<string, unknown>;
  routes: SplitRoute[];
  /** Whole-union components no route references once the split applies. */
  removable: string[];
}

function planFor(contexts: readonly BoundedContextIR[]): OpUnionFilterPlan {
  const components = new Map<string, unknown>();
  const routes: SplitRoute[] = [];
  const split = new Set<string>();
  const unsplit = new Set<string>();
  const ref = (n: string): string => `#/components/schemas/${n}`;
  for (const ctx of contexts) {
    for (const entry of deriveContextOperations(ctx)) {
      const op = entry.operation;
      if (entry.kind !== "operation" || op?.returnType?.kind !== "union") continue;
      const s = opUnionResponses(op.returnType.variants, ctx);
      if (s.errors.length === 0) {
        unsplit.add(s.unionName);
        continue;
      }
      split.add(s.unionName);
      components.set(s.successName, unionMembersJsonSchema(s.success));
      for (const arm of s.errors) {
        components.set(arm.problemName, errorArmProblemJsonSchema(arm, ref(PROBLEM_SCHEMA)));
      }
      routes.push({
        operationId: entry.id,
        successName: s.successName,
        errors: s.errorStatuses.map((e) => ({
          status: e.status,
          schema: errorStatusJsonSchema(e.arms, PROBLEM_SCHEMA, ref),
        })),
      });
    }
  }
  return {
    components,
    routes,
    removable: [...split].filter((n) => !unsplit.has(n)).sort(),
  };
}

/** Render the filter, or null when no operation-return union has an error
 *  arm (the project then neither emits nor registers it). */
export function renderOpUnionResponsesFilter(
  ns: string,
  contexts: readonly BoundedContextIR[],
): string | null {
  const plan = planFor(contexts);
  if (plan.routes.length === 0) return null;
  const componentLines = [...plan.components.entries()].map(
    ([name, schema]) => `        schemas[${JSON.stringify(name)}] = ${csSchema(schema)};`,
  );
  const caseLines = plan.routes.flatMap((r) => [
    `                    case ${JSON.stringify(r.operationId)}:`,
    `                        RetargetSuccess(operation, swaggerDoc, ${JSON.stringify(r.successName)});`,
    ...r.errors.map(
      (e) =>
        `                        RetargetProblem(operation, "${e.status}", ${csSchema(e.schema)});`,
    ),
    `                        break;`,
  ]);
  return lines(
    `// Auto-generated.`,
    `using System.Collections.Generic;`,
    `using System.Text.Json.Nodes;`,
    `using Microsoft.OpenApi;`,
    `using Swashbuckle.AspNetCore.SwaggerGen;`,
    ``,
    `namespace ${ns}.Api;`,
    ``,
    `// An operation returning \`T or <Error>\` answers its success arms at 200 and`,
    `// each error arm as a problem at that arm's status, carrying the arm's fields.`,
    `// Swashbuckle documents the whole union at 200, so this filter narrows the 200`,
    `// to the success arms and declares each error-arm status as ProblemDetails OR`,
    `// the arm's problem body — the same document every other backend serves.`,
    `public sealed class OpUnionResponsesFilter : IDocumentFilter`,
    `{`,
    `    public void Apply(OpenApiDocument swaggerDoc, DocumentFilterContext context)`,
    `    {`,
    `        swaggerDoc.Components ??= new OpenApiComponents();`,
    `        swaggerDoc.Components.Schemas ??= new Dictionary<string, IOpenApiSchema>();`,
    `        var schemas = swaggerDoc.Components.Schemas;`,
    ...componentLines,
    ...plan.removable.map((n) => `        schemas.Remove(${JSON.stringify(n)});`),
    `        if (swaggerDoc.Paths is null) return;`,
    `        foreach (var path in swaggerDoc.Paths.Values)`,
    `        {`,
    `            if (path.Operations is null) continue;`,
    `            foreach (var operation in path.Operations.Values)`,
    `            {`,
    `                if (operation.Responses is null) continue;`,
    `                switch (operation.OperationId)`,
    `                {`,
    ...caseLines,
    `                }`,
    `            }`,
    `        }`,
    `    }`,
    ``,
    `    private static void RetargetSuccess(OpenApiOperation operation, OpenApiDocument doc, string success)`,
    `    {`,
    `        if (!operation.Responses!.TryGetValue("200", out var r) || r is not OpenApiResponse resp || resp.Content is null) return;`,
    `        foreach (var media in resp.Content.Values) media.Schema = new OpenApiSchemaReference(success, doc);`,
    `    }`,
    ``,
    `    private static void RetargetProblem(OpenApiOperation operation, string status, IOpenApiSchema schema)`,
    `    {`,
    `        if (!operation.Responses!.TryGetValue(status, out var r) || r is not OpenApiResponse resp) return;`,
    `        resp.Content ??= new Dictionary<string, OpenApiMediaType>();`,
    `        resp.Content.Clear();`,
    `        resp.Content[${JSON.stringify(PROBLEM_JSON)}] = new OpenApiMediaType { Schema = schema };`,
    `    }`,
    `}`,
  );
}

/** The raw JSON-schema subset `union-wire.ts` produces, as a Microsoft.OpenApi
 *  2.0 construction expression.  `$ref`s resolve against the filter's
 *  `swaggerDoc` parameter. */
function csSchema(schema: unknown): string {
  const s = schema as {
    $ref?: string;
    type?: string;
    enum?: string[];
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    oneOf?: unknown[];
    anyOf?: unknown[];
    allOf?: unknown[];
  };
  if (s.$ref) {
    const name = s.$ref.replace(/^#\/components\/schemas\//, "");
    return `new OpenApiSchemaReference(${JSON.stringify(name)}, swaggerDoc)`;
  }
  const parts: string[] = [];
  if (s.type) parts.push(`Type = JsonSchemaType.${upperFirst(s.type)}`);
  if (s.enum) {
    parts.push(
      `Enum = new List<JsonNode> { ${s.enum.map((v) => `JsonValue.Create(${JSON.stringify(v)})!`).join(", ")} }`,
    );
  }
  if (s.properties) {
    const props = Object.entries(s.properties).map(
      ([k, v]) => `[${JSON.stringify(k)}] = ${csSchema(v)}`,
    );
    parts.push(`Properties = new Dictionary<string, IOpenApiSchema> { ${props.join(", ")} }`);
  }
  if (s.required) {
    parts.push(
      `Required = new HashSet<string> { ${s.required.map((r) => JSON.stringify(r)).join(", ")} }`,
    );
  }
  if (s.items) parts.push(`Items = ${csSchema(s.items)}`);
  for (const [key, list] of [
    ["OneOf", s.oneOf],
    ["AnyOf", s.anyOf],
    ["AllOf", s.allOf],
  ] as const) {
    if (list) {
      parts.push(`${key} = new List<IOpenApiSchema> { ${list.map(csSchema).join(", ")} }`);
    }
  }
  return `new OpenApiSchema { ${parts.join(", ")} }`;
}
