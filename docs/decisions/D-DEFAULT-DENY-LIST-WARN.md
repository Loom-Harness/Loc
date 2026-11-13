# D-DEFAULT-DENY-LIST-WARN — under `denyByDefault` an ungated list read is a warning; a cross-context policy call is a named error

**Status:** ruled by the owner (eval closure review 2026-09-28, rulings D5 and
D9; items 22 and 39).

**D5: the list read.** Every aggregate serves `GET /api/<plural>`, which is
backed by the repository find named `all`. Unless the author declares that
find, enrichment injects it without a gate. Under `denyByDefault` the list
read therefore served every row to any authenticated caller. The by-id
warning fired, but the list did not. `default-deny-checks.ts` had exempted it
as "compiler-synthesized, no author source line". That reason was weaker
than the by-id one, because the author can write
`find all(): T[] requires <expr>`, and all five backends enforce it
(`src/ir/util/read-gates.ts`).

The ruling is a **warning**, `loom.default-deny-list-ungated`, at the same
tier as `loom.default-deny-by-id-ungated`. Existing models keep building, and
the message names the line that silences the warning. An author-declared
`find all` with no gate gets the same warning. The declared-find error arm
still skips `all`, so leaving it out would bring back the silent case.
Promoting the warning to an error is left to the runtime-gating mission
(M-T3.19 / #3109).

**D9: cross-context policy calls.** Function-form policies are
context-local. Before this ruling, a `requires P()` naming a policy declared
in another context reported only `'requires' must be of type 'bool', got
'unknown'`. It now reports `loom.policy-out-of-scope`: "policy P is declared
in context A; policies are context-local — redeclare it in B". The type
system types such a call `bool` (`outOfScopePolicyCall`,
`src/language/type-system.ts`), so the named error is the only one raised.
The detection covers every way a policy is reached: the call forms `P(args)`
and `Ctx.P(args)` (the qualified spelling an author tries first when sharing a
policy), a bare `P` that nothing in scope claims (no binding, member or enum
value of that name), and a call to a top-level function whose body names `P`
(the function is inlined at the call site, so `P` resolves against the
calling context; reported there). It searches the whole compilation unit, not
the calling document: context names are unique across the workspace, so a
policy declared in another file is always in another context, and a
one-document scan let that call through to lowering, which emitted a call to
a function no backend defines.

Sharing a policy across contexts (at subdomain or system level) needs its own
language decision. It is a separate mission.

**Touches:** `src/ir/validate/checks/default-deny-checks.ts`,
`src/language/validators/policy-fn.ts`, `src/language/type-system.ts`,
`src/language/typing/qualified-policy.ts`, `src/language/typing/decl-index.ts`,
`src/diagnostics/messages.ts`, `docs/auth.md`,
`docs/language-reference/17-auth.md`, `docs/language.md`.
