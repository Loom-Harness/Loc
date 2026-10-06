// Per-`ExprIR.kind` pinning for the FLUTTER target — the M-T9.14 residue
// ("no per-kind `ExprIR` pinning"), and the Dart twin of the backends'
// `render-expr-kinds.test.ts` suites (typescript / dotnet / java / python).
//
// Every kind in the `ExprIR` union is driven through the SAME entry point a
// generated page uses — the shared walker's `emitExpr` with `flutterTarget`
// bound, which forwards each syntax arm to `DART_LEAVES` and the money /
// temporal / intrinsic / collection-op seams in `dart-expr.ts` — and its Dart
// text is pinned byte-exact.  Kinds with no client-side meaning (`this`,
// `authz-filter`) are pinned as the LOUD refusal they are, never as a
// placeholder; that refusal IS their Dart output.
//
// Why a table here rather than more full-generation tests: the kind arms were
// exercised only incidentally, through whichever `.ddd` happened to put a
// given expression in a page body — `dart-intrinsics.test.ts` covers the
// intrinsic table and `money.test.ts` the money arms, but nothing held, say,
// `paren`, `match`-as-value, `new`, `object` or `duration` to a spelling, and
// the `paren` arm is the recorded example of a kind that silently rendered
// `undefined` on every frontend (walker-core.ts's comment on that arm).
//
// Two vacuity guards, because a pin table is only as good as its coverage:
//   1. the pinned KINDS are exactly the `ExprIR` union's kinds, read off
//      `src/ir/types/loom-ir.ts` at test time (comments stripped) — a new kind
//      fails here until it is pinned, and a pin keyed on a stale kind fails
//      too; each pin's expression must BE of the kind it is filed under;
//   2. every leaf in `DART_LEAVES` (the table `flutterTarget` forwards to) is
//      reached by at least one pin — a leaf no pin reaches is a leaf whose
//      Dart spelling nothing holds.
//
// MUTATION-PROVEN (wave C3 packet 3b), each seeded defect restored by file
// copy and md5-verified, never `git checkout --`:
//   - `DART_LEAVES.literal`'s money arm returning the bare number (the M-T1.21
//     defect) fails the money literal pin AND both money-binary pins;
//   - walker-core's `paren` arm dropping its brackets fails "paren: grouping
//     survives" (`(1 + 2)` received for `((1 + 2))`);
//   - an extra, unreached `DART_LEAVES` entry fails "reaches every leaf"
//     naming it;
//   - emptying the `duration` pins fails "pins exactly the ExprIR union's
//     kinds" naming `duration`.
//
// Dart COMPILATION of these spellings is `generated-flutter-build.yml`'s job
// (`flutter analyze` + `flutter build web`); a string table cannot prove it.
// What this table proves is that the spelling does not change unseen.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitExpr, type WalkContext } from "../../../src/generator/_walker/walker-core.js";
import { DART_LEAVES } from "../../../src/generator/flutter/dart-expr.js";
import { flutterTarget } from "../../../src/generator/flutter/flutter-target.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;
const STRING = prim("string");
const INT = prim("int");
const MONEY = prim("money");
const DATETIME = prim("datetime");
const DURATION = prim("duration");

const lit = (l: string, value: string): ExprIR => ({ kind: "literal", lit: l, value }) as ExprIR;
const state = (name: string): ExprIR => ({ kind: "ref", name, refKind: "param" });
const lam = (name: string): ExprIR => ({ kind: "ref", name, refKind: "lambda" });

/** A walk context carrying only what `emitExpr` reads, with `flutterTarget`
 *  bound — the shape `walkBody` builds for a real page (walker-core.ts), minus
 *  the pack (no expression arm consults it).  `total` is a page `state` field
 *  and `orderId` a route param, so the ref arm's two scoped lookups are real. */
function ctx(): WalkContext {
  return {
    target: flutterTarget,
    imports: new Map(),
    pack: {},
    paramNames: new Set(["orderId"]),
    paramTypes: new Map(),
    pageRoutes: new Map(),
    usedParams: new Set(),
    usesNavigate: false,
    usesTableSort: false,
    usesTableFilter: false,
    usesDataGrid: false,
    stateNames: new Set(["total", "until", "items"]),
    derivedNames: new Set(),
    usesState: false,
    usesCurrentUser: false,
    usesRouterLink: false,
    usesRouteId: false,
    userComponents: new Map(),
    usedUserComponents: new Set(),
    usesChildren: false,
    apiParamNames: new Set(),
    usedApiHooks: new Map(),
    lambdaParams: new Map(),
    shellLocals: new Set(),
    aggregatesByName: new Map(),
    bcByAggregate: new Map([
      [
        "Order",
        {
          name: "Sales",
          aggregates: [],
          valueObjects: [{ name: "Price", fields: [{ name: "amount" }, { name: "currency" }] }],
        },
      ],
    ]),
    workflowsByName: new Map(),
    projectionsByName: new Set(),
    listShapedProjections: new Set(),
    bcByWorkflow: new Map(),
    formOfs: [],
    sink: {},
    hoistedModuleDecls: [],
    hoistedComponentFiles: [],
    actionMutations: [],
    collectedTestids: new Set(),
    usesCodeBlock: false,
    usesFileUpload: false,
    usesFragment: false,
    usedExternFunctions: new Set(),
    usedActions: new Set(),
    usedStores: new Map(),
  } as unknown as WalkContext;
}

type Pin =
  | { name: string; expr: ExprIR; dart: string }
  | { name: string; expr: ExprIR; throws: RegExp };

/** One or more pins per `ExprIR.kind`.  A `Record` over the union, so the
 *  test typecheck (`scripts/test-typecheck.mjs`) flags a missing kind before
 *  the runtime guard below does. */
const PINS: Record<ExprIR["kind"], Pin[]> = {
  literal: [
    {
      name: "string — single-quoted, `$` escaped",
      expr: lit("string", "it's $5"),
      dart: "'it\\'s \\$5'",
    },
    { name: "int verbatim", expr: lit("int", "42"), dart: "42" },
    { name: "long verbatim", expr: lit("long", "1234567890123456"), dart: "1234567890123456" },
    { name: "decimal verbatim", expr: lit("decimal", "1.25"), dart: "1.25" },
    { name: "money — the wire STRING at scale 4", expr: lit("money", "12.5"), dart: "'12.5000'" },
    { name: "bool", expr: lit("bool", "true"), dart: "true" },
    { name: "null", expr: lit("null", ""), dart: "null" },
    { name: "now — UTC", expr: lit("now", "now"), dart: "DateTime.now().toUtc()" },
  ],
  this: [
    {
      name: "refused — no aggregate instance on a frontend",
      expr: { kind: "this" },
      throws: /`this` has no meaning/,
    },
  ],
  id: [{ name: "the route id local", expr: { kind: "id" }, dart: "id" }],
  ref: [
    { name: "route param", expr: state("orderId"), dart: "orderId" },
    {
      name: "page state field — the Riverpod `state.` read",
      expr: { kind: "ref", name: "total", refKind: "let" },
      dart: "state.total",
    },
    {
      name: "let binding",
      expr: { kind: "ref", name: "subtotal", refKind: "let" },
      dart: "subtotal",
    },
    {
      name: "enum member — the wire name as a Dart string",
      expr: { kind: "ref", name: "Draft", refKind: "enum-value", enumName: "Status" } as ExprIR,
      dart: "'Draft'",
    },
  ],
  member: [
    {
      name: "plain field read",
      expr: {
        kind: "member",
        receiver: state("orderId"),
        member: "length",
        receiverType: STRING,
        memberType: INT,
      },
      dart: "orderId.length",
    },
  ],
  "method-call": [
    {
      name: "scalar intrinsic — Dart spelling",
      expr: {
        kind: "method-call",
        receiver: state("orderId"),
        member: "toUpper",
        args: [],
        receiverType: STRING,
        isCollectionOp: false,
      },
      dart: "(orderId.toUpperCase())",
    },
    {
      name: "collection op — `where` materialised with toList()",
      expr: {
        kind: "method-call",
        receiver: state("orderId"),
        member: "where",
        args: [{ kind: "lambda", param: "o", body: lit("bool", "true") }],
        receiverType: { kind: "array", element: STRING },
        isCollectionOp: true,
      } as ExprIR,
      dart: "(orderId).where((o) => true).toList()",
    },
  ],
  call: [
    {
      name: "value-object construction — a wire-shaped map",
      expr: {
        kind: "call",
        callKind: "free",
        name: "Price",
        args: [lit("decimal", "9.99"), lit("string", "USD")],
      },
      dart: "({'amount': 9.99, 'currency': 'USD'})",
    },
    {
      name: "free call verbatim",
      expr: { kind: "call", callKind: "free", name: "fee", args: [lit("int", "2")] },
      dart: "fee(2)",
    },
  ],
  lambda: [
    {
      name: "Dart arrow, same spelling as JS; its param resolves inside the body",
      expr: {
        kind: "lambda",
        param: "o",
        body: {
          kind: "member",
          receiver: lam("o"),
          member: "name",
          receiverType: STRING,
          memberType: STRING,
        },
      },
      dart: "(o) => o.name",
    },
  ],
  new: [
    {
      name: "part construction — a wire-shaped map",
      expr: {
        kind: "new",
        partName: "Line",
        fields: [{ name: "qty", value: lit("int", "3") }],
      },
      dart: "({'qty': 3})",
    },
  ],
  object: [
    {
      name: "a Dart map literal with quoted keys",
      expr: {
        kind: "object",
        fields: [
          { name: "a", value: lit("int", "1") },
          { name: "b", value: lit("string", "x") },
        ],
      },
      dart: "{'a': 1, 'b': 'x'}",
    },
  ],
  paren: [
    {
      name: "grouping survives — never `undefined`",
      expr: {
        kind: "paren",
        inner: { kind: "binary", op: "+", left: lit("int", "1"), right: lit("int", "2") },
      },
      dart: "((1 + 2))",
    },
  ],
  unary: [
    {
      name: "not",
      expr: { kind: "unary", op: "!", operand: lit("bool", "false") },
      dart: "(!false)",
    },
    { name: "negate", expr: { kind: "unary", op: "-", operand: lit("int", "4") }, dart: "(-4)" },
  ],
  binary: [
    {
      name: "plain operator — `==` spelled as Dart spells it",
      expr: { kind: "binary", op: "==", left: lit("int", "1"), right: lit("int", "2") },
      dart: "(1 == 2)",
    },
    {
      name: "money + money — LoomMoney, never String concatenation",
      expr: {
        kind: "binary",
        op: "+",
        left: state("total"),
        right: lit("money", "2.5"),
        leftType: MONEY,
        rightType: MONEY,
      },
      dart: "LoomMoney.add(state.total, '2.5000')",
    },
    {
      name: "money comparison — through LoomMoney.compare",
      expr: {
        kind: "binary",
        op: "<",
        left: state("total"),
        right: lit("money", "10"),
        leftType: MONEY,
        rightType: MONEY,
      },
      dart: "(LoomMoney.compare(state.total, '10.0000') < 0)",
    },
    {
      name: "datetime + duration — DateTime.add",
      expr: {
        kind: "binary",
        op: "+",
        left: state("until"),
        right: { kind: "duration", unit: "days", amount: lit("int", "7") },
        leftType: DATETIME,
        rightType: DURATION,
      },
      dart: "(state.until).add(Duration(milliseconds: ((7) * 86400000)))",
    },
  ],
  ternary: [
    {
      name: "Dart conditional",
      expr: {
        kind: "ternary",
        cond: lit("bool", "true"),
        // biome-ignore lint/suspicious/noThenProperty: ExprIR's ternary arm is named `then`
        then: lit("string", "a"),
        otherwise: lit("string", "b"),
      },
      dart: "(true ? 'a' : 'b')",
    },
  ],
  convert: [
    {
      name: "int → string",
      expr: { kind: "convert", target: "string", from: "int", value: lit("int", "5") },
      dart: "5.toString()",
    },
    {
      name: "money → string is the string itself",
      expr: { kind: "convert", target: "string", from: "money", value: state("total") },
      dart: "state.total",
    },
    {
      name: "string → money normalises through the runtime",
      expr: { kind: "convert", target: "money", from: "string", value: lit("string", "3") },
      dart: "LoomMoney.normalize('3')",
    },
    {
      name: "money → int goes through LoomMoney.toNum",
      expr: { kind: "convert", target: "int", from: "money", value: state("total") },
      dart: "LoomMoney.toNum(state.total).toInt()",
    },
  ],
  duration: [
    {
      name: "a Dart Duration of the shared millisecond span",
      expr: { kind: "duration", unit: "hours", amount: lit("int", "2") },
      dart: "Duration(milliseconds: ((2) * 3600000))",
    },
  ],
  i18nFormat: [
    {
      name: "transparent on the raw path — the wrapped operand",
      expr: { kind: "i18nFormat", format: "number", inner: lit("int", "5") } as ExprIR,
      dart: "5",
    },
  ],
  match: [
    {
      name: "value position with `else` — a right fold of Dart conditionals",
      expr: {
        kind: "match",
        arms: [
          { cond: lit("bool", "false"), value: lit("string", "a") },
          { cond: lit("bool", "true"), value: lit("string", "b") },
        ],
        otherwise: lit("string", "c"),
      } as ExprIR,
      dart: "(false ? 'a' : (true ? 'b' : 'c'))",
    },
    {
      name: "value position without `else` — the last arm is the tail",
      expr: {
        kind: "match",
        arms: [
          { cond: lit("bool", "false"), value: lit("string", "a") },
          { cond: lit("bool", "true"), value: lit("string", "b") },
        ],
      } as ExprIR,
      dart: "(false ? 'a' : 'b')",
    },
  ],
  list: [
    {
      name: "a Dart list literal",
      expr: { kind: "list", elements: [lit("string", "EU"), lit("string", "US")] },
      dart: "['EU', 'US']",
    },
  ],
  "action-ref": [
    {
      name: "a bare handler in value position — the hoisted local",
      expr: { kind: "action-ref", actionName: "approve" },
      dart: "approve",
    },
  ],
  "authz-filter": [
    {
      name: "refused — record policy is enforced server-side",
      expr: { kind: "authz-filter", filter: { kind: "deny" }, aggregate: "Order" } as ExprIR,
      throws: /authorization filter for 'Order' reached a page\/component body/,
    },
  ],
};

/** Every `kind:` literal in the `ExprIR` union, off the source (comments
 *  stripped) — the same enumeration `gate-expr.test.ts` measures against. */
function exprKindsFromSource(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, "../../../src/ir/types/loom-ir.ts"), "utf8");
  const start = src.indexOf("export type ExprIR =");
  const end = src.indexOf("\nexport ", start + 10);
  expect(start, "ExprIR union not found in loom-ir.ts").toBeGreaterThan(-1);
  const block = src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return [...new Set([...block.matchAll(/\bkind: "([A-Za-z0-9-]+)"/g)].map((m) => m[1]!))].sort();
}

describe("flutter emitExpr — one pinned Dart spelling per ExprIR kind", () => {
  for (const [kind, pins] of Object.entries(PINS)) {
    for (const pin of pins) {
      it(`${kind}: ${pin.name}`, () => {
        expect(pin.expr.kind, `pin filed under '${kind}' is a '${pin.expr.kind}'`).toBe(kind);
        if ("throws" in pin) {
          expect(() => emitExpr(pin.expr, ctx())).toThrow(pin.throws);
          return;
        }
        const out = emitExpr(pin.expr, ctx());
        expect(out).toBe(pin.dart);
        // Never a placeholder: a frontend that cannot render a kind throws or
        // is gated, it does not comment itself out.
        expect(out).not.toMatch(/unsupported|unresolved|undefined/);
      });
    }
  }
});

describe("flutter emitExpr — the pin table's vacuity guards", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pins exactly the ExprIR union's kinds, each at least once", () => {
    const pinned = Object.entries(PINS)
      .filter(([, pins]) => pins.length > 0)
      .map(([k]) => k)
      .sort();
    expect(pinned).toEqual(exprKindsFromSource());
  });

  it("reaches every leaf in DART_LEAVES", () => {
    const leaves = Object.keys(DART_LEAVES) as (keyof typeof DART_LEAVES)[];
    const spies = leaves.map((leaf) => [leaf, vi.spyOn(DART_LEAVES, leaf)] as const);
    for (const pins of Object.values(PINS)) {
      for (const pin of pins) {
        try {
          emitExpr(pin.expr, ctx());
        } catch {
          // the refusal pins are asserted above
        }
      }
    }
    const unreached = spies.filter(([, spy]) => spy.mock.calls.length === 0).map(([leaf]) => leaf);
    expect(
      unreached,
      "DART_LEAVES entries no pin reaches — their Dart spelling is unpinned",
    ).toEqual([]);
  });
});
