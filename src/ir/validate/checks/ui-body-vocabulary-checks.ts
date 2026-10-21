// -------------------------------------------------------------------------
// The frontend BODY vocabulary — what a page / component / store body may hold
// and still render on the frontend that hosts it.
//
// Two halves, one walk each:
//
//   TARGET-NEUTRAL — shapes no frontend renders, refused for every ui whether
//   or not a deployable mounts it:
//     `loom.ui-assign-not-state`    `:=` / `+=` / `-=` on a name that is not
//                                   the host's own `state` field
//     `loom.ui-find-call-arity`     a find read called with the wrong number of
//                                   arguments
//     `loom.intrinsic-unknown` /    a method the stdlib does not define, on a
//     `loom.unknown-member`         primitive / collection receiver (the same
//                                   codes the AST validator raises in domain
//                                   bodies, where it can type the receiver)
//
//   PER-TARGET — `UI_BODY_FEATURE_RENDERERS`: one declaration of which
//   frontends render each body feature that is NOT universal.  The gate
//   (`loom.ui-body-feature-unsupported`) consults only that table, and
//   `test/system/ui-body-vocabulary-census.test.ts` generates every
//   frontend × feature cell and checks the table against what the emitters
//   actually do — a feature the table admits but an emitter crashes on fails
//   the census, and so does a refusal of a feature the emitter renders.
//
// Every shape refused here otherwise validates clean and then either crashes
// `ddd generate system` with an uncoded `Error` (the shared JS walker's `this`
// and non-state-assignment throws, the Feliz MVU renderer, the Flutter
// Riverpod notifier, the Feliz find-read builder) or emits code that does not
// compile (`s.matches(…)` verbatim on every JS frontend and Dart).
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { isCollectionOp } from "../../../util/collection-ops.js";
import { intrinsicFor, intrinsicsForReceiver } from "../../../util/intrinsics.js";
import { WALKER_READ_PRIMITIVES } from "../../../util/walker-primitive-names.js";
import type {
  ActionIR,
  ComponentIR,
  ExprIR,
  FindIR,
  PageIR,
  StmtIR,
  StoreIR,
  SystemIR,
  TypeIR,
  UiIR,
} from "../../types/loom-ir.js";
import {
  felizFindArgRefResolvable,
  felizFindParamSupported,
  felizFindReturnDecodable,
} from "../../util/feliz-find-read.js";
import { resolveAggregateRead } from "../../util/page-read.js";
import { typeLabel } from "../../util/type-label.js";
import {
  walkExprChildren,
  walkExprDeep,
  walkStmtChildren,
  walkStmtExprsDeep,
  walkStmtsDeep,
} from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { namedArg, walkerRenderedExprs } from "./ui-checks-shared.js";
import { mountedUis } from "./ui-framework-checks.js";
import { resolveOfRead } from "./ui-page-structure-checks.js";

// -------------------------------------------------------------------------
// The per-target vocabulary.
// -------------------------------------------------------------------------

/** A body feature some — not all — frontends render. */
export type UiBodyFeature =
  | "block-lambda-in-action"
  | "action-ref-value"
  | "nested-async-effect"
  | "store-async-effect"
  | "async-effect-with-siblings"
  | "string-regex-match"
  | "find-read-composite-param"
  | "find-read-non-aggregate-return"
  | "find-read-unbound-arg";

const JS_FRONTENDS = ["react", "vue", "svelte", "angular"] as const;

/** Feature → the frontends (`uiFramework` values) that RENDER it.  A frontend
 *  missing from a row refuses the feature with `loom.ui-body-feature-unsupported`.
 *  Measured, not inferred: `ui-body-vocabulary-census.test.ts` generates every
 *  cell, so a row that claims too much (an emitter crash) or too little (a
 *  refusal of output that renders) fails there.  Grow a row in the same change
 *  that teaches the emitter the feature. */
export const UI_BODY_FEATURE_RENDERERS: Readonly<Record<UiBodyFeature, ReadonlySet<string>>> = {
  // The Feliz MVU `update` arm renders a single-expression lambda only.
  "block-lambda-in-action": new Set([...JS_FRONTENDS, "flutter", "phoenixLiveView"]),
  // Feliz binds the action's `Msg` case (`let f = save` → `f = Msg.Save`).
  "action-ref-value": new Set([...JS_FRONTENDS, "feliz", "flutter", "phoenixLiveView"]),
  // Feliz projects one top-level effect per action; Flutter intercepts top-level ones.
  "nested-async-effect": new Set([...JS_FRONTENDS, "phoenixLiveView"]),
  "store-async-effect": new Set([...JS_FRONTENDS, "phoenixLiveView"]),
  // Feliz projects the effect and drops the action's other statements.
  "async-effect-with-siblings": new Set([...JS_FRONTENDS, "flutter", "phoenixLiveView"]),
  // No frontend has a regex arm: the JS walkers and Dart emit `s.matches(…)`
  // verbatim (no such method) and Feliz has no arm.
  "string-regex-match": new Set(["phoenixLiveView"]),
  // (The native `.filter(…)` once had a row here.  Since M-T5.47's single
  // typing pass every receiver a page can hold — `state`, a row lambda, a
  // QueryView data set — is an AST-typed array, whose member surface is the
  // collection-op catalogue, so `.filter` is refused upstream with
  // `loom.unknown-member` on every frontend; `.where(…)` renders on all.)
  // Feliz builds a find request in `init` as a query string and decodes the
  // aggregate's own record (`ir/util/feliz-find-read.ts`).
  "find-read-composite-param": new Set([...JS_FRONTENDS, "flutter", "phoenixLiveView"]),
  "find-read-non-aggregate-return": new Set([...JS_FRONTENDS, "flutter", "phoenixLiveView"]),
  "find-read-unbound-arg": new Set([...JS_FRONTENDS, "flutter", "phoenixLiveView"]),
};

/** How each feature reads in a diagnostic: the shape, why the missing
 *  frontends cannot render it, and what to write instead. */
const FEATURE_TEXT: Readonly<Record<UiBodyFeature, { label: string; why: string; hint: string }>> =
  {
    "block-lambda-in-action": {
      label: "a block-body lambda (`x => { … }`) inside an action",
      why: "its action renderer emits single-expression lambdas only",
      hint: "Bind the value with `let` in the action body, or write the lambda as `x => <expr>`.",
    },
    "action-ref-value": {
      label: "an action named as a VALUE inside an action body",
      why: "an action is a dispatched message there, not a function value",
      hint: "Call the action (`other()`) instead of binding it.",
    },
    "nested-async-effect": {
      label: "a `match await` nested inside another `match await` arm",
      why: "it renders only a top-level `match await` per action",
      hint: "Move the inner await into its own action and call that action from the arm.",
    },
    "store-async-effect": {
      label: "a `match await` inside a store action",
      why: "it renders an async effect only on a page action, which carries the route `id`",
      hint: "Await the operation in the page action and call the store action from its arm.",
    },
    "async-effect-with-siblings": {
      label: "a `match await` beside other statements in the same action",
      why: "it projects the awaited effect as the whole action and drops the other statements",
      hint: "Keep the `match await` alone in its action; run the other statements from its arms or from a separate action.",
    },
    "string-regex-match": {
      label: "the string regex `.matches(…)`",
      why: "its page renderer has no regex arm (it would emit a call to a method the language does not have)",
      hint: "Validate the pattern on the backend — a field rule or an operation `precondition` — and show its error.",
    },
    "find-read-composite-param": {
      label: "a read of a find with a non-scalar parameter",
      why: "it sends a find's arguments as a query string, which can carry only scalars, ids and enums",
      hint: "Give the find scalar parameters.",
    },
    "find-read-non-aggregate-return": {
      label: "a read of a find that does not return its aggregate",
      why: "it decodes a find's response as the aggregate's own record (`T`, `T?`, `T[]` or `T paged`)",
      hint: "Declare the find to return the aggregate, or read the value through a projection.",
    },
    "find-read-unbound-arg": {
      label:
        "a find read whose argument is not a `state` cell, store field, literal or the route `id`",
      why: "it issues the request from `init`, where a row binding, page param or `derived` is not in scope",
      hint: "Copy the value into a `state` field and pass that.",
    },
  };

/** One place a feature is used. */
export interface UiBodyFeatureUse {
  feature: UiBodyFeature;
  where: string;
}

/** Every vocabulary feature a ui's bodies use, deduped by (where, feature). */
function uiBodyFeaturesUsed(
  ui: UiIR,
  findsByAggregate: ReadonlyMap<string, ReadonlyMap<string, FindIR>>,
  aggNames: ReadonlySet<string>,
): UiBodyFeatureUse[] {
  const out: UiBodyFeatureUse[] = [];
  const seen = new Set<string>();
  const add = (feature: UiBodyFeature, where: string): void => {
    const key = `${where}\u0000${feature}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ feature, where });
  };
  const apiParamNames = new Set(ui.apiParams.map((p) => p.name));

  const actionFeatures = (
    actions: readonly ActionIR[],
    hostWhere: string,
    host: "page" | "component" | "store",
  ): void => {
    for (const a of actions) {
      const where = `${hostWhere} action '${a.name}'`;
      for (const s of a.body) {
        walkStmtExprsDeep(s, (e) => {
          if (e.kind === "lambda" && e.block) add("block-lambda-in-action", where);
          if (e.kind === "action-ref") add("action-ref-value", where);
        });
      }
      // Async-effect placement.  A COMPONENT action carrying any `match await`
      // is already refused wholesale on the frontends that cannot host one
      // (`loom.feliz-async-effect-unsupported` / `loom.flutter-async-effect-
      // unsupported`), so it is not re-reported here.
      if (host === "component") continue;
      const effects: StmtIR[] = [];
      for (const s of a.body) {
        walkStmtsDeep(s, (n) => {
          if (n.kind === "variant-match") effects.push(n);
        });
      }
      if (effects.length === 0) continue;
      if (host === "store") {
        add("store-async-effect", where);
        continue;
      }
      if (a.body.length > 1) add("async-effect-with-siblings", where);
      for (const vm of effects) {
        if (vm.kind !== "variant-match") continue;
        const inner = [...vm.arms.flatMap((arm) => arm.body), ...(vm.elseBody ?? [])];
        let nested = false;
        for (const s of inner) walkStmtsDeep(s, (n) => (nested ||= n.kind === "variant-match"));
        if (nested) add("nested-async-effect", where);
      }
    }
  };

  const methodFeatures = (exprs: readonly ExprIR[], stmts: readonly StmtIR[], where: string) => {
    const visit = (e: ExprIR): void => {
      if (e.kind !== "method-call") return;
      if (e.member !== "matches") return;
      const t = e.receiverType.kind === "optional" ? e.receiverType.inner : e.receiverType;
      if (t.kind === "primitive" && t.name === "string") add("string-regex-match", where);
    };
    for (const e of exprs) walkExprDeep(e, visit);
    for (const s of stmts) walkStmtExprsDeep(s, visit);
  };

  const findReadFeatures = (host: PageIR | ComponentIR, where: string): void => {
    const stateNames = new Set(host.state.map((s) => s.name));
    walkExprDeep(host.body, (e) => {
      const read = findReadOf(e, apiParamNames, aggNames, findsByAggregate);
      if (!read) return;
      if (read.find.params.some((p) => !felizFindParamSupported(p.type))) {
        add("find-read-composite-param", where);
      }
      if (!felizFindReturnDecodable(read.find, read.aggregate)) {
        add("find-read-non-aggregate-return", where);
      }
      for (const arg of read.args) {
        walkExprDeep(arg, (x) => {
          if (x.kind === "ref" && !felizFindArgRefResolvable(x, stateNames)) {
            add("find-read-unbound-arg", where);
          }
        });
      }
    });
  };

  for (const page of ui.pages) {
    const where = `page '${page.name}'`;
    actionFeatures(page.actions, where, "page");
    methodFeatures(
      walkerRenderedExprs(page),
      page.actions.flatMap((a) => a.body),
      where,
    );
    findReadFeatures(page, where);
  }
  for (const comp of ui.components) {
    const where = `component '${comp.name}'`;
    actionFeatures(comp.actions, where, "component");
    methodFeatures(
      walkerRenderedExprs(comp),
      comp.actions.flatMap((a) => a.body),
      where,
    );
    findReadFeatures(comp, where);
  }
  for (const store of ui.stores) {
    const where = `store '${store.name}'`;
    actionFeatures(store.actions, where, "store");
    methodFeatures(
      store.state.flatMap((s) => (s.init ? [s.init] : [])),
      store.actions.flatMap((a) => a.body),
      where,
    );
  }
  return out;
}

/** A find read in a read primitive's `of:` slot — the find it resolves to,
 *  its aggregate and its argument expressions — or undefined for any other
 *  node (a lifecycle `all` / `byId` / `history` read included). */
function findReadOf(
  e: ExprIR,
  apiParamNames: ReadonlySet<string>,
  aggNames: ReadonlySet<string>,
  findsByAggregate: ReadonlyMap<string, ReadonlyMap<string, FindIR>>,
): { aggregate: string; find: FindIR; args: readonly ExprIR[]; spelling: string } | undefined {
  if (e.kind !== "call" || !WALKER_READ_PRIMITIVES.has(e.name)) return undefined;
  const of = namedArg(e, "of");
  if (!of) return undefined;
  const read = resolveOfRead(of, apiParamNames, aggNames);
  if (!read) return undefined;
  const target = resolveAggregateRead(read.operation, findsByAggregate.get(read.aggregate));
  if (target.kind !== "find") return undefined;
  const args = of.kind === "method-call" ? of.args : [];
  return {
    aggregate: read.aggregate,
    find: target.find,
    args,
    spelling: `${read.aggregate}.${read.operation}`,
  };
}

/** Index every repository find by aggregate. */
function findsIndex(sys: SystemIR): Map<string, Map<string, FindIR>> {
  const out = new Map<string, Map<string, FindIR>>();
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts) {
      for (const repo of ctx.repositories) {
        out.set(repo.aggregateName, new Map(repo.finds.map((f) => [f.name, f])));
      }
    }
  }
  return out;
}

function aggregateNames(sys: SystemIR): Set<string> {
  const out = new Set<string>();
  for (const sub of sys.subdomains)
    for (const ctx of sub.contexts) for (const a of ctx.aggregates) out.add(a.name);
  return out;
}

/** `loom.ui-body-feature-unsupported` — a feature a mounted ui uses that the
 *  hosting frontend does not render (per `UI_BODY_FEATURE_RENDERERS`). */
export function validateUiBodyVocabulary(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const finds = findsIndex(sys);
  const aggNames = aggregateNames(sys);
  const usesByUi = new Map<string, UiBodyFeatureUse[]>();
  const reported = new Set<string>();
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      let uses = usesByUi.get(ui.name);
      if (!uses) {
        uses = uiBodyFeaturesUsed(ui, finds, aggNames);
        usesByUi.set(ui.name, uses);
      }
      for (const { feature, where } of uses) {
        const renderers = UI_BODY_FEATURE_RENDERERS[feature];
        if (renderers.has(fw)) continue;
        const key = `${ui.name}\u0000${fw}\u0000${where}\u0000${feature}`;
        if (reported.has(key)) continue;
        reported.add(key);
        const text = FEATURE_TEXT[feature];
        diags.push({
          severity: "error",
          code: "loom.ui-body-feature-unsupported",
          message: diagMessage("loom.ui-body-feature-unsupported", {
            where,
            uiName: ui.name,
            feature: text.label,
            fw: fw || "unknown",
            dName: d.name,
            why: text.why,
            renderedBy:
              renderers.size > 0
                ? `It renders on ${[...renderers].sort().join(", ")}. `
                : "No frontend renders it. ",
            hint: text.hint,
          }),
          source: `${ui.name}/${where}`,
        });
      }
    }
  }
}

// -------------------------------------------------------------------------
// The target-neutral half.
// -------------------------------------------------------------------------

/** One body host — the names a write may target and the surfaces to walk. */
interface BodyHost {
  where: string;
  kind: "page" | "component" | "store";
  stateNames: ReadonlySet<string>;
  /** Names the AST validator already types in this host (page / component
   *  params): a method on one of them is reported there, so not here. */
  astTypedNames: ReadonlySet<string>;
  exprs: readonly ExprIR[];
  actions: readonly ActionIR[];
}

function hostsOf(ui: UiIR): BodyHost[] {
  const hosts: BodyHost[] = [];
  for (const p of ui.pages) {
    hosts.push({
      where: `page '${p.name}'`,
      kind: "page",
      stateNames: new Set(p.state.map((s) => s.name)),
      astTypedNames: new Set(p.params.map((x) => x.name)),
      exprs: walkerRenderedExprs(p),
      actions: p.actions,
    });
  }
  for (const c of ui.components) {
    hosts.push({
      where: `component '${c.name}'`,
      kind: "component",
      stateNames: new Set(c.state.map((s) => s.name)),
      astTypedNames: new Set(c.params.map((x) => x.name)),
      exprs: walkerRenderedExprs(c),
      actions: c.actions,
    });
  }
  for (const s of ui.stores) hosts.push(storeHost(s));
  return hosts;
}

function storeHost(s: StoreIR): BodyHost {
  return {
    where: `store '${s.name}'`,
    kind: "store",
    stateNames: new Set(s.state.map((f) => f.name)),
    astTypedNames: new Set(),
    exprs: s.state.flatMap((f) => (f.init ? [f.init] : [])),
    actions: s.actions,
  };
}

/** `this`, non-state writes, unknown methods and find-read arity, over every
 *  ui of `sys` (mounted or not — the model is wrong either way). */
export function validateUiBodyRules(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const finds = findsIndex(sys);
  const aggNames = aggregateNames(sys);
  const recordFunctions = new Map<string, ReadonlySet<string>>();
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts) {
      for (const vo of ctx.valueObjects) {
        recordFunctions.set(vo.name, new Set(vo.functions.map((f) => f.name)));
      }
    }
  }
  for (const ui of sys.uis) {
    const apiParamNames = new Set(ui.apiParams.map((p) => p.name));
    for (const host of hostsOf(ui)) {
      checkStateWrites(ui, host, diags);
      checkMethodVocabulary(host, recordFunctions, diags);
    }
    for (const p of ui.pages) {
      checkFindArity(ui, p, `page '${p.name}'`, apiParamNames, aggNames, finds, diags);
    }
    for (const c of ui.components) {
      checkFindArity(ui, c, `component '${c.name}'`, apiParamNames, aggNames, finds, diags);
    }
  }
}

function checkStateWrites(ui: UiIR, host: BodyHost, diags: LoomDiagnostic[]): void {
  for (const a of host.actions) {
    const where = `${host.where} action '${a.name}'`;
    const seen = new Set<string>();
    for (const top of a.body) {
      walkStmtsDeep(top, (s) => {
        if (s.kind !== "assign" && s.kind !== "add" && s.kind !== "remove") return;
        const root = s.target.segments[0];
        if (root === undefined || host.stateNames.has(root)) return;
        const target = s.target.segments.join(".");
        if (seen.has(target)) return;
        seen.add(target);
        const op = s.kind === "assign" ? ":=" : s.kind === "add" ? "+=" : "-=";
        const declared = [...host.stateNames];
        diags.push({
          severity: "error",
          code: "loom.ui-assign-not-state",
          message: diagMessage("loom.ui-assign-not-state", {
            where,
            uiName: ui.name,
            op,
            target,
            root,
            host: host.kind,
            known:
              declared.length > 0
                ? ` (declared: ${declared.join(", ")})`
                : " (it declares no `state`)",
          }),
          source: `${ui.name}/${where}`,
        });
      });
    }
  }
}

// --- unknown methods -------------------------------------------------------
//
// The AST validator rejects a method the stdlib does not define
// (`loom.intrinsic-unknown` on a primitive, `loom.unknown-member` on a
// collection or record) wherever its type environment can type the receiver.
// Since M-T5.47's single typing pass that covers a ui `state` field, an action
// param, a store field, a `let` over one of them, a match binding and a row
// lambda — so for those receivers the AST already reports the shape and this
// check stays silent (`"ast"` trust) rather than raise it a second time.  Two
// shapes remain the IR's alone: a bare action-body lambda's param, which the
// AST leaves untyped but the IR lowers at the `string` the action renderers
// dispatch by (`"typed"`), and a value-object FUNCTION called in a ui body,
// which the AST admits (the function exists in the domain) but no frontend's
// wire record carries (`loom.unknown-member#ui-record-function`).  A bare
// render-tree lambda param is lowered at a `string` PLACEHOLDER, and an api
// handle (`C.Order.byName(…)`) carries no type at all: neither is trusted.

/** How far a name's lowered type can be trusted: `"ast"` — real, and the AST
 *  gate already reports an unknown method on it; `"typed"` — real, and only
 *  the IR can see it. */
type Trust = "ast" | "typed" | "placeholder" | "untyped";

/** An operator's result type is fixed by the operator, so it is always real;
 *  it is the AST gate's to report unless an operand is one only the IR types
 *  (a bare action-lambda param). */
function operatorTrust(...operands: Trust[]): Trust {
  return operands.includes("typed") ? "typed" : "ast";
}

function checkMethodVocabulary(
  host: BodyHost,
  recordFunctions: ReadonlyMap<string, ReadonlySet<string>>,
  diags: LoomDiagnostic[],
): void {
  const reported = new Set<string>();
  /** Set once the render-tree surfaces are walked and the action bodies begin. */
  let inAction = false;
  const base = new Map<string, Trust>();
  for (const n of host.stateNames) base.set(n, "ast");
  for (const n of host.astTypedNames) base.set(n, "untyped");
  const visitExpr = (e: ExprIR, scope: Map<string, Trust>, where: string): void => {
    if (e.kind === "method-call") {
      checkMethod(e, scope, where);
      // A collection-op lambda binds its param at the element type, so it is
      // as trustworthy as the receiver it iterates.
      const recv = receiverTrust(e.receiver, scope);
      if (e.isCollectionOp && (recv === "typed" || recv === "ast")) {
        visitExpr(e.receiver, scope, where);
        for (const arg of e.args) {
          if (arg.kind === "lambda") {
            const inner = new Map(scope).set(arg.param, recv);
            visitLambdaBody(arg, inner, where);
          } else visitExpr(arg, scope, where);
        }
        return;
      }
    }
    if (e.kind === "lambda") {
      // Inside an action no primitive binds a row, so a bare lambda's param is
      // the `string` placeholder and nothing else — and the action renderers
      // dispatch its methods by exactly that type.
      const trust: Trust = inAction ? "typed" : "placeholder";
      visitLambdaBody(e, new Map(scope).set(e.param, trust), where);
      return;
    }
    walkExprChildren(e, {
      expr: (c) => visitExpr(c, scope, where),
      stmt: (s) => visitStmt(s, scope, where),
    });
  };
  const visitLambdaBody = (
    e: Extract<ExprIR, { kind: "lambda" }>,
    scope: Map<string, Trust>,
    where: string,
  ): void => {
    if (e.body) visitExpr(e.body, scope, where);
    if (e.block) visitBlock(e.block, scope, where);
  };
  const visitStmt = (s: StmtIR, scope: Map<string, Trust>, where: string): void => {
    walkStmtChildren(
      s,
      (c) => visitExpr(c, scope, where),
      (n) => visitStmt(n, scope, where),
    );
  };
  const visitBlock = (stmts: readonly StmtIR[], scope: Map<string, Trust>, where: string) => {
    const local = new Map(scope);
    for (const s of stmts) {
      visitStmt(s, local, where);
      if (s.kind === "let") local.set(s.name, receiverTrust(s.expr, local));
    }
  };
  const checkMethod = (
    e: Extract<ExprIR, { kind: "method-call" }>,
    scope: Map<string, Trust>,
    where: string,
  ): void => {
    if (e.isIntrinsicMatcher || isCollectionOp(e.member)) return;
    const trust = receiverTrust(e.receiver, scope);
    if (trust !== "typed" && trust !== "ast") return;
    const t = e.receiverType.kind === "optional" ? e.receiverType.inner : e.receiverType;
    const isRecordFunction = t.kind === "valueobject" && recordFunctions.get(t.name)?.has(e.member);
    // The AST gate reports every other unknown method on an AST-typed receiver.
    if (trust === "ast" && !isRecordFunction) return;
    if (t.kind === "valueobject") {
      const key = `${where}\u0000${e.member}\u0000${t.name}`;
      if (reported.has(key)) return;
      reported.add(key);
      diags.push(
        isRecordFunction
          ? {
              severity: "error",
              code: "loom.unknown-member",
              message: diagMessage("loom.unknown-member#ui-record-function", {
                member: e.member,
                record: t.name,
              }),
              source: where,
            }
          : {
              severity: "error",
              code: "loom.unknown-member",
              message: diagMessage("loom.unknown-member", { member: e.member, record: t.name }),
              source: where,
            },
      );
      return;
    }
    if (t.kind !== "primitive" && t.kind !== "array") return;
    // `matches` is a real string operation outside the catalogue; whether a
    // frontend renders it is the vocabulary table's question.
    if (t.kind === "primitive" && intrinsicFor(t.name, e.member)) return;
    if (t.kind === "primitive" && t.name === "string" && e.member === "matches") return;
    const key = `${where}\u0000${e.member}\u0000${typeLabel(e.receiverType)}`;
    if (reported.has(key)) return;
    reported.add(key);
    if (t.kind === "array") {
      diags.push({
        severity: "error",
        code: "loom.unknown-member",
        message: diagMessage("loom.unknown-member", {
          member: e.member,
          record: typeLabel(e.receiverType),
        }),
        source: where,
      });
      return;
    }
    const known = intrinsicsForReceiver(t.name)
      .map((s) => s.name)
      .join(", ");
    diags.push({
      severity: "error",
      code: "loom.intrinsic-unknown",
      message: diagMessage("loom.intrinsic-unknown", {
        name: typeLabel(e.receiverType),
        member: e.member,
        known: known ? ` — available: ${known}` : "",
      }),
      source: where,
    });
  };
  for (const e of host.exprs) visitExpr(e, base, host.where);
  inAction = true;
  for (const a of host.actions) {
    const scope = new Map(base);
    for (const p of a.params) scope.set(p.name, "ast");
    visitBlock(a.body, scope, `${host.where} action '${a.name}'`);
  }
}

/** How far the lowered type of `e`'s value can be trusted: a chain is as
 *  trustworthy as the binding at its root. */
function receiverTrust(e: ExprIR, scope: ReadonlyMap<string, Trust>): Trust {
  switch (e.kind) {
    case "literal":
    case "list":
    case "convert":
    case "i18nFormat":
    case "duration":
      return "ast";
    case "binary":
      return operatorTrust(receiverTrust(e.left, scope), receiverTrust(e.right, scope));
    case "unary":
      return operatorTrust(receiverTrust(e.operand, scope));
    case "paren":
      return receiverTrust(e.inner, scope);
    case "member":
    case "method-call":
      return receiverTrust(e.receiver, scope);
    case "ref": {
      if (e.refKind === "store-field" || e.refKind === "match-binding") return "ast";
      const bound = scope.get(e.name);
      if (bound === "placeholder") {
        // A row-shaped primitive (`For`, `Table`) binds its lambda at the REAL
        // row type (which the AST types too); only the bare-lambda fallback is
        // the `string` placeholder.
        return e.type && !isPlaceholderString(e.type) ? "ast" : "placeholder";
      }
      return bound ?? "untyped";
    }
    // Lowered at a type the expression does not fix (a call's result, an
    // object literal, a `match` value), or carrying none at all (`this`, an
    // api handle chain): never trusted.
    case "action-ref":
    case "authz-filter":
    case "call":
    case "id":
    case "lambda":
    case "match":
    case "new":
    case "object":
    case "ternary":
    case "this":
      return "untyped";
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

function isPlaceholderString(t: TypeIR): boolean {
  return t.kind === "primitive" && t.name === "string";
}

// --- find-read arity -------------------------------------------------------

function checkFindArity(
  ui: UiIR,
  host: PageIR | ComponentIR,
  where: string,
  apiParamNames: ReadonlySet<string>,
  aggNames: ReadonlySet<string>,
  finds: ReadonlyMap<string, ReadonlyMap<string, FindIR>>,
  diags: LoomDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const root of walkerRenderedExprs(host)) {
    walkExprDeep(root, (e) => {
      const read = findReadOf(e, apiParamNames, aggNames, finds);
      if (!read || read.args.length === read.find.params.length) return;
      const key = `${read.spelling}\u0000${read.args.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      const params = read.find.params;
      diags.push({
        severity: "error",
        code: "loom.ui-find-call-arity",
        message: diagMessage("loom.ui-find-call-arity", {
          where,
          uiName: ui.name,
          read: read.spelling,
          got: read.args.length,
          expected: params.length,
          params:
            params.length > 0
              ? ` (${params.map((p) => `${p.name}: ${typeLabel(p.type)}`).join(", ")})`
              : "",
        }),
        source: `${ui.name}/${where}`,
      });
    });
  }
}
