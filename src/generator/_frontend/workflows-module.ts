import type { ContractWorkflow, FrontendContract } from "../../ir/contract/frontend-contract.js";
import {
  type BoundedContextIR,
  contextUsesMoney,
  type TypeIR,
  type WorkflowIR,
} from "../../ir/types/loom-ir.js";
import {
  enumPool,
  findValueObjectInScope,
  type ScopeEnum,
  type TypeScope,
} from "../../ir/util/reachable-types.js";
import { type FrontendRequestNames, requestNamesForContexts } from "../../ir/util/request-names.js";
import { lowerFirst, snake, upperFirst } from "../../util/naming.js";
import { UUID_WIRE_REGEX_LITERAL } from "../../util/uuid-wire.js";
import { contractHomes } from "../_walker/walker-model.js";
import { contractAggregate, type SchemaValueObject } from "./aggregate-model.js";
import { typeReachesMoney, zodForResponse } from "./api-module.js";
import { clientAggregates, clientFinds } from "./contract.js";
import { typeBlankBlocks } from "./form-spec.js";
import { contractUsesMoney } from "./usage-flags.js";
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

/** What a workflows API module resolves its workflows' types against, beside
 *  the workflows themselves (which the Frontend Contract carries): the request
 *  identifier bases minted over the deployable's whole universe, whether the
 *  served contexts use money, and each workflow's owning context — the
 *  sibling aggregate modules that already export a schema it names, and the
 *  value objects it declares. */
export interface WorkflowsModuleScope {
  names: FrontendRequestNames;
  usesMoney: boolean;
  /** The types context `name` resolves a workflow's params in. */
  typeScope: (context: string) => TypeScope<ScopeEnum, SchemaValueObject>;
  /** The aggregate of `context` whose api module exports `<name>Schema`, or
   *  `undefined` when none does. */
  exporterOf: (context: string, kind: "enum" | "valueobject", name: string) => string | undefined;
}

/** {@link WorkflowsModuleScope} over bounded contexts, which also hands out
 *  each context itself. */
export interface ContextWorkflowsModuleScope extends WorkflowsModuleScope {
  contextOf: (name: string) => BoundedContextIR;
}

/** The scope of a deployable serving `contexts`. */
export function workflowsModuleScope(
  contexts: readonly BoundedContextIR[],
): ContextWorkflowsModuleScope {
  const byName = new Map(contexts.map((c) => [c.name, c]));
  const contextOf = (name: string): BoundedContextIR => {
    const ctx = byName.get(name);
    if (!ctx) throw new Error(`internal: workflow context '${name}' is not served`);
    return ctx;
  };
  return {
    names: requestNamesForContexts(contexts),
    usesMoney: contexts.some(contextUsesMoney),
    contextOf,
    typeScope: contextOf,
    exporterOf: (context, kind, name) => findAggregateExporting(contextOf(context), kind, name),
  };
}

/** The scope read off the Frontend Contract, for a deployable serving
 *  `contextNames` through the apis `serves`. */
export function workflowsModuleScopeOfContract(
  contract: FrontendContract,
  contextNames: readonly string[],
  serves: readonly string[],
): WorkflowsModuleScope {
  const homes = contractHomes(contract, contextNames);
  const bases = new Map(contract.wire.workflows.map((w) => [w.name, w.requestBase]));
  return {
    names: { workflow: (wf) => bases.get(wf) ?? upperFirst(wf) },
    usesMoney: contractUsesMoney(contract, contextNames),
    typeScope: (context) => {
      const home = homes.get(context);
      if (!home) throw new Error(`internal: workflow context '${context}' is not served`);
      return home;
    },
    exporterOf: (context, kind, name) =>
      clientAggregates(contract, [context]).find((a) => {
        const m = contractAggregate(contract, a.name, clientFinds(contract, a.name, serves));
        return (kind === "enum" ? m.enums : m.valueObjects).some((t) => t.name === name);
      })?.name,
  };
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
  workflows: readonly ContractWorkflow[],
  scope: WorkflowsModuleScope,
  options: { queryPackage?: string } = {},
): string {
  const queryPackage = options.queryPackage ?? "@tanstack/react-query";
  // Identifier bases, minted against the deployable's WHOLE universe so a
  // workflow's request schema cannot alias an aggregate's create/operation one
  // (`request-names.ts`).  Collision-free model ⇒ `base === upperFirst(name)`.
  const { names } = scope;
  // Observable workflows (a persisted correlation-state row) get read-only
  // instance query hooks (workflow-instance-visibility.md) — `useQuery` is
  // only imported when at least one exists, so a saga-less project's module
  // stays byte-identical.
  const anyInstances = workflows.some((wf) => wf.instance);
  // Only a command-startable workflow gets a request schema + mutation hook —
  // an event-only saga has no `POST /workflows/<wf>` route on any backend.
  const anyCommands = workflows.some((wf) => wf.params);
  const hooks = [anyCommands ? "useMutation" : "", anyInstances ? "useQuery" : ""].filter(Boolean);
  const lines: string[] = [];
  lines.push("// Auto-generated.  Do not edit by hand.");
  lines.push(`import { z } from "zod";`);
  lines.push(`import { ${hooks.join(", ")} } from "${queryPackage}";`);
  lines.push(`import { api, seg } from "./client";`);
  if (scope.usesMoney) {
    lines.push(`import { moneySchema } from "../lib/schemas";`);
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
    const ctx = scope.typeScope(wf.context);
    const base = names.workflow(wf.name);
    lines.push(`export const ${base}Request = z.object({`);
    for (const p of wf.params) {
      lines.push(`  ${p.name}: ${zodForRequest(p.type)},`);
    }
    lines.push(`});`);
    lines.push(`export type ${base}Request = z.infer<typeof ${base}Request>;`);
    // Dual FormState/Payload aliases — same gate and same reason as the
    // aggregate create/operation schemas in `api-module.ts`: money is the one
    // wire type whose schema TRANSFORMS on parse, so only a money-bearing
    // request has `z.input ≠ z.output`.  A `WorkflowForm` over one needs the
    // `FormState` name for RHF's three-generic `useForm`.
    if (wf.params.some((p) => typeReachesMoney(p.type, ctx))) {
      lines.push(`/** Pre-parse form shape (z.input) — money fields are decimal strings. */`);
      lines.push(`export type ${base}FormState = z.input<typeof ${base}Request>;`);
      lines.push(`/** Post-parse payload shape (z.output) — money fields are Decimal. */`);
      lines.push(`export type ${base}Payload = z.output<typeof ${base}Request>;`);
    }
    lines.push("");
    lines.push(`export function use${base}Workflow() {`);
    lines.push(`  return useMutation({`);
    lines.push(`    mutationFn: async (input: ${base}Request) => {`);
    // A start route that answers the created record's id hands it back, so
    // the form can open that record.
    lines.push(
      wf.resultSegment
        ? `      return String(await api.post(\`/workflows/${snake(wf.name)}\`, input));`
        : `      await api.post(\`/workflows/${snake(wf.name)}\`, input);`,
    );
    lines.push(`    },`);
    lines.push(`  });`);
    lines.push(`}`);
    lines.push("");
    if (wf.instance) {
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
function emitInstanceHooks(wf: ContractWorkflow): string[] {
  const T = upperFirst(wf.name);
  const slug = snake(wf.name);
  const key = `["workflow_instances", "${slug}"]`;
  const lines: string[] = [];
  lines.push(`export const ${T}InstanceResponse = z.object({`);
  for (const f of wf.instance ?? []) {
    lines.push(`  ${f.name}: ${f.id ? "z.string()" : zodForResponse(f.type, f.optional)},`);
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
export function apiSurfaceTypes(wf: ContractWorkflow): TypeIR[] {
  return [...(wf.params ?? []), ...(wf.instance ?? [])].map((f) => f.type);
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
export function collectSchemaDeps(
  workflows: readonly ContractWorkflow[],
  scope: WorkflowsModuleScope,
): {
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

  const ensure = (context: string, t: TypeIR): void => {
    const ctx = scope.typeScope(context);
    if (t.kind === "array") {
      ensure(context, t.element);
      return;
    }
    if (t.kind === "optional") {
      ensure(context, t.inner);
      return;
    }
    if (t.kind !== "enum" && t.kind !== "valueobject") return;
    if (resolved.has(t.name)) return;
    resolved.add(t.name);

    const owner = scope.exporterOf(context, t.kind, t.name);
    if (owner) {
      const line = `import { ${t.name}Schema } from "./${lowerFirst(owner)}";`;
      (t.kind === "enum" ? enumImports : voImports).push(line);
      return;
    }
    if (t.kind === "enum") {
      const e = enumPool(ctx).find((x) => x.name === t.name);
      if (e) enumLocals.push(...emitEnumSchema(e));
      return;
    }
    const vo = findValueObjectInScope(ctx, t.name);
    if (!vo) return;
    // Declared here, so its field schemas must be in scope here too.
    for (const f of vo.fields) ensure(context, f.type);
    voLocals.push(...emitValueObjectSchema(vo));
  };

  for (const wf of workflows) {
    for (const t of apiSurfaceTypes(wf)) ensure(wf.context, t);
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
        case "date":
        case "datetime":
          return "z.string()";
        case "json":
          return "z.unknown()";
        case "AuditEntry":
          // A record that stands only as a queryHandler return, never a
          // workflow request field (`loom.audit-entry-position`).
          throw new Error("internal: 'AuditEntry' is never a workflow request field");
        case "File":
          return "z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() })";
        case "duration":
          // A5: expression-only primitive — never a request / wire type.
          throw new Error("internal: 'duration' is expression-only and never reaches a request");
      }
    case "id":
      // Same reference-is-a-uuid rule the aggregate request schemas use — see
      // `zodForRequest` in ./zod-schemas.ts, on the same shared
      // `UUID_WIRE_PATTERN` every backend validates against.  The pattern
      // refuses the blank too, which is how a required reference with nothing
      // picked holds the submit (`formBlankBlocks`).
      return typeBlankBlocks(t) ? `z.string().regex(${UUID_WIRE_REGEX_LITERAL})` : "z.string()";
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
