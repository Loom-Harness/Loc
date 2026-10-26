// The generated drizzle read-scope helpers — `db/read-scopes.ts`.
//
// Drizzle has no global query filter and no discriminator mapping, so without
// a helper every statement over an aggregate's rows spells its `kind` scope and
// its capability / tenancy / deny predicates by hand (the same predicate at
// ~8 sites per repository, and a site that forgets one serves the rows the
// others hide).  Each aggregate with any read restriction gets ONE function
// here, rendered from the read-scope fact (`src/ir/enrich/read-scope.ts`):
//
//   export function forkliftScope(use: ScopeUse = {}): SQL | undefined {
//     if (use.write) return eq(schema.equipments.kind, "Forklift");
//     return and(
//       eq(schema.equipments.kind, "Forklift"),
//       drops(use, "archivable") ? undefined : not(eq(schema.equipments.archived, true)),
//     );
//   }
//
// and every repository read AND write site, the polymorphic base readers and
// the query-time projection routes call it (`repository-find-predicate.ts`
// decides which call a site makes).  `ignoring` is the read's `ignoring`
// clause — only a capability-contributed restriction is droppable; the `kind`
// scope, a `deny` carve-out and a bare `filter` never are.  `write` is a
// write site: the `kind` scope alone, because a write is scoped by the type
// mapping, not by a read restriction.
//
// A TPH ROOT (the abstract base of a `sharedTable` hierarchy) gets one too: its
// own restrictions plus each concrete's own, hosted on the root and guarded by
// the concrete's discriminator, which is what a polymorphic read of the
// hierarchy applies.

import { polymorphicReadFor } from "../../ir/enrich/read-scope.js";
import type { EnrichedAggregateIR, EnrichedBoundedContextIR } from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import { drizzleImportLine, stripStringLiterals } from "./drizzle-imports.js";
import {
  aggregateHasReadScope,
  type DrizzleScopeConjunct,
  drizzleScopeConjuncts,
  drizzleScopeFnName,
} from "./repository-find-predicate.js";

/** Path of the pooled helper module, relative to the generated project root. */
export const READ_SCOPES_PATH = "db/read-scopes.ts";

/** One aggregate whose repository (or base reader) calls a scope helper. */
export interface ReadScopeSpec {
  agg: EnrichedAggregateIR;
  ctx: EnrichedBoundedContextIR;
}

/** Whether `agg` gets a helper: a drizzle SQL read home (the caller filters out
 *  the shapes that evaluate in-process) with at least one restriction. */
export function wantsReadScope(agg: EnrichedAggregateIR, ctx: EnrichedBoundedContextIR): boolean {
  if (agg.isAbstract) {
    const read = polymorphicReadFor(agg, ctx.aggregates);
    return read?.layout === "sharedTable" && aggregateHasReadScope(agg, ctx);
  }
  return aggregateHasReadScope(agg, ctx);
}

/** `drops(use, "<cap>") ? undefined : <expr>` for a droppable conjunct, else `<expr>`. */
function guard(c: DrizzleScopeConjunct): string {
  return c.capability !== undefined
    ? `drops(use, ${JSON.stringify(c.capability)}) ? undefined : ${c.expr}`
    : c.expr;
}

function renderScopeFn(spec: ReadScopeSpec): string {
  const { agg, ctx } = spec;
  const { kind, filters, guarded } = drizzleScopeConjuncts(agg, ctx);
  const terms = [...(kind ? [kind] : []), ...filters.map(guard), ...guarded.map(guard)];
  const who = agg.isAbstract
    ? `the polymorphic read of ${agg.name}: its own restrictions and each subtype's, kind-guarded`
    : `a read of ${agg.name}`;
  const usesParam = kind !== null || terms.some((t) => t.includes("drops(use,"));
  const body = lines(
    `export function ${drizzleScopeFnName(agg)}(${usesParam ? "use" : "_use"}: ScopeUse = {}): SQL | undefined {`,
    ...(kind ? [`  if (use.write) return ${kind};`] : []),
    `  return and(`,
    ...terms.map((t) => `    ${t},`),
    `  );`,
    `}`,
  );
  return lines(`/** The read scope of ${who}. */`, body);
}

/** The pooled `db/read-scopes.ts`, or null when no aggregate has a scope. */
export function renderReadScopesFile(specs: readonly ReadScopeSpec[]): string | null {
  if (specs.length === 0) return null;
  const fns = specs.map(renderScopeFn);
  const typeDecl = lines(
    "/** How a site uses a scope helper: a read's `ignoring` clause, or a write site",
    " *  (the `kind` scope alone — a write is scoped by the type mapping, not by a read",
    " *  restriction). */",
    `export type ScopeUse = { ignoring?: "*" | readonly string[]; write?: boolean };`,
  );
  const dropsDecl = lines(
    "/** True when the read's `ignoring` clause drops the restriction a capability contributed. */",
    `const drops = (use: ScopeUse, capability: string): boolean =>`,
    `  use.ignoring === "*" || (use.ignoring?.includes(capability) ?? false);`,
  );
  const usesDrops = fns.some((f) => f.includes("drops(use,"));
  const used = [typeDecl, ...(usesDrops ? [dropsDecl] : []), ...fns].join("\n\n");
  const scan = stripStringLiterals(used);
  const accessorImport = `import { requireCurrentUser } from "../auth/middleware";`;
  const principalImport = /\brequireCurrentUser\(/.test(scan) ? accessorImport : false;
  return lines(
    "// Auto-generated.  Do not edit by hand.",
    `import type { SQL } from "drizzle-orm";`,
    drizzleImportLine(used),
    `import * as schema from "./schema";`,
    principalImport,
    "",
    used,
    "",
  );
}
