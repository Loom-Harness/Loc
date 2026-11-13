// A6 string interpolation — hole-type check.  A backtick template
// (`TemplateStr`) lowers to `string + <hole>` concatenation, so every hole
// must be a value the implicit `string + X` rule already stringifies:
// `string` itself, the numeric primitives, `bool`, an enum, an `X id`, or an
// aggregate carrying a `derived display: string`.  A hole of any other type
// (`datetime`, `duration`, a raw aggregate without `display`, a collection)
// has no stringification and is rejected here — the same set the explicit
// `string(x)` conversion admits.
//
//   loom.interp-hole-type — the hole expression is not stringifiable
//   loom.interp-format-dropped-in-domain (warning) — an ICU `plural` /
//     `select` / `selectordinal` hole in a template that lowers into backend
//     domain code (a `derived`, `function` or `operation` body).  Every
//     backend renders an `i18nFormat` hole as its bare value, so the branch
//     text is silently lost (ruling D8; rendering the branches is a mission).
//   loom.interp-format-invalid — a `plural` / `select` / `selectordinal` body
//     that is not ICU every runtime can render: a missing `other` branch, a
//     plural selector that is no CLDR category or `=N`, unbalanced braces
//     (`#syntax`), or a branch reading a value other than the hole's own
//     (`#nested-arg`) — the call site hands the runtime only the hole's value.

import type { AstNode, ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { type IcuNode, IcuSyntaxError, parseIcu } from "../../i18n/icu.js";
import {
  isDerivedProp,
  isDomainServiceOperation,
  isFunctionDecl,
  isOperation,
  isTemplateStr,
  isUi,
  type Model,
} from "../generated/ast.js";
import {
  envForNode,
  isImplicitlyStringifiable,
  type Ty,
  typeOf,
  typeToString,
} from "../type-system.js";
import { modelContents } from "./model-contents.js";

/** ICU format kinds Loom supports (i18n, M-T1.11).  `currency`/`percent` are
 *  NUMBER sub-skeletons (`, number, ::currency/USD`), so the number ICU *type*
 *  covers all three; `plural`/`selectordinal` are the count-driven branch forms
 *  and `select` the string-driven one — all rendered natively by the
 *  `intl-messageformat` runtime the shim ships. */
type FormatKind = "number" | "date" | "time" | "plural" | "select" | "unsupported";

/** The ICU top-level type of a raw format suffix (`", number, ::currency/USD"`
 *  → `"number"`, `", plural, one {…} other {…}"` → `"plural"`), or `undefined`
 *  when the hole carries no format. */
function formatKind(format: string | undefined): FormatKind | undefined {
  if (format === undefined) return undefined;
  // Strip the leading comma, take the first token (the ICU argType).
  const argType = format.replace(/^,/, "").trim().split(/[\s,]/)[0] ?? "";
  if (argType === "number" || argType === "date" || argType === "time") return argType;
  // `plural` and `selectordinal` are both count-driven (numeric arg); `select`
  // is string-driven.  Normalise `selectordinal` onto `plural`'s numeric rule.
  if (argType === "plural" || argType === "selectordinal") return "plural";
  if (argType === "select") return "select";
  return "unsupported";
}

/** The ICU branch forms whose branch TEXT only the frontend i18n runtime
 *  renders: every backend leaf table renders `i18nFormat` as its bare value. */
const BRANCH_FORMATS = new Set(["plural", "select", "selectordinal"]);

/** The raw ICU argType of a format suffix (`", plural, one {…}"` → `plural`). */
function icuArgType(format: string): string {
  return format.replace(/^,/, "").trim().split(/[\s,]/)[0] ?? "";
}

/** The enclosing declaration kind when `node` sits in a body that lowers into
 *  backend domain code — a `derived`, a `function`, an `operation` (aggregate
 *  or domain-service) — or `undefined` (a page slot, a ui function, a test …). */
function domainCodeHost(node: AstNode): "derived" | "function" | "operation" | undefined {
  let host: "derived" | "function" | "operation" | undefined;
  for (let n: AstNode | undefined = node.$container; n; n = n.$container) {
    if (isUi(n)) return undefined;
    if (host) continue;
    if (isDerivedProp(n)) host = "derived";
    else if (isFunctionDecl(n)) host = "function";
    else if (isOperation(n) || isDomainServiceOperation(n)) host = "operation";
  }
  return host;
}

/** The first placeholder a branch body reads — any `{name…}` nested inside a
 *  branch, at any depth — or undefined when every branch is text and `#`. */
function nestedArg(choice: IcuNode): string | undefined {
  if (choice.kind !== "choice") return undefined;
  const visit = (nodes: readonly IcuNode[]): string | undefined => {
    for (const n of nodes) {
      if (n.kind === "arg" || n.kind === "choice") return n.name;
    }
    return undefined;
  };
  for (const o of choice.options) {
    const name = visit(o.body);
    if (name !== undefined) return name;
  }
  return undefined;
}

/** Why a branch-format hole is not renderable ICU, or undefined when it is.
 *  `label` names the hole in the parser's messages — the hole's source text
 *  when that is a plain path (`order.count`), else a stand-in: the emitters
 *  derive the real placeholder name, and only the body is the author's. */
function branchFormatProblem(
  label: string,
  format: string,
): { syntax: string } | { nestedArg: string } | undefined {
  let nodes: IcuNode[];
  try {
    nodes = parseIcu(`{${label}${format}}`);
  } catch (e) {
    if (e instanceof IcuSyntaxError) return { syntax: e.message };
    throw e;
  }
  const name = nodes.length === 1 ? nestedArg(nodes[0]!) : undefined;
  return name === undefined ? undefined : { nestedArg: name };
}

function isNumericType(t: Ty): boolean {
  return (
    t.kind === "primitive" &&
    (t.name === "int" || t.name === "long" || t.name === "decimal" || t.name === "money")
  );
}

export function checkTemplateHoles(model: Model, accept: ValidationAcceptor): void {
  for (const node of modelContents(model)) {
    if (!isTemplateStr(node)) continue;
    const env = envForNode(node);
    let host: ReturnType<typeof domainCodeHost> | null = null; // null = not yet computed
    for (let i = 0; i < node.holes.length; i++) {
      const hole = node.holes[i]!;
      if (hole.format !== undefined && BRANCH_FORMATS.has(icuArgType(hole.format))) {
        const text = hole.value.$cstNode?.text.trim() ?? "";
        const label = /^[^\s{},#<>'"]+$/.test(text) ? text : "value";
        const problem = branchFormatProblem(label, hole.format);
        if (problem) {
          const format = icuArgType(hole.format);
          accept(
            "error",
            "syntax" in problem
              ? diagMessage("loom.interp-format-invalid#syntax", { format, detail: problem.syntax })
              : diagMessage("loom.interp-format-invalid#nested-arg", {
                  format,
                  name: problem.nestedArg,
                }),
            { node, property: "holes", index: i, code: "loom.interp-format-invalid" },
          );
        }
        if (host === null) host = domainCodeHost(node);
        if (host) {
          accept(
            "warning",
            diagMessage("loom.interp-format-dropped-in-domain", {
              format: icuArgType(hole.format),
              host,
            }),
            { node, property: "holes", index: i, code: "loom.interp-format-dropped-in-domain" },
          );
        }
      }
      const t: Ty = typeOf(hole.value, env);
      // `unknown` is already reported upstream (unresolved ref / bad expr) —
      // fail open so we don't double-report.
      if (t.kind === "unknown") continue;

      const kind = formatKind(hole.format);
      if (kind !== undefined) {
        // A `, format` suffix (i18n) narrows what the hole may hold.
        if (kind === "unsupported") {
          accept(
            "error",
            diagMessage("loom.interp-format-unknown", { format: hole.format?.trim() }),
            { node, property: "holes", index: i, code: "loom.interp-format-unknown" },
          );
          continue;
        }
        if (kind === "select") {
          // `select` matches the value (coerced to a string by ICU) against its
          // branch keys — any stringifiable hole works (string, enum, id, …).
          if (t.kind === "primitive" && t.name === "string") continue;
          if (isImplicitlyStringifiable(t)) continue;
          accept(
            "error",
            diagMessage("loom.interp-hole-type#select-format", { t: typeToString(t) }),
            { node, property: "holes", index: i, code: "loom.interp-hole-type" },
          );
          continue;
        }
        if (kind === "date" || kind === "time") {
          // Date/time formatting LIFTS the datetime rejection below — a
          // `datetime` hole is exactly what these skeletons format.  A
          // calendar `date` formats under `{x, date}` only: it has no
          // time-of-day for a `time` skeleton to show.
          if (t.kind === "primitive" && t.name === "datetime") continue;
          if (kind === "date" && t.kind === "primitive" && t.name === "date") continue;
          accept(
            "error",
            diagMessage("loom.interp-hole-type#date-format", { kind, t: typeToString(t) }),
            { node, property: "holes", index: i, code: "loom.interp-hole-type" },
          );
          continue;
        }
        // kind === "number" | "plural" — both operate on a numeric value (the
        // locale formatter renders it; plural selects a branch by its count).
        if (isNumericType(t)) continue;
        accept(
          "error",
          diagMessage("loom.interp-hole-type#number-format", { kind, t: typeToString(t) }),
          { node, property: "holes", index: i, code: "loom.interp-hole-type" },
        );
        continue;
      }

      // No format suffix — the original stringifiable-hole rule.
      const isString = t.kind === "primitive" && t.name === "string";
      if (isString || isImplicitlyStringifiable(t)) continue;
      accept(
        "error",
        diagMessage("loom.interp-hole-type#not-stringifiable", { t: typeToString(t) }),
        { node, property: "holes", index: i, code: "loom.interp-hole-type" },
      );
    }
  }
}
