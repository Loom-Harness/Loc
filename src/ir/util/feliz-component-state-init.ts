// A component `state {}` cell initialised from a component PARAM, on Feliz.
//
//     component Tag(start: int) { state { n: int = start } … }
//
// Shared by the IR validator (`ui-component-deferral-checks.ts`, which REPORTS
// the unresolvable shape) and the Feliz generator (`src/generator/feliz/`,
// which RENDERS the resolvable one) — one pure classification, so the gate and
// the renderer cannot drift.
//
// A Feliz app is ONE Elmish program: a component's state cells fold into the
// single app `Model` and are seeded by the app-level `init ()`
// (`src/generator/feliz/component-emit.ts`, "STATE + ACTIONS").  `init` runs
// once, before any view, with no component instance and so no props in scope —
// the initializer rendered as the bare param name (`N = start`) and
// `dotnet fable` stopped at "The value or constructor 'start' is not defined",
// from a `.ddd` that validated clean.
//
// The value a param carries is the CALL SITE's argument.  When every call site
// of the component passes the SAME constant for each param an initializer reads
// (built from literals and enum members only), that constant IS the param's
// value at init, and it substitutes in (`N = 7`).  That is exact, not an
// approximation: a Feliz component's state is program-scoped (all instances
// share it — the trade the store fold makes too), and with one agreeing value
// there is nothing for an instance to disagree about.
//
// Anything else — no call site, call sites that disagree, or an argument that
// reads page state / a lambda binder / the route — has no single init-time
// value: the component is deferred, and `loom.user-component-deferred-target`
// says so.

import type { ComponentIR, ExprIR, ParamIR, StateFieldIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** The resolution for one component whose `state {}` reads a param. */
export type FelizComponentStateInit =
  | {
      kind: "resolved";
      /** Per param-reading state cell (IR identity): the argument expression
       *  every call site agrees on, per param the initializer reads. */
      cells: ReadonlyMap<StateFieldIR, ReadonlyMap<string, ExprIR>>;
    }
  | {
      kind: "unresolved";
      /** The cells that read a param (each seeds its type's zero). */
      cells: readonly StateFieldIR[];
      /** Why there is no single init-time value — diagnostic text. */
      reason: string;
    };

/** The component params a state initializer reads. */
function paramsReadByInit(f: StateFieldIR, params: ReadonlySet<string>): string[] {
  const read = new Set<string>();
  walkExprDeep(f.init, (e) => {
    if (e.kind === "ref" && e.refKind === "param" && params.has(e.name)) read.add(e.name);
  });
  return [...read];
}

/** Expression kinds that compute from their operands alone (a `ref` is judged
 *  separately: only an enum member qualifies). */
const INIT_CONSTANT_KINDS: ReadonlySet<ExprIR["kind"]> = new Set([
  "literal",
  "unary",
  "binary",
  "ternary",
  "list",
  "convert",
]);

/** True when `e` has the same value at `init` as anywhere else — built only from
 *  literals and enum members.  A ref to page state, a param, a lambda binder or
 *  the route `id` is not bound in `init`. */
function isInitConstant(e: ExprIR): boolean {
  let ok = true;
  walkExprDeep(e, (n) => {
    if (n.kind === "ref" ? n.refKind !== "enum-value" : !INIT_CONSTANT_KINDS.has(n.kind)) {
      ok = false;
    }
  });
  return ok;
}

/** Structural identity of an argument, ignoring source positions. */
function exprKey(e: ExprIR): string {
  return JSON.stringify(e, (k, v) => (k === "origin" ? undefined : v));
}

/** The argument a call site passes for each param — named, or positional in
 *  declaration order skipping the params already filled by name (the
 *  resolution `felizTarget.renderUserComponent` applies). */
function callSiteArgs(
  call: Extract<ExprIR, { kind: "call" }>,
  params: readonly ParamIR[],
): Map<string, ExprIR> {
  const argNames = call.argNames ?? [];
  const filledByName = new Set(argNames.filter((n): n is string => n !== undefined));
  const out = new Map<string, ExprIR>();
  let cursor = 0;
  call.args.forEach((arg, i) => {
    const named = argNames[i];
    if (named !== undefined) {
      out.set(named, arg);
      return;
    }
    while (cursor < params.length && filledByName.has(params[cursor]!.name)) cursor += 1;
    const p = params[cursor];
    if (p !== undefined) {
      cursor += 1;
      out.set(p.name, arg);
    }
  });
  return out;
}

/** Every call of component `name` in the ui's page and component bodies. */
function callSites(ui: UiIR, name: string): Extract<ExprIR, { kind: "call" }>[] {
  const out: Extract<ExprIR, { kind: "call" }>[] = [];
  for (const owner of [...ui.pages, ...ui.components]) {
    walkExprDeep(owner.body, (e) => {
      if (e.kind === "call" && e.name === name) out.push(e);
    });
  }
  return out;
}

/** Classify one component; `undefined` when no `state {}` cell reads a param. */
export function felizComponentStateInit(
  ui: UiIR,
  c: ComponentIR,
): FelizComponentStateInit | undefined {
  if (c.extern) return undefined;
  const params = new Set(c.params.map((p) => p.name));
  const reading = c.state
    .map((f) => ({ f, read: paramsReadByInit(f, params) }))
    .filter(({ read }) => read.length > 0);
  if (reading.length === 0) return undefined;
  const cells = reading.map(({ f }) => f);
  const sites = callSites(ui, c.name).map((call) => callSiteArgs(call, c.params));
  if (sites.length === 0) {
    return {
      kind: "unresolved",
      cells,
      reason:
        "its `state {}` is seeded from a param, but no call site supplies a value — " +
        "the cell is part of the app-level Model, seeded by `init` with no props in scope",
    };
  }
  const agreed = new Map<string, ExprIR>();
  for (const p of new Set(reading.flatMap(({ read }) => read))) {
    let value: ExprIR | undefined;
    for (const args of sites) {
      const arg = args.get(p);
      if (arg === undefined || !isInitConstant(arg)) {
        return {
          kind: "unresolved",
          cells,
          reason:
            `its \`state {}\` is seeded from param '${p}', and a call site passes ` +
            `${arg === undefined ? "no value for it" : "a value that is not a constant"} — ` +
            "the cell is part of the app-level Model, seeded by `init` with no props in scope",
        };
      }
      if (value !== undefined && exprKey(value) !== exprKey(arg)) {
        return {
          kind: "unresolved",
          cells,
          reason:
            `its \`state {}\` is seeded from param '${p}', and its call sites pass ` +
            "different values — the cell is ONE app-level Model field shared by every instance",
        };
      }
      value = arg;
    }
    agreed.set(p, value!);
  }
  return {
    kind: "resolved",
    cells: new Map(
      reading.map(({ f, read }) => [f, new Map(read.map((p) => [p, agreed.get(p)!]))] as const),
    ),
  };
}
