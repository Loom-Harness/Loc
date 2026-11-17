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
// `walkerModelOfContract` builds it from the Frontend Contract, for every
// contract-built frontend.  `walkerModelOf` (`walker-model-enriched.ts`)
// builds it from enriched bounded contexts for the server-side walks; it lives
// in its own module so a contract-built frontend's generator never reaches the
// passes that module reads through.

import type {
  ContractAggregate,
  ContractEnum,
  ContractField,
  ContractValueObject,
  FrontendContract,
} from "../../ir/contract/frontend-contract.js";
import type { WireInvariant } from "../../ir/plan/wire-invariants.js";
import { pagedReturn } from "../../ir/stdlib/generics.js";
import type { BoundedContextIR, ExprIR, FieldIR, TypeIR } from "../../ir/types/loom-ir.js";
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
  type ScopeField,
  type ScopeValueObject,
  type TypeScope,
} from "../../ir/util/reachable-types.js";
import { type FormSpecEnv, formSpecEnvOf } from "../_frontend/form-spec.js";
import { containedPart, recordFields } from "./record-fields.js";

/** One bounded context as the walker sees it: its name (the `<Ctx>` segment of
 *  an identity text key) and the enum and value-object declarations a type
 *  name resolves against there. */
export interface WalkerHome extends TypeScope<ScopeEnum, ScopeValueObject> {
  readonly name: string;
}

/** A field of a record a page reads: its wire type and absence, and whether
 *  it rides the `Provenanced<T>` carrier. */
export interface WalkerField extends ScopeField {
  readonly provenanced?: boolean;
}

/** An aggregate as the walker sees it: the record a page loads, its parts and
 *  containments, and its public operations, each with the params a form for
 *  it renders. */
export interface WalkerAggregate {
  readonly name: string;
  /** The fields of the record a page loads: a cell's absence guard, a value
   *  object row, an update form's prefill and an operation input's label read
   *  them by name. */
  readonly fields: readonly WalkerField[];
  readonly parts: readonly { readonly name: string; readonly fields: readonly WalkerField[] }[];
  /** Its containments: the member a record reads and the part it holds. */
  readonly contains: readonly {
    readonly name: string;
    readonly partName: string;
    readonly collection: boolean;
  }[];
  readonly operations: readonly WalkerOperation[];
  /** It declares a `derived display`, served as the record's `display` field. */
  readonly display: boolean;
  /** It serves the generic delete (its canonical `destroy`). */
  readonly destroyable: boolean;
}

/** An operation param a form renders: a declared default seeds its value. */
export interface WalkerParam {
  readonly name: string;
  readonly type: TypeIR;
  readonly default?: ExprIR;
}

export interface WalkerOperation {
  readonly name: string;
  readonly visibility: string;
  /** The route segment it is posted to (`/<tag>/{id}/<segment>`). */
  readonly segment: string;
  /** Its call sends the `If-Match` precondition: the backend guards the write
   *  on the row version (`sendsIfMatchPrecondition`). */
  readonly ifMatch: boolean;
  readonly params: readonly { readonly name: string; readonly type: TypeIR }[];
  /** The params its form renders, with their declared defaults: a masked
   *  merge-patch key is left out. */
  readonly formParams: readonly WalkerParam[];
  /** It has a `when` gate, probed at `GET /{id}/can_<op>`. */
  readonly gated: boolean;
  /** Its action gates when every one reads only `currentUser` and constants
   *  (`clientActionGates`). */
  readonly clientGates?: readonly ExprIR[];
  /** The rules its request is validated against before sending
   *  (`operationWireInvariants`). */
  readonly invariants: readonly WireInvariant[];
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
  /** The rules `aggregate`'s create request is validated against before
   *  sending (`createWireInvariants`). */
  createInvariants(
    home: WalkerHome,
    aggregate: { readonly name: string },
  ): readonly WireInvariant[];
  /** `home` declares an `error` record named `name`. */
  isErrorRecord(home: WalkerHome, name: string): boolean;
  /** The context `typeName`'s identity text is keyed under, looked up first in
   *  `home` (`modelTextContextOf`). */
  modelTextOwner(typeName: string, home: WalkerHome | undefined): string | undefined;
  /** The form-spec env for forms over `home`'s types; a picker's display
   *  reads this model's aggregates. */
  formSpecEnv(home: WalkerHome): FormSpecEnv;
}

/** The model of a walk that reaches no bounded context — a layout slot, a
 *  store, a body with no domain reads. */
export function emptyWalkerModel(): WalkerModel {
  const none = new Map<string, BoundedContextIR>();
  return {
    homeOfAggregate: () => undefined,
    homeOfWorkflow: () => undefined,
    homes: [],
    aggregates: new Map(),
    workflows: new Map(),
    find: () => undefined,
    isPagedAll: (aggregate) => isPagedAllRead(aggregate, none),
    readableProjectionSet: readableProjectionNames([]),
    listShapedProjections: listShapedProjectionNames([]),
    createRequestFields: () => [],
    createInvariants: () => [],
    isErrorRecord: () => false,
    modelTextOwner: (typeName, home) =>
      modelTextContextOf(typeName, home as BoundedContextIR | undefined, []),
    formSpecEnv: (home) => formSpecEnvOf(home, () => false, none),
  };
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
    aggregates.set(a.name, { agg: contractAggregateOf(contract, a), home });
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
    createInvariants: (_home, aggregate) =>
      w.operations.find((o) => o.aggregate === aggregate.name && o.kind === "create")?.invariants ??
      [],
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
    formSpecEnv: (home) => ({
      enumValues: (name) => enumPool(home).find((e) => e.name === name)?.values,
      valueObjectFields: (name) => findValueObjectInScope(home, name)?.fields,
      hasDisplay: (aggregate) => aggregates.get(aggregate)?.agg.display === true,
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

export const optionalSegment = (resultSegment: string | undefined) =>
  resultSegment !== undefined ? { resultSegment } : {};

/** The walker's view of an aggregate the contract carries: the record is its
 *  declared response, each part's its own, and its operations the ones an
 *  api serves. */
function contractAggregateOf(contract: FrontendContract, a: ContractAggregate): WalkerAggregate {
  const w = contract.wire;
  const partNames = new Set(a.parts ?? []);
  const ops = w.operations.filter((o) => o.aggregate === a.name);
  const gated = new Set(ops.filter((o) => o.kind === "gateProbe").map((o) => o.opName));
  return {
    name: a.name,
    fields: recordFields(w.responses, a.name, partNames),
    parts: (a.parts ?? []).map((p) => ({
      name: p,
      fields: recordFields(w.responses, p, partNames),
    })),
    contains: (w.responses.find((r) => r.entity === a.name)?.fields ?? []).flatMap((f) => {
      const hit = containedPart(f.type, partNames);
      return hit ? [{ name: f.name, partName: hit.part, collection: hit.collection }] : [];
    }),
    operations: ops
      .filter((o) => o.kind === "operation" && o.opName !== undefined)
      .map((o) => {
        const body = o.params
          .filter((p) => p.location === "body")
          .map((p) => ({ name: p.name, type: p.type }));
        const optional = new Set(o.optionalParams ?? []);
        const defaults = new Map((o.paramDefaults ?? []).map((d) => [d.name, d.value]));
        return {
          name: o.opName as string,
          visibility: "public",
          segment: o.path.slice(o.path.lastIndexOf("/") + 1),
          ifMatch: o.ifMatch === true,
          params: body,
          formParams: body
            .filter((p) => !optional.has(p.name))
            .map((p) => {
              const d = defaults.get(p.name);
              return d ? { ...p, default: d } : p;
            }),
          gated: gated.has(o.opName),
          ...(o.clientGates ? { clientGates: o.clientGates } : {}),
          invariants: o.invariants ?? [],
        };
      }),
    display: a.display === true,
    destroyable: ops.some((o) => o.kind === "destroy"),
  };
}

/** Every aggregate of `model`, keyed by name. */
export function walkerAggregatesOf(model: WalkerModel): ReadonlyMap<string, WalkerAggregate> {
  return new Map([...model.aggregates].map(([name, { agg }]) => [name, agg] as const));
}

/** The aggregate `name` of the walk's model, as the walker sees it. */
export function walkerAggregate(
  model: WalkerModel,
  name: string | undefined,
): WalkerAggregate | undefined {
  return name === undefined ? undefined : model.aggregates.get(name)?.agg;
}
