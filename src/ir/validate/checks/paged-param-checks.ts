import { diagMessage } from "../../../diagnostics/messages.js";
import { snake } from "../../../util/naming.js";
import { PAGED_QUERY_PARAMS, pagedReturn } from "../../stdlib/generics.js";
import type { BoundedContextIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// Paged-read parameter collisions (`loom.paged-param-reserved`).  A `paged`
// read adds its own query parameters (`PAGED_QUERY_PARAMS`: page / pageSize /
// sort / dir) after the read's declared ones.  A declared parameter of the
// same name is two values for one HTTP query key, and a duplicate parameter in
// every generated repository / service / controller signature (TS2300, javac
// "already defined", Python "duplicate argument", a duplicate C# record
// property).  No emitter rename is honest — the query key IS the name — so it
// is refused as the modelling conflict it is.
//
// Compared in snake form, not verbatim: Python and Elixir spell the paging
// control `page_size`, and .NET Pascal-cases the query record's properties,
// so `page_size` and `Dir` collide just as `pageSize` and `dir` do.
//
// Three surfaces carry a paged read's parameters: a declared `T paged` find,
// the `findAllBy<Criterion>` find enrichment synthesizes for a paged
// queryHandler (its parameters are the CRITERION's), and the paged
// queryHandler itself (its parameters are the route's query keys).
// ---------------------------------------------------------------------------

const PAGED_RESERVED_BY_SNAKE: ReadonlyMap<string, string> = new Map(
  PAGED_QUERY_PARAMS.map((k) => [snake(k), k]),
);
const PAGED_RESERVED_LIST = PAGED_QUERY_PARAMS.map((k) => `'${k}'`).join(", ");

/** The reserved paging key a parameter name collides with, or undefined. */
function pagedReservedKey(param: string): string | undefined {
  return PAGED_RESERVED_BY_SNAKE.get(snake(param));
}

export function validatePagedParamNames(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const repo of ctx.repositories) {
    for (const find of repo.finds) {
      if (!pagedReturn(find.returnType)) continue;
      for (const p of find.params) {
        const key = pagedReservedKey(p.name);
        if (!key) continue;
        const criterion = find.synthesized ? find.criterionRef?.name : undefined;
        diags.push({
          severity: "error",
          code: "loom.paged-param-reserved",
          message: criterion
            ? diagMessage("loom.paged-param-reserved#criterion", {
                name: criterion,
                findName: find.name,
                param: p.name,
                key,
                reserved: PAGED_RESERVED_LIST,
              })
            : diagMessage("loom.paged-param-reserved#find", {
                name: repo.name,
                findName: find.name,
                param: p.name,
                key,
                reserved: PAGED_RESERVED_LIST,
              }),
          source: `${ctx.name}/${repo.name}.${find.name}`,
        });
      }
    }
  }
  for (const h of ctx.queryHandlers ?? []) {
    if (!pagedReturn(h.returnType)) continue;
    for (const p of h.params) {
      const key = pagedReservedKey(p.name);
      if (!key) continue;
      diags.push({
        severity: "error",
        code: "loom.paged-param-reserved",
        message: diagMessage("loom.paged-param-reserved#query-handler", {
          name: h.name,
          param: p.name,
          key,
          reserved: PAGED_RESERVED_LIST,
        }),
        source: `${ctx.name}/${h.name}`,
      });
    }
  }
}
