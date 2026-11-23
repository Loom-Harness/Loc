// Contract-record builders for `scaffoldHandlers`.
//
// Alongside the `commandHandler` / `queryHandler` members it emits,
// `scaffoldHandlers` splices the literal `response` / `command` / `query`
// PayloadDecl records that describe the API contract the context serves, so
// the contract is source-visible (`unfold` ejects real `.ddd`).
//
// The command/query records ride `requestTargets(ctx)`: one per request of
// every concrete aggregate, whether its repository is declared in source or
// added by enrichment, because the deployable serves both.  The handlers ride
// `handlerTargets(ctx)`, the subset with a declared repository, so every
// handler names one of these records.  Response records are derived per
// aggregate from `apiReadFields` (the AST twin of the API-read projection),
// with a sibling `<Part>Response` record for every entity part reachable
// through the aggregate's containment closure (context scope cannot reference
// a raw entity part, so a containment field points at the part's own response
// record).

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
  cloneExpr,
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
  ID_PARAM,
  type RequestTarget,
  requestTargets,
  targetCarriesId,
  targetRecordName,
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

/** The command (write) or query (read) request record for one handler target,
 * named by `targetRecordName`.  Every kind but `create` addresses one existing
 * aggregate and carries its `id` first, which the route's `{id}` binds:
 *   - create   → `command Create<Agg>Command`  { the create-input fields }
 *   - operation→ `command <Op><Agg>Command`     { id, the op's params }
 *   - destroy  → `command Destroy<Agg>Command`  { id }
 *   - getById  → `query   Get<Agg>ByIdQuery`    { id } */
function contractForTarget(t: RequestTarget): ContractRecord {
  const name = targetRecordName(t);
  const id = targetCarriesId(t) ? [idField(t.agg.name)] : [];
  switch (t.kind) {
    case "create":
      return command(name, fieldsFromProps(createRequestMembers(t.agg, t.create)));
    case "operation":
      return command(name, [...id, ...fieldsFromParams(t.op.params)]);
    case "destroy":
      return command(name, id);
    case "getById":
      return query(name, id);
  }
}

/** The `id: <Agg> id` field a record addressing one aggregate carries. */
export function idField(aggName: string): Property {
  return field(ID_PARAM, idRef(aggName));
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

/** Clone a list of source `Property` members (or create params) into fresh
 * request fields carrying the name, type and `= default` (a fresh `field(...)`
 * — the source node would be reparented by the splice; a hand-rolled type would
 * not re-link, so `cloneTypeRef` / `cloneExpr` rebuild them).  The default is
 * part of the request contract: a client form seeds from it. */
function fieldsFromProps(props: readonly (Property | Parameter)[]): Property[] {
  return props
    .filter((p) => p.type != null)
    .map((p) =>
      field(p.name, cloneTypeRef(p.type), p.default ? { default: cloneExpr(p.default) } : {}),
    );
}

/** Clone a list of `Parameter`s (operation / find params) into request fields. */
function fieldsFromParams(params: readonly Parameter[]): Property[] {
  return params.filter((p) => p.type != null).map((p) => field(p.name, cloneTypeRef(p.type)));
}
