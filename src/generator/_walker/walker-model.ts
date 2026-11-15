// What the page-body walker knows about the domain behind a ui.
//
// The walker renders page bodies for every frontend target and for LiveView.
// It reads a small, fixed set of facts about the bounded contexts a ui reaches:
// the type scope a form's fields resolve in, a repository find's params and
// return type, which projections are readable and which answer a list, the
// create request a `CreateForm` renders, whether a tag names an error record,
// and which context a type's identity text is keyed under.  `WalkerModel` is
// that set, and nothing else; the walker never holds a bounded context.
//
// `walkerModelOf` builds the model from enriched bounded contexts.  It is the
// only place under `_walker/` that reads one (`test/system/walker-model-census.test.ts`),
// and every target builds its model through it.

import { createRequestFields } from "../../ir/plan/create-request.js";
import type {
  AggregateIR,
  BoundedContextIR,
  FieldIR,
  TypeIR,
  WorkflowIR,
} from "../../ir/types/loom-ir.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import { isPagedAllRead } from "../../ir/util/paged-all.js";
import {
  listShapedProjectionNames,
  readableProjectionNames,
} from "../../ir/util/projection-read.js";
import type { TypeScope } from "../../ir/util/reachable-types.js";
import { type FormSpecEnv, formSpecEnvOf } from "../_frontend/form-spec.js";

/** One bounded context as the walker sees it: its name (the `<Ctx>` segment of
 *  an identity text key) and the enum and value-object declarations a type
 *  name resolves against there. */
export interface WalkerHome extends TypeScope {
  readonly name: string;
}

/** A repository find, as a page body calls it. */
export interface WalkerFind {
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
  readonly returnType: TypeIR;
}

export interface WalkerModel {
  /** The context an aggregate's forms resolve their types in. */
  homeOfAggregate(aggregate: string): WalkerHome | undefined;
  /** The context a workflow's forms resolve their types in. */
  homeOfWorkflow(workflow: string): WalkerHome | undefined;
  /** Every context the ui reaches, each once, in first-reached order. */
  readonly homes: readonly WalkerHome[];
  /** Every aggregate the ui reaches, with its context; a name declared twice
   *  keeps the later declaration. */
  readonly aggregates: ReadonlyMap<string, { agg: AggregateIR; home: WalkerHome }>;
  /** Every workflow the ui reaches, with its context. */
  readonly workflows: ReadonlyMap<string, { wf: WorkflowIR; home: WalkerHome }>;
  /** The find `name` of `aggregate`'s repository. */
  find(aggregate: string, name: string): WalkerFind | undefined;
  /** `<aggregate>.all` answers the `paged<T>` envelope. */
  isPagedAll(aggregate: string): boolean;
  /** The projections a client reads. */
  readonly readableProjections: ReadonlySet<string>;
  /** The readable projections whose read answers a list of rows. */
  readonly listShapedProjections: ReadonlySet<string>;
  /** The fields `aggregate`'s create request carries (`createRequestFields`). */
  createRequestFields(home: WalkerHome, aggregate: AggregateIR): readonly FieldIR[];
  /** `home` declares an `error` record named `name`. */
  isErrorRecord(home: WalkerHome, name: string): boolean;
  /** The context `typeName`'s identity text is keyed under, looked up first in
   *  `home` (`modelTextContextOf`). */
  modelTextOwner(typeName: string, home: WalkerHome | undefined): string | undefined;
  /** The form-spec env for forms over `home`'s types. */
  formSpecEnv(home: WalkerHome, aggregatesByName: ReadonlyMap<string, AggregateIR>): FormSpecEnv;
}

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

function buildModel(opts: {
  bcByAggregate?: ReadonlyMap<string, BoundedContextIR>;
  bcByWorkflow?: ReadonlyMap<string, BoundedContextIR>;
  contexts?: readonly BoundedContextIR[];
}): WalkerModel {
  const bcByAggregate = opts.bcByAggregate ?? bcByAggregateOf(opts.contexts ?? []);
  const bcByWorkflow = opts.bcByWorkflow ?? new Map<string, BoundedContextIR>();
  const contexts: readonly BoundedContextIR[] = opts.contexts ?? [
    ...new Set(bcByAggregate.values()),
  ];
  const aggregates = new Map<string, { agg: AggregateIR; home: WalkerHome }>();
  const workflows = new Map<string, { wf: WorkflowIR; home: WalkerHome }>();
  for (const bc of contexts) {
    for (const agg of bc.aggregates) aggregates.set(agg.name, { agg, home: bc });
    for (const wf of bc.workflows) workflows.set(wf.name, { wf, home: bc });
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
    readableProjections: readableProjectionNames(contexts),
    listShapedProjections: listShapedProjectionNames(contexts),
    createRequestFields: (home, aggregate) => createRequestFields(bcOf(home).payloads, aggregate),
    isErrorRecord: (home, name) =>
      bcOf(home).payloads.some((p) => p.name === name && p.kind === "error"),
    modelTextOwner: (typeName, home) => modelTextContextOf(typeName, home && bcOf(home), contexts),
    formSpecEnv: (home, aggregatesByName) => formSpecEnvOf(home, aggregatesByName, bcByAggregate),
  };
}

/** Each aggregate's bounded context, the later declaration of a repeated
 *  name winning — the index the Feliz and Flutter collectors and a whole-ui
 *  model share. */
export function bcByAggregateOf(
  contexts: readonly BoundedContextIR[],
): ReadonlyMap<string, BoundedContextIR> {
  const out = new Map<string, BoundedContextIR>();
  for (const c of contexts) for (const a of c.aggregates) out.set(a.name, c);
  return out;
}
