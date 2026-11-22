// The text-to-value parse methods (`s.toInt()`, `s.toLong()`, `s.toDecimal()`,
// `s.toDate()`) and the built-in declarations they answer with.
//
// A parse never throws: it returns `T or ParseError`, which the caller must
// `match`.  Its rules (what text is accepted, what is out of range) are written
// ONCE, as the Loom-bodied operations of the built-in `LoomParse` domain
// service the macro layer splices into each context that parses
// (`src/macros/stdlib/parse.ts`), so every backend renders the same decisions.
// The service reaches the host conversion through the internal `unchecked*`
// string intrinsics, which only run after its checks have passed and are
// refused anywhere else.
//
// Pure data, zero dependencies: the macro, the type system, the lowering and
// the validators all read it.

/** The built-in domain service holding the parse operations. */
export const PARSE_SERVICE = "LoomParse";
/** The built-in error record a failed parse returns. */
export const PARSE_ERROR = "ParseError";
/** The built-in enum naming what a parse was asked for. */
export const PARSE_TARGET = "ParseTarget";
/** The built-in enum naming why a parse failed. */
export const PARSE_FAILURE = "ParseFailure";

/** Marks a declaration the macro layer spliced as the built-in parse service
 *  (or one of its records), so the reserved-name check passes it. */
export const BUILTIN_PARSE_TAG = Symbol.for("loom.builtinParse");

/** Was `node` spliced as one of the built-in parse declarations? */
export function isBuiltinParseDecl(node: object): boolean {
  return (node as { [BUILTIN_PARSE_TAG]?: true })[BUILTIN_PARSE_TAG] === true;
}

/** The names only the built-in declarations may use. */
export const PARSE_RESERVED_NAMES: ReadonlySet<string> = new Set([
  PARSE_SERVICE,
  PARSE_ERROR,
  PARSE_TARGET,
  PARSE_FAILURE,
]);

export type ParseResultType = "int" | "long" | "decimal" | "date";

export interface ParseMethod {
  /** The method on a `string` receiver (`toInt`). */
  name: string;
  /** The type a successful parse returns. */
  type: ParseResultType;
  /** Its `ParseTarget` value (`Int`). */
  target: string;
  /** The internal conversion the service op ends with. */
  unchecked: string;
}

export const PARSE_METHODS: ReadonlyArray<ParseMethod> = [
  { name: "toInt", type: "int", target: "Int", unchecked: "uncheckedInt" },
  { name: "toLong", type: "long", target: "Long", unchecked: "uncheckedLong" },
  { name: "toDecimal", type: "decimal", target: "Decimal", unchecked: "uncheckedDecimal" },
  { name: "toDate", type: "date", target: "Date", unchecked: "uncheckedDate" },
];

/** `ParseFailure`'s values, in declaration order. */
export const PARSE_FAILURES = ["Empty", "Malformed", "OutOfRange"] as const;

/** The parse method `name` names on a `string` receiver, if any. */
export function parseMethod(name: string): ParseMethod | undefined {
  return PARSE_METHODS.find((m) => m.name === name);
}

/** Is `name` one of the internal `unchecked*` conversions? */
export function isUncheckedConversion(name: string): boolean {
  return PARSE_METHODS.some((m) => m.unchecked === name);
}
