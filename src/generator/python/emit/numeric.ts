// ---------------------------------------------------------------------------
// `app/domain/numeric.py` — cross-backend numeric semantics for the Python
// backend.
//
// THREE cross-backend divergences live here — two about INTEGER division, one
// about ordering against an absent nullable money/decimal (`present_order`):
//
//   `%`         — Python's `%` is the only FLOORED modulo among Loom's five
//                 backends (see below).
//   `divTrunc`  — the intrinsic exists precisely to give a DETERMINISTIC
//                 truncating division on every backend.  Java/.NET divide two
//                 primitive integers (`a / b`), Elixir emits `div(a, b)`; the
//                 obvious Python spelling `int(a / b)` routes through a float,
//                 so it silently loses precision past 2^53 — and Python is the
//                 one backend whose ints are arbitrary precision, so it is the
//                 one backend where that matters.  `int(10**18 + 7) / 3` gives
//                 333333333333333312; the exact truncation is
//                 333333333333333335, off by 23.  `//` is NOT the answer
//                 either: it FLOORS, so it disagrees with every other backend
//                 on negative operands.  Hence `trunc_div`.
//
// Python's `%` is the only FLOORED modulo among Loom's five backends: its
// result takes the sign of the DIVISOR, so `-5 % 3 == 1`.  TS/JS, C#, Java and
// Elixir (which deliberately emits `rem/2`, not `Integer.mod/2`) all TRUNCATE
// towards zero — the result takes the sign of the DIVIDEND, so `-5 % 3 == -2`.
// A `.ddd` expression must mean the same thing on every backend, so the Python
// renderer lowers `%` to `trunc_mod(...)` from this module rather than to the
// native operator (`render-expr.ts` → `renderBinary`).
//
// Wiring follows recorded use, not the emitted text.  `%` can appear in a
// derived field, an invariant (which the aggregate module, the Pydantic wire
// validator AND the route module each re-render), a VO function, a domain
// service, a workflow step, a seed, a unit test — a dozen emitters, each with
// its own preamble.  The renderer spells every helper call through
// `numericHelper(...)`, a `ref()` marker, so each module's import is derived
// from the call when the module is finalized, and `PyOutputMap` records which
// modules were referenced; this module is emitted iff one of its helpers was.
// ---------------------------------------------------------------------------

import { pyRef } from "../../_imports/python.js";
import type { PyOutputMap } from "../py-output.js";

/** The generated helper module.  Value-restricted TypeVar (not `float`) so
 *  `trunc_mod(int, int)` stays `int` under `mypy --strict` — a plain `float`
 *  return would poison every int-typed field it feeds. */
export const NUMERIC_PY = `"""Numeric helpers with cross-backend semantics.  Auto-generated."""

from decimal import Decimal
from typing import TypeVar

_N = TypeVar("_N", int, float)


def trunc_mod(a: _N, b: _N) -> _N:
    """Remainder that TRUNCATES towards zero, like C / Java / C# / JS \`%\`.

    Python's native \`%\` floors instead, taking the sign of the divisor
    (\`-5 % 3 == 1\`); every other Loom backend takes the sign of the dividend
    (\`-5 % 3 == -2\`).  This keeps the answer identical across backends.
    """
    m = a % b
    if m != 0 and (a < 0) != (b < 0):
        return m - b
    return m


def trunc_div(a: _N, b: _N) -> _N:
    """Integer division that TRUNCATES towards zero, like C / Java / C# \`/\`.

    This is the \`divTrunc\` intrinsic.  \`int(a / b)\` would round-trip through a
    float and lose precision above 2**53 (Python's ints are arbitrary
    precision, so that loss is real and silent); \`a // b\` is exact but FLOORS,
    disagreeing with every other backend on negative operands.  This spelling
    is both exact and truncating.
    """
    if (a < 0) != (b < 0):
        return -(-a // b)
    return a // b


def present_order(a: Decimal | float | None, op: str, b: Decimal | float | None) -> bool:
    """An ordering over a nullable money/decimal: False when either side is absent.

    Loom's ordering against an absent value answers false on every backend
    (SQL's UNKNOWN, .NET's lifted operators); Python's native \`None > x\`
    raises \`TypeError\` instead.
    """
    if a is None or b is None:
        return False
    if op == "<":
        return a < b
    if op == "<=":
        return a <= b
    if op == ">":
        return a > b
    return a >= b
`;

const HELPER_PATH = "app/domain/numeric.py";
const NUMERIC_MODULE = "app.domain.numeric";

/** A call to one of this module's helpers, as the renderer writes it — a
 *  `ref()` marker, so the import is derived from the call. */
export function numericHelper(name: "trunc_mod" | "trunc_div" | "present_order"): string {
  return pyRef(NUMERIC_MODULE, name);
}

/** Emit `app/domain/numeric.py` when some module referenced one of its helpers
 *  — a no-op when nothing in the project uses `%`, `divTrunc` or an absent-aware
 *  ordering.  Runs after every module has been written. */
export function emitNumericHelpers(out: PyOutputMap): void {
  if (out.references(NUMERIC_MODULE)) out.set(HELPER_PATH, NUMERIC_PY);
}
