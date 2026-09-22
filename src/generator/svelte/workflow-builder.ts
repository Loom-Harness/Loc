import {
  type BoundedContextIR,
  contextUsesMoney,
  type WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { snake, upperFirst } from "../../util/naming.js";
import { requestNamesForContexts } from "../_frontend/request-names.js";
import { collectSchemaDeps } from "../_frontend/workflows-module.js";
import { zodForRequest, zodForResponse } from "../_frontend/zod-schemas.js";

// ---------------------------------------------------------------------------
// Workflow API module — Zod schemas + svelte-query factories for
// every workflow.  Sibling of src/generator/react/workflow-builder.ts
// with the data layer swapped to @tanstack/svelte-query v6 (same
// exported use* names).  Page objects come from the shared builders.
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
// deployable.  One file at `src/lib/api/workflows.ts` aggregating them all.
// ---------------------------------------------------------------------------

export function buildWorkflowsApiModule(contexts: BoundedContextIR[]): string {
  const workflows = allWorkflows(contexts);
  // Identifier bases minted against the deployable's whole universe so a
  // workflow's request schema cannot alias an aggregate's create/operation one
  // (`_frontend/request-names.ts`).
  const names = requestNamesForContexts(contexts);
  // Observable workflows (a persisted correlation-state row) get read-only
  // instance query hooks (workflow-instance-visibility.md) — `useQuery` is
  // only imported when at least one exists, so a saga-less project's module
  // stays byte-identical.
  const anyInstances = workflows.some(({ wf }) => wf.instanceWireShape);
  const lines: string[] = [];
  lines.push("// Auto-generated.  Do not edit by hand.");
  lines.push(`import { z } from "zod";`);
  lines.push(
    `import { ${anyInstances ? "createMutation, createQuery" : "createMutation"} } from "@tanstack/svelte-query";`,
  );
  lines.push(`import { api, seg } from "./client";`);
  if (contexts.some(contextUsesMoney)) {
    lines.push(`import { moneySchema } from "../schemas";`);
  }
  const { imports: schemaImports, locals: schemaLocals } = collectSchemaDeps(workflows);
  lines.push(...schemaImports);
  lines.push("");
  if (schemaLocals.length > 0) {
    lines.push(...schemaLocals);
    lines.push("");
  }

  for (const { wf } of workflows) {
    const base = names.workflow(wf.name);
    lines.push(`export const ${base}Request = z.object({`);
    for (const p of wf.params) {
      lines.push(`  ${p.name}: ${zodForRequest(p.type)},`);
    }
    lines.push(`});`);
    lines.push(`export type ${base}Request = z.infer<typeof ${base}Request>;`);
    lines.push("");
    lines.push(`export function use${base}Workflow() {`);
    lines.push(`  return createMutation(() => ({`);
    lines.push(`    mutationFn: async (input: ${base}Request) => {`);
    lines.push(`      await api.post(\`/workflows/${snake(wf.name)}\`, input);`);
    lines.push(`    },`);
    lines.push(`  }));`);
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
  lines.push(`  return createQuery(() => ({`);
  lines.push(`    queryKey: ${key},`);
  lines.push(`    queryFn: async () => {`);
  lines.push(`      const r = await api.get(\`/workflows/${slug}/instances\`);`);
  lines.push(`      return ${T}InstanceListResponse.parse(r);`);
  lines.push(`    },`);
  lines.push(`  }));`);
  lines.push(`}`);
  lines.push("");
  lines.push(`export function use${T}InstanceById(id: () => string | undefined) {`);
  lines.push(`  return createQuery(() => ({`);
  lines.push(`    queryKey: [...${key}, id()],`);
  lines.push(`    enabled: !!id(),`);
  lines.push(`    queryFn: async () => {`);
  lines.push(`      const r = await api.get(\`/workflows/${slug}/instances/\${seg(id())}\`);`);
  lines.push(`      return ${T}InstanceResponse.parse(r);`);
  lines.push(`    },`);
  lines.push(`  }));`);
  lines.push(`}`);
  lines.push("");
  return lines;
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
