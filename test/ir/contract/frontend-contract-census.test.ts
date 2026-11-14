// Two pins on how the Frontend Contract is built (`src/ir/contract/`).
//
// 1. The allowlist.  Every spec the contract is copied through is listed below
//    with the fields it SHIPS — every classified field that is neither dropped
//    nor denied.  The spec types already make an unclassified IR field a
//    compile error; this pin makes a newly SHIPPED field a reviewed change: a
//    field that reaches the contract fails here until it is added to the list,
//    and a field that stops shipping fails until it is removed.
//
// 2. The wire source (owner ruling, D-FRONTEND-CONTRACT).  The contract reads
//    its wire half through `declaredResponseFor` / `contractResponsesFor`
//    (`src/ir/util/declared-response.ts`) and never reads the derived wire
//    shape itself: no module under `src/ir/contract/` names a `wireFieldsFor*`
//    helper, imports `wire-projection` (where they live) or `mask-taint` (which
//    stays server-side).  Retiring the derived shape then changes no contract
//    code.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { shippedFields } from "../../../src/ir/contract/allowlist.js";
import "../../../src/ir/contract/frontend-contract.js";
import { REPO_ROOT } from "../../_helpers/ddd-corpus.js";

const SHIPPED: Record<string, string[] | null> = {
  ActionIR: ["body", "name", "params"],
  ApiIR: ["errorStatuses", "name", "routes", "sourceModule", "urlStyle"],
  ApiOperationParamIR: ["location", "name", "type"],
  ComponentIR: ["actions", "body", "derived", "extern", "externPath", "name", "params", "state"],
  ContractAggregate: ["context", "history", "name"],
  ContractField: ["name", "optional", "type"],
  ContractInvariant: ["expr", "guard", "message"],
  ContractFind: ["aggregate", "name", "params", "returnType", "routes", "sortDefault"],
  ContractFindRoute: ["api", "path"],
  ContractParam: ["name", "type"],
  ContractOperation: [
    "aggregate",
    "claimedByExplicitRoute",
    "errorStatuses",
    "id",
    "idTokens",
    "ifMatch",
    "invariants",
    "kind",
    "method",
    "opName",
    "optionalParams",
    "params",
    "path",
    "responseType",
  ],
  DerivedIR: ["expr", "name", "type"],
  EventIR: ["fields", "name"],
  "ExprIR.action-ref": ["actionName", "paramType", "storeName"],
  "ExprIR.authz-filter": null,
  "ExprIR.binary": ["left", "leftType", "op", "resultType", "right", "rightType"],
  "ExprIR.call": [
    "argNames",
    "args",
    "awaited",
    "callKind",
    "name",
    "resourceOp",
    "resultType",
    "storeAction",
    "style",
  ],
  "ExprIR.convert": ["from", "target", "value"],
  "ExprIR.duration": ["amount", "unit"],
  "ExprIR.exists": null,
  "ExprIR.i18nFormat": ["format", "inner"],
  "ExprIR.id": [],
  "ExprIR.lambda": ["block", "body", "param"],
  "ExprIR.list": ["elementType", "elements"],
  "ExprIR.literal": ["lit", "value"],
  "ExprIR.match": ["arms", "otherwise", "subject", "subjectShape", "subjectType", "variantArms"],
  "ExprIR.member": ["member", "memberType", "receiver", "receiverType"],
  "ExprIR.method-call": [
    "argNames",
    "args",
    "awaited",
    "isCollectionOp",
    "isIntrinsicMatcher",
    "member",
    "receiver",
    "receiverType",
    "resultType",
    "throwKind",
  ],
  "ExprIR.modelText": ["defaultText", "key"],
  "ExprIR.new": ["fields", "nested", "partName"],
  "ExprIR.object": ["fields"],
  "ExprIR.paren": ["inner"],
  "ExprIR.ref": [
    "enumCandidates",
    "enumName",
    "name",
    "refKind",
    "resourceApiName",
    "resourceKind",
    "resourceName",
    "storeName",
    "type",
  ],
  "ExprIR.ternary": ["cond", "otherwise", "then"],
  "ExprIR.this": [],
  "ExprIR.unary": ["op", "operand"],
  FieldIR: ["name", "optional", "type"],
  LayoutIR: ["footer", "header", "name", "sidebar"],
  MatchArm: ["cond", "value"],
  MenuBlockIR: ["sections"],
  "MenuLinkIR.external": ["label", "url"],
  "MenuLinkIR.page": ["pageName", "props", "route"],
  MenuMetaIR: ["entries"],
  MenuSectionIR: ["label", "links"],
  MessageIR: ["key", "text"],
  NamedExpr: ["name", "value"],
  PageIR: [
    "actions",
    "area",
    "body",
    "derived",
    "emitPath",
    "layout",
    "menuMeta",
    "metadata",
    "name",
    "params",
    "requires",
    "route",
    "state",
    "title",
  ],
  "PageLayoutIR.named": ["ref"],
  "PageLayoutIR.preset": ["name"],
  PageMetadataIR: ["canonical", "description", "ogImage"],
  ParamIR: ["default", "name", "type"],
  PathIR: ["segments"],
  PayloadGeneric: ["arg", "ctor"],
  PayloadIR: ["fields", "generic", "kind", "name", "variants"],
  RefetchTargetIR: ["aggregate", "queryTag"],
  ResourceOp: ["boundApi", "capability", "interface", "resourceKind", "resourceName", "verb"],
  ContractResponse: ["entity", "fields", "name"],
  ContractResponseField: ["maskable", "name", "optional", "provenanced", "type"],
  ReturnVariantIR: ["variantShape", "variantTag"],
  RouteIR: ["method", "path", "target"],
  RouteTarget: ["context", "handler"],
  StateFieldIR: ["init", "name", "type"],
  "StmtIR.add": ["collection", "elementType", "target", "value"],
  "StmtIR.assign": ["target", "targetType", "value"],
  "StmtIR.call": ["args", "name", "store", "target", "targetPrivate"],
  "StmtIR.emit": null,
  "StmtIR.expression": ["expr"],
  "StmtIR.if": ["cond", "elseBody", "thenBody"],
  "StmtIR.let": ["expr", "name", "type"],
  "StmtIR.precondition": ["expr", "message", "source"],
  "StmtIR.remove": ["collection", "elementType", "target", "value"],
  "StmtIR.requires": ["expr", "source"],
  "StmtIR.return": ["armVariants", "value", "variantShape", "variantTag"],
  "StmtIR.variant-match": ["arms", "elseBody", "subject", "subjectShape", "subjectType"],
  StoreAction: ["action", "store"],
  StoreIR: ["actions", "lifetime", "name", "state"],
  StyleEntry: ["key", "value"],
  StyleIR: ["entries"],
  "TypeIR.action": ["arg"],
  "TypeIR.array": ["element"],
  "TypeIR.entity": ["declKind", "name"],
  "TypeIR.enum": ["name"],
  "TypeIR.genericInstance": ["arg", "ctor"],
  "TypeIR.id": ["targetName"],
  "TypeIR.none": [],
  "TypeIR.optional": ["inner"],
  "TypeIR.primitive": ["name"],
  "TypeIR.slot": [],
  "TypeIR.union": ["variants"],
  "TypeIR.valueobject": ["name"],
  UiApiParamIR: ["apiName", "name"],
  UiChannelParamIR: ["channelName", "contextName", "name"],
  UiFunctionIR: ["externPath", "name", "params", "returnType"],
  UiIR: [
    "apiParams",
    "channelParams",
    "components",
    "framework",
    "functions",
    "menu",
    "name",
    "notifications",
    "pages",
    "stores",
  ],
  UiNotificationIR: ["bind", "eventType", "paramName", "refetches", "toasts"],
  VariantArm: ["binding", "isError", "value", "varType"],
  VariantStmtArm: ["binding", "body", "isError", "varType"],
};

describe("Frontend Contract allowlist", () => {
  it("ships exactly the pinned fields of every spec", () => {
    expect(shippedFields()).toEqual(SHIPPED);
  });
});

const CONTRACT_DIR = join(REPO_ROOT, "src", "ir", "contract");

/** What a contract module must not name: the derived wire-shape helpers, and
 *  the modules that hold them or the server-side mask analysis. */
const FORBIDDEN: readonly { what: string; re: RegExp }[] = [
  { what: "a wireFieldsFor* helper", re: /\bwireFieldsFor\w*/ },
  { what: "an import of wire-projection", re: /from\s+["'][^"']*\/wire-projection(\.js)?["']/ },
  { what: "an import of mask-taint", re: /from\s+["'][^"']*\/mask-taint(\.js)?["']/ },
];

function contractSources(): { file: string; text: string }[] {
  return readdirSync(CONTRACT_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({
      file: relative(REPO_ROOT, join(CONTRACT_DIR, f)),
      text: readFileSync(join(CONTRACT_DIR, f), "utf8"),
    }));
}

/** The offending `file: what` pairs in `sources`. */
function wireSourceViolations(sources: readonly { file: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { file, text } of sources) {
    for (const { what, re } of FORBIDDEN) if (re.test(text)) out.push(`${file}: ${what}`);
  }
  return out;
}

describe("Frontend Contract wire source", () => {
  it("no contract module reads the derived wire shape", () => {
    const sources = contractSources();
    expect(sources.map((s) => s.file)).toContain("src/ir/contract/frontend-contract.ts");
    expect(wireSourceViolations(sources)).toEqual([]);
  });

  it("names each forbidden reach when a module makes it", () => {
    const seeded = [
      {
        file: "seed.ts",
        text: [
          'import { wireMaskPlan } from "../enrich/wire-projection.js";',
          'import { maskedReadPredicates } from "../enrich/mask-taint.js";',
          "const f = wireFieldsForAggregate(agg);",
        ].join("\n"),
      },
    ];
    expect(wireSourceViolations(seeded)).toEqual([
      "seed.ts: a wireFieldsFor* helper",
      "seed.ts: an import of wire-projection",
      "seed.ts: an import of mask-taint",
    ]);
  });
});
