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

import type {
  ContractEnum,
  ContractField,
  ContractValueObject,
  FrontendContract,
} from "../../ir/contract/frontend-contract.js";
import { createRequestFields } from "../../ir/plan/create-request.js";
import { pagedReturn } from "../../ir/stdlib/generics.js";
import type { AggregateIR, BoundedContextIR, FieldIR, TypeIR } from "../../ir/types/loom-ir.js";
import { modelTextContextOf } from "../../ir/util/model-text-owner.js";
import { isPagedAllRead } from "../../ir/util/paged-all.js";
import {
  listShapedProjectionNames,
  readableProjectionNames,
} from "../../ir/util/projection-read.js";
import {
  enumPool,
  findValueObjectInScope,
  type ScopeEnum,
  type ScopeValueObject,
  type TypeScope,
} from "../../ir/util/reachable-types.js";
import { requestNamesForContexts } from "../../ir/util/request-names.js";
import { emitsCommandRoute, workflowResultSegment } from "../../ir/util/workflow-command-route.js";
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

/** A workflow as the walker sees it: whether a command starts it
 *  (`emitsCommandRoute`), and that command's params (none when no command
 *  starts it). */
export interface WalkerWorkflow {
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
  readonly startable: boolean;
  /** On a startable workflow: the route segment of the aggregate a successful
   *  start created, when the start route answers with its id. */
  readonly resultSegment?: string;
  /** On a startable workflow: the identifier base of its client surface
   *  (`<base>Request`, `use<base>Workflow`), minted against every aggregate
   *  request the frontend's contexts export (`ir/util/request-names.ts`). */
  readonly requestBase?: string;
}

/** The workflows of `model` a walk may run, restricted to `names` (a page walk
 *  runs any; a component, action or store walk none). */
export function walkerWorkflowsFor(
  model: WalkerModel,
  names: { keys(): Iterable<string> },
): ReadonlyMap<string, WalkerWorkflow> {
  const out = new Map<string, WalkerWorkflow>();
  for (const name of names.keys()) {
    const hit = model.workflows.get(name);
    if (hit) out.set(name, hit.wf);
  }
  return out;
}

/** The workflows a walk may run, keyed by name: every one of `model`'s. */
export function walkerWorkflowsOf(model: WalkerModel): ReadonlyMap<string, WalkerWorkflow> {
  return new Map([...model.workflows].map(([name, { wf }]) => [name, wf] as const));
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

/** The model of a walk that reaches no bounded context — a layout slot, a
 *  store, a body with no domain reads. */
export function emptyWalkerModel(): WalkerModel {
  return walkerModelOf({});
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
  const bcByWorkflow = opts.bcByWorkflow ?? workflowIndex(opts.contexts ?? []);
  const contexts: readonly BoundedContextIR[] = opts.contexts ?? [
    ...new Set(bcByAggregate.values()),
  ];
  const aggregates = new Map<string, { agg: WalkerAggregate; home: WalkerHome }>();
  const workflows = new Map<string, { wf: WalkerWorkflow; home: WalkerHome }>();
  const requestNames = requestNamesForContexts(contexts);
  for (const bc of contexts) {
    for (const agg of bc.aggregates) aggregates.set(agg.name, { agg, home: bc });
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

function workflowIndex(
  contexts: readonly BoundedContextIR[],
): ReadonlyMap<string, BoundedContextIR> {
  const out = new Map<string, BoundedContextIR>();
  for (const c of contexts) for (const w of c.workflows) out.set(w.name, c);
  return out;
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

/** Which contexts a model's homes are: the ones the ui's aggregates live in, in
 *  first-reached order (a page walk), or every given context (a whole-ui
 *  scan). */
export type WalkerReach = "aggregates" | "contexts";

/** A context's type scope as the Frontend Contract carries it: the enums and
 *  value objects it declares plus the system-level ones, then the other
 *  contexts' declarations whose names it lacks.  The contract twin of a
 *  `BoundedContextIR`'s own and sibling pools. */
export type ContractHome = TypeScope<ContractEnum, ContractValueObject> & { readonly name: string };

/** {@link ContractHome} for each of `names`, keyed by context name. */
export function contractHomes(
  contract: FrontendContract,
  names: readonly string[],
): Map<string, ContractHome> {
  const w = contract.wire;
  const systemEnums = w.enums.filter((e) => e.context === undefined);
  const systemVos = w.valueObjects.filter((v) => v.context === undefined);
  const out = new Map<string, ContractHome>();
  for (const name of names) {
    const enums = [...w.enums.filter((e) => e.context === name), ...systemEnums];
    const vos = [...w.valueObjects.filter((v) => v.context === name), ...systemVos];
    const enumNames = new Set(enums.map((e) => e.name));
    const voNames = new Set(vos.map((v) => v.name));
    out.set(name, {
      name,
      enums,
      siblingEnums: w.enums.filter(
        (e) => e.context !== undefined && e.context !== name && !enumNames.has(e.name),
      ),
      valueObjects: vos,
      siblingValueObjects: w.valueObjects.filter(
        (v) => v.context !== undefined && v.context !== name && !voNames.has(v.name),
      ),
    });
  }
  return out;
}

/** The model of a ui that reaches `contextNames`, read off the Frontend
 *  Contract alone.  It answers every `WalkerModel` question the same way
 *  `walkerModelOf` does over the enriched contexts; the equivalence test
 *  (`test/generator/_walker/walker-model-equivalence.test.ts`) holds the two
 *  together. */
export function walkerModelOfContract(
  contract: FrontendContract,
  contextNames: readonly string[],
  reach: WalkerReach = "aggregates",
): WalkerModel {
  const w = contract.wire;
  const served = new Set(contextNames);
  const servedAggregates = w.aggregates.filter((a) => served.has(a.context));
  const homeNames =
    reach === "contexts" ? [...contextNames] : [...new Set(servedAggregates.map((a) => a.context))];
  const homeByName = contractHomes(contract, homeNames);
  const homes = [...homeByName.values()];
  const aggregates = new Map<string, { agg: WalkerAggregate; home: WalkerHome }>();
  for (const a of servedAggregates) {
    const home = homeByName.get(a.context);
    if (!home) continue;
    const response = w.responses.find((r) => r.entity === a.name);
    aggregates.set(a.name, {
      agg: {
        name: a.name,
        fields: (response?.fields ?? []).map((f) => ({ name: f.name })),
        operations: w.operations
          .filter((o) => o.aggregate === a.name && o.kind === "operation" && o.opName)
          .map((o) => ({
            name: o.opName as string,
            visibility: "public",
            params: o.params
              .filter((p) => p.location === "body")
              .map((p) => ({ name: p.name, type: p.type })),
          })),
      },
      home,
    });
  }
  const workflows = new Map<string, { wf: WalkerWorkflow; home: WalkerHome }>();
  for (const wf of w.workflows) {
    const home = homeByName.get(wf.context);
    if (!home) continue;
    workflows.set(wf.name, {
      wf: {
        name: wf.name,
        params: wf.params ?? [],
        startable: wf.params !== undefined,
        ...optionalSegment(wf.resultSegment),
        ...(wf.requestBase !== undefined ? { requestBase: wf.requestBase } : {}),
      },
      home,
    });
  }
  const find = (aggregate: string, name: string): WalkerFind | undefined => {
    const f = w.finds.find((x) => x.aggregate === aggregate && x.name === name);
    return f && { name: f.name, params: f.params, returnType: f.returnType };
  };
  const isPagedAll = (aggregate: string): boolean => {
    const all = find(aggregate, "all");
    return all ? pagedReturn(all.returnType) !== null : false;
  };
  const projections = w.projections.filter((p) => served.has(p.context));
  // Mirrors `modelTextContextOf`: the home context wins outright; else the one
  // context that declares the type, the first by name when several do.
  const declares = (home: string, type: string): "own" | "system" | undefined => {
    const agg = servedAggregates.find(
      (a) => a.context === home && (a.name === type || (a.parts ?? []).includes(type)),
    );
    if (agg) return "own";
    if (w.workflows.some((x) => x.context === home && x.name === type)) return "own";
    for (const decl of [...w.enums, ...w.valueObjects]) {
      if (decl.name !== type) continue;
      if (decl.context === undefined) return "system";
      if (decl.context === home) return "own";
    }
    return undefined;
  };
  return {
    homeOfAggregate: (aggregate) => aggregates.get(aggregate)?.home,
    homeOfWorkflow: (workflow) => workflows.get(workflow)?.home,
    homes,
    aggregates,
    workflows,
    find,
    isPagedAll,
    readableProjectionSet: new Set(projections.map((p) => p.name)),
    listShapedProjections: new Set(projections.filter((p) => p.many).map((p) => p.name)),
    createRequestFields: (_home, aggregate) => {
      const name = w.aggregates.find((a) => a.name === aggregate.name)?.createRequest;
      const record = name && w.records.find((r) => r.name === name);
      return record ? record.fields.map(asField) : [];
    },
    isErrorRecord: (home, name) =>
      w.records.some((r) => r.name === name && r.kind === "error" && r.context === home.name),
    modelTextOwner: (typeName, home) => {
      if (home) {
        const d = declares(home.name, typeName);
        if (d === "own") return home.name;
        if (d === "system") return undefined;
      }
      return homes
        .map((h) => h.name)
        .filter((h) => declares(h, typeName) === "own")
        .sort()[0];
    },
    formSpecEnv: (home, aggregatesByName) => ({
      enumValues: (name) => enumPool(home).find((e) => e.name === name)?.values,
      valueObjectFields: (name) => findValueObjectInScope(home, name)?.fields,
      hasDisplay: (aggregate) => !!aggregatesByName.get(aggregate)?.displayDerived,
      isPaged: isPagedAll,
    }),
  };
}

/** A contract record field as the IR field a create form renders. */
function asField(f: ContractField): FieldIR {
  return {
    name: f.name,
    type: f.type,
    optional: f.optional,
    ...(f.default !== undefined ? { default: f.default } : {}),
  } as FieldIR;
}

const optionalSegment = (resultSegment: string | undefined) =>
  resultSegment !== undefined ? { resultSegment } : {};
