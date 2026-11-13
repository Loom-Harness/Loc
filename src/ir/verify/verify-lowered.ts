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
  ComponentIR,
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
  PageIR,
  ParamIR,
  ProjectionIR,
  StmtIR,
  StoreIR,
  TestIR,
  TestStmtIR,
  TypeIR,
  ValueObjectIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { allContexts } from "../types/loom-ir.js";
import type { OriginRef } from "../types/origin.js";
import type { SystemIR } from "../types/system.js";
import {
  walkExprChildren,
  walkExprDeep,
  walkStmtChildren,
  walkStmtsDeep,
  walkTestStmtExprsDeep,
  walkWorkflowStmtOwnExprsDeep,
  walkWorkflowStmtsDeep,
} from "../util/walk.js";
import { VIEW_EFFECT_BUILTINS } from "../validate/checks/ui-checks-shared.js";

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
    /** Every context's enums (a sibling context's are folded in only at
     *  enrichment); a name declared twice merges its values. */
    enums: ReadonlyMap<string, ReadonlySet<string>>;
  };
}

function uniqueByName<T extends { name: string }>(xs: readonly T[]): Map<string, T | undefined> {
  const out = new Map<string, T | undefined>();
  for (const x of xs) out.set(x.name, out.has(x.name) ? undefined : x);
  return out;
}

function mergedEnums(enums: readonly EnumIR[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of enums) {
    const values = out.get(e.name) ?? new Set<string>();
    for (const v of e.values) values.add(v);
    out.set(e.name, values);
  }
  return out;
}

function indexModel(model: LoomModel): ContextIndex["modelWide"] {
  const ctxs = allContexts(model);
  const aggregates = ctxs.flatMap((c) => c.aggregates);
  return {
    aggregates: uniqueByName(aggregates),
    parts: uniqueByName(aggregates.flatMap((a) => a.parts)),
    valueObjects: uniqueByName([...model.rootValueObjects, ...ctxs.flatMap((c) => c.valueObjects)]),
    enums: mergedEnums([...model.rootEnums, ...ctxs.flatMap((c) => c.enums)]),
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
  /** Set for a page / component / store body, whose IR follows the walker's
   *  encoding (see `verifyUi`). */
  ui?: UiFacet;
}

/** What a ui (or test) body may name beyond its own bindings.  The page walker
 *  resolves a bare name itself — a declaration used as a call receiver
 *  (`Customer.findAll`, `S.Order.all`), a page, a store, a design token — so
 *  lowering leaves it `refKind: "unknown"` and the verifier makes no claim
 *  about it; and it reads an aggregate's operations and finds as members of
 *  the aggregate (`order.close`). */
interface UiFacet {
  /** Per aggregate: its operation and find names, readable as members. */
  operations: ReadonlyMap<string, ReadonlySet<string>>;
  /** The view-effect builtins (`navigate`, `toast`): lowered as
   *  `private-operation`-shaped call statements, resolved by the walker
   *  against the page's imports. */
  viewEffects: ReadonlySet<string>;
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
  outerLets: readonly string[] = [],
): void {
  const bindings = collectBindings(stmts, exprs);
  for (const n of outerLets) bindings.lets.add(n);
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
      const uiOps =
        e.receiverType.kind === "entity"
          ? scope.ui?.operations.get(e.receiverType.name)
          : undefined;
      if (members && !members.readable.has(e.member) && !uiOps?.has(e.member))
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
      if (
        !scope.index.enums.get(e.enumName)?.has(e.name) &&
        !scope.index.modelWide.enums.get(e.enumName)?.has(e.name)
      )
        miss(`value of enum ${e.enumName}`);
      return;
    case "unknown":
      // In a ui body a bare name is the page walker's to resolve — a
      // declaration used as a receiver, a page, a store, a design token.
      if (scope.ui) return;
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
      if (scope.ui?.viewEffects.has(s.name)) return;
      // A ui `function` called from an action body lowers to the same
      // `private-operation`-shaped statement; the walker binds it by name.
      if (scope.ui && scope.functions.has(s.name)) return;
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
    for (const p of ctx.projections) verifyProjection(p, index, out);
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
  for (const sys of model.systems) verifyUiBodies(model, sys, modelWide, out);
  verifyTests(model, modelWide, out);
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
  checkWorkflowBlocks(stmts, report);
  for (const st of all) {
    // A violation inside a statement with no origin of its own points at the statement.
    const at: Report = (kind, detail, origin) => report(kind, detail, origin ?? st.origin);
    if (st.kind === "expr-let" && st.name === UNLOWERED) {
      at("unlowered-statement", "a statement lowering has no form for");
      continue;
    }
    verifyWorkflowStmt(st, scope, bindings, at);
    walkWorkflowStmtOwnExprsDeep(st, (e) => verifyExpr(e, scope, bindings, at));
  }
  for (const e of exprs) if (e) walkExprDeep(e, checkExpr);
}

/** The placeholder `let` lowering leaves where a workflow / handler statement
 *  has no form (`src/ir/lower/lower-workflow.ts`); the IR validator refuses it
 *  by name, so it must never reach codegen. */
const UNLOWERED = "__bad__";

/** The statement blocks a workflow statement nests — each its own scope. */
function workflowChildBlocks(s: WorkflowStmtIR): (readonly WorkflowStmtIR[])[] {
  switch (s.kind) {
    case "for-each":
      return [s.body];
    case "if-let":
      return [s.thenBody, s.elseBody ?? []];
    case "variant-match":
      return [...s.arms.map((a) => a.body), s.elseBody ?? []];
    case "precondition":
    case "requires":
    case "emit":
    case "factory-let":
    case "repo-let":
    case "expr-let":
    case "repo-run":
    case "op-call":
    case "repo-delete":
    case "resource-call":
    case "domain-service-call":
    case "not-found":
    case "assign":
      return [];
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      return [];
    }
  }
}

/** No workflow statement block binds one name twice. */
function checkWorkflowBlocks(block: readonly WorkflowStmtIR[], report: Report): void {
  const seen = new Set<string>();
  for (const st of block) {
    const bound = st.kind === "expr-let" && st.name === UNLOWERED ? undefined : workflowBinding(st);
    // A `for` / `if let` variable scopes to the nested block, not this one.
    const blockScoped = st.kind === "for-each" || st.kind === "if-let";
    if (bound && !blockScoped) {
      if (seen.has(bound))
        report("duplicate-let", `\`let ${bound}\` is bound twice in one block`, st.origin);
      seen.add(bound);
    }
    for (const child of workflowChildBlocks(st)) checkWorkflowBlocks(child, report);
  }
}

// ---------------------------------------------------------------------------
// Ui bodies (pages, components, stores)
// ---------------------------------------------------------------------------

/** The ui facet of `sys`: each aggregate's operations and finds. */
function uiFacet(model: LoomModel, sys: SystemIR | undefined): UiFacet {
  const operations = new Map<string, Set<string>>();
  const ctxs = sys?.subdomains.flatMap((sd) => sd.contexts) ?? [];
  for (const ctx of [...ctxs, ...model.contexts]) {
    for (const a of ctx.aggregates)
      operations.set(
        a.name,
        new Set([...a.operations, ...a.creates, ...a.destroys].map((o) => o.name)),
      );
    for (const r of ctx.repositories) {
      const ops = operations.get(r.aggregateName);
      for (const f of r.finds) ops?.add(f.name);
    }
  }
  return { operations, viewEffects: VIEW_EFFECT_BUILTINS };
}

function verifyUiBodies(
  model: LoomModel,
  sys: SystemIR,
  modelWide: ContextIndex["modelWide"],
  out: LoweringViolation[],
): void {
  const ctxs = sys.subdomains.flatMap((sd) => sd.contexts);
  if (ctxs.length === 0 || sys.uis.length === 0) return;
  // A ui spans every context of its system; the model-wide maps resolve its
  // receivers' types.
  const index = indexContext(model, ctxs[0]!, modelWide);
  const ui = uiFacet(model, sys);
  for (const u of sys.uis) {
    const functions = names(u.functions);
    const hosts: (PageIR | ComponentIR | StoreIR)[] = [...u.pages, ...u.components, ...u.stores];
    for (const h of hosts) {
      const derived = "derived" in h ? h.derived : [];
      const params = "params" in h ? h.params : [];
      const stateNames = h.state.map((st) => ({ name: st.name }));
      const scope = (member: string, extra: readonly { name: string }[] = []): BodyScope => ({
        where: `${u.name}.${h.name}.${member}`,
        index,
        self: memberSet(stateNames as FieldIR[], [], derived),
        params: names([...params, ...extra]),
        functions,
        operations: new Set(),
        origin: "origin" in h ? h.origin : undefined,
        ui,
      });
      const page = h as Partial<PageIR>;
      verifyBody(
        scope("body"),
        [],
        [
          page.body,
          page.title,
          page.requires,
          ...h.state.map((st) => st.init),
          ...derived.map((d) => d.expr),
          ...paramDefaults(params),
        ],
        out,
        // State and derived values read as `let` refs in a ui body.
        [...h.state.map((st) => st.name), ...derived.map((d) => d.name)],
      );
      for (const a of h.actions)
        verifyBody(scope(`action ${a.name}`, a.params), a.body, [], out, [
          ...h.state.map((st) => st.name),
          ...derived.map((d) => d.name),
        ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Test bodies (unit, context integration, e2e)
// ---------------------------------------------------------------------------

function verifyTests(
  model: LoomModel,
  modelWide: ContextIndex["modelWide"],
  out: LoweringViolation[],
): void {
  const systemOf = new Map<BoundedContextIR, SystemIR>();
  for (const sys of model.systems)
    for (const c of sys.subdomains.flatMap((sd) => sd.contexts)) systemOf.set(c, sys);
  const facets = new Map<SystemIR | undefined, UiFacet>();
  const facetFor = (sys: SystemIR | undefined): UiFacet => {
    let f = facets.get(sys);
    if (!f) {
      f = uiFacet(model, sys);
      facets.set(sys, f);
    }
    return f;
  };
  const run = (where: string, index: ContextIndex, ui: UiFacet, tests: readonly TestIR[]) => {
    for (const t of tests) verifyTestBody(`${where}.test ${t.name}`, index, ui, t.statements, out);
  };
  for (const ctx of allContexts(model)) {
    const index = indexContext(model, ctx, modelWide);
    const ui = facetFor(systemOf.get(ctx));
    run(ctx.name, index, ui, ctx.tests);
    for (const a of ctx.aggregates) run(`${ctx.name}.${a.name}`, index, ui, a.tests);
    for (const v of ctx.valueObjects) run(`${ctx.name}.${v.name}`, index, ui, v.tests);
    for (const d of ctx.domainServices) run(`${ctx.name}.${d.name}`, index, ui, d.tests);
  }
  for (const sys of model.systems) {
    const ctx = sys.subdomains.flatMap((sd) => sd.contexts)[0];
    if (!ctx) continue;
    const index = indexContext(model, ctx, modelWide);
    for (const t of sys.e2eTests)
      verifyTestBody(`${sys.name}.e2e ${t.name}`, index, facetFor(sys), t.statements, out);
  }
}

function verifyTestBody(
  where: string,
  index: ContextIndex,
  ui: UiFacet,
  statements: readonly TestStmtIR[],
  out: LoweringViolation[],
): void {
  const exprs: ExprIR[] = [];
  const lets: string[] = [];
  for (const st of statements) {
    if (st.kind === "let") lets.push(st.name);
    walkTestStmtExprsDeep(st, (e) => exprs.push(e));
  }
  const scope: BodyScope = {
    where,
    index,
    params: new Set(),
    functions: new Set(),
    operations: new Set(),
    ui,
  };
  // The expressions are already flattened; check each node once, not its subtree.
  const bindings = collectBindings([], exprs);
  for (const n of lets) bindings.lets.add(n);
  const report = (kind: LoweringViolationKind, detail: string, origin?: OriginRef) =>
    out.push({ kind, where, detail, origin });
  for (const e of exprs) verifyExpr(e, scope, bindings, report);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function verifyProjection(p: ProjectionIR, index: ContextIndex, out: LoweringViolation[]): void {
  const where = `${index.ctx.name}.${p.name}`;
  // Fold handlers write the projection's own row.
  const self = memberSet(p.stateFields, [], []);
  for (const h of p.handlers) {
    verifyBody(
      {
        where: `${where}.on ${h.event}`,
        index,
        self,
        params: names([...p.params, { name: h.param }]),
        functions: new Set(),
        operations: new Set(),
        origin: p.origin,
      },
      h.statements,
      [h.correlation],
      out,
    );
  }
  const q = p.query;
  if (!q) return;
  // The query half reads the source row (its fields bare, or through its
  // alias) and each join alias.
  const sourceSelf = projectionSourceMembers(q, index);
  verifyBody(
    {
      where: `${where}.query`,
      index,
      self: sourceSelf,
      params: names(p.params),
      functions: new Set(),
      operations: new Set(),
      origin: p.origin,
    },
    [],
    [
      q.filter,
      q.requires,
      ...(q.criterionRef?.args ?? []),
      // An aggregation select carries its column as `aggregate.arg`; its
      // `expr` is the source spelling (a bare `count` is an unbound ref).
      ...(q.selects ?? []).map((s) => (s.aggregate ? s.aggregate.arg : s.expr)),
      ...(q.groupBy ?? []),
      ...q.joins.map((j) => j.idRef),
      ...paramDefaults(p.params),
    ],
    out,
    [...(q.sourceAlias ? [q.sourceAlias] : []), ...q.joins.map((j) => j.alias)],
  );
}

/** The row a projection query reads: an aggregate's members, or the state
 *  fields of the workflow / projection it selects from. */
function projectionSourceMembers(
  q: NonNullable<ProjectionIR["query"]>,
  index: ContextIndex,
): MemberSet | undefined {
  if (!q.source) return undefined;
  const ctxs = [index.ctx];
  const find = <T extends { name: string }>(pick: (c: BoundedContextIR) => readonly T[]) =>
    ctxs.flatMap(pick).find((x) => x.name === q.source);
  switch (q.sourceKind) {
    case "workflow": {
      const wf = find((c) => c.workflows);
      return wf ? memberSet(wf.stateFields, [], []) : undefined;
    }
    case "projection": {
      const pr = find((c) => c.projections);
      return pr ? memberSet(pr.stateFields, [], []) : undefined;
    }
    default: {
      const agg = index.aggregates.get(q.source) ?? index.modelWide.aggregates.get(q.source);
      return agg ? aggregateMembers(agg, index) : undefined;
    }
  }
}
