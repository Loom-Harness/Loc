// The single source of truth for how a generated UNIT test discriminates WHICH
// rung of the domain floor rejected a call — `expect(<call>).toThrow(<kind>)`.
//
// Why it exists: `toThrow()` alone asserts only "it threw".  The 2026-09-13
// testability audit deleted a `precondition` from a generated aggregate and the
// test stayed GREEN, because the aggregate's `invariant` threw in its place —
// a test named "a fresh work order cannot be completed" went on claiming
// something it no longer proved (F11).
//
// The rung is observable in-process, but the five backends expose it two
// different ways, and the split is not arbitrary:
//
//   * ELIXIR is STRUCTURAL.  `GuardError` is `defexception [:message, :kind]`
//     (`elixir/vanilla/denial.ts`), so the rung rides the struct and the
//     message stays free text.  That shape exists because reading the PREFIX
//     was tried there and failed: an author's `message "..."` missed it and
//     reraised into a 500.
//   * The other four read the MESSAGE PREFIX below, which every one of them
//     emits from a `message ?? \`<prefix><source>\`` fallback (see
//     `{typescript,python,java,dotnet}` `render-stmt.ts` / `entity.ts` /
//     `enums-vos.ts`).
//
// Which is exactly why an authored `message "..."` on the rule under test is
// REFUSED against this matcher (`loom.throw-kind-custom-message`): the clause
// that makes a rule legible to a human overwrites the prefix, leaving four of
// the five backends nothing to match.  Giving those four the structural `kind`
// elixir already has is the right long-term answer and is filed as its own
// mission — an error-shape change across five backends should not ride along
// on a matcher's first outing (design M-T5.36 § 2a, decision 7).

import type { ThrowKindName } from "../../util/intrinsic-matchers.js";

/** The derived message prefix each rung emits on node / python / java / .NET
 *  when the rule carries no authored `message`.  Kept as the exact emitted
 *  text (trailing space and all) so a matcher built from it cannot drift from
 *  the thing it matches. */
export const THROW_KIND_PREFIX: Readonly<Record<ThrowKindName, string>> = {
  precondition: "Precondition failed: ",
  invariant: "Invariant violated: ",
};

/** The rung's prefix as an ANCHORED regex SOURCE (no delimiters), for the two
 *  backends whose throw matcher takes a pattern rather than a string —
 *  vitest's `toThrow(/…/)` and pytest's `raises(match=…)`.  Anchored at the
 *  start so it pins the prefix rather than finding it anywhere in a longer
 *  sentence; metacharacters are escaped even though today's two prefixes carry
 *  none, so a future rung name cannot silently become a pattern. */
export function throwKindPatternSource(kind: ThrowKindName): string {
  return `^${THROW_KIND_PREFIX[kind].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
}
