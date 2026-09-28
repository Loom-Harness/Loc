// ---------------------------------------------------------------------------
// A CONTEXT-level `filter` lowers in the AGGREGATE's env, not the context's.
//
// `context Sales { filter !this.isDeleted }` propagates to every aggregate in
// the context.  It was lowered ONCE, in the context's env — which binds no
// `this` — and the already-lowered predicate was then concatenated onto each
// aggregate.  So every aggregate received the filter with its `this.<field>`
// refs UNRESOLVED: on an `isDeleted: bool` column the member access carried
// `receiverType`/`memberType` of `string`.
//
// Nothing read those types, so every emitter was right and the defect was
// invisible — `ddd generate system` reported `0 error(s)` and the .NET
// `HasQueryFilter`, the drizzle predicate and the Ecto `where` were all
// correct.  It surfaces the moment any validator or emitter asks the IR what
// the field IS, which `LoomModel` promises it can: "every member access
// carries `receiverType` and `memberType`" (docs/technical.md).  A type claim
// read off this node reported a `bool` column as a `string`.
//
// The fix carries the FilterDecl / StampDecl AST nodes unlowered and lowers
// them per aggregate, where `this` is bound.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { walkExprDeep } from "../../src/ir/util/walk.js";
import { parseString } from "../_helpers/parse.js";

const SRC = `
system Demo {
  subdomain M { context Sales {
    filter !this.isDeleted
    stamp onCreate { touchedBy := this.subject }
    aggregate Order with crudish {
      subject: string
      isDeleted: bool
      touchedBy: string managed
    }
    aggregate Customer with crudish {
      subject: string
      isDeleted: bool
      touchedBy: string managed
    }
  }}
  api A from M
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d { platform: dotnet contexts: [Sales] dataSources: [st] serves: A port: 3000 }
}`;

/** Every `this.<member>` access reachable from `e`, as `<member>:<memberType>`. */
function memberTypes(e: ExprIR): string[] {
  const out: string[] = [];
  walkExprDeep(e, (n) => {
    if (n.kind === "member" && n.receiver.kind === "this") {
      const t = n.memberType;
      out.push(`${n.member}:${t?.kind === "primitive" ? t.name : (t?.kind ?? "none")}`);
    }
  });
  return out;
}

describe("a context-level capability lowers against the aggregate it lands on", () => {
  it("types `this.<field>` from the AGGREGATE, on every aggregate in the context", async () => {
    const m = enrichLoomModel(lowerModel((await parseString(SRC)).model));
    const ctx = m.systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.aggregates.map((a) => a.name)).toEqual(["Order", "Customer"]);
    for (const agg of ctx.aggregates) {
      const filters = (agg as { contextFilters?: ExprIR[] }).contextFilters ?? [];
      expect(filters.length, `${agg.name} did not receive the context filter`).toBe(1);
      // `isDeleted: bool` — the whole defect was this reading `string`.
      expect(memberTypes(filters[0]!), `${agg.name}`).toEqual(["isDeleted:bool"]);
    }
  });

  it("types a context-level STAMP's value the same way", async () => {
    const m = enrichLoomModel(lowerModel((await parseString(SRC)).model));
    const ctx = m.systems[0]!.subdomains[0]!.contexts[0]!;
    for (const agg of ctx.aggregates) {
      const stamps =
        (agg as { contextStamps?: { assignments: { value: ExprIR }[] }[] }).contextStamps ?? [];
      expect(stamps.length, `${agg.name} did not receive the context stamp`).toBe(1);
      expect(memberTypes(stamps[0]!.assignments[0]!.value), `${agg.name}`).toEqual([
        "subject:string",
      ]);
    }
  });
});
