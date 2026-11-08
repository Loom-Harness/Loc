// The `let` bindings a test body asserts ABSENT — the direct subject of a
// non-negated `expect(x).toBeNull()` / `.toBeAbsent()`.
//
// A context integration test's optional by-id read (`let r = Note.find(id)`)
// is narrowed to non-null by the backends whose test body would otherwise not
// type-check or would fail later at a field access (`assert r is not None`,
// `Objects.requireNonNull`).  That narrowing must not run for a binding the
// test then asserts IS null — the cross-principal read `as { … }` exists to
// write — or the assertion can never be reached.

import type { ExprIR, TestStmtIR } from "../types/loom-ir.js";

const ABSENT_MATCHERS = new Set(["toBeNull", "toBeAbsent"]);

function subjectName(e: ExprIR): string | undefined {
  const inner = e.kind === "paren" ? e.inner : e;
  return inner.kind === "ref" ? inner.name : undefined;
}

export function bindingsAssertedAbsent(statements: readonly TestStmtIR[]): Set<string> {
  const out = new Set<string>();
  for (const s of statements) {
    if (s.kind !== "expect") continue;
    const e = s.expr;
    if (e.kind !== "method-call" || !e.isIntrinsicMatcher || !ABSENT_MATCHERS.has(e.member)) {
      continue;
    }
    const name = subjectName(e.receiver);
    if (name) out.add(name);
  }
  return out;
}
