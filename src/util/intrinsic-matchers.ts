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
  // and refuses the kind form (`loom.e2e-throw-kind-invalid`).
  { name: "toThrow", arity: 0, on: "value", negatable: false },
  // ── absence: ONE language value, TWO wire spellings ──────────────────────
  //
  // Loom has a single absence value (`int?` holding nothing).  The wire has
  // two ways to say it — `"estimate": null` and no `estimate` key at all —
  // and the five backends have genuinely disagreed about which they send
  // (that disagreement is why `test/fixtures/corpus/absent-optional.ddd`
  // exists).  One matcher covering both would make it two strengths of claim
  // under one name, the defect #2959 fixed on the ui side, so the pair is
  // deliberately two matchers and an author pins the spelling on purpose.
  //
  // What holds them apart is not the author's care but the CONFORMANCE GATE:
  // `diffBodies` (test/_helpers/response-diff.ts) unions both key sets and
  // raises a `key-set` divergence, so a backend that changed spelling fails
  // its behavioural leg against the committed wire golden.  Today's enforced
  // contract is EXPLICIT NULL on all five backends — see RS-35 in
  // docs/conformance-semantics.md.
  { name: "toBeNull", arity: 0, on: "value", negatable: true },
  // `toBeAbsent()` — E2E ONLY, and deliberately so.  "The key is not in the
  // payload" is a statement about a serialized body; it needs a payload to be
  // about.  In the unit tier the subject is an aggregate STRUCT, where a
  // declared field always exists: C#'s `int?`, Java's `Integer` and an Elixir
  // struct's `nil` default have no "absent" to observe at all.  Lowering it
  // in-process would therefore leave only two options, and both are the
  // defect this pair exists to avoid — degrade it to a null check (making it
  // a silent synonym for `toBeNull`, one matcher meaning two strengths) or
  // emit an assertion that can never pass.  `checkExpectMatcher` refuses it
  // in a unit `test` and names `toBeNull()` instead.
  //
  // In e2e it is allowed to FAIL HONESTLY: no backend omits a key today, so
  // it has no passing subject — and a matcher that says "this backend
  // omitted the key" is exactly how the next divergence gets caught.  It is
  // NOT special-cased into always passing.
  { name: "toBeAbsent", arity: 0, on: "value", negatable: true },
  // `toContain(x)` — ONE matcher, TWO lowerings, chosen by the SUBJECT'S
  // TYPE: membership for a collection (`array`), substring for a `string`.
  // The dispatch reads `receiverType` off the IR (already fully resolved by
  // phase 5, so no backend re-resolves it) and `checkContainReceiver`
  // rejects every other subject type at the author's own source span.
  { name: "toContain", arity: 1, on: "value", negatable: true },
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
