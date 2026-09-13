import {
  type BoundedContextIR,
  contextUsesMoney,
  type TypeIR,
  type WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { findValueObjectInScope } from "../../ir/util/reachable-types.js";
import { lowerFirst, snake, upperFirst } from "../../util/naming.js";
import { typeReachesMoney, zodForResponse } from "./api-module.js";
import { collectUsedTypes, emitEnumSchema, emitValueObjectSchema } from "./zod-schemas.js";

// ---------------------------------------------------------------------------
// Workflow API module + Playwright page object emission.
//
// The page-side emission (workflows index, per-workflow form) lives in
// src/generator/react/templating/preparers/workflow-{index,form}.ts.
// What remains here is two emission paths that aren't pack-shaped:
//
//   buildWorkflowsApiModule  — Zod schemas + react-query mutation
//                              hooks for every workflow
//   buildWorkflowPageObject  — Playwright page object per workflow
//
// Plus the `allWorkflows` / `hasAnyWorkflow` iterators that the
// orchestrator and the templating preparers share.
// ---------------------------------------------------------------------------

/** Whether any workflow exists across the deployable's contexts. */
export function hasAnyWorkflow(contexts: BoundedContextIR[]): boolean {
  return contexts.some((c) => c.workflows.length > 0);
}

/** Gather every workflow with its owning context, sorted by name for
 *  stable emission. */
export function allWorkflows(
  contexts: BoundedContextIR[],
): Array<{ wf: WorkflowIR; ctx: BoundedContextIR }> {
  const out: Array<{ wf: WorkflowIR; ctx: BoundedContextIR }> = [];
  for (const ctx of contexts) {
    for (const wf of ctx.workflows) out.push({ wf, ctx });
  }
  out.sort((a, b) => a.wf.name.localeCompare(b.wf.name));
  return out;
}

// ---------------------------------------------------------------------------
// API module — Zod schemas + mutation hooks for every workflow in the
// deployable.  One file at `src/api/workflows.ts` aggregating them all.
// ---------------------------------------------------------------------------

export function buildWorkflowsApiModule(
  contexts: BoundedContextIR[],
  options: { queryPackage?: string } = {},
): string {
  const queryPackage = options.queryPackage ?? "@tanstack/react-query";
  const workflows = allWorkflows(contexts);
  // Observable workflows (a persisted correlation-state row) get read-only
  // instance query hooks (workflow-instance-visibility.md) — `useQuery` is
  // only imported when at least one exists, so a saga-less project's module
  // stays byte-identical.
  const anyInstances = workflows.some(({ wf }) => wf.instanceWireShape);
  const lines: string[] = [];
  lines.push("// Auto-generated.  Do not edit by hand.");
  lines.push(`import { z } from "zod";`);
  lines.push(
    `import { ${anyInstances ? "useMutation, useQuery" : "useMutation"} } from "${queryPackage}";`,
  );
  lines.push(`import { api, seg } from "./client";`);
  if (contexts.some(contextUsesMoney)) {
    lines.push(`import { moneySchema } from "../lib/schemas";`);
  }
  const { imports: schemaImports, locals: schemaLocals } = collectSchemaDeps(workflows);
  lines.push(...schemaImports);
  lines.push("");
  if (schemaLocals.length > 0) {
    lines.push(...schemaLocals);
    lines.push("");
  }

  for (const { wf, ctx } of workflows) {
    lines.push(`export const ${upperFirst(wf.name)}Request = z.object({`);
    for (const p of wf.params) {
      lines.push(`  ${p.name}: ${zodForRequest(p.type)},`);
    }
    lines.push(`});`);
    lines.push(
      `export type ${upperFirst(wf.name)}Request = z.infer<typeof ${upperFirst(wf.name)}Request>;`,
    );
    // Dual FormState/Payload aliases — same gate and same reason as the
    // aggregate create/operation schemas in `api-module.ts`: money is the one
    // wire type whose schema TRANSFORMS on parse, so only a money-bearing
    // request has `z.input ≠ z.output`.  A `WorkflowForm` over one needs the
    // `FormState` name for RHF's three-generic `useForm`.
    if (wf.params.some((p) => typeReachesMoney(p.type, ctx))) {
      const name = upperFirst(wf.name);
      lines.push(`/** Pre-parse form shape (z.input) — money fields are decimal strings. */`);
      lines.push(`export type ${name}FormState = z.input<typeof ${name}Request>;`);
      lines.push(`/** Post-parse payload shape (z.output) — money fields are Decimal. */`);
      lines.push(`export type ${name}Payload = z.output<typeof ${name}Request>;`);
    }
    lines.push("");
    lines.push(`export function use${upperFirst(wf.name)}Workflow() {`);
    lines.push(`  return useMutation({`);
    lines.push(`    mutationFn: async (input: ${upperFirst(wf.name)}Request) => {`);
    lines.push(`      await api.post(\`/workflows/${snake(wf.name)}\`, input);`);
    lines.push(`    },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
    if (wf.instanceWireShape) {
      lines.push(...emitInstanceHooks(wf));
    }
  }

  return narrowSegImport(lines.join("\n"));
}

/** Read-only instance query hooks for an observable workflow
 *  (workflow-instance-visibility.md): the `<Wf>InstanceResponse` /
 *  `<Wf>InstanceListResponse` Zod schemas (the React mirror of the Hono DTOs)
 *  plus `useAll<Wf>Instances()` / `use<Wf>InstanceById(id)` — the same
 *  react-query shape as an aggregate's `useAll<Agg>` / `use<Agg>ById`. */
function emitInstanceHooks(wf: WorkflowIR): string[] {
  const T = upperFirst(wf.name);
  const slug = snake(wf.name);
  const key = `["workflow_instances", "${slug}"]`;
  const lines: string[] = [];
  lines.push(`export const ${T}InstanceResponse = z.object({`);
  for (const f of wf.instanceWireShape ?? []) {
    lines.push(
      `  ${f.name}: ${f.source === "id" ? "z.string()" : zodForResponse(f.type, f.optional)},`,
    );
  }
  lines.push(`});`);
  lines.push(`export type ${T}InstanceResponse = z.infer<typeof ${T}InstanceResponse>;`);
  lines.push(`export const ${T}InstanceListResponse = z.array(${T}InstanceResponse);`);
  lines.push("");
  lines.push(`export function useAll${T}Instances() {`);
  lines.push(`  return useQuery({`);
  lines.push(`    queryKey: ${key},`);
  lines.push(`    queryFn: async () => {`);
  lines.push(`      const r = await api.get(\`/workflows/${slug}/instances\`);`);
  lines.push(`      return ${T}InstanceListResponse.parse(r);`);
  lines.push(`    },`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push("");
  lines.push(`export function use${T}InstanceById(id: string | undefined) {`);
  lines.push(`  return useQuery({`);
  lines.push(`    queryKey: [...${key}, id],`);
  lines.push(`    enabled: !!id,`);
  lines.push(`    queryFn: async () => {`);
  lines.push(`      const r = await api.get(\`/workflows/${slug}/instances/\${seg(id)}\`);`);
  lines.push(`      return ${T}InstanceResponse.parse(r);`);
  lines.push(`    },`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push("");
  return lines;
}

/** The types a workflow's API surface references: its command params plus —
 *  for an observable workflow — its instance wire-shape fields (whose response
 *  schema may name enum / value-object schemas that must be in scope). */
function apiSurfaceTypes(wf: WorkflowIR): TypeIR[] {
  return [...wf.params.map((p) => p.type), ...(wf.instanceWireShape ?? []).map((f) => f.type)];
}

/** The aggregate module that actually EXPORTS `<name>Schema`, or `undefined`
 *  when none does.
 *
 *  A per-aggregate module (`api/<agg>.ts`) emits a schema for exactly the types
 *  `collectUsedTypes` reaches from that aggregate's own surface, so asking the
 *  same collector is the only resolution that cannot disagree with what was
 *  emitted.  This replaces a `ctx.aggregates[0]` fallback that aimed the import
 *  at an arbitrary unrelated module whenever NO aggregate used the type — which
 *  is precisely the case an enum reachable only from a workflow's persisted
 *  state hits, so `claimState: ClaimState` emitted
 *  `import { ClaimStateSchema } from "./agency";` against a module that exports
 *  no such name (#2864 T3). */
function findAggregateExporting(
  ctx: BoundedContextIR,
  kind: "enum" | "valueobject",
  name: string,
): string | undefined {
  for (const a of ctx.aggregates) {
    const repo = ctx.repositories.find((r) => r.aggregateName === a.name);
    const used = collectUsedTypes(a, repo, ctx);
    const pool = kind === "enum" ? used.enums : used.valueObjects;
    if (pool.some((t) => t.name === name)) return a.name;
  }
  return undefined;
}

/** Every enum / value-object schema this module's own schemas name, split into
 *  the ones an aggregate module exports (import them) and the ones no module
 *  exports (declare them here, the way the Hono workflow router declares its
 *  own `const <Enum>Schema` rather than reaching for one).
 *
 *  An IMPORTED `<Vo>Schema` carries its whole transitive body in the module it
 *  came from, so nothing beneath it needs to enter this module's scope — which
 *  is why the closure is walked only through LOCALLY declared value objects.
 *  Emitting an import for a name this file never writes would leave a dead
 *  specifier behind and trip the generated-code Biome gate. */
export function collectSchemaDeps(workflows: Array<{ wf: WorkflowIR; ctx: BoundedContextIR }>): {
  imports: string[];
  locals: string[];
} {
  // Enums are kept ahead of value objects in both buckets: a `<Vo>Schema` body
  // names its field schemas, so every `<Enum>Schema` it can reference has to be
  // declared above it.
  const enumImports: string[] = [];
  const voImports: string[] = [];
  const enumLocals: string[] = [];
  const voLocals: string[] = [];
  const resolved = new Set<string>();

  const ensure = (ctx: BoundedContextIR, t: TypeIR): void => {
    if (t.kind === "array") {
      ensure(ctx, t.element);
      return;
    }
    if (t.kind === "optional") {
      ensure(ctx, t.inner);
      return;
    }
    if (t.kind !== "enum" && t.kind !== "valueobject") return;
    if (resolved.has(t.name)) return;
    resolved.add(t.name);

    const owner = findAggregateExporting(ctx, t.kind, t.name);
    if (owner) {
      const line = `import { ${t.name}Schema } from "./${lowerFirst(owner)}";`;
      (t.kind === "enum" ? enumImports : voImports).push(line);
      return;
    }
    if (t.kind === "enum") {
      const e = ctx.enums.find((x) => x.name === t.name);
      if (e) enumLocals.push(...emitEnumSchema(e));
      return;
    }
    const vo = findValueObjectInScope(ctx, t.name);
    if (!vo) return;
    // Declared here, so its field schemas must be in scope here too.
    for (const f of vo.fields) ensure(ctx, f.type);
    voLocals.push(...emitValueObjectSchema(vo));
  };

  for (const { wf, ctx } of workflows) {
    for (const t of apiSurfaceTypes(wf)) ensure(ctx, t);
  }
  return {
    imports: [...enumImports, ...voImports],
    locals: [...enumLocals, ...voLocals],
  };
}

// ---------------------------------------------------------------------------
// Playwright page object — moved to `workflow-page-object.ts` (the
// selectStyle-aware builder the svelte frontend parameterizes; the
// defaults reproduce this module's original output byte-for-byte).
// ---------------------------------------------------------------------------

export { buildWorkflowPageObject } from "./workflow-page-object.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function zodForRequest(t: TypeIR): string {
  switch (t.kind) {
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: inner switch on the primitive name union is exhaustive (every arm returns)
    case "primitive":
      switch (t.name) {
        case "int":
        case "long":
          return "z.number().int()";
        case "decimal":
          return "z.number()";
        case "money":
          return "moneySchema";
        case "string":
        case "guid":
          return "z.string()";
        case "bool":
          return "z.boolean()";
        case "datetime":
          return "z.string()";
        case "json":
          return "z.unknown()";
        case "File":
          return "z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() })";
        case "duration":
          // A5: expression-only primitive — never a request / wire type.
          throw new Error("internal: 'duration' is expression-only and never reaches a request");
      }
    case "id":
      // Same reference-is-a-uuid rule the aggregate request schemas use — see
      // `zodForRequest` in ./zod-schemas.ts (schemathesis F2).
      return t.valueType === "guid" ? "z.string().uuid()" : "z.string()";
    case "enum":
      return `${t.name}Schema`;
    case "valueobject":
      return `${t.name}Schema`;
    case "entity":
      return "z.unknown()";
    case "array":
      return `z.array(${zodForRequest(t.element)})`;
    case "optional":
      return `${zodForRequest(t.inner)}.nullish()`;
    case "action":
    case "slot":
      throw new Error(
        "zodForRequest: 'slot' type is UI-only and should not reach a workflow request schema.",
      );
    case "genericInstance":
      throw new Error(
        `zodForRequest: generic carrier '${t.ctor}' is not emittable yet (P3b); IR-validate should have rejected it.`,
      );
    case "union":
    case "none":
      throw new Error(
        `zodForRequest: discriminated unions are not emittable yet (P4); IR-validate should have rejected '${t.kind}'.`,
      );
  }
}

/** Drop the `seg` specifier when the module emitted no path interpolation —
 *  a workflow module with no instance-by-id read, say.  Same deferred-import
 *  shape the Hono route builder uses for `./problem-details`: emit the wide
 *  import, then narrow it once the body is known.  Without this the generated
 *  file carries an unused import, which `test:biome-gen` flags (and which the
 *  generated projects' own Biome config would too). */
function narrowSegImport(src: string): string {
  return /\$\{seg\(/.test(src)
    ? src
    : src.replace('import { api, seg } from "./client";', 'import { api } from "./client";');
}
