// Contract-record builders for `scaffoldHandlers` (M-T5.10, contract layer).
//
// Alongside the `commandHandler` / `queryHandler` members it already emits,
// `scaffoldHandlers` splices the literal `response` / `command` / `query`
// PayloadDecl records that describe the API contract those handlers realise —
// so the contract is SOURCE-VISIBLE (`unfold` ejects real `.ddd`).  In PR1 the
// records are additive and fully INERT: no handler references them yet, so
// generation is byte-identical with vs without them (verified on every backend).
//
// The records ride the SAME `handlerTargets(ctx)` selection the handlers do, so
// records and handlers stay in lock-step — every command/query record names the
// handler that will (in a later PR) reference it.  Response records are derived
// per aggregate from `apiReadFields` (the AST twin of the IR wire-projection
// `forApiRead(wireShape)`), with a sibling `<Part>Response` record for every
// entity part reachable through the aggregate's containment closure (context
// scope cannot reference a raw entity part, so a containment field points at the
// part's own response record).

import type {
  Aggregate,
  BoundedContext,
  ContextMember,
  EntityPart,
  Parameter,
  PayloadDecl,
  Property,
} from "../../../language/generated/ast.js";
import { isAggregate, isEntityPart } from "../../../language/generated/ast.js";
import {
  apiReadFields,
  apiReadFieldsOf,
  cloneTypeRef,
  command,
  containmentOf,
  entityPartNames,
  field,
  idRef,
  query,
  response,
} from "../../api/index.js";
import {
  createRequestMembers,
  idParamName,
  type RequestTarget,
  requestTargets,
  targetHandlerName,
} from "./_handlers-shared.js";

type ContractRecord = PayloadDecl & ContextMember;

/** Every contract record `scaffoldHandlers` splices into `ctx`, in emission
 * order: response records (per aggregate: `<Agg>Response` + its reachable
 * `<Part>Response`s) first, then one command/query record per handler target.
 * Deduplicated by name (two aggregates could reach a same-named part; a name is
 * emitted once). */
export function contractRecords(ctx: BoundedContext): ContractRecord[] {
  const out: ContractRecord[] = [];
  const seen = new Set<string>();
  const emit = (rec: ContractRecord) => {
    if (seen.has(rec.name)) return;
    seen.add(rec.name);
    out.push(rec);
  };

  // Response records — the read-projection contracts.
  for (const agg of (ctx.members ?? []).filter(isAggregate)) {
    emit(response(`${agg.name}Response`, [...apiReadFields(agg)]));
    for (const partRec of partResponses(agg)) emit(partRec);
  }

  // Command / query records — the request contracts, one per request the
  // context serves.  A handler target is a request target with a declared
  // repository, so every handler `scaffoldHandlers` emits names one of these.
  for (const t of requestTargets(ctx)) {
    emit(contractForTarget(t));
  }

  return out;
}

/** The command (write) or query (read) request record for one handler target.
 *   - create   → `command <Create<Agg>>Command`  over the create-input fields
 *   - operation→ `command <Op><Agg>Command`       over the op's params
 *   - destroy  → `command <Destroy<Agg>>Command`  empty (id is a route param)
 *   - getById  → `query   <Get<Agg>>Query`        over the single `<agg>Id` id
 * The `*Command` name matches the .NET Mediator record name a later PR wires up. */
function contractForTarget(t: RequestTarget): ContractRecord {
  const base = targetHandlerName(t);
  switch (t.kind) {
    case "create":
      return command(`${base}Command`, fieldsFromProps(createRequestMembers(t.agg, t.create)));
    case "operation":
      return command(`${base}Command`, fieldsFromParams(t.op.params));
    case "destroy":
      return command(`${base}Command`, []);
    case "getById":
      return query(`${base}Query`, [field(idParamName(t.agg.name), idRef(t.agg.name))]);
  }
}

/** A `<Part>Response` record for every entity part reachable through `agg`'s
 * containment closure (BFS over containments — explicit `contains` and inferred
 * entity-typed properties alike; parts are aggregate-local, so all referenced
 * parts live in `agg.members`).  Deduplicated within the aggregate;
 * `contractRecords` dedups again across the context. */
function partResponses(agg: Aggregate): ContractRecord[] {
  const partsByName = new Map<string, EntityPart>();
  for (const m of agg.members ?? []) {
    if (isEntityPart(m)) partsByName.set(m.name, m);
  }
  const partNames = entityPartNames(agg);
  const containedPart = (m: unknown): EntityPart | undefined => {
    const c = containmentOf(m, partNames);
    return c ? partsByName.get(c.part) : undefined;
  };
  const out: ContractRecord[] = [];
  const visited = new Set<string>();
  const visit = (part: EntityPart): void => {
    if (visited.has(part.name)) return;
    visited.add(part.name);
    out.push(response(`${part.name}Response`, apiReadFieldsOf(part.members, [], partNames)));
    for (const m of part.members) {
      const child = containedPart(m);
      if (child) visit(child);
    }
  };
  for (const m of agg.members ?? []) {
    const child = containedPart(m);
    if (child) visit(child);
  }
  return out;
}

/** Clone a list of source `Property` members into fresh name+type request
 * fields (a fresh `field(...)` — the source node would be reparented by the
 * splice; a hand-rolled type would not re-link, so `cloneTypeRef` rebuilds it). */
function fieldsFromProps(props: readonly (Property | Parameter)[]): Property[] {
  return props.filter((p) => p.type != null).map((p) => field(p.name, cloneTypeRef(p.type)));
}

/** Clone a list of `Parameter`s (operation / find params) into request fields. */
function fieldsFromParams(params: readonly Parameter[]): Property[] {
  return params.filter((p) => p.type != null).map((p) => field(p.name, cloneTypeRef(p.type)));
}
