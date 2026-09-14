import type { BoundedContextIR, TypeIR, WorkflowIR } from "../../ir/types/loom-ir.js";
import { peelCollection, peelNullable, wireTypeInfo } from "../../ir/types/wire-types.js";
import { lines } from "../../util/code-builder.js";
import { lowerFirst, snake, upperFirst } from "../../util/naming.js";
import { allWorkflows } from "../_frontend/workflows-module.js";
import { exportedResponseTypes } from "./api-module.js";

// ---------------------------------------------------------------------------
// Angular workflows API module (`src/api/workflows.ts`).
//
// The Angular sibling of `_frontend/workflows-module.ts` (the React/Vue zod +
// `useMutation`/`useQuery` emitter).  Angular reads/writes through TanStack
// `injectMutation` / `injectQuery` off an `@Injectable` `WorkflowsService`
// wrapping `HttpClient`, so the surface is TS-interface (not zod) shaped —
// matching the per-aggregate `api/<agg>.ts` module.  Each workflow becomes:
//
//   - a `<Wf>Request` interface (the command params),
//   - a `WorkflowsService.<wf>()` POST `/workflows/<snake>` method,
//   - a `use<Wf>Workflow()` `injectMutation` factory,
//   - for an observable workflow, a `<Wf>InstanceRow` interface, the
//     `instances()` / `instance(id)` GET methods, and the
//     `useAll<Wf>Instances()` / `use<Wf>InstanceById(id)` read factories.
// ---------------------------------------------------------------------------

/** Map a wire `TypeIR` to a TS type string (primitives + ids precise; enums /
 *  value objects / nested entities fall back to `unknown`).
 *
 *  Exported for `projections-module.ts`, which needs the identical mapping
 *  (notably wire `money` → `string`).  NOTE: `api-module.ts` carries a second,
 *  `precise`-flagged variant of this function — the two predate each other and
 *  unifying them is its own slice; this export at least stops a THIRD copy. */
export function wireTsType(t: TypeIR, precise = false): string {
  const info = wireTypeInfo(t, "response");
  if (info.isNullable) return `${wireTsType(peelNullable(t), precise)} | null`;
  if (info.isCollection) return `${wireTsType(peelCollection(t), precise)}[]`;
  switch (info.refKind) {
    case "primitive":
      switch (info.primitive) {
        case "int":
        case "long":
        case "decimal":
          return "number";
        case "money":
          return "string";
        case "bool":
          return "boolean";
        case "string":
        case "datetime":
        case "guid":
          return "string";
        default:
          return "unknown";
      }
    case "id":
      return "string";
    default:
      // `precise` types an ENUM by name — the `<Enum>` union the module either
      // imports from the aggregate that owns it or declares itself.  Without it
      // a workflow's enum-typed state field lands as `unknown`, which builds but
      // silently drops the contract: the row can no longer be narrowed, and an
      // `EnumBadge` over it has nothing to switch on (#2864 T3).
      if (precise && t.kind === "enum") return t.name;
      return "unknown";
  }
}

function instanceRowLines(wf: WorkflowIR): string[] {
  const T = upperFirst(wf.name);
  const out: string[] = [`export interface ${T}InstanceRow {`];
  for (const f of wf.instanceWireShape ?? []) {
    out.push(`  ${f.name}: ${f.source === "id" ? "string" : wireTsType(f.type, true)};`);
  }
  out.push("}");
  out.push("");
  return out;
}

/** The `<Enum>` unions an observable workflow's instance row names, split into
 *  the ones an aggregate module already exports (import them) and the ones no
 *  aggregate module exports (declare them here).
 *
 *  Angular's per-aggregate module emits `export type <Enum> = "A" | "B";` for
 *  exactly the enums `exportedResponseTypes` reaches from that aggregate's own
 *  response surface, so asking the same helper is the only resolution that
 *  cannot disagree with what was emitted.  An enum reachable only from a
 *  workflow's persisted state is reached from no aggregate at all — hence the
 *  local declaration. */
function instanceEnumDeps(workflows: Array<{ wf: WorkflowIR; ctx: BoundedContextIR }>): {
  imports: string[];
  locals: string[];
} {
  const imports: string[] = [];
  const locals: string[] = [];
  const seen = new Set<string>();
  for (const { wf, ctx } of workflows) {
    for (const f of wf.instanceWireShape ?? []) {
      if (f.source === "id") continue;
      const base = peelCollection(peelNullable(f.type));
      if (base.kind !== "enum" || seen.has(base.name)) continue;
      seen.add(base.name);
      const owner = ctx.aggregates.find((a) =>
        exportedResponseTypes(a, ctx).enums.some((e) => e.name === base.name),
      );
      if (owner) {
        imports.push(`import type { ${base.name} } from "./${lowerFirst(owner.name)}";`);
        continue;
      }
      const decl = ctx.enums.find((e) => e.name === base.name);
      if (decl) {
        locals.push(
          `export type ${decl.name} = ${decl.values.map((v) => JSON.stringify(v)).join(" | ")};`,
        );
      }
    }
  }
  return { imports, locals };
}

/** Emit the `src/api/workflows.ts` module aggregating every workflow across the
 *  served contexts. */
export function buildAngularWorkflowsModule(contexts: BoundedContextIR[]): string {
  const workflows = allWorkflows(contexts);
  const anyInstances = workflows.some(({ wf }) => wf.instanceWireShape);
  const out: string[] = [
    "// Auto-generated.  Do not edit by hand.",
    'import { HttpClient } from "@angular/common/http";',
    'import { Injectable, inject } from "@angular/core";',
    `import { ${anyInstances ? "injectMutation, injectQuery" : "injectMutation"} } from "@tanstack/angular-query-experimental";`,
    'import { firstValueFrom } from "rxjs";',
    'import { API_BASE_URL } from "./config";',
    "",
  ];

  // The `<Enum>` unions the instance rows below are typed against: imported
  // from the aggregate module that already exports one, declared here when no
  // aggregate module does.  See `instanceEnumDeps`.
  const { imports: enumImports, locals: enumLocals } = instanceEnumDeps(workflows);
  if (enumImports.length > 0) out.push(...enumImports, "");
  if (enumLocals.length > 0) out.push(...enumLocals, "");

  // Request + instance-row interfaces.
  for (const { wf } of workflows) {
    const T = upperFirst(wf.name);
    out.push(`export interface ${T}Request {`);
    for (const p of wf.params) out.push(`  ${p.name}: ${wireTsType(p.type)};`);
    out.push("}");
    out.push("");
    if (wf.instanceWireShape) out.push(...instanceRowLines(wf));
  }

  // Service.
  out.push(`@Injectable({ providedIn: "root" })`);
  out.push(`export class WorkflowsService {`);
  out.push("  private readonly http = inject(HttpClient);");
  for (const { wf } of workflows) {
    const T = upperFirst(wf.name);
    const m = lowerFirst(wf.name);
    const slug = snake(wf.name);
    out.push("");
    out.push(`  ${m}(input: ${T}Request) {`);
    out.push(`    return this.http.post<void>(\`\${API_BASE_URL}/workflows/${slug}\`, input);`);
    out.push("  }");
    if (wf.instanceWireShape) {
      out.push("");
      out.push(`  ${m}Instances() {`);
      out.push(
        `    return this.http.get<${T}InstanceRow[]>(\`\${API_BASE_URL}/workflows/${slug}/instances\`);`,
      );
      out.push("  }");
      out.push("");
      out.push(`  ${m}InstanceById(id: string) {`);
      out.push(
        `    return this.http.get<${T}InstanceRow>(\`\${API_BASE_URL}/workflows/${slug}/instances/\${id}\`);`,
      );
      out.push("  }");
    }
  }
  out.push("}");
  out.push("");

  // Factories.
  for (const { wf } of workflows) {
    const T = upperFirst(wf.name);
    const m = lowerFirst(wf.name);
    out.push(
      `/** \`${wf.name}\` workflow command (TanStack \`injectMutation\`) — \`mutateAsync(input)\``,
      " *  POSTs the command params. */",
      `export function use${T}Workflow() {`,
      "  const service = inject(WorkflowsService);",
      "  return injectMutation(() => ({",
      `    mutationFn: (input: ${T}Request) => firstValueFrom(service.${m}(input)),`,
      "  }));",
      "}",
      "",
    );
    if (wf.instanceWireShape) {
      out.push(
        `/** \`${wf.name}\` instance list read — the saga-state rows. */`,
        `export function useAll${T}Instances() {`,
        "  const service = inject(WorkflowsService);",
        "  return injectQuery(() => ({",
        `    queryKey: ["workflow_instances", "${snake(wf.name)}"] as const,`,
        `    queryFn: () => firstValueFrom(service.${m}Instances()),`,
        "  }));",
        "}",
        "",
        `/** \`${wf.name}\` single-instance read by correlation id (idle until id resolves). */`,
        `export function use${T}InstanceById(id: string | undefined) {`,
        "  const service = inject(WorkflowsService);",
        "  return injectQuery(() => ({",
        `    queryKey: ["workflow_instances", "${snake(wf.name)}", id] as const,`,
        `    queryFn: () => firstValueFrom(service.${m}InstanceById(id as string)),`,
        "    enabled: !!id,",
        "  }));",
        "}",
        "",
      );
    }
  }

  return lines(...out);
}
