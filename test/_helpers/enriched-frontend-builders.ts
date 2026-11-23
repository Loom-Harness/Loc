// The enriched-IR derivations of the facts a frontend reads off the Frontend
// Contract: the aggregate model, the page names and the workflow page-object
// inputs, each built from the enriched contexts instead.
//
// No frontend emits from these: every one reads the contract.  They stay as the
// oracle the equivalence tests hold the contract builders to
// (`test/generator/_frontend/aggregate-model-equivalence.test.ts`,
// `frontend-scope-equivalence.test.ts`) — two independent derivations of one
// fact that must agree on every tracked model.

import type {
  FrontendAggregate,
  FrontendField,
} from "../../src/generator/_frontend/aggregate-model.js";
import type { ClientFind } from "../../src/generator/_frontend/contract.js";
import type { WorkflowPageObjectResolver } from "../../src/generator/_frontend/workflow-page-object.js";
import { collectUsedTypes } from "../../src/generator/_frontend/zod-schemas.js";
import { createRequestFields } from "../../src/ir/plan/create-request.js";
import { unionReturn } from "../../src/ir/stdlib/unions.js";
import {
  type AggregateIR,
  aggregateUsesMoneyDeep,
  type BoundedContextIR,
  type ExprIR,
  type TypeIR,
} from "../../src/ir/types/loom-ir.js";
import { emitsRestCreate } from "../../src/ir/util/canonical-lifecycle.js";
import { partsChildrenFirst } from "../../src/ir/util/containment-parent.js";
import { isPermissionQueryOp, operationFormParams } from "../../src/ir/util/op-gates.js";
import type { PageNameCtx } from "../../src/ir/util/page-kind.js";
import { valueObjectPool } from "../../src/ir/util/reachable-types.js";
import { requestNamesForContexts } from "../../src/ir/util/request-names.js";
import { snake } from "../../src/util/naming.js";

const field = (f: {
  name: string;
  type: TypeIR;
  optional?: boolean;
  default?: ExprIR;
}): FrontendField => ({
  name: f.name,
  type: f.type,
  optional: !!f.optional,
  ...(f.default !== undefined ? { default: f.default } : {}),
});

/** True iff the aggregate (root or a part) declares a `provenanced` field. */
function aggregateHasProvenanced(agg: AggregateIR): boolean {
  return (
    agg.fields.some((f) => f.provenanced) ||
    agg.parts.some((p) => p.fields.some((f) => f.provenanced))
  );
}

/** The model of `agg` built from its enriched node and declaring context. */
export function frontendAggregateOf(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  finds: readonly ClientFind[] = [],
): FrontendAggregate {
  const used = collectUsedTypes(agg, { finds }, ctx);
  return {
    name: agg.name,
    scope: ctx,
    restCreate: emitsRestCreate(agg),
    createFields: createRequestFields(ctx.payloads, agg).map(field),
    operations: agg.operations
      .filter((o) => o.visibility === "public")
      .map((o) => {
        const u = o.returnType ? unionReturn(o.returnType) : null;
        return {
          name: o.name,
          segment: snake(o.routeSlug ?? o.name),
          gated: isPermissionQueryOp(o),
          ...(u ? { union: u.variants } : {}),
          paramCount: o.params.length,
          formParams: operationFormParams(o).map((p) => ({ name: p.name, type: p.type })),
        };
      }),
    collections: agg.contains
      .filter((c) => c.collection && agg.parts.some((p) => p.name === c.partName))
      .map((c) => c.name),
    parts: partsChildrenFirst(agg.parts).map((p) => p.name),
    enums: used.enums,
    valueObjects: used.valueObjects,
    usesMoney: aggregateUsesMoneyDeep(agg, valueObjectPool(ctx)),
    carriesProvenance: aggregateHasProvenanced(agg),
    errorRecord: (name) => {
      const p = ctx.payloads.find((x) => x.name === name && x.kind === "error");
      return p && { fields: p.fields.map(field) };
    },
  };
}

/** The page names over a frontend's bounded contexts. */
export function pageNamesOf(
  contexts: Iterable<{
    readonly aggregates: readonly { readonly name: string }[];
    readonly workflows: readonly { readonly name: string }[];
  }>,
): PageNameCtx {
  const list = [...contexts];
  return {
    aggregateNames: [...new Set(list.flatMap((c) => c.aggregates.map((a) => a.name)))],
    workflowNames: list.flatMap((c) => c.workflows.map((w) => w.name)),
  };
}

/** The workflow page-object resolver over a frontend's bounded contexts. */
export function workflowPageObjectsOf(
  contextsByName: ReadonlyMap<string, BoundedContextIR>,
): WorkflowPageObjectResolver {
  const names = requestNamesForContexts(contextsByName.values());
  return (name, context) => {
    let bc = contextsByName.get(context);
    let wf = bc?.workflows.find((w) => w.name === name);
    if (!wf) {
      for (const c of contextsByName.values()) {
        const found = c.workflows.find((w) => w.name === name);
        if (found) {
          bc = c;
          wf = found;
          break;
        }
      }
    }
    if (!bc || !wf) return undefined;
    return { name: wf.name, params: wf.params, scope: bc, requestBase: names.workflow(wf.name) };
  };
}
