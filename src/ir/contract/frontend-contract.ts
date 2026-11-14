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
  InvariantIR,
  LayoutIR,
  MessageIR,
  OperationIR,
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
import { maskedPatchParams } from "../util/op-gates.js";
import { declaredCreateCommandFor } from "../util/declared-request.js";
import { pagedFindRoutes } from "../util/paged-find-routes.js";
import { aggregateIsVersioned } from "../util/versioned-capability.js";
import { classifyForWire } from "../validate/invariant-classify.js";
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
    /** Events a UI notification subscribes to. */
    events: ContractRecord[];
    valueObjects: ContractValueObject[];
    enums: { name: string; values: string[] }[];
  };
}

export interface ContractAggregate {
  name: string;
  /** The bounded context that owns it. */
  context: string;
  /** The aggregate serves its entity-history trail (`GET /<tag>/{id}/history`). */
  history?: true;
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

export interface ContractParam {
  name: string;
  type: TypeIR;
}

export interface ContractField {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** A request field's default, which the server applies when the field is
   *  absent and a create form seeds or fetches (`GET /<tag>/prepare`). */
  default?: ExprIR;
}

export interface ContractRecord {
  name: string;
  kind: string;
  fields: ContractField[];
  variants?: TypeIR[];
  generic?: { ctor: string; arg: TypeIR };
}

export interface ContractValueObject {
  name: string;
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
   *  declares one (`declaredCreateCommandFor`). */
  request?: string;
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
});

const findRule = record<ContractFind>("ContractFind", {
  aggregate: keep,
  name: keep,
  params: list(record<ContractParam>("ContractParam", { name: keep, type: typeRule })),
  returnType: typeRule,
  sortDefault: keep,
  routes: list(
    record<{ api: string; path: string }>("ContractFindRoute", { api: keep, path: keep }),
  ),
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
      if (agg.isAbstract) continue;
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
      records.push(as(payloadRule, p, `${at}.records.${p.name}`));
    }
  }

  const uis = sys.uis.map((u) => as<UiIR>(uiRule, u, `${at}.ui ${u.name}`));
  const eventNames = new Set(sys.uis.flatMap((u) => u.notifications.map((n) => n.eventType)));
  const events: ContractRecord[] = [];
  for (const ctx of sys.subdomains.flatMap((sd) => sd.contexts)) {
    for (const ev of ctx.events) {
      if (!eventNames.has(ev.name) || events.some((e) => e.name === ev.name)) continue;
      events.push(as(eventRule, ev, `${at}.events.${ev.name}`));
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
  for (const vo of [...allContexts.flatMap((c) => c.valueObjects), ...model.rootValueObjects]) {
    if (!vos.has(vo.name)) vos.set(vo.name, vo);
  }
  for (const en of [...allContexts.flatMap((c) => c.enums), ...model.rootEnums]) {
    if (!enums.has(en.name)) enums.set(en.name, en);
  }
  const seenVo = new Set<string>();
  const seenEnum = new Set<string>();
  let frontier: unknown[] = [contract.ui, contract.wire];
  while (frontier.length > 0) {
    const named = namedTypes(frontier);
    frontier = [];
    for (const name of named.enums) {
      const en = enums.get(name);
      if (!en || seenEnum.has(name)) continue;
      seenEnum.add(name);
      contract.wire.enums.push({ name: en.name, values: [...en.values] });
    }
    for (const name of named.valueObjects) {
      const vo = vos.get(name);
      if (!vo || seenVo.has(name)) continue;
      seenVo.add(name);
      const projected = valueObjectContract(vo, `system ${sys.name}.valueObject ${name}`);
      contract.wire.valueObjects.push(projected);
      frontier.push(projected);
    }
  }
  contract.wire.enums.sort((a, b) => a.name.localeCompare(b.name));
  contract.wire.valueObjects.sort((a, b) => a.name.localeCompare(b.name));
}

function valueObjectContract(vo: ValueObjectIR, at: string): ContractValueObject {
  const available = new Set(vo.fields.map((f) => f.name));
  return {
    name: vo.name,
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
  const available = new Set(domain.params.map((p) => p.name));
  const invariants =
    op.kind === "operation"
      ? [...(agg?.invariants ?? []), ...preconditionsOf(domain)]
          .filter((inv) => classifyForWire(inv, { available }))
          .map((inv) => ({
            expr: inv.expr,
            ...(inv.guard ? { guard: inv.guard } : {}),
            ...(inv.message ? { message: inv.message } : {}),
          }))
      : [];
  return {
    opName: domain.name,
    ...(domain.name === "update" && agg && aggregateIsVersioned(agg)
      ? { ifMatch: true as const }
      : {}),
    ...(optional.length > 0 ? { optionalParams: optional } : {}),
    ...(invariants.length > 0 ? { invariants } : {}),
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
  const record = declaredCreateCommandFor(ctx.payloads, agg);
  if (!record) return {};
  const available = new Set(record.fields.map((f) => f.name));
  const invariants = agg.invariants
    .filter((inv) => classifyForWire(inv, { available }))
    .map((inv) => ({
      expr: inv.expr,
      ...(inv.guard ? { guard: inv.guard } : {}),
      ...(inv.message ? { message: inv.message } : {}),
    }));
  return { request: record.name, ...(invariants.length > 0 ? { invariants } : {}) };
}

/** An operation's `precondition` statements, as the invariants a request is
 *  validated against. */
function preconditionsOf(op: OperationIR): InvariantIR[] {
  return op.statements.flatMap((s) =>
    s.kind === "precondition" ? [{ expr: s.expr, source: s.source, message: s.message }] : [],
  );
}
