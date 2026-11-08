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
//   - `wireFieldsForAggregate` — a `derived` that reads a masked field carries
//     the inherited predicate on its wire field, so every backend's masked
//     serializer (which reads `WireField.maskUnless`) redacts it too;
//   - `applyMaskWriteGates` — an operation that writes a caller-supplied value
//     into a masked field gets the predicate as a hoisted `requires` (a caller
//     who cannot read the field cannot change it; a merge-patch update that
//     omits the key keeps the stored value and passes);
//   - `applyMaskFindGates` / `applyMaskHandlerGates` — a read whose predicate
//     reads a masked field would answer an existence oracle on the hidden
//     value, so it inherits the mask predicate as its `requires`.
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
  ExprIR,
  FieldIR,
  FindIR,
  OperationIR,
  QueryHandlerIR,
  RepositoryIR,
  RetrievalIR,
  StmtIR,
  TypeIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { walkExprDeep, walkStmtsDeep, walkWorkflowStmtsDeep } from "../util/walk.js";

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

/** The masked self-member names one expression reads — a field / derived
 *  read on the row (`salary`, `this.salary`), plus a `let` that carries one. */
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
    if (n.kind === "member" && n.receiver.kind === "this" && masked.has(n.member)) note(n.member);
  });
  return out;
}

type MaskSource = Pick<AggregateIR, "fields" | "derived">;

/** The fact: every masked wire member of an aggregate → its effective read
 *  predicate.  A declared `mask unless` field maps to its own predicate; a
 *  `derived` that reads masked members (directly or through another derived)
 *  maps to the conjunction of their predicates — a caller sees it only when
 *  it could see every masked value it is computed from.  Empty for a
 *  mask-free aggregate. */
export function maskedReadPredicates(agg: MaskSource): Map<string, ExprIR> {
  const out = new Map<string, ExprIR>();
  for (const f of agg.fields) if (f.maskUnless) out.set(f.name, f.maskUnless);
  if (out.size === 0) return out;
  // Fixpoint: a derived reading a derived reading a masked field.
  const pending: DerivedIR[] = [...agg.derived];
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of pending) {
      if (out.has(d.name)) continue;
      const reads = maskedReadsOf(d.expr, new Set(out.keys()));
      if (reads.length === 0) continue;
      const pred = conjoinPredicates(reads.map((r) => out.get(r)!));
      if (pred) {
        out.set(d.name, pred);
        changed = true;
      }
    }
  }
  return out;
}

/** The predicate a read through `expr` (a find / criterion / retrieval
 *  predicate over the aggregate's rows) must inherit, or undefined. */
function predicateMaskOf(agg: MaskSource, expr: ExprIR | undefined): ExprIR | undefined {
  if (!expr || !agg.fields.some((f) => f.maskUnless)) return undefined;
  const masks = maskedReadPredicates(agg);
  const reads = maskedReadsOf(expr, new Set(masks.keys()));
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
  const masked = new Map(agg.fields.filter((f) => f.maskUnless).map((f) => [f.name, f] as const));
  if (masked.size === 0) return [];
  const out: MaskWriteSink[] = [];
  for (const op of agg.operations) {
    const seen = new Set<string>();
    for (const root of op.statements) {
      walkStmtsDeep(root, (s: StmtIR) => {
        if (s.kind !== "assign") return;
        const head = s.target.segments[0];
        const field = head === undefined ? undefined : masked.get(head);
        if (!field || seen.has(field.name) || !readsCallerInput(s.value)) return;
        seen.add(field.name);
        out.push({ op, field });
      });
    }
  }
  return out;
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
      (s) => !op.statements.some((st) => st.kind === "requires" && st.maskWriteOf === s.field.name),
    );
    if (fresh.length === 0) return op;
    let lead = 0;
    while (lead < op.statements.length && op.statements[lead]!.kind === "requires") lead++;
    const gates: StmtIR[] = fresh.map((s) => ({
      kind: "requires",
      expr: structuredClone(s.field.maskUnless!),
      source: maskWriteGateSource(agg.name, s.field.name),
      maskWriteOf: s.field.name,
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
    if (!agg?.fields.some((f) => f.maskUnless)) return r;
    let changed = false;
    const finds = r.finds.map((f: FindIR) => {
      const mask = predicateMaskOf(agg, f.filter);
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

/** The masked predicate a handler-body repository read runs, per aggregate. */
function handlerReadMasks(
  statements: WorkflowStmtIR[],
  aggregates: ReadonlyMap<string, AggregateIR>,
  repos: ReadonlyMap<string, RepositoryIR>,
  criteria: ReadonlyMap<string, CriterionIR>,
  retrievals: ReadonlyMap<string, RetrievalIR>,
): { agg: string; mask: ExprIR }[] {
  const out: { agg: string; mask: ExprIR }[] = [];
  const consider = (aggName: string, pred: ExprIR | undefined): void => {
    const agg = aggregates.get(aggName);
    if (!agg) return;
    const mask = predicateMaskOf(agg, pred);
    if (mask) out.push({ agg: aggName, mask });
  };
  const findFilter = (repoName: string, method: string | undefined): ExprIR | undefined =>
    method ? repos.get(repoName)?.finds.find((f) => f.name === method)?.filter : undefined;
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "repo-let") {
        if (n.synthCriterion) consider(n.aggName, criteria.get(n.synthCriterion.name)?.body);
        else consider(n.aggName, findFilter(n.repoName, n.method));
      } else if (n.kind === "repo-run") {
        if (n.synthCriterion) consider(n.aggName, criteria.get(n.synthCriterion.name)?.body);
        else consider(n.aggName, retrievals.get(n.retrievalName)?.where);
      } else if (n.kind === "if-let" && n.op !== "bound") {
        consider(n.aggName, criteria.get(n.synthCriterion.name)?.body);
        consider(n.aggName, findFilter(n.repoName, n.findMethod));
      }
    });
  }
  return out;
}

/** Put the mask predicate ahead of every hand-written handler whose body
 *  reads an aggregate through a predicate on a masked field — the handler
 *  twin of `applyMaskFindGates`.  The gate authorizes that read only
 *  (`readGateOf`), exactly like a `policy { read … }` handler gate. */
export function applyMaskHandlerGates<H extends QueryHandlerIR | CommandHandlerIR>(
  handlers: H[] | undefined,
  ctx: {
    aggregates: readonly AggregateIR[];
    repositories: readonly RepositoryIR[];
    criteria?: readonly CriterionIR[];
    retrievals?: readonly RetrievalIR[];
  },
): H[] | undefined {
  if (!handlers || !ctx.aggregates.some((a) => a.fields.some((f) => f.maskUnless))) {
    return handlers;
  }
  const aggregates = new Map(ctx.aggregates.map((a) => [a.name, a] as const));
  const repos = new Map(ctx.repositories.map((r) => [r.name, r] as const));
  const criteria = new Map((ctx.criteria ?? []).map((c) => [c.name, c] as const));
  const retrievals = new Map((ctx.retrievals ?? []).map((r) => [r.name, r] as const));
  return handlers.map((h) => {
    if (h.extern) return h;
    const masks = handlerReadMasks(h.statements, aggregates, repos, criteria, retrievals);
    const leading: WorkflowStmtIR[] = [];
    for (const st of h.statements) {
      if (st.kind !== "requires") break;
      leading.push(st);
    }
    const gates: WorkflowStmtIR[] = [];
    const keys = new Set(leading.filter((s) => s.kind === "requires").map((s) => exprKey(s.expr)));
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
    return gates.length === 0 ? h : { ...h, statements: [...gates, ...h.statements] };
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
    const maskedFields = agg.fields.filter((f) => f.maskUnless).map((f) => f.name);
    if (maskedFields.length === 0) continue;
    const masked = new Set(maskedFields);
    // A `derived` whose expression reads a masked field carries the same value.
    for (const d of agg.derived) {
      if (firstMaskedRead(d.expr, masked, new Map())) masked.add(d.name);
    }
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
            out.set(s.eventName, `${agg.name}.${via}`);
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
