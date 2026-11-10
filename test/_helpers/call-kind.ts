import { expect } from "vitest";
import type { CallTarget, ExprIR } from "../../src/ir/types/loom-ir.js";

/** A `call` expression of one `callKind`, which carries that kind's payload. */
export type CallOf<K extends CallTarget["callKind"]> = Extract<
  ExprIR,
  { kind: "call"; callKind: K }
>;

/** Assert `e` is a `call` of `kind` — the test fails otherwise — and narrow it
 *  so the kind's payload (`resourceOp`, `repoRead`, …) can be read. */
export function expectCallKind<K extends CallTarget["callKind"]>(
  e: ExprIR | undefined,
  kind: K,
): asserts e is CallOf<K> {
  expect(e?.kind === "call" ? e.callKind : e?.kind).toBe(kind);
}
