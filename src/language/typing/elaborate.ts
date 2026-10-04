// The single typing pass: one elaboration over the AST (M-T5.44 design §D4–D8).
//
// One walk per compilation unit visits EVERY node by reflection, so no
// container can be missed: there is no hand-kept list of "body roots" to
// forget an arm in. What a container BINDS is a table keyed by its `$type`
// (`enterNode`), and every statement list is a lexical block: a `let` binds
// into the block for the statements after it, never for the enclosing one.
// Each expression is typed exactly once, top-down, and its type is cached
// against its AST node (a memo of a pure function of the linked AST + the
// compilation unit's `DeclIndex` — derived, not stamped).
//
// This file is the SYNTH half (each expression's own type). Expected-type
// elaboration (literal promotion, enum retargeting) is the cutover slices'.

import type { AstNode } from "langium";
import type { PrimitiveName } from "../../ir/types/loom-ir.js";
import { isCollectionOp } from "../../util/collection-ops.js";
import { isIntrinsicMatcher } from "../../util/intrinsic-matchers.js";
import { intrinsicFor, intrinsicReturnType, isIntrinsicName } from "../../util/intrinsics.js";
import {
  ORG_CONTEXT_ACCESSOR,
  ORG_CONTEXT_ORG_PATH,
  PRINCIPAL_ORG_CONTEXT_PATH,
  PRINCIPAL_ORG_PATH,
  PRINCIPAL_ROOT_ORG,
} from "../../util/principal.js";
import { findVerb } from "../../util/resource-verbs.js";
import { durationUnitOf } from "../../util/temporal.js";
import { isWalkerPrimitive } from "../../util/walker-primitive-names.js";
import type {
  Aggregate,
  BinaryChain,
  BoundedContext,
  BuilderCall,
  CallArg,
  EntityPart,
  Expression,
  FunctionDecl,
  Lambda,
  MemberSuffix,
  Model,
  Operation,
  PostfixChain,
  PostfixSuffix,
  Projection,
  Property,
  Statement,
  TypeAtom,
  TypeRef,
  ValueObject,
  Workflow,
} from "../generated/ast.js";
import {
  isActionDecl,
  isActionType,
  isAggregate,
  isApply,
  isAwaitExpr,
  isBinaryChain,
  isBoolLit,
  isBoundedContext,
  isBuilderCall,
  isCallSuffix,
  isCommandHandler,
  isComponent,
  isContainment,
  isCreate,
  isCriterion,
  isDecLit,
  isDerivedProp,
  isDestroy,
  isDomainServiceOperation,
  isEntityPart,
  isEnumDecl,
  isEventDecl,
  isExpression,
  isFindDecl,
  isForStmt,
  isFunctionDecl,
  isHandleDecl,
  isIdRef,
  isIdType,
  isIfLetStmt,
  isIntLit,
  isLambda,
  isLetStmt,
  isListLit,
  isMatchExpr,
  isMatchStmt,
  isMemberSuffix,
  isNamedType,
  isNameRef,
  isNowExpr,
  isNullLit,
  isObjectLit,
  isOnDecl,
  isOperation,
  isPage,
  isParenExpr,
  isPayloadDecl,
  isPolicyDecl,
  isPostfixChain,
  isPrimitiveConversion,
  isPrimitiveType,
  isProjection,
  isProjectionOn,
  isProperty,
  isQueryHandler,
  isRepository,
  isRetrieval,
  isSlotType,
  isStateBlock,
  isStore,
  isStringLit,
  isTemplateStr,
  isTernaryExpr,
  isTestE2E,
  isThisRef,
  isUi,
  isUiNotification,
  isUnaryExpr,
  isValueObject,
  isWorkflow,
  isWorkflowCreateDecl,
} from "../generated/ast.js";
import { stdFunction } from "../stdlib.js";
import type { DeclIndex } from "./decl-index.js";
import { isPrim, mergeTags, type RecordShape, Ty, withTags } from "./ty.js";

// ---------------------------------------------------------------------------
// Scope model (design §D4): one persistent chain, built by the walk.
// ---------------------------------------------------------------------------

export type BindingKind =
  | "param"
  | "let"
  | "lambda"
  | "match"
  | "event-param"
  | "state"
  | "derived"
  | "action";

export interface Binding {
  ty: Ty;
  origin: AstNode;
  kind: BindingKind;
}

/** The container facts a scope inherits: who `this` is, which context names
 *  resolve against, whether this is a ui body. */
export interface Frame {
  owner?: Aggregate | EntityPart | ValueObject | Workflow | Projection;
  ctx?: BoundedContext;
  ui: boolean;
  /** `criterion … of T as <alias>` — a bare `<alias>` is `this`. */
  candidateAlias?: string;
  /** A `test e2e` body: ctx-less, bare domain names stay unresolved. */
  e2e: boolean;
  /** Inside a row-shaped walker primitive (`For` / `Table` / `DataGrid`): the
   *  row element type every context-less lambda in the body binds. */
  rowElem?: Ty;
  /** Inside a projection `select`: the whole-table aggregation operators
   *  (`count`, `sum(x)`, …) are in scope with the source table as receiver. */
  selectAggregates?: boolean;
}

export class Scope {
  readonly vars = new Map<string, Binding>();
  constructor(
    readonly parent: Scope | undefined,
    readonly frame: Frame,
  ) {}
  lookup(name: string): Binding | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
  child(frame?: Partial<Frame>): Scope {
    return new Scope(this, frame ? { ...this.frame, ...frame } : this.frame);
  }
  bind(name: string | undefined, ty: Ty, origin: AstNode, kind: BindingKind): void {
    if (name) this.vars.set(name, { ty, origin, kind });
  }
}

const ROOT_FRAME: Frame = { ui: false, e2e: false };

// ---------------------------------------------------------------------------
// The elaborator
// ---------------------------------------------------------------------------

export class Elaborator {
  /** The synthesized type of every expression (and of each postfix suffix:
   *  the receiver type AFTER that suffix). */
  readonly types = new WeakMap<AstNode, Ty>();
  /** The scope in force at each statement / expression root. */
  readonly scopes = new WeakMap<AstNode, Scope>();

  constructor(readonly index: DeclIndex) {}

  run(): void {
    for (const m of this.index.models) this.visit(m, new Scope(undefined, ROOT_FRAME));
  }

  // ---- the generic walk -------------------------------------------------

  private visit(node: AstNode, scope: Scope): void {
    if (this.types.has(node)) return;
    if (isExpression(node)) {
      this.synth(node, scope);
      return;
    }
    const inner = this.enterNode(node, scope);
    this.scopes.set(node, inner);
    if (isProjection(node)) {
      this.visitProjection(node, scope, inner);
      return;
    }
    // Binder-shaped statements thread their binding into SPECIFIC children.
    if (isIfLetStmt(node)) {
      const src = this.synth(node.source, inner);
      const then = inner.child();
      then.bind(node.var, src.kind === "optional" ? src.inner : src, node, "let");
      this.visitBlock(node.thenBody, then);
      this.visitBlock(node.elseBody, inner.child());
      return;
    }
    if (isForStmt(node)) {
      const it = this.synth(node.iterable, inner);
      const body = inner.child();
      body.bind(node.var, elementOf(it) ?? Ty.unknown("no-rule"), node, "let");
      this.visitBlock(node.body, body);
      return;
    }
    if (isMatchStmt(node)) {
      this.synth(node.subject, inner);
      for (const arm of node.varArms) {
        const armScope = inner.child();
        armScope.bind(arm.binding, this.resolveAtom(arm.varType, inner), arm, "match");
        this.visitBlock(arm.body, armScope);
      }
      this.visitBlock(node.elseBody, inner.child());
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (Array.isArray(value)) {
        if (value.length > 0 && isAstNode(value[0]))
          this.visitBlock(value as AstNode[], inner.child());
      } else if (isAstNode(value)) {
        this.visit(value, inner);
      }
    }
  }

  /** A projection's QUERY half (`from` / joins / `where` / `group by` /
   *  `select`) reads the SOURCE row, aliased like a criterion candidate, with
   *  the query params and each join alias bound in order; its `requires` gate
   *  sees only the context; its fold half (`on`, state fields) sees the
   *  projection row itself. */
  private visitProjection(p: Projection, outer: Scope, own: Scope): void {
    const src = p.source?.ref;
    const q = outer.child({
      owner: src ?? p,
      candidateAlias: src ? p.sourceAlias : undefined,
    });
    this.bindParams(q, p.params);
    for (const j of p.joins) {
      this.synth(j.idRef, q);
      const agg = j.aggregate?.ref;
      q.bind(
        j.alias,
        agg ? Ty.record({ of: "aggregate", ref: agg }) : Ty.unknown("unresolved-type"),
        j,
        "let",
      );
    }
    if (p.filter) this.synth(p.filter, q);
    for (const g of p.groupBys) this.synth(g, q);
    const sel = q.child({ selectAggregates: true });
    for (const s of p.selects) this.synth(s.expr, sel);
    if (p.gate) this.synth(p.gate, outer);
    this.visitBlock(p.members, own.child());
  }

  /** A list is a lexical block: a `let` binds for the siblings after it. */
  private visitBlock(nodes: readonly AstNode[], block: Scope): void {
    for (const n of nodes) {
      this.visit(n, block);
      if (isLetStmt(n))
        block.bind(n.name, this.types.get(n.expr) ?? Ty.unknown("no-rule"), n, "let");
    }
  }

  /** The binder table: what entering a node of each `$type` puts in scope. */
  private enterNode(node: AstNode, scope: Scope): Scope {
    if (isBoundedContext(node)) return scope.child({ ctx: node, ui: false });
    if (isUi(node)) return scope.child({ ui: true, ctx: undefined });
    if (isTestE2E(node)) return scope.child({ e2e: true, ctx: undefined, owner: undefined });
    if (isAggregate(node) || isEntityPart(node) || isValueObject(node) || isWorkflow(node)) {
      return scope.child({ owner: node, candidateAlias: undefined });
    }
    if (isProjection(node)) return scope.child({ owner: node, candidateAlias: undefined });
    if (isRepository(node)) {
      const agg = node.aggregate?.ref;
      return agg ? scope.child({ owner: agg }) : scope;
    }
    if (isCriterion(node) || isRetrieval(node)) {
      const target = this.resolveType(node.target, scope);
      const agg =
        target.kind === "record" && target.shape.of === "aggregate" ? target.shape.ref : undefined;
      const s = scope.child({
        owner: agg,
        candidateAlias: isCriterion(node) ? node.alias : undefined,
      });
      this.bindParams(s, node.params);
      return s;
    }
    if (
      isOperation(node) ||
      isCreate(node) ||
      isDestroy(node) ||
      isFunctionDecl(node) ||
      isDomainServiceOperation(node) ||
      isWorkflowCreateDecl(node) ||
      isHandleDecl(node) ||
      isCommandHandler(node) ||
      isQueryHandler(node) ||
      isFindDecl(node) ||
      isPolicyDecl(node) ||
      isActionDecl(node)
    ) {
      const s = scope.child();
      this.bindParams(s, (node as { params: { name: string; type: TypeRef }[] }).params);
      return s;
    }
    if (isOnDecl(node) || isApply(node) || isProjectionOn(node)) {
      const s = scope.child();
      const ev = node.event?.ref;
      if (ev) s.bind(node.param, Ty.record({ of: "event", ref: ev }), node, "event-param");
      return s;
    }
    if (isUiNotification(node)) {
      const s = scope.child();
      const ev = node.event?.ref;
      if (ev) s.bind(node.bind, Ty.record({ of: "event", ref: ev }), node, "event-param");
      return s;
    }
    if (isPage(node) || isComponent(node) || isStore(node)) {
      const s = scope.child();
      if (!isStore(node)) this.bindParams(s, node.params);
      const decls: AstNode[] = isPage(node) ? node.props : node.decls;
      // Route `:segments` bind as strings (the URL is text; every frontend reads it so).
      for (const d of decls) {
        if (d.$type !== "RouteProp") continue;
        for (const m of String((d as { value?: string }).value ?? "").matchAll(
          /:([A-Za-z_][A-Za-z0-9_]*)/g,
        )) {
          if (!s.lookup(m[1]!)) s.bind(m[1], Ty.prim("string"), d, "param");
        }
      }
      for (const d of decls) {
        if (isStateBlock(d))
          for (const f of d.fields) s.bind(f.name, this.resolveType(f.type, s), f, "state");
      }
      for (const d of decls) {
        if (isDerivedProp(d)) s.bind(d.name, this.resolveType(d.type, s), d, "derived");
      }
      for (const d of decls) {
        if (isActionDecl(d)) {
          const p = d.params[0];
          s.bind(
            d.name,
            { kind: "action", ...(p ? { arg: this.resolveType(p.type, s) } : {}) },
            d,
            "action",
          );
        }
      }
      return s;
    }
    return scope;
  }

  private bindParams(
    s: Scope,
    params: readonly { name: string; type: TypeRef }[] | undefined,
  ): void {
    for (const p of params ?? [])
      s.bind(p.name, this.resolveType(p.type, s), p as unknown as AstNode, "param");
  }

  // ---- types ------------------------------------------------------------

  resolveType(t: TypeRef | undefined, scope: Scope | undefined): Ty {
    if (!t) return Ty.unknown("unresolved-type");
    const head = this.resolveAtom(t, scope);
    const alts = (t.alternatives ?? []) as TypeAtom[];
    if (alts.length === 0) return head;
    return Ty.union([head, ...alts.map((a) => this.resolveAtom(a, scope))]);
  }

  resolveAtom(t: TypeRef | TypeAtom, scope: Scope | undefined): Ty {
    let inner = this.resolveBase(t, scope);
    for (const ctor of t.ctors ?? []) {
      inner =
        ctor === "option" ? Ty.union([inner, Ty.none]) : { kind: "generic", ctor, arg: inner };
    }
    if (t.array) inner = Ty.array(inner);
    if (t.optional) inner = Ty.opt(inner);
    return inner;
  }

  private resolveBase(t: TypeRef | TypeAtom, scope: Scope | undefined): Ty {
    const base = t.base;
    if (isPrimitiveType(base)) return Ty.prim(base.name as PrimitiveName);
    if (isSlotType(base)) return { kind: "slot" };
    if (isActionType(base))
      return base.arg
        ? { kind: "action", arg: this.resolveType(base.arg, scope) }
        : { kind: "action" };
    if (isIdType(base)) {
      const target = base.target?.ref;
      const name = target?.name ?? base.target?.$refText ?? "Unknown";
      if (target && (isAggregate(target) || isEntityPart(target)))
        return { kind: "id", target, name };
      if (!target && name === "User") {
        // `User id` — the principal's id scalar, not a domain aggregate.
        const idField = this.index.userBlock()?.fields.find((f) => f.name === "id");
        if (idField) return this.resolveType(idField.type, scope);
      }
      const byName =
        this.index.find("aggregate", name, base) ?? this.index.find("part", name, base);
      return { kind: "id", target: byName, name };
    }
    if (isNamedType(base)) {
      const target = base.target?.ref;
      const from: AstNode = base;
      const name = target?.name ?? base.target?.$refText;
      if (!name) return Ty.unknown("unresolved-type");
      const decl =
        target ??
        this.index.find("valueobject", name, from) ??
        this.index.find("enum", name, from) ??
        this.index.find("aggregate", name, from) ??
        this.index.find("part", name, from) ??
        this.index.find("event", name, from) ??
        this.index.find("payload", name, from);
      if (!decl) return Ty.unknown("unresolved-type");
      if (isEnumDecl(decl)) return { kind: "enum", ref: decl, name };
      if (isValueObject(decl)) return { kind: "valueobject", ref: decl, name };
      if (isAggregate(decl)) return Ty.record({ of: "aggregate", ref: decl });
      if (isEntityPart(decl)) return Ty.record({ of: "part", ref: decl });
      if (isEventDecl(decl)) return Ty.record({ of: "event", ref: decl });
      if (isPayloadDecl(decl)) return Ty.record({ of: "payload", ref: decl });
      return Ty.unknown("unresolved-type");
    }
    return Ty.unknown("unresolved-type");
  }

  private propertyType(p: Property, scope: Scope | undefined): Ty {
    const tags = p.sensitivity?.tags;
    return withTags(
      this.resolveType(p.type, scope),
      tags && tags.length > 0 ? [...tags].sort() : undefined,
    );
  }

  // ---- synth: an expression's own type -----------------------------------

  synth(e: Expression | undefined, scope: Scope): Ty {
    if (!e) return Ty.unknown("parse-broken");
    const cached = this.types.get(e);
    if (cached) return cached;
    this.scopes.set(e, scope);
    let t = this.synthInner(e, scope);
    if (t.kind === "optional") t = this.narrowed(e, t);
    this.types.set(e, t);
    return t;
  }

  private synthInner(e: Expression, scope: Scope): Ty {
    if (isStringLit(e)) return Ty.prim("string");
    if (isTemplateStr(e)) {
      for (const h of e.holes) this.synth(h.value, scope);
      return Ty.prim("string");
    }
    if (isIntLit(e)) return Ty.prim("int");
    if (isDecLit(e)) return Ty.prim("decimal");
    if (isBoolLit(e)) return Ty.prim("bool");
    if (isNullLit(e)) return Ty.opt(Ty.never);
    if (isNowExpr(e)) return Ty.prim("datetime");
    if (isPrimitiveConversion(e)) {
      this.synth(e.value, scope);
      return Ty.prim(e.target as PrimitiveName);
    }
    if (isThisRef(e)) return this.thisType(scope) ?? Ty.unknown("unresolved-name");
    if (isIdRef(e)) {
      const bound = scope.lookup("id");
      if (bound) return bound.ty;
      const owner = scope.frame.owner;
      if (owner && !isValueObject(owner)) return { kind: "id", target: owner, name: owner.name };
      return Ty.unknown("unresolved-name");
    }
    if (isParenExpr(e)) return this.synth(e.inner, scope);
    if (isAwaitExpr(e)) return this.synth(e.inner, scope);
    if (isUnaryExpr(e)) {
      const t = this.synth(e.operand, scope);
      return e.op === "!" ? Ty.prim("bool") : t;
    }
    if (isBinaryChain(e)) return this.synthBinary(e, scope);
    if (isTernaryExpr(e)) {
      this.synth(e.cond, scope);
      const a = this.synth(e.thenExpr, scope);
      const b = this.synth(e.elseExpr, scope);
      return withTags(join(a, b) ?? a, mergeTags(a.sensitivity, b.sensitivity));
    }
    if (isMatchExpr(e)) {
      let acc: Ty | undefined;
      const fold = (t: Ty) => {
        acc = acc === undefined ? t : (join(acc, t) ?? acc);
      };
      if (e.subject) this.synth(e.subject, scope);
      for (const arm of e.arms) {
        this.synth(arm.cond, scope);
        fold(this.synth(arm.value, scope));
      }
      for (const arm of e.varArms) {
        const armScope = scope.child();
        armScope.bind(arm.binding, this.resolveAtom(arm.varType, scope), arm, "match");
        fold(this.synth(arm.value, armScope));
      }
      if (e.elseExpr) fold(this.synth(e.elseExpr, scope));
      return acc ?? Ty.unknown("no-rule");
    }
    if (isLambda(e)) return this.synthLambda(e, scope, scope.frame.rowElem).self;
    if (isListLit(e)) {
      let acc: Ty | undefined;
      for (const el of e.elements) {
        const t = this.synth(el, scope);
        acc = acc === undefined ? t : (join(acc, t) ?? acc);
      }
      return Ty.array(acc ?? Ty.never);
    }
    if (isObjectLit(e)) {
      for (const f of e.fields) this.synth(f.value, scope);
      return Ty.unknown("no-rule");
    }
    if (isBuilderCall(e)) return this.synthBuilder(e, scope);
    if (isPostfixChain(e)) return this.synthChain(e, scope);
    if (isNameRef(e)) return this.synthName(e.name, scope, e);
    // RetrievalLiteral and anything newer: type the children, report the gap.
    for (const [k, v] of Object.entries(e)) {
      if (k.startsWith("$")) continue;
      if (Array.isArray(v)) for (const x of v) if (isAstNode(x)) this.visit(x, scope);
      if (isAstNode(v)) this.visit(v, scope);
    }
    return Ty.unknown("no-rule");
  }

  /** The type `this` denotes in `scope`. */
  private thisType(scope: Scope): Ty | undefined {
    const o = scope.frame.owner;
    if (!o) return undefined;
    if (isAggregate(o)) return Ty.record({ of: "aggregate", ref: o });
    if (isEntityPart(o)) return Ty.record({ of: "part", ref: o });
    if (isValueObject(o)) return { kind: "valueobject", ref: o, name: o.name };
    if (isWorkflow(o)) return Ty.record({ of: "workflow", ref: o });
    return Ty.record({ of: "projection", ref: o });
  }

  // ---- names --------------------------------------------------------------

  private synthName(name: string, scope: Scope, node: AstNode): Ty {
    const f = scope.frame;
    // The principal — unshadowable when the unit declares a claim block.
    const user = this.index.userBlock();
    if (name === "currentUser" && user) return Ty.record({ of: "principal", ref: user });
    // Ambient resource handles serving this context — unshadowable.
    const res = this.index.resourcesFor(f.ctx).find((r) => r.name === name);
    if (res) return Ty.record({ of: "resource", ref: res });
    if (f.candidateAlias && name === f.candidateAlias)
      return this.thisType(scope) ?? Ty.unknown("unresolved-name");
    const local = scope.lookup(name);
    if (local) return local.ty;
    // `test e2e` call roots are resolved at render time against the target
    // deployable; typing them is cutover family 3f's (a pass gap, not an
    // author error).
    if (f.e2e && (name === "api" || name === "ui")) return Ty.unknown("no-rule");
    const member = f.owner ? this.ownerMember(f.owner, name, scope) : undefined;
    if (member) return member;
    // A store named as a value (`Cart.lines` heads resolve here).
    if (f.ui) {
      const store = this.storeNamed(name, node);
      if (store) return Ty.record({ of: "store", ref: store });
    }
    // A criterion / policy function named bare is a predicate; a missing
    // argument list is an arity error the validator reports, not a type hole.
    if (this.index.find("criterion", name, node) || this.index.find("policy", name, node)) {
      return Ty.prim("bool");
    }
    if (f.selectAggregates && name === "count") return Ty.prim("int");
    if ((f.ctx || f.ui) && !f.e2e) {
      const enums = this.index.enumsDeclaringValue(name, node);
      const e = enums[0];
      if (e) return { kind: "enum", ref: e, name: e.name };
    }
    if (name === "currentUser" || name === ORG_CONTEXT_ACCESSOR)
      return Ty.record({ of: "principal", ref: user });
    // A declaration named in value position (`OperationForm(of: Order, …)`,
    // a chain head): it denotes the declaration, not a value.
    if (this.namesDeclaration(name, node)) return Ty.unknown("not-a-value");
    return Ty.unknown("unresolved-name");
  }

  private namesDeclaration(name: string, node: AstNode): boolean {
    const kinds = [
      "aggregate",
      "part",
      "valueobject",
      "enum",
      "event",
      "payload",
      "workflow",
      "projection",
      "repository",
      "service",
      "criterion",
      "retrieval",
    ] as const;
    if (kinds.some((k) => this.index.find(k, name, node))) return true;
    return (
      this.apiParamNamed(name, node) ||
      this.componentNamed(name, node) ||
      this.storeNamed(name, node) !== undefined
    );
  }

  /** A bare name resolved against the enclosing owner's members (inherited
   *  through `extends` — own members shadow the base's). */
  private ownerMember(
    owner: Aggregate | EntityPart | ValueObject | Workflow | Projection,
    name: string,
    scope: Scope,
  ): Ty | undefined {
    for (const o of ownerChain(owner)) {
      for (const m of o.members as AstNode[]) {
        if ((m as { name?: string }).name !== name) continue;
        if (isProperty(m)) return this.propertyType(m, scope);
        if (isContainment(m)) {
          const part = m.partType?.ref;
          if (!part) return Ty.unknown("unresolved-type");
          const t = Ty.record({ of: "part", ref: part });
          return m.collection ? Ty.array(t) : t;
        }
        if (isDerivedProp(m)) return this.resolveType(m.type, scope);
      }
    }
    return undefined;
  }

  private componentNamed(name: string, node: AstNode): boolean {
    for (let c: AstNode | undefined = node; c; c = c.$container) {
      if (isUi(c)) return c.members.some((m) => isComponent(m) && m.name === name);
      if (c.$type === "Model") {
        return (c as Model).members.some((m) => isComponent(m) && m.name === name);
      }
    }
    return false;
  }

  private storeNamed(name: string, node: AstNode): import("../generated/ast.js").Store | undefined {
    for (let c: AstNode | undefined = node; c; c = c.$container) {
      if (isUi(c)) return c.members.find((m) => isStore(m) && m.name === name) as never;
    }
    return undefined;
  }

  // ---- operators ------------------------------------------------------------

  private synthBinary(e: BinaryChain, scope: Scope): Ty {
    const head = this.synth(e.head, scope);
    const rest = e.rest.map((r) => this.synth(r, scope));
    if (e.ops[0] === "??") {
      const bare = head.kind === "optional" ? head.inner : head;
      const fallback = rest[rest.length - 1]!;
      return join(bare, fallback) ?? bare;
    }
    let acc = head;
    for (let i = 0; i < e.ops.length; i++) {
      const op = e.ops[i]!;
      if (["&&", "||", "==", "!=", "<", "<=", ">", ">="].includes(op)) return Ty.prim("bool");
      acc = arithmetic(acc, rest[i]!, op);
    }
    return acc;
  }

  // ---- builders -------------------------------------------------------------

  private synthBuilder(e: BuilderCall, scope: Scope): Ty {
    const name = e.type;
    const isPrimitive =
      isWalkerPrimitive(name) && !(this.index.find("valueobject", name, e) && !scope.frame.ui);
    if (isPrimitive) this.synthPrimitiveArgs(name, e.entries, scope, e);
    else for (const entry of e.entries) this.synth(entry.value, scope);
    if (scope.frame.ui && isWalkerPrimitive(name)) return { kind: "slot" };
    const vo = this.index.find("valueobject", name, e);
    if (vo) return { kind: "valueobject", ref: vo, name };
    const agg = this.index.find("aggregate", name, e);
    if (agg) return Ty.record({ of: "aggregate", ref: agg });
    const part = this.index.find("part", name, e);
    if (part) return Ty.record({ of: "part", ref: part });
    const ev = this.index.find("event", name, e);
    if (ev) return Ty.record({ of: "event", ref: ev });
    const pl = this.index.find("payload", name, e);
    if (pl) return Ty.record({ of: "payload", ref: pl });
    // A walker primitive or a user component builds a ui element.
    if (isWalkerPrimitive(name) || scope.frame.ui) return { kind: "slot" };
    return Ty.unknown("unresolved-name");
  }

  /** A walker primitive's arguments (builder `{ … }` or call `( … )` form). A
   *  row-shaped primitive binds its collection argument's element for every
   *  context-less lambda in its body; `QueryView`'s `data:` lambda binds the
   *  read result its `of:` names. */
  private synthPrimitiveArgs(
    name: string,
    entries: readonly { name?: string; value: Expression }[],
    scope: Scope,
    at: AstNode,
  ): void {
    let body = scope;
    const rowArg = ROW_SOURCE_ARG[name];
    if (rowArg) {
      const source =
        entries.find((x) => x.name === rowArg) ??
        entries.find((x) => !x.name && !isLambda(x.value));
      const el = source ? elementOf(this.synth(source.value, scope)) : undefined;
      if (el) body = scope.child({ rowElem: el });
    }
    let queryResult = name === "QueryView" ? this.queryResultType(entries, scope) : undefined;
    // `paged: true` — the read answers one page: the `data:` lambda binds the
    // `Paged<T>` envelope (`rows.items`, `rows.totalPages`), not the list.
    const paged = entries.find((x) => x.name === "paged")?.value;
    if (queryResult?.kind === "array" && paged && isBoolLit(paged) && paged.value === "true") {
      queryResult = { kind: "generic", ctor: "paged", arg: queryResult.element };
    }
    void at;
    for (const entry of entries) {
      if (queryResult && entry.name === "data" && isLambda(entry.value))
        this.synthLambda(entry.value, body, queryResult);
      else this.synth(entry.value, body);
    }
  }

  /** The record / list a `QueryView { of: <handle>.<Agg>.<verb>(…) }` reads. */
  private queryResultType(
    entries: readonly { name?: string; value: Expression }[],
    scope: Scope,
  ): Ty | undefined {
    const of = entries.find((x) => x.name === "of")?.value;
    if (!of || !isPostfixChain(of)) return undefined;
    this.synth(of, scope);
    const t = this.apiReadType(of, scope);
    return t?.kind === "optional" ? t.inner : t;
  }

  private apiParamNamed(name: string, node: AstNode): boolean {
    for (let c: AstNode | undefined = node; c; c = c.$container) {
      if (isUi(c))
        return c.members.some(
          (m) => m.$type === "UiApiParam" && (m as { name?: string }).name === name,
        );
    }
    return false;
  }

  /** The value a ui-side read `<handle>.<Agg>.<verb>(…)` (or
   *  `<handle>.<Projection>`) yields — the aggregate is the LAST suffix naming
   *  one, the verb the suffix after it. */
  private apiReadType(of: PostfixChain, scope: Scope): Ty | undefined {
    // The path segments: the head name, then each member suffix.
    const segs: string[] = [isNameRef(of.head) ? of.head.name : ""];
    for (const s of of.suffixes) if (isMemberSuffix(s)) segs.push(String(s.member));
    for (let i = segs.length - 1; i >= 0; i--) {
      const m = segs[i]!;
      if (!m) continue;
      const verb = segs[i + 1];
      const agg = this.index.find("aggregate", m, of);
      if (agg) {
        const row = Ty.record({ of: "aggregate", ref: agg });
        if (verb === undefined || verb === "all" || verb === "findAll") return Ty.array(row);
        if (verb === "byId") return row;
        const repo = this.repositoryFor(agg);
        const find = repo?.finds.find((f) => f.name === verb);
        if (find) return this.resolveType(find.returnType, scope);
        return Ty.array(row);
      }
      const proj = this.index.find("projection", m, of);
      if (proj) {
        if (i !== segs.length - 1) return undefined;
        const shape = projectionReadShape(proj);
        if (!shape) return undefined;
        const row = Ty.record({ of: "projection", ref: proj });
        return shape === "many" ? Ty.array(row) : row;
      }
      const wf = this.index.find("workflow", m, of);
      if (wf && verb === "instances") {
        const row = Ty.record({ of: "workflow", ref: wf });
        const op = segs[i + 2];
        return op === "byId" ? row : Ty.array(row);
      }
    }
    return undefined;
  }

  private repositoryFor(agg: Aggregate): import("../generated/ast.js").Repository | undefined {
    const ctx = agg.$container;
    return ctx.members.find((m) => isRepository(m) && m.aggregate?.ref === agg) as never;
  }

  // ---- lambdas --------------------------------------------------------------

  /** Elaborate a lambda whose parameter has type `param` (undefined when the
   *  context gives none). Returns the lambda's own type and its body's type. */
  private synthLambda(e: Lambda, scope: Scope, param: Ty | undefined): { self: Ty; body?: Ty } {
    const inner = scope.child();
    inner.bind(e.param, param ?? Ty.unknown("contextual-lambda"), e, "lambda");
    let body: Ty | undefined;
    if (e.body) body = this.synth(e.body, inner);
    else this.visitBlock(e.stmts, inner.child());
    const self: Ty = param ? { kind: "action", arg: param } : Ty.unknown("contextual-lambda");
    this.scopes.set(e, scope);
    this.types.set(e, self);
    return { self, body };
  }

  /** Elaborate call args; a lambda arg gets `lambdaParam` as its parameter type. */
  private synthArgs(args: readonly CallArg[], scope: Scope, lambdaParam?: Ty): (Ty | undefined)[] {
    return args.map((a) => {
      if (isLambda(a.value)) return this.synthLambda(a.value, scope, lambdaParam).body;
      return this.synth(a.value, scope);
    });
  }

  // ---- postfix chains ---------------------------------------------------------

  private synthChain(e: PostfixChain, scope: Scope): Ty {
    const first = e.suffixes[0];
    const headName = isNameRef(e.head) ? e.head.name : undefined;
    let cur: Ty | undefined;
    let start = 0;
    if (headName !== undefined && first) {
      const head = this.chainHead(e, headName, first, scope);
      cur = head?.t;
      if (head) {
        if (isNameRef(e.head) && !this.types.has(e.head)) {
          // The head NAME of a call / repository / service / store chain is not
          // a value of its own; record what it names for the LSP.
          this.types.set(e.head, this.headNameType(headName, scope, e.head));
        }
        this.types.set(first, head.t);
        start = head.consumed;
        if (start > 1) this.types.set(e.suffixes[start - 1]!, head.t);
      }
    }
    if (!cur) cur = this.synth(e.head, scope);
    for (let i = start; i < e.suffixes.length; i++) {
      const s = e.suffixes[i]!;
      cur = this.afterSuffix(cur, s, scope);
      this.types.set(s, cur);
    }
    return cur;
  }

  /** The type a head name denotes when it is NOT a value (an aggregate,
   *  repository, service or store name before `.`). */
  private headNameType(name: string, scope: Scope, node: AstNode): Ty {
    const t = this.synthName(name, scope, node);
    return t.kind === "unknown" ? Ty.unknown("not-a-value") : t;
  }

  /** The head-name + first-suffix forms that are not "a value, then a member":
   *  free calls, `Agg.create(…)`, repository reads, domain-service calls,
   *  `permissions.x`, store fields. Undefined when the chain is ordinary. */
  private chainHead(
    e: PostfixChain,
    name: string,
    first: PostfixSuffix,
    scope: Scope,
  ): { t: Ty; consumed: number } | undefined {
    const t = this.chainHeadType(e, name, first, scope);
    if (t === undefined) return undefined;
    return { t: t.t, consumed: t.consumed };
  }

  private chainHeadType(
    e: PostfixChain,
    name: string,
    first: PostfixSuffix,
    scope: Scope,
  ): { t: Ty; consumed: number } | undefined {
    const node = e.head;
    // A value of that name in scope wins over every declaration-name form.
    const shadowed = scope.lookup(name) !== undefined;
    if (isCallSuffix(first)) {
      const args = first.args;
      const t = this.freeCall(name, scope, node, args);
      if (scope.frame.ui && t.kind === "slot" && isWalkerPrimitive(name)) {
        this.synthPrimitiveArgs(name, args, scope, node);
      } else this.synthArgs(args, scope);
      return { t: t, consumed: 1 };
    }
    if (!isMemberSuffix(first) || shadowed) return undefined;
    const ms = first;
    const readHead =
      this.apiParamNamed(name, node) ||
      this.index.find("aggregate", name, node) ||
      this.index.find("projection", name, node) ||
      this.index.find("workflow", name, node);
    if (scope.frame.ui && readHead) {
      // The read consumes the whole chain: its suffixes are path segments, not
      // member accesses on a value.
      for (const s of e.suffixes) if (isMemberSuffix(s) && s.call) this.synthArgs(s.args, scope);
      for (const s of e.suffixes.slice(1)) this.types.set(s, Ty.unknown("not-a-value"));
      return {
        t: this.apiReadType(e, scope) ?? Ty.unknown("no-rule"),
        consumed: e.suffixes.length,
      };
    }
    if (name === "permissions" && !ms.call && !scope.lookup("permissions")) {
      const perms = this.permissionsVisible(node);
      if (perms) return { t: Ty.prim("string"), consumed: 1 };
    }
    if (!ms.call) {
      const en = this.index.find("enum", name, node);
      if (en?.values.some((v) => v.name === ms.member))
        return { t: { kind: "enum", ref: en, name: en.name }, consumed: 1 };
    }
    if (ms.call && ms.member === "create") {
      const agg = this.index.find("aggregate", name, node);
      if (agg) {
        this.synthArgs(ms.args, scope);
        return { t: Ty.record({ of: "aggregate", ref: agg }), consumed: 1 };
      }
    }
    if (ms.call) {
      const repo = this.index.find("repository", name, node);
      if (repo && !this.index.find("aggregate", name, node)) {
        const agg = repo.aggregate?.ref;
        this.synthArgs(ms.args, scope);
        return {
          t: agg ? this.repoReadType(repo, agg, ms, scope) : Ty.unknown("unresolved-type"),
          consumed: 1,
        };
      }
      const svc = this.index.find("service", name, node);
      if (svc) {
        this.synthArgs(ms.args, scope);
        const op = svc.operations.find((o) => o.name === ms.member);
        if (!op) return { t: Ty.unknown("unresolved-member"), consumed: 1 };
        return {
          t: op.returnType ? this.resolveType(op.returnType, scope) : Ty.never,
          consumed: 1,
        };
      }
    }
    return undefined;
  }

  private permissionsVisible(node: AstNode): boolean {
    for (let c: AstNode | undefined = node; c; c = c.$container) {
      const perms = (c as { permissions?: unknown[] }).permissions;
      if (Array.isArray(perms) && perms.length > 0) return true;
      if ((c as { $type?: string }).$type === "Module") return true;
    }
    return false;
  }

  /** The value a repository read yields — ONE rule for every container
   *  (the IR's `repoReadResultType`: union-aware declared finds, `getById` is
   *  the row, `findById`/`find` are optional, `findAll`/`all`/`run` are lists). */
  private repoReadType(
    repo: import("../generated/ast.js").Repository,
    agg: Aggregate,
    ms: MemberSuffix,
    scope: Scope,
  ): Ty {
    const row = Ty.record({ of: "aggregate", ref: agg });
    const declared = repo.finds.find((f) => f.name === ms.member);
    if (declared) return this.resolveType(declared.returnType, scope);
    switch (ms.member) {
      case "getById":
        return row;
      case "findById":
      case "find":
        return Ty.opt(row);
      case "findAll":
      case "all":
      case "run":
        return Ty.array(row);
      default:
        return Ty.unknown("unresolved-member");
    }
  }

  /** `name(args)` with no receiver. Shadowing order: a local function, a
   *  same-owner operation, a value-object constructor, a criterion / policy
   *  predicate, a top-level or stdlib function, a duration builtin. */
  private freeCall(name: string, scope: Scope, node: AstNode, args: readonly CallArg[] = []): Ty {
    if (scope.frame.selectAggregates && ["count", "sum", "avg", "min", "max"].includes(name)) {
      if (name === "count") return Ty.prim("int");
      const col = args[0] ? this.synth(args[0].value, scope) : Ty.unknown("no-rule");
      if (name === "avg") {
        const bare = col.kind === "optional" ? col.inner : col;
        return Ty.prim(isPrim(bare, "money") ? "money" : "decimal");
      }
      return col;
    }
    const local = scope.lookup(name);
    if (local?.kind === "action") return Ty.never;
    const owner = scope.frame.owner;
    if (owner) {
      for (const o of ownerChain(owner)) {
        for (const m of o.members as AstNode[]) {
          if (isFunctionDecl(m) && m.name === name) return this.resolveType(m.returnType, scope);
          if (isOperation(m) && m.name === name) {
            return m.returnType ? this.resolveType(m.returnType, scope) : Ty.never;
          }
        }
      }
    }
    const vo = this.index.find("valueobject", name, node);
    if (vo) return { kind: "valueobject", ref: vo, name };
    if (this.index.find("criterion", name, node) || this.index.find("policy", name, node)) {
      return Ty.prim("bool");
    }
    const fn: FunctionDecl | undefined =
      this.index.find("function", name, node) ?? stdFunction(name);
    if (fn) return this.resolveType(fn.returnType, scope);
    if (durationUnitOf(name)) return Ty.prim("duration");
    // A walker primitive / user component invoked in call form builds a ui element.
    if (scope.frame.ui && (isWalkerPrimitive(name) || this.componentNamed(name, node)))
      return { kind: "slot" };
    return Ty.unknown("unresolved-name");
  }

  /** The receiver type after one postfix suffix. */
  private afterSuffix(recv: Ty, s: PostfixSuffix, scope: Scope): Ty {
    const t = this.afterSuffixInner(recv, s, scope);
    // Every argument is typed, whether or not the member resolved.
    if (isMemberSuffix(s) && s.call) {
      for (const a of s.args) if (!this.types.has(a.value)) this.synth(a.value, scope);
    }
    // An assertion matcher (`expect(x).toBe(y)`) is a statement, not a value.
    if (t.kind === "unknown" && isMemberSuffix(s) && s.call && isIntrinsicMatcher(s.member))
      return Ty.never;
    return t;
  }

  private afterSuffixInner(recv: Ty, s: PostfixSuffix, scope: Scope): Ty {
    if (isCallSuffix(s)) {
      this.synthArgs(s.args, scope);
      return Ty.unknown("no-rule");
    }
    const ms = s as MemberSuffix;
    const name = ms.member;
    const tags = recv.sensitivity;
    // Scalar intrinsics and collection ops read through ONE optional level
    // (the validator owns whether the unguarded read is legal).
    const bare = recv.kind === "optional" ? recv.inner : recv;
    if (bare.kind === "array") return this.collectionOp(bare.element, ms, scope);
    if (ms.call && bare.kind !== "record" && bare.kind !== "valueobject")
      this.synthArgs(ms.args, scope);
    switch (recv.kind) {
      case "record":
        return this.recordMember(recv.shape, ms, scope);
      case "generic":
        return genericMember(recv.ctor, recv.arg, name) ?? Ty.unknown("unresolved-member");
      case "valueobject": {
        if (!recv.ref) return Ty.unknown("unresolved-type");
        const t = this.memberOf(recv.ref, ms, scope);
        return t ?? Ty.unknown("unresolved-member");
      }
      case "id": {
        if (name === "id") return recv;
        const target = recv.target;
        if (!target) return Ty.unknown("unresolved-type");
        return this.memberOf(target, ms, scope) ?? Ty.unknown("unresolved-member");
      }
      case "primitive":
      case "optional": {
        const p = bare.kind === "primitive" ? bare.name : undefined;
        if (!p) return Ty.unknown("unresolved-member");
        if (p === "string" && name === "length") return withTags(Ty.prim("int"), tags);
        if (p === "string" && name === "matches") return Ty.prim("bool");
        const sig = intrinsicFor(p, name);
        if (sig) {
          const ret = intrinsicReturnType(sig, p);
          if (ret.endsWith("[]")) return Ty.array(Ty.prim(ret.slice(0, -2) as PrimitiveName));
          return Ty.prim(ret as PrimitiveName);
        }
        return Ty.unknown("unresolved-member");
      }
      default:
        return recv.kind === "unknown" ? recv : Ty.unknown("unresolved-member");
    }
  }

  private recordMember(shape: RecordShape, ms: MemberSuffix, scope: Scope): Ty {
    const name = ms.member;
    switch (shape.of) {
      case "aggregate":
      case "part":
      case "workflow":
      case "projection":
        return this.memberOf(shape.ref, ms, scope) ?? Ty.unknown("unresolved-member");
      case "event":
      case "payload": {
        const f = shape.ref.fields.find((x) => x.name === name);
        return f ? this.propertyType(f, scope) : Ty.unknown("unresolved-member");
      }
      case "principal": {
        if (
          name === PRINCIPAL_ORG_PATH ||
          name === PRINCIPAL_ROOT_ORG ||
          name === PRINCIPAL_ORG_CONTEXT_PATH ||
          name === ORG_CONTEXT_ORG_PATH
        ) {
          return Ty.prim("string");
        }
        const f = shape.ref?.fields.find((x) => x.name === name);
        return f ? this.resolveType(f.type, scope) : Ty.unknown("unresolved-member");
      }
      case "resource": {
        this.synthArgs(ms.args, scope);
        const kind = shape.ref.kind;
        const verb = kind ? findVerb(kind, name) : undefined;
        if (!verb) return Ty.unknown("unresolved-member");
        switch (verb.result) {
          case "json":
            return Ty.prim("json");
          case "json?":
            return Ty.opt(Ty.prim("json"));
          case "string":
            return Ty.prim("string");
          case "string[]":
            return Ty.array(Ty.prim("string"));
          default:
            return Ty.never;
        }
      }
      case "store": {
        if (ms.call) {
          this.synthArgs(ms.args, scope);
          return Ty.never;
        }
        for (const d of shape.ref.decls) {
          if (isStateBlock(d)) {
            const f = d.fields.find((x) => x.name === name);
            if (f) return this.resolveType(f.type, scope);
          }
        }
        return Ty.unknown("unresolved-member");
      }
      default: {
        const _exhaustive: never = shape;
        return _exhaustive;
      }
    }
  }

  /** A member of a declaration with `members` (aggregate — through its
   *  `extends` chain — part, value object, workflow, projection). */
  private memberOf(
    target: Aggregate | EntityPart | ValueObject | Workflow | Projection,
    ms: MemberSuffix,
    scope: Scope,
  ): Ty | undefined {
    const name = ms.member;
    if (name === "id" && !isValueObject(target)) return { kind: "id", target, name: target.name };
    for (const o of ownerChain(target)) {
      for (const m of o.members as AstNode[]) {
        if ((m as { name?: string }).name !== name) continue;
        if (isProperty(m)) return this.propertyType(m, scope);
        if (isContainment(m)) {
          const part = m.partType?.ref;
          if (!part) return Ty.unknown("unresolved-type");
          const t = Ty.record({ of: "part", ref: part });
          return m.collection ? Ty.array(t) : t;
        }
        if (isDerivedProp(m)) return this.resolveType(m.type, scope);
        if (isFunctionDecl(m)) {
          if (ms.call) this.synthArgs(ms.args, scope);
          return ms.call ? this.resolveType(m.returnType, scope) : Ty.unknown("no-rule");
        }
        if (isOperation(m)) {
          if (ms.call) this.synthArgs(ms.args, scope);
          const op = m as Operation;
          return op.returnType ? this.resolveType(op.returnType, scope) : Ty.never;
        }
      }
    }
    return undefined;
  }

  // ---- collection ops ---------------------------------------------------------

  private collectionOp(element: Ty, ms: MemberSuffix, scope: Scope): Ty {
    const args = this.synthArgs(ms.args, scope, element);
    const body = isLambda(ms.args[0]?.value) ? args[0] : undefined;
    switch (ms.member) {
      case "count":
      case "length":
        return Ty.prim("int");
      case "sum":
        return body ?? element;
      case "all":
      case "any":
      case "contains":
        return Ty.prim("bool");
      case "map":
        return Ty.array(body ?? element);
      case "sortBy":
      case "distinct":
      case "take":
      case "skip":
      case "where":
        return Ty.array(element);
      case "join":
        return Ty.prim("string");
      case "first":
        return element;
      case "firstOrNull":
        return Ty.opt(element);
      case "min":
      case "max":
        return Ty.opt(body ?? element);
      case "avg": {
        const t = body ?? element;
        return Ty.opt(Ty.prim(isPrim(t, "money") ? "money" : "decimal"));
      }
      default:
        return isCollectionOp(ms.member) ? Ty.unknown("no-rule") : Ty.unknown("unresolved-member");
    }
  }

  // ---- ternary null-narrowing (the language layer's rule, kept) ---------------

  private narrowed(e: Expression, t: Ty & { kind: "optional" }): Ty {
    const key = simplePathKey(e);
    if (key === undefined) return t;
    return isNarrowedNonNull(e, key) ? withTags(t.inner, t.sensitivity) : t;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** A member of a blessed generic carrier (the field lists of
 *  `src/ir/stdlib/generics.ts`). */
function genericMember(ctor: string, arg: Ty, name: string): Ty | undefined {
  if (ctor === "paged") {
    if (name === "items") return Ty.array(arg);
    if (["page", "pageSize", "total", "totalPages"].includes(name)) return Ty.prim("int");
  } else if (ctor === "envelope") {
    if (name === "id") return Ty.prim("string");
    if (name === "ts") return Ty.prim("datetime");
    if (name === "body") return arg;
  } else if (ctor === "provenanced") {
    if (name === "value") return arg;
    if (name === "lineage") return Ty.opt(Ty.prim("json"));
  }
  return undefined;
}

/** The collection argument of each row-shaped walker primitive. */
const ROW_SOURCE_ARG: Readonly<Record<string, string>> = {
  For: "each",
  Table: "rows",
  DataGrid: "rows",
};

/** How a query-time projection rides the wire: one row, a list, or neither. */
function projectionReadShape(p: Projection): "one" | "many" | undefined {
  if (!p.source || p.members.some(isProjectionOn)) return undefined;
  if (p.key !== undefined) return undefined;
  if (p.groupBys.length > 0) return "many";
  if (!p.members.some(isProperty) && p.selects.length === 0) return "many";
  return "one";
}

function isAstNode(v: unknown): v is AstNode {
  return (
    typeof v === "object" && v !== null && typeof (v as { $type?: unknown }).$type === "string"
  );
}

/** An owner and, for an aggregate, its `extends` ancestors (own first). */
function ownerChain(
  o: Aggregate | EntityPart | ValueObject | Workflow | Projection,
): (Aggregate | EntityPart | ValueObject | Workflow | Projection)[] {
  if (!isAggregate(o)) return [o];
  const out: Aggregate[] = [];
  const seen = new Set<Aggregate>();
  for (let cur: Aggregate | undefined = o; cur && !seen.has(cur); cur = cur.superType?.ref) {
    seen.add(cur);
    out.push(cur);
  }
  return out;
}

function elementOf(t: Ty): Ty | undefined {
  const bare = t.kind === "optional" ? t.inner : t;
  return bare.kind === "array" ? bare.element : undefined;
}

/** The more general of two types (`int`/`long` → `long`, `T`/`null` → `T?`),
 *  or undefined when they share no supertype. */
function join(a: Ty, b: Ty): Ty | undefined {
  if (a.kind === "unknown") return a;
  if (b.kind === "unknown") return b;
  if (a.kind === "never") return b;
  if (b.kind === "never") return a;
  if (a.kind === "optional" || b.kind === "optional") {
    const ai = a.kind === "optional" ? a.inner : a;
    const bi = b.kind === "optional" ? b.inner : b;
    const j = join(ai, bi);
    return j ? (j.kind === "optional" ? j : Ty.opt(j)) : undefined;
  }
  if (a.kind === "primitive" && b.kind === "primitive") {
    if (a.name === b.name) return a;
    const order = ["int", "long", "decimal"];
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai >= 0 && bi >= 0) return Ty.prim(order[Math.max(ai, bi)] as PrimitiveName);
    return undefined;
  }
  if (sameType(a, b)) return a;
  return undefined;
}

function declOf(t: Ty): unknown {
  switch (t.kind) {
    case "record":
      return t.shape.of === "principal" ? "principal" : t.shape.ref;
    case "enum":
    case "valueobject":
      return t.ref ?? t.name;
    case "id":
      return t.target ?? t.name;
    default:
      return undefined;
  }
}

function sameType(a: Ty, b: Ty): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "array" && b.kind === "array") return sameType(a.element, b.element);
  if (a.kind === "primitive" && b.kind === "primitive") return a.name === b.name;
  const da = declOf(a);
  return da !== undefined && da === declOf(b);
}

/** Binary arithmetic / concatenation — the language layer's closed rules
 *  (money and temporal algebras, numeric widening, `/` widens to decimal,
 *  implicit stringification). Anything else is `ill-typed-operands`. */
function arithmetic(a: Ty, b: Ty, op: string): Ty {
  const tags = mergeTags(a.sensitivity, b.sensitivity);
  const r = arithmeticBare(a, b, op);
  return withTags(r, tags);
}

function arithmeticBare(a: Ty, b: Ty, op: string): Ty {
  if (a.kind === "unknown") return a;
  if (b.kind === "unknown") return b;
  if (op === "+") {
    const aStr = isPrim(a, "string");
    const bStr = isPrim(b, "string");
    if (aStr && bStr) return Ty.prim("string");
    if ((aStr && stringifiable(b)) || (bStr && stringifiable(a))) return Ty.prim("string");
  }
  const an = a.kind === "primitive" ? a.name : undefined;
  const bn = b.kind === "primitive" ? b.name : undefined;
  if (an === "money" || bn === "money") {
    if (an === "money" && bn === "money")
      return op === "+" || op === "-" ? Ty.prim("money") : Ty.unknown("ill-typed-operands");
    const other = an === "money" ? bn : an;
    if (other !== "int" && other !== "long" && other !== "decimal")
      return Ty.unknown("ill-typed-operands");
    if (op === "*" || (op === "/" && an === "money")) return Ty.prim("money");
    return Ty.unknown("ill-typed-operands");
  }
  const temporal = (n?: string) => n === "duration" || n === "datetime";
  if (temporal(an) || temporal(bn)) {
    if (an === "datetime" && bn === "duration")
      return op === "+" || op === "-" ? Ty.prim("datetime") : Ty.unknown("ill-typed-operands");
    if (an === "duration" && bn === "datetime")
      return op === "+" ? Ty.prim("datetime") : Ty.unknown("ill-typed-operands");
    if (an === "datetime" && bn === "datetime")
      return op === "-" ? Ty.prim("duration") : Ty.unknown("ill-typed-operands");
    if (an === "duration" && bn === "duration")
      return op === "+" || op === "-" ? Ty.prim("duration") : Ty.unknown("ill-typed-operands");
    if (op === "*" && ((an === "duration" && bn === "int") || (an === "int" && bn === "duration")))
      return Ty.prim("duration");
    return Ty.unknown("ill-typed-operands");
  }
  const order = ["int", "long", "decimal"];
  const ai = an ? order.indexOf(an) : -1;
  const bi = bn ? order.indexOf(bn) : -1;
  if (ai >= 0 && bi >= 0) {
    const w = order[Math.max(ai, bi)]!;
    if (op === "/" && (w === "int" || w === "long")) return Ty.prim("decimal");
    return Ty.prim(w as PrimitiveName);
  }
  return Ty.unknown("ill-typed-operands");
}

function stringifiable(t: Ty): boolean {
  if (t.kind === "primitive") return ["int", "long", "decimal", "money", "bool"].includes(t.name);
  if (t.kind === "enum" || t.kind === "id") return true;
  if (t.kind === "record" && t.shape.of === "aggregate") {
    return t.shape.ref.members.some((m) => isDerivedProp(m) && m.name === "display");
  }
  return false;
}

// Ternary null-narrowing: `<path> != null ? <path is T> : …` (see the long
// rationale in `type-system.ts` above `simplePathKey`; this is the same rule).

function simplePathKey(e: AstNode | undefined): string | undefined {
  if (!e) return undefined;
  if (isParenExpr(e)) return simplePathKey(e.inner);
  if (isThisRef(e)) return "this";
  if (isNameRef(e)) return e.name;
  if (isPostfixChain(e)) {
    const head = simplePathKey(e.head);
    if (head === undefined) return undefined;
    const parts = [head];
    for (const s of e.suffixes) {
      if (!isMemberSuffix(s) || s.call) return undefined;
      parts.push(s.member);
    }
    return parts.join(".");
  }
  return undefined;
}

function unparen(e: AstNode | undefined): AstNode | undefined {
  let cur = e;
  while (cur && isParenExpr(cur)) cur = cur.inner;
  return cur;
}

function condTestsNull(cond: AstNode | undefined, key: string, op: "==" | "!="): boolean {
  const c = unparen(cond);
  if (!c || !isBinaryChain(c) || c.ops.length !== 1 || c.ops[0] !== op) return false;
  const l = unparen(c.head);
  const r = unparen(c.rest[0]);
  if (!l || !r) return false;
  const lNull = isNullLit(l);
  if (lNull === isNullLit(r)) return false;
  return simplePathKey(lNull ? r : l) === key;
}

function branchBlocksNarrowing(branch: AstNode): boolean {
  const opNames = new Set<string>();
  for (let c: AstNode | undefined = branch; c; c = c.$container) {
    if (isAggregate(c) || isEntityPart(c))
      for (const m of c.members) if (isOperation(m)) opNames.add(m.name);
  }
  const stack: AstNode[] = [branch];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (isCallSuffix(n)) return true;
    if (isMemberSuffix(n) && n.call) {
      if (opNames.has(n.member)) return true;
      if (!isIntrinsicName(n.member) && !isCollectionOp(n.member) && n.member !== "matches")
        return true;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k.startsWith("$")) continue;
      if (Array.isArray(v)) for (const x of v) if (isAstNode(x)) stack.push(x);
      if (isAstNode(v)) stack.push(v);
    }
  }
  return false;
}

function isNarrowedNonNull(node: AstNode, key: string): boolean {
  let child: AstNode = node;
  for (let parent = child.$container; parent; child = parent, parent = child.$container) {
    if (isTernaryExpr(parent)) {
      const inThen = parent.thenExpr === child;
      const inElse = parent.elseExpr === child;
      if (
        (inThen || inElse) &&
        condTestsNull(parent.cond, key, inThen ? "!=" : "==") &&
        !branchBlocksNarrowing(child)
      ) {
        return true;
      }
    }
  }
  return false;
}

export type { Model, Statement };
