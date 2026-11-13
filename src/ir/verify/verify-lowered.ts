// The post-lowering IR well-formedness verifier.
//
// Lowering (phase ⑤) resolves every name once, and every backend renders what
// it resolved.  A name lowering resolves wrongly is therefore rendered wrongly
// on all five backends at once, and nothing in between notices: the defect
// surfaces per target as a compile error or a silent runtime bug.  This pass
// checks that the lowered IR agrees with itself — every `ref` names a
// declaration of its `refKind` that the body can see, every assignment target
// is a stored member, every member read names a member of its receiver's type,
// every call names a target of its `callKind` — so a wrong lowering rule fails
// here, on the model that exposes it, before any backend sees it.
//
// A violation is a compiler defect, not an author error: a model the AST
// validators accept must lower to a well-formed IR, and a construct lowering
// cannot express must be refused before lowering with a `loom.*` diagnostic.
//
// Scope is flow-insensitive per body: a name counts as bound when the body
// binds it anywhere (a `let`, a lambda parameter, a match-arm binding, an
// `exists` row).  That is enough to catch a ref resolved to the wrong KIND of
// declaration — the defect class this pass exists for — without re-deriving
// lexical scoping, which is the AST validator's job.

import type {
  AggregateIR,
  BoundedContextIR,
  DerivedIR,
  DomainServiceIR,
  EntityPartIR,
  EnumIR,
  ExprIR,
  FieldIR,
  FunctionIR,
  InvariantIR,
  LoomModel,
  LoweringViolation,
  LoweringViolationKind,
  OperationIR,
  ParamIR,
  StmtIR,
  TypeIR,
  ValueObjectIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { allContexts } from "../types/loom-ir.js";
import type { OriginRef } from "../types/origin.js";
import {
  walkExprChildren,
  walkExprDeep,
  walkStmtChildren,
  walkStmtsDeep,
  walkWorkflowStmtOwnExprsDeep,
  walkWorkflowStmtsDeep,
} from "../util/walk.js";

/** Stable one-line rendering of a violation (the ratchet baseline's key). */
export function formatViolation(v: LoweringViolation): string {
  return `${v.kind} ${v.where}: ${v.detail}`;
}

// ---------------------------------------------------------------------------
// Declaration index
// ---------------------------------------------------------------------------

/** The data members a `this` / receiver of one declaration exposes. */
interface MemberSet {
  /** Stored fields and containments — the assignable members. */
  stored: ReadonlySet<string>;
  /** Everything readable: stored, derived, and the implicit `id`. */
  readable: ReadonlySet<string>;
}

interface ContextIndex {
  ctx: BoundedContextIR;
  enums: ReadonlyMap<string, ReadonlySet<string>>;
  valueObjects: ReadonlyMap<string, ValueObjectIR>;
  aggregates: ReadonlyMap<string, AggregateIR>;
  parts: ReadonlyMap<string, EntityPartIR>;
  domainServices: ReadonlyMap<string, DomainServiceIR>;
  /** Every context's declarations, for a receiver typed by another context
   *  (an in-system api call returns the callee's record).  A name declared in
   *  two contexts maps to `undefined`: no claim is made about it. */
  modelWide: {
    aggregates: ReadonlyMap<string, AggregateIR | undefined>;
    parts: ReadonlyMap<string, EntityPartIR | undefined>;
    valueObjects: ReadonlyMap<string, ValueObjectIR | undefined>;
  };
}

function uniqueByName<T extends { name: string }>(xs: readonly T[]): Map<string, T | undefined> {
  const out = new Map<string, T | undefined>();
  for (const x of xs) out.set(x.name, out.has(x.name) ? undefined : x);
  return out;
}

function indexModel(model: LoomModel): ContextIndex["modelWide"] {
  const ctxs = allContexts(model);
  const aggregates = ctxs.flatMap((c) => c.aggregates);
  return {
    aggregates: uniqueByName(aggregates),
    parts: uniqueByName(aggregates.flatMap((a) => a.parts)),
    valueObjects: uniqueByName([...model.rootValueObjects, ...ctxs.flatMap((c) => c.valueObjects)]),
  };
}

function indexContext(
  model: LoomModel,
  ctx: BoundedContextIR,
  modelWide: ContextIndex["modelWide"],
): ContextIndex {
  const enums = new Map<string, Set<string>>();
  const addEnum = (e: EnumIR) => enums.set(e.name, new Set(e.values));
  for (const e of model.rootEnums) addEnum(e);
  for (const e of ctx.siblingEnums ?? []) addEnum(e);
  for (const e of ctx.enums) addEnum(e);
  const valueObjects = new Map<string, ValueObjectIR>();
  for (const vo of [
    ...model.rootValueObjects,
    ...(ctx.siblingValueObjects ?? []),
    ...ctx.valueObjects,
  ])
    valueObjects.set(vo.name, vo);
  const aggregates = new Map(ctx.aggregates.map((a) => [a.name, a]));
  const parts = new Map<string, EntityPartIR>();
  for (const a of ctx.aggregates) for (const p of a.parts) parts.set(p.name, p);
  const domainServices = new Map(ctx.domainServices.map((s) => [s.name, s]));
  return { ctx, enums, valueObjects, aggregates, parts, domainServices, modelWide };
}

/** The aggregate and every base it `extends`, own first.  Lowering reads the
 *  inherited members through the chain (enrichment merges them later). */
function aggregateChain(agg: AggregateIR, index: ContextIndex): AggregateIR[] {
  const chain: AggregateIR[] = [];
  const seen = new Set<string>();
  for (let a: AggregateIR | undefined = agg; a && !seen.has(a.name); ) {
    seen.add(a.name);
    chain.push(a);
    a = a.extendsAggregate ? index.aggregates.get(a.extendsAggregate) : undefined;
  }
  return chain;
}

function memberSet(
  fields: readonly FieldIR[],
  contains: readonly { name: string }[],
  derived: readonly DerivedIR[],
): MemberSet {
  const stored = new Set([...fields.map((f) => f.name), ...contains.map((c) => c.name)]);
  return { stored, readable: new Set([...stored, ...derived.map((d) => d.name), "id"]) };
}

function aggregateMembers(agg: AggregateIR, index: ContextIndex): MemberSet {
  const chain = aggregateChain(agg, index);
  return memberSet(
    chain.flatMap((a) => a.fields),
    chain.flatMap((a) => a.contains),
    chain.flatMap((a) => a.derived),
  );
}

/** The members a receiver of type `t` exposes, when `t` names a declaration
 *  this index can see; `undefined` for every other type (no claim made). */
function membersOfType(t: TypeIR, index: ContextIndex): MemberSet | undefined {
  if (t.kind === "valueobject") {
    const vo = index.valueObjects.get(t.name) ?? index.modelWide.valueObjects.get(t.name);
    return vo ? memberSet(vo.fields, [], vo.derived) : undefined;
  }
  if (t.kind !== "entity") return undefined;
  if (t.declKind === "aggregate") {
    const agg = index.aggregates.get(t.name) ?? index.modelWide.aggregates.get(t.name);
    return agg ? aggregateMembers(agg, index) : undefined;
  }
  if (t.declKind === "part") {
    const part = index.parts.get(t.name) ?? index.modelWide.parts.get(t.name);
    return part ? memberSet(part.fields, part.contains, part.derived) : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Body scope
// ---------------------------------------------------------------------------

/** What one body can name. */
interface BodyScope {
  where: string;
  index: ContextIndex;
  /** The `this` of the body — absent in a domain-service operation. */
  self?: MemberSet;
  /** Members a `this-vo-prop` names (value-object bodies only). */
  voSelf?: MemberSet;
  params: ReadonlySet<string>;
  /** Helper functions a bare call / `helper-fn` ref can name. */
  functions: ReadonlySet<string>;
  /** Operations a `private-operation` call can name. */
  operations: ReadonlySet<string>;
  /** Fallback origin when the offending node carries none. */
  origin?: OriginRef;
}

/** Names the body binds anywhere — flow-insensitive (see the file header). */
interface Bindings {
  lets: Set<string>;
  lambdas: Set<string>;
  matchBindings: Set<string>;
  rows: Set<string>;
}

function collectBindings(
  stmts: readonly StmtIR[],
  exprs: readonly (ExprIR | undefined)[],
): Bindings {
  const b: Bindings = {
    lets: new Set(),
    lambdas: new Set(),
    matchBindings: new Set(),
    rows: new Set(),
  };
  const onExpr = (e: ExprIR) => {
    if (e.kind === "lambda") b.lambdas.add(e.param);
    for (const arm of e.kind === "match" ? e.variantArms : [])
      if (arm.binding) b.matchBindings.add(arm.binding);
    if (e.kind === "exists") b.rows.add(e.binding);
  };
  for (const s of stmts) {
    walkStmtsDeep(s, (st) => {
      if (st.kind === "let") b.lets.add(st.name);
      for (const arm of st.kind === "variant-match" ? st.arms : [])
        if (arm.binding) b.matchBindings.add(arm.binding);
    });
    walkStmtExprs(s, onExpr);
  }
  for (const e of exprs) walkExprDeep(e, onExpr);
  return b;
}

/** True when the body binds `name` — a parameter, a `let`, a lambda parameter,
 *  a match-arm binding or an `exists` row. */
function isBound(name: string, scope: BodyScope, b: Bindings): boolean {
  return (
    scope.params.has(name) ||
    b.lets.has(name) ||
    b.lambdas.has(name) ||
    b.matchBindings.has(name) ||
    b.rows.has(name)
  );
}

/** Every expression reachable from `s`, nested blocks and lambda bodies included. */
function walkStmtExprs(s: StmtIR, visit: (e: ExprIR) => void): void {
  walkStmtsDeep(s, (st) => walkStmtChildren(st, (e) => walkExprShallowDeep(e, visit)));
}

/** `walkExprDeep` without descending into lambda STATEMENT blocks — those are
 *  reached as statements by `walkStmtsDeep`, so descending twice would report a
 *  violation inside a block-body lambda twice. */
function walkExprShallowDeep(e: ExprIR, visit: (e: ExprIR) => void): void {
  visit(e);
  walkExprChildren(e, { expr: (c) => walkExprShallowDeep(c, visit) });
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function verifyBody(
  scope: BodyScope,
  stmts: readonly StmtIR[],
  exprs: readonly (ExprIR | undefined)[],
  out: LoweringViolation[],
): void {
  const bindings = collectBindings(stmts, exprs);
  const report = (kind: LoweringViolationKind, detail: string, origin?: OriginRef) =>
    out.push({ kind, where: scope.where, detail, origin: origin ?? scope.origin });
  const checkExpr = (e: ExprIR) => verifyExpr(e, scope, bindings, report);
  for (const s of stmts) {
    walkStmtsDeep(s, (st) => {
      // A violation inside a statement with no origin of its own points at the statement.
      const at: Report = (kind, detail, origin) => report(kind, detail, origin ?? st.origin);
      verifyStmt(st, scope, at);
      walkStmtChildren(st, (e) =>
        walkExprShallowDeep(e, (x) => verifyExpr(x, scope, bindings, at)),
      );
    });
  }
  checkDuplicateLets(stmts, report);
  for (const e of exprs) if (e) walkExprDeep(e, checkExpr);
}

type Report = (kind: LoweringViolationKind, detail: string, origin?: OriginRef) => void;

function verifyExpr(e: ExprIR, scope: BodyScope, b: Bindings, report: Report): void {
  switch (e.kind) {
    case "ref":
      verifyRef(e, scope, b, report);
      return;
    case "member": {
      const members = membersOfType(e.receiverType, scope.index);
      if (members && !members.readable.has(e.member))
        report(
          "member-unresolved",
          `\`.${e.member}\` is not a member of ${typeName(e.receiverType)}`,
          e.origin,
        );
      return;
    }
    case "call":
      verifyCallTarget(e, scope, report);
      return;
    case "literal":
    case "this":
    case "id":
    case "method-call":
    case "action-ref":
    case "lambda":
    case "new":
    case "object":
    case "list":
    case "authz-filter":
    case "exists":
    case "paren":
    case "unary":
    case "binary":
    case "ternary":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "modelText":
    case "match":
      return;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
    }
  }
}

function verifyRef(
  e: Extract<ExprIR, { kind: "ref" }>,
  scope: BodyScope,
  b: Bindings,
  report: Report,
): void {
  const miss = (what: string) =>
    report("ref-unresolved", `\`${e.name}\` (refKind ${e.refKind}) names no ${what}`, e.origin);
  switch (e.refKind) {
    case "param":
      if (!scope.params.has(e.name)) miss("parameter");
      return;
    case "let":
      if (!b.lets.has(e.name)) miss("`let` binding");
      return;
    case "lambda":
      if (!b.lambdas.has(e.name)) miss("lambda parameter");
      return;
    case "match-binding":
      if (!b.matchBindings.has(e.name)) miss("match-arm binding");
      return;
    case "row":
      if (!b.rows.has(e.name)) miss("`exists` row");
      return;
    case "this-prop":
      if (!scope.self?.stored.has(e.name)) miss("stored member of `this`");
      return;
    case "this-derived":
      if (!scope.self?.readable.has(e.name) && !scope.voSelf?.readable.has(e.name))
        miss("derived member of `this`");
      return;
    case "this-vo-prop":
      if (!scope.voSelf?.stored.has(e.name)) miss("field of the value object");
      return;
    case "helper-fn":
      if (!scope.functions.has(e.name)) miss("function");
      return;
    case "enum-value":
      if (!scope.index.enums.get(e.enumName)?.has(e.name)) miss(`value of enum ${e.enumName}`);
      return;
    case "unknown":
      miss("declaration (unresolved)");
      return;
    case "current-user":
    case "resource":
    case "store-field":
    case "workflow-fn":
      return;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
    }
  }
}

function verifyCallTarget(
  e: Extract<ExprIR, { kind: "call" }>,
  scope: BodyScope,
  report: Report,
): void {
  const miss = (what: string) =>
    report("call-target", `\`${e.name}(…)\` (callKind ${e.callKind}) names no ${what}`, e.origin);
  switch (e.callKind) {
    case "function":
      if (!scope.functions.has(e.name)) miss("function");
      return;
    case "private-operation":
      if (!scope.operations.has(e.name)) miss("operation");
      return;
    case "value-object-ctor":
      if (!scope.index.valueObjects.has(e.name)) miss("value object");
      return;
    case "domain-service": {
      const svc = scope.index.domainServices.get(e.serviceRef.service);
      if (!svc?.operations.some((o) => o.name === e.serviceRef.op))
        miss("domain-service operation");
      return;
    }
    case "repo-read":
      if (!scope.index.aggregates.has(e.repoRead.aggregate)) miss("aggregate");
      return;
    case "workflow-fn":
    case "resource-op":
    case "remote-api-op":
    case "action":
    case "store-action":
    case "free":
      return;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
    }
  }
}

function verifyStmt(s: StmtIR, scope: BodyScope, report: Report): void {
  switch (s.kind) {
    case "assign":
    case "add":
    case "remove":
      verifyAssignTarget(s.target.segments, scope, report, s.origin);
      return;
    case "call": {
      const known =
        s.target === "function"
          ? scope.functions
          : s.target === "private-operation"
            ? scope.operations
            : undefined;
      if (known && !known.has(s.name))
        report(
          "call-target",
          `\`${s.name}(…)\` (call ${s.target}) names no ${s.target === "function" ? "function" : "operation"}`,
          s.origin,
        );
      return;
    }
    case "precondition":
    case "requires":
    case "let":
    case "emit":
    case "expression":
    case "variant-match":
    case "if":
    case "return":
      return;
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
    }
  }
}

/** A write target is rooted at a stored member of `this`; each further segment
 *  names a stored member of the value object or part the previous one holds. */
function verifyAssignTarget(
  segments: readonly string[],
  scope: BodyScope,
  report: Report,
  origin: OriginRef | undefined,
): void {
  const path = segments.join(".");
  const self = scope.self;
  const head = segments[0];
  if (!self || head === undefined || !self.stored.has(head)) {
    report("assign-target", `\`${path}\` — \`${head}\` is not a stored member of \`this\``, origin);
  }
}

function checkDuplicateLets(stmts: readonly StmtIR[], report: Report): void {
  const blocks: (readonly StmtIR[])[] = [stmts];
  for (const s of stmts)
    walkStmtsDeep(s, (st) => {
      if (st.kind === "if") blocks.push(st.thenBody, st.elseBody ?? []);
      if (st.kind === "variant-match")
        blocks.push(...st.arms.map((a) => a.body), st.elseBody ?? []);
      walkStmtChildren(st, (e) =>
        walkExprShallowDeep(e, (x) => {
          if (x.kind === "lambda" && x.block) blocks.push(x.block);
        }),
      );
    });
  for (const block of new Set(blocks)) {
    const seen = new Set<string>();
    for (const st of block) {
      if (st.kind !== "let") continue;
      if (seen.has(st.name))
        report("duplicate-let", `\`let ${st.name}\` is bound twice in one block`, st.origin);
      seen.add(st.name);
    }
  }
}

function typeName(t: TypeIR): string {
  return "name" in t ? `${t.kind} ${t.name}` : t.kind;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const names = (xs: readonly { name: string }[]) => new Set(xs.map((x) => x.name));

function invariantExprs(invs: readonly InvariantIR[]): ExprIR[] {
  return invs.flatMap((i) => (i.guard ? [i.expr, i.guard] : [i.expr]));
}

function functionBody(fn: FunctionIR): { stmts: readonly StmtIR[]; exprs: ExprIR[] } {
  return "expr" in fn.body
    ? { stmts: [], exprs: [fn.body.expr] }
    : { stmts: fn.body.stmts, exprs: [] };
}

function paramDefaults(params: readonly ParamIR[]): (ExprIR | undefined)[] {
  return params.map((p) => p.default);
}

/** Verify every domain-logic body of a lowered model. */
export function verifyLoweredModel(model: LoomModel): LoweringViolation[] {
  const out: LoweringViolation[] = [];
  const modelWide = indexModel(model);
  for (const ctx of allContexts(model)) {
    const index = indexContext(model, ctx, modelWide);
    for (const agg of ctx.aggregates) verifyAggregate(agg, index, out);
    for (const vo of ctx.valueObjects) verifyValueObject(vo, index, `${ctx.name}.${vo.name}`, out);
    for (const wf of ctx.workflows) verifyWorkflow(wf, index, out);
    for (const repo of ctx.repositories) {
      const agg = index.aggregates.get(repo.aggregateName);
      if (!agg) continue;
      for (const f of repo.finds) {
        verifyBody(
          {
            where: `${ctx.name}.${repo.name}.${f.name}`,
            index,
            self: aggregateMembers(agg, index),
            params: names(f.params),
            functions: new Set(),
            operations: new Set(),
            origin: repo.origin,
          },
          [],
          [f.filter, f.requires, ...(f.criterionRef?.args ?? []), ...paramDefaults(f.params)],
          out,
        );
      }
    }
    for (const c of ctx.criteria) {
      const agg =
        c.targetType.kind === "entity" ? index.aggregates.get(c.targetType.name) : undefined;
      verifyBody(
        {
          where: `${ctx.name}.${c.name}`,
          index,
          self: agg ? aggregateMembers(agg, index) : undefined,
          params: names(c.params),
          functions: new Set(),
          operations: new Set(),
        },
        [],
        [c.body],
        out,
      );
    }
    for (const h of [...ctx.commandHandlers, ...ctx.queryHandlers]) {
      verifyWorkflowBody(
        {
          where: `${ctx.name}.${h.name}`,
          index,
          params: names(h.params),
          functions: new Set(),
          operations: new Set(),
        },
        h.statements,
        [h.returnValue, ...paramDefaults(h.params)],
        out,
      );
    }
    for (const svc of ctx.domainServices) {
      for (const op of svc.operations) {
        verifyBody(
          {
            where: `${ctx.name}.${svc.name}.${op.name}`,
            index,
            params: names(op.params),
            functions: new Set(),
            operations: new Set(),
          },
          op.body,
          paramDefaults(op.params),
          out,
        );
      }
    }
  }
  return out;
}

function verifyAggregate(agg: AggregateIR, index: ContextIndex, out: LoweringViolation[]): void {
  const chain = aggregateChain(agg, index);
  const self = aggregateMembers(agg, index);
  const functions = new Set(chain.flatMap((a) => a.functions.map((f) => f.name)));
  const operations = new Set(
    chain.flatMap((a) => [...a.operations, ...a.creates, ...a.destroys].map((o) => o.name)),
  );
  const base = (
    member: string,
    params: readonly { name: string }[],
    origin?: OriginRef,
  ): BodyScope => ({
    where: `${index.ctx.name}.${agg.name}.${member}`,
    index,
    self,
    params: names(params),
    functions,
    operations,
    origin: origin ?? agg.origin,
  });
  const op = (o: OperationIR) =>
    verifyBody(
      base(o.name, o.params, o.origin),
      o.statements,
      [o.when, ...paramDefaults(o.params)],
      out,
    );
  for (const o of agg.operations) op(o);
  for (const o of agg.creates) op(o);
  for (const o of agg.destroys) op(o);
  for (const a of agg.appliers)
    verifyBody(base(`apply ${a.event}`, [{ name: a.param }]), a.statements, [], out);
  for (const fn of agg.functions) {
    const { stmts, exprs } = functionBody(fn);
    verifyBody(base(fn.name, fn.params), stmts, [...exprs, ...paramDefaults(fn.params)], out);
  }
  for (const d of agg.derived) verifyBody(base(d.name, []), [], [d.expr], out);
  verifyBody(base("invariants", []), [], invariantExprs(agg.invariants), out);
  verifyBody(
    base("field defaults", []),
    [],
    agg.fields.map((f) => f.default),
    out,
  );
  for (const part of agg.parts) verifyPart(part, index, out);
}

function verifyPart(part: EntityPartIR, index: ContextIndex, out: LoweringViolation[]): void {
  const self = memberSet(part.fields, part.contains, part.derived);
  const functions = names(part.functions);
  const base = (member: string, params: readonly { name: string }[]): BodyScope => ({
    where: `${index.ctx.name}.${part.parentName}.${part.name}.${member}`,
    index,
    self,
    params: names(params),
    functions,
    operations: new Set(),
  });
  for (const fn of part.functions) {
    const { stmts, exprs } = functionBody(fn);
    verifyBody(base(fn.name, fn.params), stmts, [...exprs, ...paramDefaults(fn.params)], out);
  }
  for (const d of part.derived) verifyBody(base(d.name, []), [], [d.expr], out);
  verifyBody(base("invariants", []), [], invariantExprs(part.invariants), out);
  verifyBody(
    base("field defaults", []),
    [],
    part.fields.map((f) => f.default),
    out,
  );
}

function verifyValueObject(
  vo: ValueObjectIR,
  index: ContextIndex,
  where: string,
  out: LoweringViolation[],
): void {
  const voSelf = memberSet(vo.fields, [], vo.derived);
  const functions = names(vo.functions);
  const base = (member: string, params: readonly { name: string }[]): BodyScope => ({
    where: `${where}.${member}`,
    index,
    voSelf,
    params: names(params),
    functions,
    operations: new Set(),
  });
  for (const fn of vo.functions) {
    const { stmts, exprs } = functionBody(fn);
    verifyBody(base(fn.name, fn.params), stmts, [...exprs, ...paramDefaults(fn.params)], out);
  }
  for (const d of vo.derived) verifyBody(base(d.name, []), [], [d.expr], out);
  verifyBody(base("invariants", []), [], invariantExprs(vo.invariants), out);
}

// ---------------------------------------------------------------------------
// Workflow-shaped bodies (workflows, command / query handlers)
// ---------------------------------------------------------------------------

function verifyWorkflow(wf: WorkflowIR, index: ContextIndex, out: LoweringViolation[]): void {
  const self = memberSet(wf.stateFields, [], []);
  const functions = names(wf.functions);
  const base = (member: string, params: readonly { name: string }[]): BodyScope => ({
    where: `${index.ctx.name}.${wf.name}.${member}`,
    index,
    self,
    params: names(params),
    functions,
    operations: new Set(),
    origin: wf.origin,
  });
  for (const c of wf.creates) {
    const params = c.eventBinding ? [...c.params, { name: c.eventBinding }] : c.params;
    verifyWorkflowBody(
      base(`create ${c.name ?? ""}`.trim(), params),
      c.statements,
      [c.correlation, c.returnValue, ...paramDefaults(c.params)],
      out,
    );
  }
  for (const on of wf.subscriptions)
    verifyWorkflowBody(
      base(`on ${on.event}`, [{ name: on.param }]),
      on.statements,
      [on.correlation],
      out,
    );
  for (const a of wf.appliers)
    verifyBody(base(`apply ${a.event}`, [{ name: a.param }]), a.statements, [], out);
  for (const fn of wf.functions) {
    const { stmts, exprs } = functionBody(fn);
    verifyBody(base(fn.name, fn.params), stmts, [...exprs, ...paramDefaults(fn.params)], out);
  }
}

function verifyWorkflowStmt(
  st: WorkflowStmtIR,
  scope: BodyScope,
  b: Bindings,
  report: Report,
): void {
  switch (st.kind) {
    case "assign":
      verifyAssignTarget(st.target.segments, scope, report, st.origin);
      return;
    case "op-call":
      if (!isBound(st.target, scope, b))
        report("ref-unresolved", `\`${st.target}.${st.op}(…)\` targets no binding`, st.origin);
      return;
    case "precondition":
    case "requires":
    case "emit":
    case "factory-let":
    case "repo-let":
    case "expr-let":
    case "repo-run":
    case "repo-delete":
    case "for-each":
    case "resource-call":
    case "domain-service-call":
    case "if-let":
    case "not-found":
    case "variant-match":
      return;
    default: {
      const _exhaustive: never = st;
      void _exhaustive;
    }
  }
}

/** The name a workflow statement binds for the statements after it, if any. */
function workflowBinding(s: WorkflowStmtIR): string | undefined {
  switch (s.kind) {
    case "factory-let":
    case "repo-let":
    case "expr-let":
    case "repo-run":
      return s.name;
    case "for-each":
    case "if-let":
      return s.var;
    case "op-call":
    case "domain-service-call":
      return s.result?.name;
    case "precondition":
    case "requires":
    case "emit":
    case "repo-delete":
    case "resource-call":
    case "not-found":
    case "variant-match":
    case "assign":
      return undefined;
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      return undefined;
    }
  }
}

function verifyWorkflowBody(
  scope: BodyScope,
  stmts: readonly WorkflowStmtIR[],
  exprs: readonly (ExprIR | undefined)[],
  out: LoweringViolation[],
): void {
  const bindings = collectBindings([], exprs);
  const all: WorkflowStmtIR[] = [];
  for (const s of stmts) walkWorkflowStmtsDeep(s, (st) => all.push(st));
  for (const st of all) {
    const bound = workflowBinding(st);
    if (bound) bindings.lets.add(bound);
    for (const arm of st.kind === "variant-match" ? st.arms : [])
      if (arm.binding) bindings.matchBindings.add(arm.binding);
    walkWorkflowStmtOwnExprsDeep(st, (e) => {
      if (e.kind === "lambda") bindings.lambdas.add(e.param);
      for (const arm of e.kind === "match" ? e.variantArms : [])
        if (arm.binding) bindings.matchBindings.add(arm.binding);
      if (e.kind === "exists") bindings.rows.add(e.binding);
    });
    // A block-body lambda's statements bind too.
    walkWorkflowStmtOwnExprsDeep(st, (e) => {
      for (const s of e.kind === "lambda" ? (e.block ?? []) : [])
        walkStmtsDeep(s, (x) => {
          if (x.kind === "let") bindings.lets.add(x.name);
        });
    });
  }
  const report = (kind: LoweringViolationKind, detail: string, origin?: OriginRef) =>
    out.push({ kind, where: scope.where, detail, origin: origin ?? scope.origin });
  const checkExpr = (e: ExprIR) => verifyExpr(e, scope, bindings, report);
  for (const st of all) {
    // A violation inside a statement with no origin of its own points at the statement.
    const at: Report = (kind, detail, origin) => report(kind, detail, origin ?? st.origin);
    verifyWorkflowStmt(st, scope, bindings, at);
    walkWorkflowStmtOwnExprsDeep(st, (e) => verifyExpr(e, scope, bindings, at));
  }
  for (const e of exprs) if (e) walkExprDeep(e, checkExpr);
}
