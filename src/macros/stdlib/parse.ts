// ALWAYS-ON: the built-in parse service.  A context whose code calls a parse
// method on a string (`s.toInt()`, `s.toLong()`, `s.toDecimal()`,
// `s.toDate()`) gets these members, built here as final AST:
//
//   enum ParseTarget { Int, Long, Decimal, Date }
//   enum ParseFailure { Empty, Malformed, OutOfRange }
//   error ParseError { input: string  expected: ParseTarget  reason: ParseFailure }
//   domainService LoomParse {
//     operation toInt(s: string): int or ParseError { … }
//     …
//   }
//
// The typing and the lowering route `s.toInt()` to `LoomParse.toInt(s)`, so
// the rules below are the one place a parse decides what text it accepts, and
// every backend renders them through its ordinary domain-service emission:
//
//   - the empty string fails `Empty`; anything else that is not exactly the
//     target's text form fails `Malformed` — no surrounding space, no `+`, no
//     grouping, no exponent, no locale (`" 1"`, `"+1"`, `"1,5"`, `"1e3"`,
//     `".5"` and `"5."` are all malformed);
//   - int: `-?[0-9]+` within −2147483648…2147483647; long: within
//     ±9007199254740991 (the largest integer every backend holds exactly);
//     decimal: `-?[0-9]+(.[0-9]+)?` with at most 28 significant digits, and
//     `-0` parses to 0; date: `yyyy-MM-dd`, a real calendar day of year 1 or
//     later.  Leading zeros are allowed and do not count toward a limit.
//     Text outside a range fails `OutOfRange`.
//
// Each op ends with an internal `unchecked*` conversion, which only ever sees
// text the checks above accepted.  The names are reserved: an authored
// declaration of any of them is refused (`loom.intrinsic-parse#reserved-name`).

import { type AstNode, AstUtils } from "langium";
import {
  type BoundedContext,
  type BuilderCall,
  type BuilderEntry,
  type DomainService,
  type DomainServiceOperation,
  type Expression,
  type IfStmt,
  isBoundedContext,
  isMemberSuffix,
  type LetStmt,
  type Model,
  type ReturnStmt,
  type Statement,
  type UnaryExpr,
} from "../../language/generated/ast.js";
import {
  BUILTIN_PARSE_TAG,
  isBuiltinParseDecl,
  PARSE_ERROR,
  PARSE_FAILURE,
  PARSE_FAILURES,
  PARSE_METHODS,
  PARSE_SERVICE,
  PARSE_TARGET,
  type ParseMethod,
  parseMethod,
} from "../../util/parse-methods.js";
import { mkAst } from "../api/_mk.js";
import { typeAtom } from "../api/factories.js";
import {
  binaryExpr,
  enumDecl,
  errorRecord,
  field,
  intLit,
  memberAccess,
  namedType,
  nameRef,
  not,
  param,
  paren,
  primType,
  stringLit,
} from "../api/index.js";

/** Splice the parse service into every context that calls a parse method. */
export function spliceParseServices(model: Model): void {
  for (const ctx of AstUtils.streamAllContents(model).filter(isBoundedContext)) {
    if (!callsParseMethod(ctx)) continue;
    if (ctx.members.some((m) => isBuiltinParseDecl(m))) continue;
    for (const m of parseMembers()) {
      (m as { [BUILTIN_PARSE_TAG]?: true })[BUILTIN_PARSE_TAG] = true;
      const members = ctx.members as AstNode[];
      const mm = m as {
        $container?: AstNode;
        $containerProperty?: string;
        $containerIndex?: number;
      };
      mm.$container = ctx;
      mm.$containerProperty = "members";
      mm.$containerIndex = members.length;
      members.push(m);
    }
  }
}

function callsParseMethod(ctx: BoundedContext): boolean {
  return AstUtils.streamAllContents(ctx).some(
    (n) =>
      isMemberSuffix(n) && n.call && n.args.length === 0 && parseMethod(n.member) !== undefined,
  );
}

function parseMembers(): AstNode[] {
  const target = enumDecl(
    PARSE_TARGET,
    PARSE_METHODS.map((m) => m.target),
  );
  const failure = enumDecl(PARSE_FAILURE, [...PARSE_FAILURES]);
  const error = errorRecord(PARSE_ERROR, [
    field("input", primType("string")),
    field("expected", namedType(PARSE_TARGET)),
    field("reason", namedType(PARSE_FAILURE)),
  ]);
  const service = wire(
    mkAst<DomainService>({
      $type: "DomainService",
      name: PARSE_SERVICE,
      operations: PARSE_METHODS.map(parseOperation),
      tests: [],
    }),
  );
  return [target, failure, error, service];
}

const S = "s";

function parseOperation(m: ParseMethod): DomainServiceOperation {
  const returnType = primType(m.type);
  const alt = typeAtom(namedType(PARSE_ERROR));
  (returnType as { alternatives: unknown[] }).alternatives = [alt];
  const fail = (reason: string): ReturnStmt =>
    ret(
      mkAst<BuilderCall>({
        $type: "BuilderCall",
        type: PARSE_ERROR,
        entries: [
          entry("input", nameRef(S)),
          entry("expected", memberAccess(nameRef(PARSE_TARGET), m.target)),
          entry("reason", memberAccess(nameRef(PARSE_FAILURE), reason)),
        ],
      }),
    );
  const stmts: Statement[] = [
    ifThen(binaryExpr(nameRef(S), "==", stringLit("")), fail("Empty")),
    ...checks(m, fail),
  ];
  return mkAst<DomainServiceOperation>({
    $type: "DomainServiceOperation",
    name: m.name,
    params: [param(S, primType("string"))],
    returnType,
    stmts,
    audited: false,
    extern: false,
    private: false,
  });
}

/** The format and range checks after `Empty`, ending with the conversion. */
function checks(m: ParseMethod, fail: (reason: string) => ReturnStmt): Statement[] {
  const malformed = (re: string) => ifThen(not(matches(re)), fail("Malformed"));
  const outOfRange = (cond: Expression) => ifThen(cond, fail("OutOfRange"));
  const convert = (name = m.unchecked) => memberAccess(nameRef(S), name, { call: true });
  switch (m.type) {
    case "int":
      return [
        malformed("^-?[0-9]+$"),
        outOfRange(not(matches("^-?0*[0-9]{1,10}$"))),
        let_("v", convert("uncheckedLong")),
        outOfRange(
          binaryExpr(
            binaryExpr(nameRef("v"), ">", intLit(2147483647)),
            "||",
            binaryExpr(neg(nameRef("v")), ">", intLit(2147483648)),
          ),
        ),
        ret(convert()),
      ];
    case "long":
      return [
        malformed("^-?[0-9]+$"),
        outOfRange(not(matches("^-?0*[0-9]{1,16}$"))),
        let_("v", convert()),
        outOfRange(
          binaryExpr(
            binaryExpr(nameRef("v"), ">", intLit(9007199254740991)),
            "||",
            binaryExpr(neg(nameRef("v")), ">", intLit(9007199254740991)),
          ),
        ),
        ret(nameRef("v")),
      ];
    case "decimal":
      return [
        malformed("^-?[0-9]+([.][0-9]+)?$"),
        // At most 28 digits once the leading zeros are set aside.
        outOfRange(not(matches("^-?0*(?=([.]?[0-9]){0,28}$)[0-9.]*$"))),
        // `+ 0` folds a negative zero (`-0`, `-0.00`) to zero on every backend.
        ret(binaryExpr(convert(), "+", intLit(0))),
      ];
    case "date": {
      const part = (start: number, len: number) =>
        memberAccess(
          memberAccess(nameRef(S), "substring", { call: true, args: [intLit(start), intLit(len)] }),
          "uncheckedInt",
          { call: true },
        );
      const eq = (name: string, n: number) => binaryExpr(nameRef(name), "==", intLit(n));
      const or = (a: Expression, b: Expression) => binaryExpr(a, "||", b);
      const and = (a: Expression, b: Expression) => binaryExpr(a, "&&", b);
      const rem = (n: number) => binaryExpr(nameRef("y"), "%", intLit(n));
      const leap = and(
        binaryExpr(rem(4), "==", intLit(0)),
        paren(or(binaryExpr(rem(100), "!=", intLit(0)), binaryExpr(rem(400), "==", intLit(0)))),
      );
      return [
        malformed("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
        let_("y", part(0, 4)),
        let_("m", part(5, 2)),
        let_("d", part(8, 2)),
        outOfRange(
          or(
            or(binaryExpr(nameRef("y"), "<", intLit(1)), binaryExpr(nameRef("m"), "<", intLit(1))),
            or(binaryExpr(nameRef("m"), ">", intLit(12)), binaryExpr(nameRef("d"), "<", intLit(1))),
          ),
        ),
        outOfRange(binaryExpr(nameRef("d"), ">", intLit(31))),
        outOfRange(
          and(
            paren(or(or(eq("m", 4), eq("m", 6)), or(eq("m", 9), eq("m", 11)))),
            binaryExpr(nameRef("d"), ">", intLit(30)),
          ),
        ),
        outOfRange(and(eq("m", 2), binaryExpr(nameRef("d"), ">", intLit(29)))),
        outOfRange(and(and(eq("m", 2), eq("d", 29)), not(paren(leap)))),
        ret(convert()),
      ];
    }
  }
}

const matches = (re: string) =>
  memberAccess(nameRef(S), "matches", { call: true, args: [stringLit(re)] });

function neg(operand: Expression): UnaryExpr {
  return wire(mkAst<UnaryExpr>({ $type: "UnaryExpr", op: "-", operand }));
}

function ret(value: Expression): ReturnStmt {
  return wire(mkAst<ReturnStmt>({ $type: "ReturnStmt", value }));
}

function let_(name: string, expr: Expression): LetStmt {
  return wire(mkAst<LetStmt>({ $type: "LetStmt", name, expr }));
}

function entry(name: string, value: Expression): BuilderEntry {
  return mkAst<BuilderEntry>({ $type: "BuilderEntry", name, value });
}

function ifThen(cond: Expression, then: Statement): IfStmt {
  return wire(mkAst<IfStmt>({ $type: "IfStmt", cond, thenBody: [then], elseBody: [] }));
}

/** Point every direct AST child of `node` (recursively) back at its parent —
 *  the container triple the parser would have set. */
function wire<T extends AstNode>(node: T): T {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    const children = Array.isArray(value) ? value : [value];
    children.forEach((child, i) => {
      if (!child || typeof child !== "object" || !("$type" in child)) return;
      const c = child as {
        $container?: AstNode;
        $containerProperty?: string;
        $containerIndex?: number;
      };
      c.$container = node;
      c.$containerProperty = key;
      if (Array.isArray(value)) c.$containerIndex = i;
      else delete c.$containerIndex;
      wire(child as AstNode);
    });
  }
  return node;
}
