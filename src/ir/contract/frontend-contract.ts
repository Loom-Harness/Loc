// The Frontend Contract: the reduced, serializable view of an enriched system
// that a frontend target emits from on its own — the resolved UI plus the wire
// surface the generated client sees, and nothing of the domain behind it.
//
// Two halves.  The UI half is the system's `ui`s, root components and layouts,
// copied through the allowlist in `ui-spec.ts`.  The wire half is the exposed
// API: the operations of every context the system serves (`exposedContexts`),
// the response record of each exposed aggregate and part, the declared
// command / query / error / payload records, the events a UI notification
// names, and the value objects and enums those reach.  Response records are
// the declared records, read through `declaredResponseFor` by
// `contractResponsesFor` (`src/ir/util/declared-response.ts`); the derived wire
// shape is never read.  A masked field ships as a `maskable` flag; its
// predicate stays on the server.
//
// Request shapes are the declared `command` / `query` records; no derived
// create-input or operation-input shape is shipped.  An aggregate whose
// context declares no response record is not exposed over a declared contract
// and is absent.  The build is an allowlist (`allowlist.ts`): every value in
// the result was copied on purpose, so the result is JSON-exact — it equals
// its own `JSON.parse(JSON.stringify(…))`.

import { createRequestRecord } from "../plan/create-request.js";
import { createWireInvariants, operationWireInvariants } from "../plan/wire-invariants.js";
import { pagedReturn, pagedSortDefault } from "../stdlib/generics.js";
import type {
  AggregateIR,
  ApiIR,
  ComponentIR,
  EnrichedBoundedContextIR,
  EnrichedLoomModel,
  EnrichedSystemIR,
  EnumIR,
  EventIR,
  ExprIR,
  FieldIR,
  LayoutIR,
  MessageIR,
  PayloadIR,
  RouteIR,
  TypeIR,
  UiIR,
  ValueObjectIR,
} from "../types/loom-ir.js";
import {
  type ApiOperationIR,
  type ApiOperationParamIR,
  deriveContextOperations,
} from "../util/api-surface.js";
import {
  type ContractResponse,
  type ContractResponseField,
  contractResponsesFor,
} from "../util/declared-response.js";
import { exposedContexts } from "../util/exposed-contexts.js";
import { classifyForWire } from "../util/invariant-classify.js";
import { clientActionGates, maskedPatchParams } from "../util/op-gates.js";
import { pagedFindRoutes } from "../util/paged-find-routes.js";
import { isFrontendReadableProjection, projectionReadShape } from "../util/projection-read.js";
import { requestNamesForContexts } from "../util/request-names.js";
import { aggregateIsVersioned } from "../util/versioned-capability.js";
import { emitsCommandRoute, workflowResultSegment } from "../util/workflow-command-route.js";
import { drop, keep, list, type Rule, record } from "./allowlist.js";
import { componentRule, exprRule, layoutRule, messageRule, typeRule, uiRule } from "./ui-spec.js";

/** Bumped on any change a consumer must react to. */
const FRONTEND_CONTRACT_VERSION = 1;

export interface FrontendContract {
  contractVersion: number;
  system: string;
  ui: {
    uis: UiIR[];
    /** Root-level components, visible to every ui. */
    components: ComponentIR[];
    layouts: LayoutIR[];
    /** The `currentUser` claim shape page expressions read. */
    user?: { fields: ContractField[]; registry?: string };
  };
  wire: {
    apis: ApiIR[];
    operations: ContractOperation[];
    /** Every aggregate the exposed contexts serve, with the read surface beside
     *  its operations. */
    aggregates: ContractAggregate[];
    /** Every repository find of an exposed aggregate a client may call. */
    finds: ContractFind[];
    responses: ContractResponse[];
    /** Declared `command` / `query` / `error` / `payload` records, plus any
     *  `response` record no aggregate claims, and the paged / union carriers. */
    records: ContractRecord[];
    /** Every event an exposed context declares, and every event a UI
     *  notification subscribes to, each with the context that declares it. */
    events: ContractRecord[];
    /** Every workflow of an exposed context a client starts or observes, by
     *  name. */
    workflows: ContractWorkflow[];
    /** Every projection of an exposed context a client reads, in declaration
     *  order. */
    projections: ContractProjection[];
    valueObjects: ContractValueObject[];
    enums: ContractEnum[];
  };
}

export interface ContractEnum {
  name: string;
  values: string[];
  /** The bounded context that declares it; absent when it is declared at
   *  system level. */
  context?: string;
}

export interface ContractAggregate {
  name: string;
  /** The bounded context that owns it. */
  context: string;
  /** The aggregate serves its entity-history trail (`GET /<tag>/{id}/history`). */
  history?: true;
  /** Its entity parts, by name. */
  parts?: string[];
  /** The declared command record its create request is (`createRequestRecord`),
   *  whether or not an api serves the create. */
  createRequest?: string;
  /** It declares a `derived display`, which its response serves as the
   *  `display` field a reference picker labels its options with. */
  display?: true;
}

/** A repository find, as a client calls it.  The auto-`all` is always served;
 *  every other find is synthesized and reachable only through an explicit api
 *  route, so it carries the routes that serve it — a client keeps the first one
 *  on an api its target backend serves. */
export interface ContractFind {
  aggregate: string;
  name: string;
  params: ContractParam[];
  returnType: TypeIR;
  /** A paged find's `sort` default: empty when the find declares its own
   *  order, else `id`. */
  sortDefault?: string;
  routes?: { api: string; path: string }[];
}

/** A workflow, as a client starts or observes it. */
export interface ContractWorkflow {
  name: string;
  /** The bounded context that owns it. */
  context: string;
  /** The body params of its `POST /workflows/<wf>` start route; absent on a
   *  workflow no command starts (`emitsCommandRoute`). */
  params?: ContractParam[];
  /** The route segment of the aggregate a successful start created, when the
   *  start route answers with its id. */
  resultSegment?: string;
  /** The identifier base of its client surface (`<base>Request`,
   *  `use<base>Workflow`), on a workflow a command starts: its name, unless an
   *  aggregate's create or operation request already spells that
   *  (`frontendRequestNames`). */
  requestBase?: string;
  /** The instance row of an observable workflow
   *  (`GET /workflows/<wf>/instances`). */
  instance?: ContractInstanceField[];
}

export interface ContractInstanceField {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** The correlation id token: a string on the wire. */
  id?: true;
}

/** A projection, as a client reads it (`GET /projections/<proj>`). */
export interface ContractProjection {
  name: string;
  /** The bounded context that owns it. */
  context: string;
  /** The read answers a list of rows rather than one (`projectionReadShape`). */
  many?: true;
  fields: ContractField[];
}

export interface ContractParam {
  name: string;
  type: TypeIR;
}

export interface ContractField {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** A request field's default, which the server applies when the field is
   *  absent and a create form seeds. */
  default?: ExprIR;
}

export interface ContractRecord {
  name: string;
  /** The bounded context that declares it, on a declared record. */
  context?: string;
  kind: string;
  fields: ContractField[];
  variants?: TypeIR[];
  generic?: { ctor: string; arg: TypeIR };
}

export interface ContractValueObject {
  name: string;
  /** The bounded context that declares it; absent when it is declared at
   *  system level. */
  context?: string;
  fields: ContractField[];
  derived: ContractField[];
  /** The invariants a client validates before sending (`classifyForWire`). */
  invariants: { expr: ExprIR; guard?: ExprIR; message?: MessageIR }[];
}

/** One operation the exposed api serves, with the facts a client needs about
 *  its domain operation decided here rather than re-derived from it. */
export type ContractOperation = Omit<ApiOperationIR, "find" | "operation"> & OperationFacts;

interface OperationFacts {
  /** The domain operation's name, on an `operation` / `gateProbe` entry. */
  opName?: string;
  /** The client sends the `If-Match` precondition: the backend guards this
   *  write on the row version. */
  ifMatch?: true;
  /** Body params a merge-patch form may leave out: a masked field the caller
   *  may not read is written only when sent. */
  optionalParams?: string[];
  /** The rules a client validates its request against before sending: the
   *  aggregate's invariants and the operation's preconditions that read only
   *  the request body (`classifyForWire`), in that order. */
  invariants?: ContractInvariant[];
  /** On a `create`: the declared command record its body is, when the context
   *  declares one (`createRequestRecord`). */
  request?: string;
  /** On an `operation`: its action gates, when every one reads only
   *  `currentUser` and constants (`clientActionGates`) — a frontend with a
   *  verified session hides the trigger of a caller they refuse. */
  clientGates?: ExprIR[];
  /** On an `operation`: the declared defaults of its params, which seed the
   *  form's initial values (`this.<field>` reads the loaded record). */
  paramDefaults?: { name: string; value: ExprIR }[];
}

export interface ContractInvariant {
  expr: ExprIR;
  guard?: ExprIR;
  message?: MessageIR;
}

const field = record<ContractField>("ContractField", {
  name: keep,
  type: typeRule,
  optional: keep,
  default: exprRule,
});
const fieldIR = record<FieldIR>("FieldIR", {
  name: keep,
  type: typeRule,
  optional: keep,
  provenanced: drop,
  sensitivity: drop,
  access: drop,
  accessSource: drop,
  default: exprRule,
  maskUnless: drop,
  origin: drop,
});

const operationRule = record<ApiOperationIR & OperationFacts>("ContractOperation", {
  idTokens: keep,
  id: keep,
  method: keep,
  path: keep,
  aggregate: keep,
  kind: keep,
  params: list(
    record<ApiOperationParamIR>("ApiOperationParamIR", {
      name: keep,
      type: typeRule,
      location: keep,
    }),
  ),
  responseType: typeRule,
  errorStatuses: keep,
  find: drop,
  operation: drop,
  claimedByExplicitRoute: keep,
  polymorphicBase: drop,
  opName: keep,
  ifMatch: keep,
  optionalParams: keep,
  request: keep,
  clientGates: list(exprRule),
  paramDefaults: list(
    record<{ name: string; value: ExprIR }>("ContractParamDefault", {
      name: keep,
      value: exprRule,
    }),
  ),
  invariants: list(
    record<ContractInvariant>("ContractInvariant", {
      expr: exprRule,
      guard: exprRule,
      message: messageRule,
    }),
  ),
});

const aggregateRule = record<ContractAggregate>("ContractAggregate", {
  name: keep,
  context: keep,
  history: keep,
  parts: keep,
  createRequest: keep,
  display: keep,
});

const paramRule = record<ContractParam>("ContractParam", { name: keep, type: typeRule });

const findRule = record<ContractFind>("ContractFind", {
  aggregate: keep,
  name: keep,
  params: list(paramRule),
  returnType: typeRule,
  sortDefault: keep,
  routes: list(
    record<{ api: string; path: string }>("ContractFindRoute", { api: keep, path: keep }),
  ),
});

const workflowRule = record<ContractWorkflow>("ContractWorkflow", {
  name: keep,
  context: keep,
  params: list(paramRule),
  resultSegment: keep,
  requestBase: keep,
  instance: list(
    record<ContractInstanceField>("ContractInstanceField", {
      name: keep,
      type: typeRule,
      optional: keep,
      id: keep,
    }),
  ),
});

const projectionRule = record<ContractProjection>("ContractProjection", {
  name: keep,
  context: keep,
  many: keep,
  fields: list(field),
});

const apiRule = record<ApiIR>("ApiIR", {
  name: keep,
  sourceModule: keep,
  urlStyle: keep,
  errorStatuses: (v) => ({ ...(v as Record<string, number>) }),
  routes: list(
    record<RouteIR>("RouteIR", {
      method: keep,
      path: keep,
      target: record<RouteIR["target"]>("RouteTarget", { context: keep, handler: keep }),
      // A frontend calls the handler `target` names; how the server binds the
      // request into the record is not its concern.
      sends: drop,
    }),
  ),
});

const responseRule = record<ContractResponse>("ContractResponse", {
  name: keep,
  entity: keep,
  fields: list(
    record<ContractResponseField>("ContractResponseField", {
      name: keep,
      type: typeRule,
      optional: keep,
      maskable: keep,
      provenanced: keep,
      derived: keep,
    }),
  ),
});

const payloadRule = record<PayloadIR>("PayloadIR", {
  name: keep,
  kind: keep,
  fields: list(fieldIR),
  variants: list(typeRule),
  synthesized: drop,
  generic: record<NonNullable<PayloadIR["generic"]>>("PayloadGeneric", {
    ctor: keep,
    arg: typeRule,
  }),
});

const eventRule = record<EventIR>("EventIR", { name: keep, fields: list(fieldIR), origin: drop });

function createRequestOf(
  ctx: EnrichedBoundedContextIR,
  agg: AggregateIR,
): { createRequest?: string } {
  const record = createRequestRecord(ctx.payloads, agg);
  return record ? { createRequest: record.name } : {};
}

function as<T>(rule: Rule, value: unknown, at: string): T {
  return rule(value, at) as T;
}

/** A synthesized `<Agg>Wire` record restates the derived wire shape; the paged
 *  and union carriers it sits beside are declared shapes and ship. */
function isDerivedWireRecord(p: PayloadIR): boolean {
  return p.synthesized && p.generic === undefined && p.variants === undefined;
}

export function buildFrontendContract(
  model: EnrichedLoomModel,
  sys: EnrichedSystemIR,
): FrontendContract {
  const at = `system ${sys.name}`;
  const contexts = exposedContexts(sys);

  const responses: ContractResponse[] = [];
  const claimed = new Set<string>();
  const operations: ContractOperation[] = [];
  const aggregates: ContractAggregate[] = [];
  const finds: ContractFind[] = [];
  const findRoutesByApi = sys.apis.map((api) => ({
    api: api.name,
    routes: pagedFindRoutes(sys, { serves: [api.name] }),
  }));
  const records: ContractRecord[] = [];
  const recordNames = new Set<string>();
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      // An abstract base serves no rows of its own, except the polymorphic
      // read home (`ownTable`), whose list and by-id reads answer with its
      // declared response.
      if (agg.isAbstract && agg.inheritanceUsing !== "ownTable") continue;
      for (const r of contractResponsesFor(ctx.payloads, agg) ?? []) {
        claimed.add(r.name);
        responses.push(as(responseRule, r, `${at}.responses.${r.name}`));
      }
    }
    operations.push(...contractOperations(ctx, at));
    for (const agg of ctx.aggregates) {
      const repo = ctx.repositories.find((r) => r.aggregateName === agg.name);
      aggregates.push(
        as(
          aggregateRule,
          {
            name: agg.name,
            context: ctx.name,
            ...(repo?.historyFind ? { history: true as const } : {}),
            ...(agg.parts.length > 0 ? { parts: agg.parts.map((p) => p.name) } : {}),
            ...(agg.displayDerived ? { display: true as const } : {}),
            ...createRequestOf(ctx, agg),
          },
          `${at}.aggregates.${agg.name}`,
        ),
      );
      for (const find of repo?.finds ?? []) {
        const routes = findRoutesByApi.flatMap(({ api, routes: byAgg }) => {
          const route = byAgg.get(agg.name)?.get(find.name);
          return route ? [{ api, path: route.path }] : [];
        });
        if (find.name !== "all" && routes.length === 0) continue;
        finds.push(
          as(
            findRule,
            {
              aggregate: agg.name,
              name: find.name,
              params: find.params.map((p) => ({ name: p.name, type: p.type })),
              returnType: find.returnType,
              ...(pagedReturn(find.returnType) ? { sortDefault: pagedSortDefault(find) } : {}),
              ...(routes.length > 0 ? { routes } : {}),
            },
            `${at}.finds.${agg.name}.${find.name}`,
          ),
        );
      }
    }
  }
  for (const ctx of contexts) {
    for (const p of ctx.payloads) {
      if (p.kind === "event" || claimed.has(p.name) || recordNames.has(p.name)) continue;
      if (isDerivedWireRecord(p)) continue;
      recordNames.add(p.name);
      records.push({
        ...as<ContractRecord>(payloadRule, p, `${at}.records.${p.name}`),
        context: ctx.name,
      });
    }
  }

  const workflows: ContractWorkflow[] = [];
  const projections: ContractProjection[] = [];
  const requestNames = requestNamesForContexts(contexts);
  for (const ctx of contexts) {
    for (const wf of ctx.workflows) {
      const command = emitsCommandRoute(wf);
      if (!command && !wf.instanceWireShape) continue;
      const resultSegment = command ? workflowResultSegment(wf) : undefined;
      workflows.push(
        as(
          workflowRule,
          {
            name: wf.name,
            context: ctx.name,
            ...(command ? { params: wf.params.map((p) => ({ name: p.name, type: p.type })) } : {}),
            ...(resultSegment !== undefined ? { resultSegment } : {}),
            ...(command ? { requestBase: requestNames.workflow(wf.name) } : {}),
            ...(wf.instanceWireShape
              ? {
                  instance: wf.instanceWireShape.map((f) => ({
                    name: f.name,
                    type: f.type,
                    optional: f.optional,
                    ...(f.source === "id" ? { id: true as const } : {}),
                  })),
                }
              : {}),
          },
          `${at}.workflows.${wf.name}`,
        ),
      );
    }
    for (const proj of ctx.projections ?? []) {
      if (!isFrontendReadableProjection(proj)) continue;
      projections.push(
        as(
          projectionRule,
          {
            name: proj.name,
            context: ctx.name,
            ...(projectionReadShape(proj) === "many" ? { many: true as const } : {}),
            fields: (proj.wireShape ?? []).map((f) => ({
              name: f.name,
              type: f.type,
              optional: !!f.optional,
            })),
          },
          `${at}.projections.${proj.name}`,
        ),
      );
    }
  }
  workflows.sort((a, b) => a.name.localeCompare(b.name));

  const uis = sys.uis.map((u) => as<UiIR>(uiRule, u, `${at}.ui ${u.name}`));
  const eventNames = new Set(sys.uis.flatMap((u) => u.notifications.map((n) => n.eventType)));
  // A client decodes the events its contexts declare (Flutter's wire models)
  // as well as the ones a notification names.
  const exposed = new Set(contexts.map((c) => c.name));
  const events: ContractRecord[] = [];
  for (const ctx of sys.subdomains.flatMap((sd) => sd.contexts)) {
    for (const ev of ctx.events) {
      if (!exposed.has(ctx.name) && !eventNames.has(ev.name)) continue;
      if (events.some((e) => e.name === ev.name)) continue;
      events.push({
        ...as<ContractRecord>(eventRule, ev, `${at}.events.${ev.name}`),
        context: ctx.name,
      });
    }
  }

  const contract: FrontendContract = {
    contractVersion: FRONTEND_CONTRACT_VERSION,
    system: sys.name,
    ui: {
      uis,
      components: model.components.map((c) =>
        as<ComponentIR>(componentRule, c, `${at}.component ${c.name}`),
      ),
      layouts: sys.layouts.map((l) => as<LayoutIR>(layoutRule, l, `${at}.layout ${l.name}`)),
      ...(sys.user
        ? {
            user: {
              fields: sys.user.fields.map((f) =>
                as<ContractField>(fieldIR, f, `${at}.user.${f.name}`),
              ),
              ...(sys.user.registry ? { registry: sys.user.registry } : {}),
            },
          }
        : {}),
    },
    wire: {
      apis: sys.apis.map((a) => as<ApiIR>(apiRule, a, `${at}.api ${a.name}`)),
      operations,
      aggregates,
      finds,
      responses,
      records,
      events,
      workflows,
      projections,
      valueObjects: [],
      enums: [],
    },
  };
  closeOverNamedTypes(model, sys, contract);
  return contract;
}

/** Add the value objects and enums the contract names, to a fixpoint: a value
 *  object's own fields can name more. */
function closeOverNamedTypes(
  model: EnrichedLoomModel,
  sys: EnrichedSystemIR,
  contract: FrontendContract,
): void {
  const allContexts = [...sys.subdomains.flatMap((sd) => sd.contexts), ...model.contexts];
  const vos = new Map<string, ValueObjectIR>();
  const enums = new Map<string, EnumIR>();
  // The context that declares each name: a system-level declaration is folded
  // into every context, so only a context's own one names it.
  const owner = new Map<string, string>();
  // Declaration order: system order of contexts, then each context's own.
  const ordinal = new Map<string, number>();
  const declared = (key: string): void => {
    if (!ordinal.has(key)) ordinal.set(key, ordinal.size);
  };
  for (const ctx of allContexts) {
    for (const vo of ctx.valueObjects) {
      declared(`vo:${vo.name}`);
      if (vos.has(vo.name)) continue;
      vos.set(vo.name, vo);
      if (!vo.systemLevel) owner.set(`vo:${vo.name}`, ctx.name);
    }
    for (const en of ctx.enums) {
      declared(`enum:${en.name}`);
      if (enums.has(en.name)) continue;
      enums.set(en.name, en);
      if (!en.systemLevel) owner.set(`enum:${en.name}`, ctx.name);
    }
  }
  for (const vo of model.rootValueObjects) {
    declared(`vo:${vo.name}`);
    if (!vos.has(vo.name)) vos.set(vo.name, vo);
  }
  for (const en of model.rootEnums) {
    declared(`enum:${en.name}`);
    if (!enums.has(en.name)) enums.set(en.name, en);
  }
  const seenVo = new Set<string>();
  const seenEnum = new Set<string>();
  const pushEnum = (name: string): void => {
    const en = enums.get(name);
    if (!en || seenEnum.has(name)) return;
    seenEnum.add(name);
    const enCtx = owner.get(`enum:${name}`);
    contract.wire.enums.push({
      name: en.name,
      values: [...en.values],
      ...(enCtx !== undefined ? { context: enCtx } : {}),
    });
  };
  /** Add value object `name`; returns its projection when newly added. */
  const pushVo = (name: string): ContractValueObject | undefined => {
    const vo = vos.get(name);
    if (!vo || seenVo.has(name)) return undefined;
    seenVo.add(name);
    const projected = valueObjectContract(
      vo,
      owner.get(`vo:${name}`),
      `system ${sys.name}.valueObject ${name}`,
    );
    contract.wire.valueObjects.push(projected);
    return projected;
  };
  const closeOver = (roots: readonly unknown[]): void => {
    let frontier: unknown[] = [...roots];
    while (frontier.length > 0) {
      const named = namedTypes(frontier);
      frontier = [];
      for (const name of named.enums) pushEnum(name);
      for (const name of named.valueObjects) {
        const projected = pushVo(name);
        if (projected) frontier.push(projected);
      }
    }
  };
  closeOver([contract.ui, contract.wire]);
  // Every enum an exposed context declares, system-level ones included, rides
  // the contract even when no wire type names it: a ui that renders an
  // `EnumBadge` catalogues the value text of each enum in its contexts' scope.
  // Every value object does too: a client emits a wire model per value object
  // of its contexts (Flutter's `models.dart`).
  for (const ctx of exposedContexts(sys)) {
    for (const en of ctx.enums) pushEnum(en.name);
    for (const vo of ctx.valueObjects) pushVo(vo.name);
  }
  // A value object's fields can name more enums and value objects.
  closeOver(contract.wire.valueObjects);
  const rank = (key: string): number => ordinal.get(key) ?? Number.MAX_SAFE_INTEGER;
  contract.wire.enums.sort((a, b) => rank(`enum:${a.name}`) - rank(`enum:${b.name}`));
  contract.wire.valueObjects.sort((a, b) => rank(`vo:${a.name}`) - rank(`vo:${b.name}`));
}

function valueObjectContract(
  vo: ValueObjectIR,
  context: string | undefined,
  at: string,
): ContractValueObject {
  const available = new Set(vo.fields.map((f) => f.name));
  return {
    name: vo.name,
    ...(context !== undefined ? { context } : {}),
    fields: vo.fields.map((f) => as<ContractField>(fieldIR, f, `${at}.${f.name}`)),
    derived: vo.derived.map((d) =>
      as<ContractField>(
        field,
        { name: d.name, type: d.type, optional: d.type.kind === "optional" },
        `${at}.${d.name}`,
      ),
    ),
    invariants: vo.invariants
      .filter((inv) => classifyForWire(inv, { available }))
      .map((inv, i) => ({
        expr: as<ExprIR>(exprRule, inv.expr, `${at}.invariant[${i}]`),
        ...(inv.guard
          ? { guard: as<ExprIR>(exprRule, inv.guard, `${at}.invariant[${i}].guard`) }
          : {}),
        ...(inv.message ? { message: { key: inv.message.key, text: inv.message.text } } : {}),
      })),
  };
}

/** The value-object and enum names a projected subtree mentions — read off its
 *  `TypeIR` nodes and enum-value refs. */
function namedTypes(roots: readonly unknown[]): { valueObjects: string[]; enums: string[] } {
  const valueObjects = new Set<string>();
  const enums = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v === null || typeof v !== "object") return;
    const node = v as Record<string, unknown>;
    if (node.kind === "valueobject" && typeof node.name === "string") valueObjects.add(node.name);
    if (node.kind === "enum" && typeof node.name === "string") enums.add(node.name);
    if (node.refKind === "enum-value" && typeof node.enumName === "string")
      enums.add(node.enumName);
    for (const x of Object.values(node)) visit(x);
  };
  for (const r of roots) visit(r);
  return { valueObjects: [...valueObjects], enums: [...enums] };
}

/** The contract as the bytes `ddd emit-frontend-contract` writes. */
export function renderFrontendContract(contract: FrontendContract): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

/** The operations `ctx` serves, as the contract carries them. */
export function contractOperations(
  ctx: EnrichedBoundedContextIR,
  at = `context ${ctx.name}`,
): ContractOperation[] {
  return deriveContextOperations(ctx).map((op) => {
    const agg = ctx.aggregates.find((a) => a.name === op.aggregate);
    return as<ContractOperation>(
      operationRule,
      { ...op, ...operationFacts(op, agg), ...(agg ? createFacts(op, ctx, agg) : {}) },
      `${at}.operations.${op.id}`,
    );
  });
}

/** What a client needs about the domain operation behind `op`. */
function operationFacts(op: ApiOperationIR, agg: AggregateIR | undefined): OperationFacts {
  const domain = op.operation;
  if (!domain) return {};
  const optional = [...maskedPatchParams(domain)];
  const clientGates = op.kind === "operation" ? clientActionGates(domain) : undefined;
  const paramDefaults =
    op.kind === "operation"
      ? domain.params.flatMap((p) => (p.default ? [{ name: p.name, value: p.default }] : []))
      : [];
  const invariants = op.kind === "operation" ? operationWireInvariants(agg, domain) : [];
  return {
    opName: domain.name,
    ...(domain.name === "update" && agg && aggregateIsVersioned(agg)
      ? { ifMatch: true as const }
      : {}),
    ...(optional.length > 0 ? { optionalParams: optional } : {}),
    ...(invariants.length > 0 ? { invariants } : {}),
    ...(clientGates ? { clientGates } : {}),
    ...(paramDefaults.length > 0 ? { paramDefaults } : {}),
  };
}

/** What a client needs about a `create`: the declared command record its body
 *  is, and the aggregate's invariants that read only that record's fields. */
function createFacts(
  op: ApiOperationIR,
  ctx: EnrichedBoundedContextIR,
  agg: AggregateIR,
): OperationFacts {
  if (op.kind !== "create") return {};
  const record = createRequestRecord(ctx.payloads, agg);
  if (!record) return {};
  const invariants = createWireInvariants(ctx.payloads, agg);
  return { request: record.name, ...(invariants.length > 0 ? { invariants } : {}) };
}
