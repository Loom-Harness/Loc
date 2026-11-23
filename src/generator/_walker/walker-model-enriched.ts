// The walker model of enriched bounded contexts: the walks that run on the
// server side of the Frontend Contract — LiveView's pages and the i18n catalog
// scan — read the domain IR directly.
//
// It lives apart from `walker-model.ts` because it reads each aggregate's
// declared response through `contractResponsesFor`, which taints masked fields
// with the mask analysis (`ir/enrich/mask-taint.ts`).  A contract-built
// frontend imports `walker-model.ts` and never this module, so its generator
// reaches no build pass (`test/system/frontend-contract-layering.test.ts`).
// This is the only place under `_walker/` that reads a bounded context
// (`test/system/walker-model-census.test.ts`).

import { createRequestFields } from "../../ir/plan/create-request.js";
import { createWireInvariants, operationWireInvariants } from "../../ir/plan/wire-invariants.js";
import type {
  AggregateIR,
  BoundedContextIR,
  OperationIR,
  PayloadIR,
} from "../../ir/types/loom-ir.js";
import { canonicalDestroy } from "../../ir/util/canonical-lifecycle.js";
import { contractResponsesFor } from "../../ir/util/declared-response.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import {
  clientActionGates,
  isPermissionQueryOp,
  operationFormParams,
} from "../../ir/util/op-gates.js";
import { isPagedAllRead } from "../../ir/util/paged-all.js";
import {
  listShapedProjectionNames,
  readableProjectionNames,
} from "../../ir/util/projection-read.js";
import { requestNamesForContexts } from "../../ir/util/request-names.js";
import { aggregateIsVersioned } from "../../ir/util/versioned-capability.js";
import { emitsCommandRoute, workflowResultSegment } from "../../ir/util/workflow-command-route.js";
import { snake } from "../../util/naming.js";
import { formSpecEnvOf } from "../_frontend/form-spec.js";
import { recordDerivedFields, recordFields } from "./record-fields.js";
import {
  optionalSegment,
  type WalkerAggregate,
  type WalkerHome,
  type WalkerModel,
  type WalkerOperation,
  type WalkerWorkflow,
} from "./walker-model.js";

/** The model of a ui that reaches the given contexts.  `bcByAggregate` /
 *  `bcByWorkflow` name each aggregate's and workflow's context; `contexts`,
 *  when given, is the full reach (a whole-ui scan), else the contexts the
 *  aggregate map names. */
export function walkerModelOf(opts: {
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>;
  bcByWorkflow?: ReadonlyMap<string, BoundedContextIR>;
  contexts?: readonly BoundedContextIR[];
}): WalkerModel {
  return buildModel(opts);
}

/** `op` as the walker sees it.  Its request rules are `agg`'s invariants and
 *  its own preconditions; given no `agg`, its preconditions alone. */
function walkerOperationOf(
  op: OperationIR,
  agg?: Pick<AggregateIR, "invariants" | "capabilities">,
): WalkerOperation {
  const clientGates = clientActionGates(op);
  return {
    name: op.name,
    visibility: op.visibility,
    segment: snake(op.routeSlug ?? op.name),
    ifMatch: op.name === "update" && !!agg && aggregateIsVersioned(agg),
    params: op.params,
    formParams: operationFormParams(op),
    // The permission query the derived `gateProbe` entry serves — the same
    // fact the contract path reads off the api surface.
    gated: isPermissionQueryOp(op),
    ...(clientGates ? { clientGates } : {}),
    invariants: operationWireInvariants(agg, op),
  };
}

/** `agg` as the walker sees it.  Given its context's `payloads`, its record is
 *  the declared response a page loads; without them, its declared fields. */
function walkerAggregateOf(agg: AggregateIR, payloads?: readonly PayloadIR[]): WalkerAggregate {
  const responses = payloads && contractResponsesFor(payloads, agg);
  const partNames = new Set(agg.parts.map((p) => p.name));
  return {
    name: agg.name,
    fields: responses ? recordFields(responses, agg.name, partNames) : agg.fields,
    ...(responses ? { derivedFields: recordDerivedFields(responses, agg.name) } : {}),
    parts: agg.parts.map((p) => ({
      name: p.name,
      fields: responses ? recordFields(responses, p.name, partNames) : p.fields,
    })),
    contains: agg.contains.map((c) => ({
      name: c.name,
      partName: c.partName,
      collection: c.collection,
    })),
    operations: agg.operations.map((op) => walkerOperationOf(op, agg)),
    display: !!agg.displayDerived,
    destroyable: canonicalDestroy(agg) !== null,
  };
}

function buildModel(opts: {
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>;
  bcByWorkflow?: ReadonlyMap<string, BoundedContextIR>;
  contexts?: readonly BoundedContextIR[];
}): WalkerModel {
  const bcByAggregate = opts.bcByAggregate ?? bcByAggregateOf(opts.contexts ?? []);
  const bcByWorkflow = opts.bcByWorkflow ?? workflowIndex(opts.contexts ?? []);
  const contexts: readonly BoundedContextIR[] = opts.contexts ?? [
    ...new Set(bcByAggregate.values()),
  ];
  const aggregates = new Map<string, { agg: WalkerAggregate; home: WalkerHome }>();
  const workflows = new Map<string, { wf: WalkerWorkflow; home: WalkerHome }>();
  const requestNames = requestNamesForContexts(contexts);
  for (const bc of contexts) {
    for (const agg of bc.aggregates)
      aggregates.set(agg.name, { agg: walkerAggregateOf(agg, bc.payloads), home: bc });
    for (const wf of bc.workflows) {
      workflows.set(wf.name, {
        wf: {
          name: wf.name,
          // Only a command starts a workflow through a form; an event-started
          // one has no start params to render.
          params: emitsCommandRoute(wf) ? wf.params : [],
          startable: emitsCommandRoute(wf),
          ...(emitsCommandRoute(wf)
            ? {
                ...optionalSegment(workflowResultSegment(wf)),
                requestBase: requestNames.workflow(wf.name),
              }
            : {}),
        },
        home: bc,
      });
    }
  }
  // A home is always one of these contexts: the adapter hands out the context
  // itself, so reading it back is an identity.
  const bcOf = (home: WalkerHome): BoundedContextIR => home as BoundedContextIR;
  return {
    homeOfAggregate: (aggregate) => bcByAggregate.get(aggregate),
    homeOfWorkflow: (workflow) => bcByWorkflow.get(workflow),
    homes: contexts,
    aggregates,
    workflows,
    find: (aggregate, name) =>
      bcByAggregate
        .get(aggregate)
        ?.repositories.find((r) => r.aggregateName === aggregate)
        ?.finds.find((f) => f.name === name),
    isPagedAll: (aggregate) => isPagedAllRead(aggregate, bcByAggregate),
    readableProjectionSet: readableProjectionNames(contexts),
    listShapedProjections: listShapedProjectionNames(contexts),
    createRequestFields: (home, aggregate) => {
      const bc = bcOf(home);
      const agg = bc.aggregates.find((a) => a.name === aggregate.name);
      return agg ? createRequestFields(bc.payloads, agg) : [];
    },
    createInvariants: (home, aggregate) => {
      const bc = bcOf(home);
      const agg = bc.aggregates.find((a) => a.name === aggregate.name);
      return agg ? createWireInvariants(bc.payloads, agg) : [];
    },
    isErrorRecord: (home, name) =>
      bcOf(home).payloads.some((p) => p.name === name && p.kind === "error"),
    modelTextOwner: (typeName, home) => modelTextContextOf(typeName, home && bcOf(home), contexts),
    formSpecEnv: (home) =>
      formSpecEnvOf(home, (name) => aggregates.get(name)?.agg.display === true, bcByAggregate),
  };
}

function workflowIndex(
  contexts: readonly BoundedContextIR[],
): ReadonlyMap<string, BoundedContextIR> {
  const out = new Map<string, BoundedContextIR>();
  for (const c of contexts) for (const w of c.workflows) out.set(w.name, c);
  return out;
}

/** Each aggregate's bounded context, the later declaration of a repeated
 *  name winning — a whole-ui model's index. */
function bcByAggregateOf(
  contexts: readonly BoundedContextIR[],
): ReadonlyMap<string, BoundedContextIR> {
  const out = new Map<string, BoundedContextIR>();
  for (const c of contexts) for (const a of c.aggregates) out.set(a.name, c);
  return out;
}
