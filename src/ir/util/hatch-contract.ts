// The contract of each escape-hatch file, as target-neutral text.
//
// A hatch file (an `extern` implementation, `docs/extern.md`) is owned by one
// model construct: an aggregate whose `extern` operations it implements
// (`Ctx.Agg`), or an `extern` command / query handler (`Ctx.Handler`).  The
// emitters tag each stub with that owner key; this module renders, from the
// IR alone, what the file is expected to implement — one `.ddd`-spelled
// signature per hook — so a person or an agent can compare it with the file
// they have.  It never reads the user's file.

import type { BoundedContextIR, LoomModel, ParamIR } from "../types/loom-ir.js";
import { allContexts } from "../types/queries.js";
import { typeLabel } from "./type-label.js";

export type HatchKind = "extern-operations" | "extern-command-handler" | "extern-query-handler";

export interface HatchContract {
  /** `Ctx.Agg` or `Ctx.Handler` — the key the emitters tag the stub with. */
  readonly owner: string;
  readonly kind: HatchKind;
  /** One `.ddd`-spelled signature per hook the file implements. */
  readonly signatures: readonly string[];
}

const params = (ps: readonly ParamIR[]): string =>
  ps.map((p) => `${p.name}: ${typeLabel(p.type)}`).join(", ");

/** Every hatch contract of one context, in declaration order. */
function contractsOf(ctx: BoundedContextIR): HatchContract[] {
  const out: HatchContract[] = [];
  for (const agg of ctx.aggregates) {
    const ops = agg.operations.filter((o) => o.extern);
    if (ops.length === 0) continue;
    out.push({
      owner: `${ctx.name}.${agg.name}`,
      kind: "extern-operations",
      signatures: ops.map(
        (o) =>
          `${o.name}(${params(o.params)})${o.returnType ? `: ${typeLabel(o.returnType)}` : ""}`,
      ),
    });
  }
  for (const h of ctx.commandHandlers ?? []) {
    if (!h.extern) continue;
    out.push({
      owner: `${ctx.name}.${h.name}`,
      kind: "extern-command-handler",
      signatures: [
        `${h.name}(${params(h.params)})${h.returnType ? `: ${typeLabel(h.returnType)}` : ""}`,
      ],
    });
  }
  for (const h of ctx.queryHandlers ?? []) {
    if (!h.extern) continue;
    out.push({
      owner: `${ctx.name}.${h.name}`,
      kind: "extern-query-handler",
      signatures: [`${h.name}(${params(h.params)}): ${typeLabel(h.returnType)}`],
    });
  }
  return out;
}

/** Every hatch contract in the model, keyed by owner. */
export function hatchContracts(loom: LoomModel): Map<string, HatchContract> {
  const byOwner = new Map<string, HatchContract>();
  for (const ctx of allContexts(loom)) {
    for (const c of contractsOf(ctx)) byOwner.set(c.owner, c);
  }
  return byOwner;
}
