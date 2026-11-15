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
import type { ScopeEnum, ScopeValueObject, TypeScope } from "../../ir/util/reachable-types.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { type FormSpecEnv, formSpecEnvOf } from "../_frontend/form-spec.js";

/** One bounded context as the walker sees it: its name (the `<Ctx>` segment of
 *  an identity text key) and the enum and value-object declarations a type
 *  name resolves against there. */
export interface WalkerHome extends TypeScope<ScopeEnum, ScopeValueObject> {
  readonly name: string;
}

/** An aggregate as the walker sees it: its public operations, each with the
 *  params a form for it renders. */
export interface WalkerAggregate {
  readonly name: string;
  /** Its declared fields, by name: an operation input mirroring one keys its
   *  label under the aggregate. */
  readonly fields: readonly { readonly name: string }[];
  readonly operations: readonly WalkerOperation[];
}

export interface WalkerOperation {
  readonly name: string;
  readonly visibility: string;
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
}

/** A workflow as the walker sees it: its start params, and whether a command
 *  starts it (`emitsCommandRoute`). */
export interface WalkerWorkflow {
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
  readonly startable: boolean;
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
  readonly aggregates: ReadonlyMap<string, { agg: WalkerAggregate; home: WalkerHome }>;
  /** Every workflow the ui reaches, with its context. */
  readonly workflows: ReadonlyMap<string, { wf: WalkerWorkflow; home: WalkerHome }>;
  /** The find `name` of `aggregate`'s repository. */
  find(aggregate: string, name: string): WalkerFind | undefined;
  /** `<aggregate>.all` answers the `paged<T>` envelope. */
  isPagedAll(aggregate: string): boolean;
  /** The projections a client reads. */
  readonly readableProjectionSet: ReadonlySet<string>;
  /** The readable projections whose read answers a list of rows. */
  readonly listShapedProjections: ReadonlySet<string>;
  /** The fields `aggregate`'s create request carries (`createRequestFields`). */
  createRequestFields(home: WalkerHome, aggregate: { readonly name: string }): readonly FieldIR[];
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
  const aggregates = new Map<string, { agg: WalkerAggregate; home: WalkerHome }>();
  const workflows = new Map<string, { wf: WalkerWorkflow; home: WalkerHome }>();
  for (const bc of contexts) {
    for (const agg of bc.aggregates) aggregates.set(agg.name, { agg, home: bc });
    for (const wf of bc.workflows) {
      workflows.set(wf.name, {
        wf: { name: wf.name, params: wf.params, startable: emitsCommandRoute(wf) },
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
    // The walker hands back the aggregate it resolved off this model or the
    // enriched aggregate map, both of which are the context's own node.
    createRequestFields: (home, aggregate) =>
      createRequestFields(bcOf(home).payloads, aggregate as AggregateIR),
    isErrorRecord: (home, name) =>
      bcOf(home).payloads.some((p) => p.name === name && p.kind === "error"),
    modelTextOwner: (typeName, home) => modelTextContextOf(typeName, home && bcOf(home), contexts),
    formSpecEnv: (home, aggregatesByName) => formSpecEnvOf(home, aggregatesByName, bcByAggregate),
  };
}

/** The bounded context behind a home of a model `walkerModelOf` built.  For
 *  the targets that always walk on the enriched model and keep their own
 *  domain-typed form code (Angular, Feliz); a home of any other model has no
 *  context behind it. */
export function contextOfHome(home: WalkerHome): BoundedContextIR {
  if (!("payloads" in home)) {
    throw new Error(`internal: home '${home.name}' was not built from a bounded context`);
  }
  return home as BoundedContextIR;
}

/** {@link contextOfHome} of a home a lookup may not find. */
export function contextOfOptionalHome(home: WalkerHome | undefined): BoundedContextIR | undefined {
  return home && contextOfHome(home);
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
