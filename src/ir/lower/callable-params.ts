// ---------------------------------------------------------------------------
// The shared callable parameter binding (M-T5.21).
//
// Every callable site in the language — aggregate `operation` / `create` /
// `destroy`, `function`, `commandHandler` / `queryHandler`, a `domainService`
// operation, a workflow `create` / `handle` — lowers its parameter list the
// same way: lower each declared type, push a `ParamIR`, and bind the name as a
// `param` local so the body resolves it.  That loop was written SEVEN times
// across three lowerers, which is the `lower/` half of the finding M-T5.21's
// design records ("per-rule lowerers with near-identical param / return / body
// handling").
//
// The one axis that genuinely differs is whether a param DEFAULT
// (`param: T = <expr>`) is lowered, so it is a parameter of this helper rather
// than a fork of it — and the sites that pass `false` say why in their own
// comment.  Nothing else about the loop varied, which is why collapsing it is
// byte-identical.
//
// Leaf module: imports only the other `lower/` leaves, never `lower.ts`.
// ---------------------------------------------------------------------------

import type { Parameter } from "../../language/generated/ast.js";
import type { ParamIR } from "../types/loom-ir.js";
import { lowerExprInContext } from "./lower-expr.js";
import { type Env, lowerType, withLocal } from "./lower-types.js";

export interface LoweredCallableParams {
  /** The lowered parameter list, in declaration order. */
  readonly params: ParamIR[];
  /** `env` with every parameter bound as a `param` local — the env a body
   *  lowers in. */
  readonly env: Env;
}

/**
 * Lower a callable's parameter list and bind each name in a fresh body env.
 *
 * `defaults` decides whether a `param: T = <expr>` default is lowered onto the
 * `ParamIR`.  A default resolves in `env` — the SURROUNDING env, which for an
 * aggregate operation / create / destroy carries `this`, so a default may read
 * the target instance (`to: date = this.eta`).  Sibling parameters are
 * deliberately NOT in scope (defaults resolve against `env`, not the
 * accumulating body env), which keeps resolution order-independent.
 */
export function lowerCallableParams(
  declared: readonly Parameter[],
  env: Env,
  { defaults }: { defaults: boolean },
): LoweredCallableParams {
  let inner = env;
  const params: ParamIR[] = [];
  for (const p of declared) {
    const t = lowerType(p.type, env);
    const def = defaults && p.default ? lowerExprInContext(p.default, t, env) : undefined;
    params.push({ name: p.name, type: t, ...(def ? { default: def } : {}) });
    inner = withLocal(inner, p.name, "param", t);
  }
  return { params, env: inner };
}
