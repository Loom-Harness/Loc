// The UI half of the Frontend Contract: what of a page, component, store and
// their resolved expression trees a frontend target receives.
//
// The expression and statement trees ship resolved — every ref carries its
// `refKind`, every member its receiver and member type, every call its
// `callKind` — so a target never re-resolves.  Types are nominal (`TypeIR`
// names a declaration), so an edge points at a wire record in the contract's
// other half rather than embedding a domain node.  What a UI body cannot
// legitimately hold — a repository read, a domain-service or workflow call, a
// capability filter, provenance capture — is denied, not dropped: its
// presence means lowering put a domain fact where the client would see it.
// Source origins are dropped: they name local files.

import type {
  ActionIR,
  ComponentIR,
  DerivedIR,
  ExprIR,
  LayoutIR,
  MenuBlockIR,
  MenuLinkIR,
  MenuMetaIR,
  MenuSectionIR,
  MessageIR,
  PageIR,
  PageLayoutIR,
  PageMetadataIR,
  ParamIR,
  PathIR,
  RefetchTargetIR,
  ReturnVariantIR,
  StateFieldIR,
  StmtIR,
  StoreIR,
  StyleIR,
  TypeIR,
  UiApiParamIR,
  UiChannelParamIR,
  UiFunctionIR,
  UiIR,
  UiNotificationIR,
} from "../types/loom-ir.js";
import {
  deny,
  drop,
  FrontendContractError,
  keep,
  lazy,
  list,
  oneOf,
  type Rule,
  record,
  type Spec,
  union,
} from "./allowlist.js";

const DOMAIN_READ = "a domain read never ships to a frontend";

export const typeRule: Rule = union<TypeIR>("TypeIR", {
  primitive: { name: keep },
  id: { targetName: keep },
  enum: { name: keep },
  valueobject: { name: keep },
  entity: { name: keep, declKind: keep },
  array: { element: lazy(() => typeRule) },
  optional: { inner: lazy(() => typeRule) },
  genericInstance: { ctor: keep, arg: lazy(() => typeRule) },
  union: { variants: list(lazy(() => typeRule)) },
  none: {},
  slot: {},
  action: { arg: lazy(() => typeRule) },
});

const expr: Rule = lazy(() => exprRule);
const exprs = list(expr);
const stmts: Rule = list(lazy(() => stmtRule));
const named = list(
  record<{ name: string; value: ExprIR }>("NamedExpr", { name: keep, value: expr }),
);
const style = record<StyleIR>("StyleIR", {
  entries: list(record<StyleIR["entries"][number]>("StyleEntry", { key: keep, value: expr })),
});

/** Call kinds a UI body may make: its own functions, value-object
 *  constructors, sibling and store actions, ambient resource verbs and the
 *  unresolved free calls the walker renders as primitives. */
const UI_CALL_KINDS = [
  "function",
  "value-object-ctor",
  "action",
  "store-action",
  "resource-op",
  "free",
];

type ExprCase<K extends ExprIR["kind"]> = Extract<ExprIR, { kind: K }>;
type MatchArm = ExprCase<"match">["arms"][number];
type VariantArm = ExprCase<"match">["variantArms"][number];
type ResourceOp = Extract<ExprCase<"call">, { callKind: "resource-op" }>["resourceOp"];
type StoreAction = Extract<ExprCase<"call">, { callKind: "store-action" }>["storeAction"];

export const exprRule: Rule = union<ExprIR>("ExprIR", {
  literal: { lit: keep, value: keep, origin: drop },
  this: { origin: drop },
  id: { origin: drop },
  ref: {
    name: keep,
    type: typeRule,
    refKind: keep,
    enumName: keep,
    enumCandidates: keep,
    resourceName: keep,
    resourceKind: keep,
    resourceApiName: keep,
    storeName: keep,
    wfScope: deny("a workflow helper never ships to a frontend"),
    origin: drop,
  },
  member: {
    receiver: expr,
    member: keep,
    receiverType: typeRule,
    memberType: typeRule,
    origin: drop,
  },
  "method-call": {
    receiver: expr,
    member: keep,
    args: exprs,
    receiverType: typeRule,
    isCollectionOp: keep,
    isIntrinsicMatcher: keep,
    throwKind: keep,
    argNames: keep,
    awaited: keep,
    bypassRead: deny(DOMAIN_READ),
    resultType: typeRule,
    origin: drop,
  },
  call: {
    name: keep,
    args: exprs,
    argNames: keep,
    awaited: keep,
    style,
    resultType: typeRule,
    callKind: oneOf(UI_CALL_KINDS, "a UI body calls no domain code"),
    wfScope: deny("a workflow helper never ships to a frontend"),
    targetPrivate: deny("a private operation never ships to a frontend"),
    resourceOp: record<ResourceOp>("ResourceOp", {
      resourceName: keep,
      resourceKind: keep,
      verb: keep,
      capability: keep,
      interface: keep,
      boundApi: keep,
    }),
    remoteApiOp: deny("a service-to-service call never ships to a frontend"),
    serviceRef: deny("a domain-service call never ships to a frontend"),
    repoRead: deny(DOMAIN_READ),
    storeAction: record<StoreAction>("StoreAction", { store: keep, action: keep }),
    origin: drop,
  },
  "action-ref": { actionName: keep, paramType: typeRule, storeName: keep, origin: drop },
  lambda: { param: keep, body: expr, block: stmts, origin: drop },
  new: { partName: keep, fields: named, nested: keep, origin: drop },
  object: { fields: named, origin: drop },
  list: { elements: exprs, elementType: typeRule, origin: drop },
  "authz-filter": { deny: "a capability filter never ships to a frontend" },
  exists: { deny: DOMAIN_READ },
  paren: { inner: expr, origin: drop },
  unary: { op: keep, operand: expr, origin: drop },
  binary: {
    op: keep,
    left: expr,
    right: expr,
    leftType: typeRule,
    rightType: typeRule,
    resultType: typeRule,
    origin: drop,
  },
  ternary: {
    cond: expr,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the IR ternary's branch field, not a thenable.
    then: expr,
    otherwise: expr,
    origin: drop,
  },
  convert: { target: keep, from: keep, value: expr, origin: drop },
  duration: { unit: keep, amount: expr, origin: drop },
  i18nFormat: { inner: expr, format: keep, origin: drop },
  modelText: { key: keep, defaultText: keep, origin: drop },
  match: {
    arms: list(record<MatchArm>("MatchArm", { cond: expr, value: expr })),
    otherwise: expr,
    subject: expr,
    subjectType: typeRule,
    subjectShape: keep,
    variantArms: list(
      record<VariantArm>("VariantArm", {
        varType: typeRule,
        binding: keep,
        value: expr,
        isError: keep,
      }),
    ),
    origin: drop,
  },
});

const message = record<MessageIR>("MessageIR", { key: keep, text: keep });
const path = record<PathIR>("PathIR", { segments: keep });
const PROVENANCE = "provenance capture is server-side";

type StmtCase<K extends StmtIR["kind"]> = Extract<StmtIR, { kind: K }>;
type VariantStmtArm = StmtCase<"variant-match">["arms"][number];

export const stmtRule: Rule = union<StmtIR>("StmtIR", {
  precondition: { expr, source: keep, message, origin: drop },
  requires: {
    expr,
    source: keep,
    maskWriteOf: deny("mask enforcement is server-side"),
    origin: drop,
  },
  let: { name: keep, expr, type: typeRule, origin: drop },
  assign: { target: path, value: expr, targetType: typeRule, prov: deny(PROVENANCE), origin: drop },
  add: {
    target: path,
    value: expr,
    elementType: typeRule,
    collection: keep,
    prov: deny(PROVENANCE),
    origin: drop,
  },
  remove: {
    target: path,
    value: expr,
    elementType: typeRule,
    collection: keep,
    prov: deny(PROVENANCE),
    origin: drop,
  },
  emit: { deny: "a domain event is raised server-side" },
  call: {
    // A UI body has no operations in scope: lowering gives a page effect
    // (`toast`, `navigate`) or an extern ui function the `private-operation`
    // target when nothing else resolves the name, and never a private one.
    target: oneOf(
      ["function", "action", "store-action", "private-operation"],
      "a UI body calls no domain code",
    ),
    name: keep,
    args: exprs,
    store: keep,
    targetPrivate: (v, at) => {
      if (v === true)
        throw new FrontendContractError(at, "a private operation never ships to a frontend");
      return v;
    },
    origin: drop,
  },
  expression: { expr, origin: drop },
  "variant-match": {
    subject: expr,
    subjectType: typeRule,
    subjectShape: keep,
    arms: list(
      record<VariantStmtArm>("VariantStmtArm", {
        varType: typeRule,
        binding: keep,
        body: stmts,
        isError: keep,
      }),
    ),
    elseBody: stmts,
    origin: drop,
  },
  if: { cond: expr, thenBody: stmts, elseBody: stmts, origin: drop },
  return: {
    value: expr,
    variantTag: keep,
    variantShape: keep,
    armVariants: list(
      record<ReturnVariantIR>("ReturnVariantIR", { variantTag: keep, variantShape: keep }),
    ),
    origin: drop,
  },
});

const param = record<ParamIR>("ParamIR", { name: keep, type: typeRule, default: expr });
const state = record<StateFieldIR>("StateFieldIR", { name: keep, type: typeRule, init: expr });
const derived = record<DerivedIR>("DerivedIR", { name: keep, type: typeRule, expr });
const action = record<ActionIR>("ActionIR", { name: keep, params: list(param), body: stmts });

const menuLink = union<MenuLinkIR>("MenuLinkIR", {
  page: { pageName: keep, route: keep, props: named },
  external: { label: keep, url: keep },
});

const pageSpec: Spec<PageIR> = {
  name: keep,
  params: list(param),
  route: keep,
  title: expr,
  requires: expr,
  state: list(state),
  derived: list(derived),
  actions: list(action),
  body: expr,
  menuMeta: record<MenuMetaIR>("MenuMetaIR", { entries: named }),
  emitPath: keep,
  area: keep,
  layout: union<PageLayoutIR>("PageLayoutIR", { preset: { name: keep }, named: { ref: keep } }),
  metadata: record<PageMetadataIR>("PageMetadataIR", {
    description: keep,
    ogImage: keep,
    canonical: keep,
  }),
  origin: drop,
};

const componentSpec: Spec<ComponentIR> = {
  name: keep,
  params: list(param),
  state: list(state),
  derived: list(derived),
  actions: list(action),
  body: expr,
  extern: keep,
  externPath: keep,
  origin: drop,
};

export const componentRule = record<ComponentIR>("ComponentIR", componentSpec);

export const uiRule = record<UiIR>("UiIR", {
  name: keep,
  framework: keep,
  pages: list(record<PageIR>("PageIR", pageSpec)),
  components: list(componentRule),
  stores: list(
    record<StoreIR>("StoreIR", {
      name: keep,
      lifetime: keep,
      state: list(state),
      actions: list(action),
    }),
  ),
  menu: record<MenuBlockIR>("MenuBlockIR", {
    sections: list(record<MenuSectionIR>("MenuSectionIR", { label: keep, links: list(menuLink) })),
  }),
  apiParams: list(record<UiApiParamIR>("UiApiParamIR", { name: keep, apiName: keep })),
  channelParams: list(
    record<UiChannelParamIR>("UiChannelParamIR", {
      name: keep,
      contextName: keep,
      channelName: keep,
    }),
  ),
  notifications: list(
    record<UiNotificationIR>("UiNotificationIR", {
      paramName: keep,
      eventType: keep,
      bind: keep,
      toasts: exprs,
      refetches: list(
        record<RefetchTargetIR>("RefetchTargetIR", { aggregate: keep, queryTag: keep }),
      ),
    }),
  ),
  functions: list(
    record<UiFunctionIR>("UiFunctionIR", {
      name: keep,
      params: list(param),
      returnType: typeRule,
      externPath: keep,
    }),
  ),
});

export const layoutRule = record<LayoutIR>("LayoutIR", {
  name: keep,
  header: expr,
  sidebar: expr,
  footer: expr,
});
