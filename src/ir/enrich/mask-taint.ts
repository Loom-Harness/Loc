// Phase ⑥ — the visibility taint of a `mask unless` field.
//
// A `mask unless <pred>` field is redacted at the read boundary unless the
// caller satisfies `<pred>`.  That guarantee holds only if EVERY place the
// field's value flows to either applies the same predicate (the sink INHERITS
// the mask) or is refused in phase ⑦.  Deciding that per emitter is how a mask
// leaked through a `derived` (#3970), a find predicate (#3993) and the generic
// update (#3683): each emitter checked only the declared field.
//
// This module is the one place the taint is computed.  It is a pure function of
// the aggregate (Derive, don't stamp), read by:
//
//   - `declaredResponseFor` / `responseWireFor` — a `derived` that reads a masked
//     field carries the inherited predicate on its response row, so every
//     backend's masked serializer (which reads `WireField.maskUnless`)
//     redacts it too;
//   - `applyMaskWriteGates` — an operation that writes a caller-supplied value
//     into a masked field gets the predicate as a hoisted `requires` (a caller
//     who cannot read the field cannot change it; a merge-patch update that
//     omits the key keeps the stored value and passes);
//   - `applyMaskFindGates` / `applyMaskHandlerGates` / `applyMaskWorkflowGates`
//     — a read whose predicate (its criterion / retrieval `where`, or a
//     capability query-filter it runs under) reads a masked field would answer
//     an existence oracle on the hidden value, so it inherits the mask
//     predicate as its `requires`.  A handler or workflow inherits the gates of
//     every read its body makes, including the reads of the `reading` domain
//     services it calls.
//
// Every inherited gate is the mask predicate alone, which reads only
// `currentUser` (`loom.field-mask-not-current-user`) — never the row or the
// caller's value — so a right guess and a wrong one get the same answer.
//
// Every traversal rides `src/ir/util/walk.ts`.

import type {
  AggregateIR,
  BoundedContextIR,
  CommandHandlerIR,
  CriterionIR,
  DerivedIR,
  DomainServiceIR,
  EntityPartIR,
  ExprIR,
  FieldIR,
  FindIR,
  OperationIR,
  QueryHandlerIR,
  RepositoryIR,
  RetrievalIR,
  StmtIR,
  TypeIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import {
  walkExprDeep,
  walkStmtExprsDeep,
  walkStmtsDeep,
  walkWorkflowStmtExprsDeep,
  walkWorkflowStmtsDeep,
} from "../util/walk.js";

const BOOL: TypeIR = { kind: "primitive", name: "bool" };

const withoutOrigin = (k: string, v: unknown): unknown => (k === "origin" ? undefined : v);
const exprKey = (e: ExprIR): string => JSON.stringify(e, withoutOrigin);

/** `a && b && …` over distinct predicates (structural dedupe, source order). */
function conjoinPredicates(preds: readonly ExprIR[]): ExprIR | undefined {
  const seen = new Set<string>();
  const distinct: ExprIR[] = [];
  for (const p of preds) {
    const k = exprKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    distinct.push(p);
  }
  if (distinct.length === 0) return undefined;
  return distinct
    .map((p) => structuredClone(p))
    .reduce((acc, p) => ({
      kind: "binary",
      op: "&&",
      left: acc,
      right: p,
      leftType: BOOL,
      rightType: BOOL,
      resultType: BOOL,
    }));
}

/** The key a contained part's masked member is tracked under — the part name
 *  qualifies it, so it never collides with a root member name. */
export function partMemberKey(part: string, member: string): string {
  return `${part}.${member}`;
}

/** The masked member names one expression reads — a field / derived read on
 *  the row (`salary`, `this.salary`), a `let` that carries one, and a member
 *  read off a contained part (`reviews.map(r => r.note)`), keyed
 *  `<Part>.<member>` (`partMemberKey`). */
function maskedReadsOf(
  e: ExprIR | undefined,
  masked: ReadonlySet<string>,
  taintedLets: ReadonlyMap<string, readonly string[]> = new Map(),
): string[] {
  const out: string[] = [];
  const note = (n: string): void => {
    if (!out.includes(n)) out.push(n);
  };
  walkExprDeep(e, (n) => {
    if (n.kind === "ref") {
      const selfProp =
        n.refKind === "this-prop" || n.refKind === "this-vo-prop" || n.refKind === "this-derived";
      if (selfProp && masked.has(n.name)) note(n.name);
      else if (n.refKind === "let") for (const via of taintedLets.get(n.name) ?? []) note(via);
      return;
    }
    if (n.kind !== "member") return;
    if (n.receiver.kind === "this" && masked.has(n.member)) {
      note(n.member);
      return;
    }
    const part = entityNameOf(n.receiverType);
    if (part !== undefined && masked.has(partMemberKey(part, n.member))) {
      note(partMemberKey(part, n.member));
    }
  });
  return out;
}

function entityNameOf(t: TypeIR | undefined): string | undefined {
  let cur = t;
  while (cur?.kind === "optional") cur = cur.inner;
  return cur?.kind === "entity" ? cur.name : undefined;
}

type MaskSource = Pick<AggregateIR, "fields" | "derived"> &
  Partial<Pick<AggregateIR, "contextFilters" | "contextFilterOrigins" | "parts">>;

/** True when an aggregate carries a `mask unless` field anywhere on its wire —
 *  on the root, or on any contained part.  The gate every "is this read
 *  masked" decision takes, on every backend: a masked part makes the root's
 *  response serializer the redacting one. */
export function carriesFieldMask(agg: {
  fields: readonly FieldIR[];
  parts?: readonly EntityPartIR[];
}): boolean {
  return (
    agg.fields.some((f) => f.maskUnless) ||
    (agg.parts ?? []).some((p) => p.fields.some((f) => f.maskUnless))
  );
}

/** Every masked member of every contained part of `agg`, keyed
 *  `<Part>.<member>` → its effective read predicate (the part's own fields,
 *  plus each part `derived` the taint marks). */
function partMaskPredicates(agg: MaskSource): Map<string, ExprIR> {
  const out = new Map<string, ExprIR>();
  for (const part of agg.parts ?? []) {
    for (const [name, pred] of maskedReadPredicates(part)) {
      out.set(partMemberKey(part.name, name), pred);
    }
  }
  return out;
}

/** The full read-mask table of an aggregate: its own masked members plus
 *  every contained part's (`partMemberKey`) — what a read predicate, an event
 *  payload or a `derived` is checked against. */
function allMaskPredicates(agg: MaskSource): Map<string, ExprIR> {
  return new Map([...partMaskPredicates(agg), ...maskedReadPredicates(agg)]);
}

/** A read's `ignoring` stance — which capability query-filters it skips. */
interface BypassStance {
  bypassAll?: boolean;
  bypassCaps?: readonly string[];
}

/** The fact: every masked wire member of an aggregate → its effective read
 *  predicate.  A declared `mask unless` field maps to its own predicate; a
 *  `derived` that reads masked members (directly or through another derived)
 *  maps to the conjunction of their predicates — a caller sees it only when
 *  it could see every masked value it is computed from.  Empty for a
 *  mask-free aggregate. */
export function maskedReadPredicates(agg: MaskSource): Map<string, ExprIR> {
  const out = new Map<string, ExprIR>();
  for (const f of agg.fields) if (f.maskUnless) out.set(f.name, f.maskUnless);
  // A root `derived` reading a contained part's masked member
  // (`reviews.count(r => r.flagged)`) inherits that member's predicate.
  const parts = partMaskPredicates(agg);
  if (out.size === 0 && parts.size === 0) return out;
  const lookup = (k: string): ExprIR | undefined => out.get(k) ?? parts.get(k);
  // Fixpoint: a derived reading a derived reading a masked field.
  const pending: DerivedIR[] = [...agg.derived];
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of pending) {
      if (out.has(d.name)) continue;
      const reads = maskedReadsOf(d.expr, new Set([...out.keys(), ...parts.keys()]));
      if (reads.length === 0) continue;
      const pred = conjoinPredicates(reads.map((r) => lookup(r)!));
      if (pred) {
        out.set(d.name, pred);
        changed = true;
      }
    }
  }
  return out;
}

/** Every contained part `derived` of `agg` that reads ANOTHER part's masked
 *  member (`entity Line { derived hasSecret: bool = notes.any(n => n.secret) }`)
 *  — a read the part's own projection cannot redact, since a part's wire
 *  taint covers only its own members.  Refused in phase ⑦. */
export function partDerivedNestedMaskReads(
  agg: MaskSource,
): { part: string; derived: string; via: string }[] {
  const all = partMaskPredicates(agg);
  if (all.size === 0) return [];
  const out: { part: string; derived: string; via: string }[] = [];
  for (const part of agg.parts ?? []) {
    const own = maskedReadPredicates(part);
    const foreign = new Set([...all.keys()].filter((k) => !k.startsWith(`${part.name}.`)));
    for (const d of part.derived) {
      if (own.has(d.name)) continue;
      const via = maskedReadsOf(d.expr, foreign)[0];
      if (via !== undefined) out.push({ part: part.name, derived: d.name, via });
    }
  }
  return out;
}

/** The predicate a caller must satisfy to see EVERY masked value inside one
 *  contained part (transitively through its own containments) — the
 *  conjunction of each masked member's predicate, or undefined for a
 *  mask-free part.  A sink that carries the whole part (an audit-history
 *  change entry on the containment) inherits it: the entry is shown only to a
 *  caller who could read every value in it. */
export function partContentMask(
  part: EntityPartIR,
  parts: readonly EntityPartIR[],
  seen: ReadonlySet<string> = new Set(),
): ExprIR | undefined {
  if (seen.has(part.name)) return undefined;
  const inner = new Set([...seen, part.name]);
  const preds: ExprIR[] = [...maskedReadPredicates(part).values()];
  for (const c of part.contains) {
    const child = parts.find((p) => p.name === c.partName);
    const m = child ? partContentMask(child, parts, inner) : undefined;
    if (m) preds.push(m);
  }
  return conjoinPredicates(preds);
}

/** The capability query-filters a read of `agg` runs under: every
 *  `contextFilters` entry, minus the ones its `ignoring` stance bypasses. */
function carriedFilters(agg: MaskSource, stance: BypassStance | undefined): ExprIR[] {
  if (stance?.bypassAll) return [];
  const bypassed = new Set(stance?.bypassCaps ?? []);
  return (agg.contextFilters ?? []).filter((_, i) => {
    const cap = agg.contextFilterOrigins?.[i];
    return cap === undefined || !bypassed.has(cap);
  });
}

/** The predicate a read of `agg` must inherit, or undefined: the conjunction
 *  of the mask predicates of every masked member its `where` (a find /
 *  criterion / retrieval predicate) or a capability filter it runs under
 *  reads. */
function readMaskOf(
  agg: MaskSource,
  where: ExprIR | undefined,
  stance: BypassStance | undefined,
): ExprIR | undefined {
  if (!carriesFieldMask(agg)) return undefined;
  const masks = allMaskPredicates(agg);
  const keys = new Set(masks.keys());
  const reads: string[] = [];
  for (const pred of [where, ...carriedFilters(agg, stance)]) {
    for (const r of maskedReadsOf(pred, keys)) if (!reads.includes(r)) reads.push(r);
  }
  return conjoinPredicates(reads.map((r) => masks.get(r)!));
}

// ── Write sinks ──────────────────────────────────────────────────────────────
//
// A caller who cannot read a masked field must not be able to change it.  The
// gate is the mask predicate ALONE — never a comparison against the stored
// value: `requires <value> == this.<f> || <mask>` would answer 204 for a
// correct guess and 403 for a wrong one, an oracle on the hidden value one
// guess at a time.  Because the predicate reads only `currentUser`, the gate
// answers the same for every value the caller sends.
//
// A merge-patch update (RS-47) writes a field only when its key is present, so
// its route evaluates the gate only then (`maskWritePresenceParam`, op-gates):
// a patch that leaves the masked key out keeps the stored value and passes.
// Every other operation always writes, so it requires the mask outright.

/** One operation that writes a caller-supplied value into a masked field. */
export interface MaskWriteSink {
  op: OperationIR;
  field: FieldIR;
  /** The masked member the write lands in — the field name on the root,
   *  `<Part>.<field>` (`partMemberKey`) on a contained part. */
  key: string;
  /** The declaring entity's name, for the gate's 403 detail. */
  owner: string;
}

const CALLER_REF_KINDS = new Set(["param", "let", "lambda", "match-binding"]);

/** True when the value may carry what the caller sent — it reads an operation
 *  param, or a body-local that may hold one. */
function readsCallerInput(e: ExprIR): boolean {
  let hit = false;
  walkExprDeep(e, (n) => {
    if (n.kind === "ref" && CALLER_REF_KINDS.has(n.refKind)) hit = true;
  });
  return hit;
}

/** Every operation of `agg` that writes a caller-supplied value into a
 *  `mask unless` field (any statement depth, any path into the field).
 *  Creates are not sinks: a new row has no stored value to overwrite, and the
 *  creator chose it.  An assignment from constants or the row itself is the
 *  author's own domain logic, not the caller's input. */
function maskWriteSinks(agg: AggregateIR): MaskWriteSink[] {
  if (!carriesFieldMask(agg)) return [];
  const partsByName = new Map(agg.parts.map((p) => [p.name, p] as const));
  const out: MaskWriteSink[] = [];
  for (const op of agg.operations) {
    const seen = new Set<string>();
    // A `let` bound to a contained part (`let c = comments.first()`) is a
    // write path into that part: `c.internal := v`.
    const partLets = new Map<string, string>();
    for (const root of op.statements) {
      walkStmtsDeep(root, (s: StmtIR) => {
        if (s.kind !== "let") return;
        const part = entityNameOf(s.type);
        if (part !== undefined && partsByName.has(part)) partLets.set(s.name, part);
      });
    }
    for (const root of op.statements) {
      walkStmtsDeep(root, (s: StmtIR) => {
        if (s.kind !== "assign") return;
        const hit = writtenMaskedField(agg, partsByName, partLets, s.target.segments);
        if (!hit || seen.has(hit.key) || !readsCallerInput(s.value)) return;
        seen.add(hit.key);
        out.push({ op, ...hit });
      });
    }
  }
  return out;
}

/** The masked field an assignment path lands in, or undefined: a root field
 *  (`salary`, or any path under it), or a contained part's field reached
 *  through a containment (`memo.text`) or a part-typed `let`
 *  (`c.internal`). */
function writtenMaskedField(
  agg: AggregateIR,
  partsByName: ReadonlyMap<string, EntityPartIR>,
  partLets: ReadonlyMap<string, string>,
  segments: readonly string[],
): Omit<MaskWriteSink, "op"> | undefined {
  const [head, ...rest] = segments;
  if (head === undefined) return undefined;
  const rootField = agg.fields.find((f) => f.name === head && f.maskUnless);
  if (rootField) return { field: rootField, key: rootField.name, owner: agg.name };
  const letPart = partLets.get(head);
  const containment = agg.contains.find((x) => x.name === head);
  let part = partsByName.get(letPart ?? containment?.partName ?? "");
  let path = rest;
  while (part && path.length > 1) {
    const step = path[0];
    const c = part.contains.find((x) => x.name === step);
    part = c ? partsByName.get(c.partName) : undefined;
    path = path.slice(1);
  }
  if (!part || path.length !== 1) return undefined;
  const field = part.fields.find((f) => f.name === path[0] && f.maskUnless);
  return field ? { field, key: partMemberKey(part.name, field.name), owner: part.name } : undefined;
}

/** The `source` text a mask write gate carries (the 403 detail). */
function maskWriteGateSource(agg: string, field: string): string {
  return `mask unless — only a caller who can read ${agg}.${field} may change it`;
}

/** Prepend each mask write gate to its operation — after the operation's own
 *  leading `requires` run, so it hoists with them.  Idempotent: an operation
 *  already carrying the gate is left alone. */
export function applyMaskWriteGates<A extends AggregateIR>(agg: A): A {
  const sinks = maskWriteSinks(agg);
  if (sinks.length === 0) return agg;
  const byOp = new Map<OperationIR, MaskWriteSink[]>();
  for (const s of sinks) byOp.set(s.op, [...(byOp.get(s.op) ?? []), s]);
  const operations = agg.operations.map((op) => {
    const mine = byOp.get(op);
    if (!mine) return op;
    const fresh = mine.filter(
      (s) => !op.statements.some((st) => st.kind === "requires" && st.maskWriteOf === s.key),
    );
    if (fresh.length === 0) return op;
    let lead = 0;
    while (lead < op.statements.length && op.statements[lead]!.kind === "requires") lead++;
    const gates: StmtIR[] = fresh.map((s) => ({
      kind: "requires",
      expr: structuredClone(s.field.maskUnless!),
      source: maskWriteGateSource(s.owner, s.field.name),
      maskWriteOf: s.key,
    }));
    return {
      ...op,
      statements: [...op.statements.slice(0, lead), ...gates, ...op.statements.slice(lead)],
    };
  });
  return { ...agg, operations };
}

// ── Read-predicate sinks ─────────────────────────────────────────────────────

/** A read gate widened by the mask predicate: `existing && mask`. */
function withMask(existing: ExprIR | undefined, mask: ExprIR): ExprIR {
  return existing ? conjoinPredicates([existing, mask])! : structuredClone(mask);
}

/** A find whose `where` reads a masked field inherits the mask as its gate,
 *  so a caller who cannot read the field cannot probe it either.  Idempotent:
 *  a gate that already conjoins the mask is not widened again. */
export function applyMaskFindGates(
  repos: RepositoryIR[],
  aggregates: readonly AggregateIR[],
): RepositoryIR[] {
  const byName = new Map(aggregates.map((a) => [a.name, a] as const));
  return repos.map((r) => {
    const agg = byName.get(r.aggregateName);
    if (!agg || !carriesFieldMask(agg)) return r;
    let changed = false;
    const finds = r.finds.map((f: FindIR) => {
      const mask = readMaskOf(agg, f.filter, f);
      if (!mask || (f.requires && conjoins(f.requires, mask))) return f;
      changed = true;
      return { ...f, requires: withMask(f.requires, mask) };
    });
    return changed ? { ...r, finds } : r;
  });
}

/** True when `gate` is `mask` or a conjunction that has `mask` as a term. */
export function conjoins(gate: ExprIR, mask: ExprIR): boolean {
  const k = exprKey(mask);
  const terms: ExprIR[] = [];
  const collect = (e: ExprIR): void => {
    if (e.kind === "binary" && e.op === "&&") {
      collect(e.left);
      collect(e.right);
    } else terms.push(e);
  };
  collect(gate);
  return terms.some((t) => exprKey(t) === k);
}

/** Everything a body's reads resolve against. */
interface ReadScope {
  aggregates: ReadonlyMap<string, AggregateIR>;
  repos: ReadonlyMap<string, RepositoryIR>;
  criteria: ReadonlyMap<string, CriterionIR>;
  retrievals: ReadonlyMap<string, RetrievalIR>;
  services: ReadonlyMap<string, DomainServiceIR>;
}

function readScope(ctx: MaskScopeInput): ReadScope {
  return {
    aggregates: new Map(ctx.aggregates.map((a) => [a.name, a] as const)),
    repos: new Map(ctx.repositories.map((r) => [r.name, r] as const)),
    criteria: new Map((ctx.criteria ?? []).map((c) => [c.name, c] as const)),
    retrievals: new Map((ctx.retrievals ?? []).map((r) => [r.name, r] as const)),
    services: new Map((ctx.domainServices ?? []).map((d) => [d.name, d] as const)),
  };
}

/** The masked predicate every repository read of a handler / workflow body
 *  runs, per aggregate, in first-read order — the statement forms
 *  (`repo-let` / `repo-run` / `if let`), the expression form (a `repo-read`
 *  call), and, through each `reading` domain-service operation the body calls
 *  (transitively), that operation's own reads. */
function bodyReadMasks(
  statements: WorkflowStmtIR[],
  scope: ReadScope,
): { agg: string; mask: ExprIR }[] {
  const out: { agg: string; mask: ExprIR }[] = [];
  const consider = (
    aggName: string,
    where: ExprIR | undefined,
    stance: BypassStance | undefined,
  ): void => {
    const agg = scope.aggregates.get(aggName);
    if (!agg) return;
    const mask = readMaskOf(agg, where, stance);
    if (mask) out.push({ agg: aggName, mask });
  };
  const find = (repoName: string, method: string | undefined): FindIR | undefined =>
    method ? scope.repos.get(repoName)?.finds.find((f) => f.name === method) : undefined;
  const criterionBody = (c: { name: string } | undefined): ExprIR | undefined =>
    c?.name ? scope.criteria.get(c.name)?.body : undefined;
  const visitedOps = new Set<string>();
  // An expression-level read: a `reading` domain service's repository query,
  // or a call into a domain service whose operation body reads.
  const visitCall = (e: ExprIR): void => {
    if (e.kind !== "call") return;
    if (e.callKind === "repo-read" && e.repoRead) {
      const r = e.repoRead;
      const stance = r.bypassRead ?? r;
      if (r.synthCriterion) consider(r.aggregate, criterionBody(r.synthCriterion), stance);
      else if (r.retrievalName) {
        const rt = scope.retrievals.get(r.retrievalName);
        consider(r.aggregate, rt?.where, rt ?? stance);
      } else {
        const f = find(r.repo, r.method);
        consider(r.aggregate, f?.filter, f ?? stance);
      }
    } else if (e.callKind === "domain-service" && e.serviceRef) {
      const key = `${e.serviceRef.service}.${e.serviceRef.op}`;
      if (visitedOps.has(key)) return;
      visitedOps.add(key);
      const op = scope.services
        .get(e.serviceRef.service)
        ?.operations.find((o) => o.name === e.serviceRef!.op);
      for (const st of op?.body ?? []) walkStmtExprsDeep(st, visitCall);
    }
  };
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "repo-let") {
        const stance = n.bypassRead;
        if (n.synthCriterion) consider(n.aggName, criterionBody(n.synthCriterion), stance);
        else {
          const f = find(n.repoName, n.method);
          consider(n.aggName, f?.filter, stance ?? f);
        }
      } else if (n.kind === "repo-run") {
        if (n.synthCriterion) consider(n.aggName, criterionBody(n.synthCriterion), n);
        else {
          const rt = scope.retrievals.get(n.retrievalName);
          consider(n.aggName, rt?.where, n.bypassAll || n.bypassCaps ? n : rt);
        }
      } else if (n.kind === "if-let" && n.op !== "bound") {
        const f = find(n.repoName, n.findMethod);
        const stance = n.bypassRead ?? f;
        consider(n.aggName, criterionBody(n.synthCriterion), stance);
        consider(n.aggName, f?.filter, stance);
      }
    });
    walkWorkflowStmtExprsDeep(st, visitCall);
  }
  return out;
}

/** `statements` with a leading mask read gate per distinct masked predicate
 *  its reads run — each marked `readGateOf` (it authorizes that read only,
 *  like a `policy { read … }` handler gate).  A gate the body already leads
 *  with (an authored copy) is not repeated, so the pass is idempotent. */
function withMaskReadGates(statements: WorkflowStmtIR[], scope: ReadScope): WorkflowStmtIR[] {
  const masks = bodyReadMasks(statements, scope);
  if (masks.length === 0) return statements;
  const keys = new Set<string>();
  for (const st of statements) {
    if (st.kind !== "requires") break;
    keys.add(exprKey(st.expr));
  }
  const gates: WorkflowStmtIR[] = [];
  for (const { agg, mask } of masks) {
    const k = exprKey(mask);
    if (keys.has(k)) continue;
    keys.add(k);
    gates.push({
      kind: "requires",
      expr: structuredClone(mask),
      source: `mask unless — the read filters ${agg} on a masked field`,
      readGateOf: agg,
    });
  }
  return gates.length === 0 ? statements : [...gates, ...statements];
}

/** What the handler / workflow mask passes read against. */
export interface MaskScopeInput {
  aggregates: readonly AggregateIR[];
  repositories: readonly RepositoryIR[];
  criteria?: readonly CriterionIR[];
  retrievals?: readonly RetrievalIR[];
  domainServices?: readonly DomainServiceIR[];
}

const anyMasked = (ctx: MaskScopeInput): boolean => ctx.aggregates.some(carriesFieldMask);

/** Put the mask predicate ahead of every hand-written handler whose body
 *  reads an aggregate through a predicate on a masked field — the handler
 *  twin of `applyMaskFindGates`. */
export function applyMaskHandlerGates<H extends QueryHandlerIR | CommandHandlerIR>(
  handlers: H[],
  ctx: MaskScopeInput,
): H[] {
  if (!anyMasked(ctx)) return handlers;
  const scope = readScope(ctx);
  return handlers.map((h) => {
    if (h.extern) return h;
    const statements = withMaskReadGates(h.statements, scope);
    return statements === h.statements ? h : { ...h, statements };
  });
}

/** The workflow twin: every command-triggered `create` — a caller's own
 *  route — inherits the mask gates of the reads its body makes.  An
 *  event-triggered `create` or an `on(…)` reactor runs as the system
 *  principal on an event, with no caller to probe anything, so it is left
 *  alone.  The deprecated `statements` facade (the primary create's body)
 *  follows its create. */
export function applyMaskWorkflowGates(workflows: WorkflowIR[], ctx: MaskScopeInput): WorkflowIR[] {
  if (!anyMasked(ctx)) return workflows;
  const scope = readScope(ctx);
  return workflows.map((wf) => {
    let changed = false;
    const creates = wf.creates.map((c) => {
      if (c.triggerKind !== "command") return c;
      const statements = withMaskReadGates(c.statements, scope);
      if (statements === c.statements) return c;
      changed = true;
      return { ...c, statements };
    });
    if (!changed) return wf;
    const primary = wf.creates.find((c) => c.name === null) ?? wf.creates[0];
    const facade =
      primary && primary.triggerKind === "command"
        ? withMaskReadGates(wf.statements, scope)
        : wf.statements;
    return { ...wf, creates, statements: facade };
  });
}

// ── Event sinks ──────────────────────────────────────────────────────────────
//
// An `emit`ted event whose payload reads a masked value carries it past every
// read boundary: a folded projection serves it, a channel publishes it.

/** The first masked field a single expression reads, or null — the shared
 *  taint reader (`mask-taint.ts`), with a `let` carrying one masked name. */
function firstMaskedRead(
  e: ExprIR,
  masked: ReadonlySet<string>,
  taintedLets: ReadonlyMap<string, string>,
): string | null {
  const lets = new Map([...taintedLets].map(([k, v]) => [k, [v]] as const));
  return maskedReadsOf(e, masked, lets)[0] ?? null;
}

/** Map every event whose emitted payload carries a `mask unless` value to the
 *  `<Aggregate>.<field>` that laundered into it. */

export function maskLaunderingEvents(ctx: BoundedContextIR): Map<string, string> {
  const out = new Map<string, string>();
  for (const agg of ctx.aggregates) {
    if (!carriesFieldMask(agg)) continue;
    // Every masked member — root fields, the `derived` computed from one, and
    // each contained part's (`<Part>.<member>`) — carries the masked value.
    const masked = new Set(allMaskPredicates(agg).keys());
    for (const op of [...agg.operations, ...(agg.creates ?? []), ...(agg.destroys ?? [])]) {
      const stmts: StmtIR[] = [];
      for (const s of op.statements) walkStmtsDeep(s, (n) => stmts.push(n));
      // Fixpoint over `let` bindings so declaration order (or nesting inside a
      // lambda block) can't hide a chain `let a = salary` / `let b = a`.
      const taintedLets = new Map<string, string>();
      for (let changed = true; changed; ) {
        changed = false;
        for (const s of stmts) {
          if (s.kind !== "let" || taintedLets.has(s.name)) continue;
          const via = firstMaskedRead(s.expr, masked, taintedLets);
          if (via !== null) {
            taintedLets.set(s.name, via);
            changed = true;
          }
        }
      }
      for (const s of stmts) {
        if (s.kind !== "emit" || out.has(s.eventName)) continue;
        for (const f of s.fields) {
          const via = firstMaskedRead(f.value, masked, taintedLets);
          if (via !== null) {
            out.set(s.eventName, via.includes(".") ? via : `${agg.name}.${via}`);
            break;
          }
        }
      }
    }
  }
  return out;
}

// ── Log sink ─────────────────────────────────────────────────────────────────

/** True when a field's value must not appear in the synthesized `inspect`
 *  text (`toString()` / `Inspect` — what a log line or an exception carries,
 *  with no principal check): a `sensitive(...)` field, or a `mask unless` one.
 *  Read by `synthesizeInspect` and by every backend that decides whether to
 *  emit its own redacting inspect hook. */
export function fieldRedactedInInspect(f: {
  sensitivity?: readonly string[];
  maskUnless?: ExprIR;
}): boolean {
  return (!!f.sensitivity && f.sensitivity.length > 0) || f.maskUnless !== undefined;
}
