import type { ContractWorkflow } from "../../ir/contract/frontend-contract.js";
import type { BoundedContextIR, WorkflowIR } from "../../ir/types/loom-ir.js";
import { snake, upperFirst } from "../../util/naming.js";
import { withFormTextImports } from "../_frontend/form-text-runtime.js";
import {
  collectSchemaDeps,
  type WorkflowsModuleScope,
  workflowFormStateAliases,
} from "../_frontend/workflows-module.js";
import { zodForRequest, zodForResponse } from "../_frontend/zod-schemas.js";
import { SCHEMA_NAMES } from "../_symbols/plan.js";

// ---------------------------------------------------------------------------
// Workflow API module — Zod schemas + svelte-query factories for
// every workflow.  Sibling of src/generator/react/workflow-builder.ts
// with the data layer swapped to @tanstack/svelte-query v6 (same
// exported use* names).  Page objects come from the shared builders.
// ---------------------------------------------------------------------------

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

export function buildWorkflowsApiModule(
  workflows: readonly ContractWorkflow[],
  scope: WorkflowsModuleScope,
): string {
  // Identifier bases minted against the deployable's whole universe so a
  // workflow's request schema cannot alias an aggregate's create/operation one
  // (`ir/util/request-names.ts`).
  const { names } = scope;
  // Observable workflows (a persisted correlation-state row) get read-only
  // instance query hooks (workflow-instance-visibility.md) — `useQuery` is
  // only imported when at least one exists, so a saga-less project's module
  // stays byte-identical.
  const anyInstances = workflows.some((wf) => wf.instance);
  // Only a command-startable workflow gets a request schema + mutation — an
  // event-only saga has no `POST /workflows/<wf>` route on any backend.
  const anyCommands = workflows.some((wf) => wf.params);
  const factories = [anyCommands ? "createMutation" : "", anyInstances ? "createQuery" : ""].filter(
    Boolean,
  );
  const lines: string[] = [];
  lines.push("// Auto-generated.  Do not edit by hand.");
  lines.push(`import { z } from "zod";`);
  lines.push(`import { ${factories.join(", ")} } from "@tanstack/svelte-query";`);
  lines.push(`import { api, seg } from "./client";`);
  if (scope.usesMoney) {
    lines.push(`import { moneySchema } from "../schemas";`);
  }
  const { imports: schemaImports, locals: schemaLocals } = collectSchemaDeps(workflows, scope);
  lines.push(...schemaImports);
  lines.push("");
  if (schemaLocals.length > 0) {
    lines.push(...schemaLocals);
    lines.push("");
  }

  for (const wf of workflows) {
    if (!wf.params) {
      if (wf.instance) lines.push(...emitInstanceHooks(wf));
      continue;
    }
    const base = names.workflow(wf.name);
    lines.push(`export const ${base}Request = z.object({`);
    for (const p of wf.params) {
      lines.push(`  ${p.name}: ${zodForRequest(p.type)},`);
    }
    lines.push(`});`);
    lines.push(`export type ${base}Request = z.infer<typeof ${base}Request>;`);
    lines.push(...workflowFormStateAliases(wf, scope));
    lines.push("");
    lines.push(`export function use${base}Workflow() {`);
    lines.push(`  return createMutation(() => ({`);
    lines.push(`    mutationFn: async (input: ${base}Request) => {`);
    lines.push(
      wf.resultSegment
        ? `      return String(await api.post(\`/workflows/${snake(wf.name)}\`, input));`
        : `      await api.post(\`/workflows/${snake(wf.name)}\`, input);`,
    );
    lines.push(`    },`);
    lines.push(`  }));`);
    lines.push(`}`);
    lines.push("");
    if (wf.instance) {
      lines.push(...emitInstanceHooks(wf));
    }
  }

  return withFormTextImports(narrowSegImport(lines.join("\n")), "../form-text", "../schemas");
}

/** Read-only instance query hooks for an observable workflow
 *  (workflow-instance-visibility.md): the `<Wf>InstanceResponse` /
 *  `<Wf>InstanceListResponse` Zod schemas (the React mirror of the Hono DTOs)
 *  plus `useAll<Wf>Instances()` / `use<Wf>InstanceById(id)` — the same
 *  react-query shape as an aggregate's `useAll<Agg>` / `use<Agg>ById`. */
function emitInstanceHooks(wf: ContractWorkflow): string[] {
  const T = upperFirst(wf.name);
  const slug = snake(wf.name);
  const key = `["workflow_instances", "${slug}"]`;
  const lines: string[] = [];
  lines.push(`export const ${SCHEMA_NAMES.instanceResponse(wf.name)} = z.object({`);
  for (const f of wf.instance ?? []) {
    lines.push(`  ${f.name}: ${f.id ? "z.string()" : zodForResponse(f.type, f.optional)},`);
  }
  lines.push(`});`);
  lines.push(
    `export type ${SCHEMA_NAMES.instanceResponse(wf.name)} = z.infer<typeof ${SCHEMA_NAMES.instanceResponse(wf.name)}>;`,
  );
  lines.push(
    `export const ${SCHEMA_NAMES.instanceListResponse(wf.name)} = z.array(${SCHEMA_NAMES.instanceResponse(wf.name)});`,
  );
  lines.push("");
  lines.push(`export function useAll${T}Instances() {`);
  lines.push(`  return createQuery(() => ({`);
  lines.push(`    queryKey: ${key},`);
  lines.push(`    queryFn: async () => {`);
  lines.push(`      const r = await api.get(\`/workflows/${slug}/instances\`);`);
  lines.push(`      return ${SCHEMA_NAMES.instanceListResponse(wf.name)}.parse(r);`);
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
  lines.push(`      return ${SCHEMA_NAMES.instanceResponse(wf.name)}.parse(r);`);
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
