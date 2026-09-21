// Canonical test-assertion matcher catalogue — a built-in "intrinsic"
// library the compiler knows by name (resolved into the IR, then lowered
// per-backend to Playwright / vitest / xUnit / ExUnit).
//
// `on` records whether the matcher reads a DOM locator (web-first,
// auto-retrying) or a plain value; `arity` is the fixed
// positional-argument count for validation.  Adding a matcher is a table
// entry here plus a per-backend lowering — no renderer special-case.
//
// Pure data: zero language / AST dependencies, so this lives at a leaf
// under src/util/ and every layer (language, ir, generator, system)
// imports from here without back-edges into language/.

export interface MatcherSig {
  name: string;
  arity: number;
  on: "locator" | "value";
  /** When this matcher reads a locator, the negated form is `not.<name>`. */
  negatable: boolean;
}

const INTRINSIC_MATCHER_SIGNATURES: ReadonlyArray<MatcherSig> = [
  { name: "toBe", arity: 1, on: "value", negatable: true },
  { name: "toBeGreaterThan", arity: 1, on: "value", negatable: true },
  { name: "toBeGreaterThanOrEqual", arity: 1, on: "value", negatable: true },
  { name: "toBeLessThan", arity: 1, on: "value", negatable: true },
  { name: "toBeLessThanOrEqual", arity: 1, on: "value", negatable: true },
  // `expect(actual).toBeSameInstant(expected)` — temporal equality that compares
  // two ISO-8601 timestamps as INSTANTS, not strings: it forgives wire-format
  // differences (e.g. .NET's `…00.0000000Z` vs the canonical `…00Z`) while still
  // catching a real difference in the point in time.  Wire-serialization is only
  // observable at the HTTP boundary, so `checkExpectMatcher` restricts it to
  // `test e2e` bodies (a domain unit test compares in-memory values with `toBe`).
  { name: "toBeSameInstant", arity: 1, on: "value", negatable: true },
  { name: "toHaveText", arity: 1, on: "locator", negatable: true },
  { name: "toHaveCount", arity: 1, on: "locator", negatable: true },
  { name: "toBeVisible", arity: 0, on: "locator", negatable: true },
  // `expect(call).toThrow()` / `.toThrow(404)` / `.toThrow(precondition)` —
  // the method-based throw assertion (replaces the old `expectThrows`
  // statement keyword).  It is special: the *lowering* recognises it and
  // rewrites the `expect` into the `expect-throws` IR node (so every backend
  // renders it as a throw the way it always has).  Its argument is therefore
  // variable and TIER-SPLIT, which `checkExpectMatcher` enforces and
  // `checkMatcherArity` skips (the `arity: 0` below is the bare-form default
  // and is never strict-checked):
  //
  //   * bare            — legal in both tiers; "it threw", nothing more.
  //   * `<status>`      — E2E ONLY.  An integer pinning the HTTP status of a
  //                       live rejection, rendered by `e2e-render.ts` into a
  //                       `/→ N\b/` matcher.
  //   * `<kind>`        — UNIT ONLY.  `precondition` or `invariant`: WHICH
  //                       rung of the domain floor rejected the call.  Parsed
  //                       through the grammar's `ThrowKind` slot (both words
  //                       are hard keywords), carried on `expect-throws` as
  //                       `throwKind`, and lowered per-backend.
  //
  // The split is not cosmetic.  In-process the kind is observable — Elixir
  // carries a structural `:kind` on `GuardError`, the other four a stable
  // message prefix ("Precondition failed: " / "Invariant violated: ").  Over
  // HTTP both rungs are a 422 whose only discriminator is the RFC 7807
  // `detail` sentence, which an authored `message "..."` overwrites.  Letting
  // one matcher mean both would make it two strengths of claim under one name
  // — the defect #2959 fixed on the ui side, where `toThrow(422)` silently
  // meant something weaker.  So a `test e2e` body keeps `toThrow(<status>)`
  // and refuses the kind form (`loom.e2e-throw-kind-unsupported`).
  { name: "toThrow", arity: 0, on: "value", negatable: false },
];

/** The failure RUNGS `toThrow(<kind>)` can pin — a closed, compiler-known set
 *  mirroring the grammar's `ThrowKind` rule.  `precondition` is a validity
 *  check the OPERATION BODY declares; `invariant` is a whole-state rule the
 *  AGGREGATE (or value object) declares.  `requires` is deliberately absent:
 *  it is an AUTHORIZATION rung (403), it needs a principal the unit tier has
 *  no vocabulary for, and the fleet deferred the principal clause (F6). */
export const THROW_KINDS = ["precondition", "invariant"] as const;

export type ThrowKindName = (typeof THROW_KINDS)[number];

const THROW_KIND_SET: ReadonlySet<string> = new Set(THROW_KINDS);

export function isThrowKind(name: string): name is ThrowKindName {
  return THROW_KIND_SET.has(name);
}

const INTRINSIC_MATCHERS = new Map(INTRINSIC_MATCHER_SIGNATURES.map((m) => [m.name, m]));

export function isIntrinsicMatcher(name: string): boolean {
  return INTRINSIC_MATCHERS.has(name);
}

export function intrinsicMatcherSig(name: string): MatcherSig | undefined {
  return INTRINSIC_MATCHERS.get(name);
}
