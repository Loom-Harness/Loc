import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// M-T5.28 — statement PLACEMENT (`src/language/validators/stmt-placement.ts`).
//
// Three `Statement` alternatives are lowerable only in specific bodies, and
// until this gate nothing said so.  Each produced a SILENT decline — the source
// validated `0 error(s), 0 warning(s)` and then:
//
//   `match` (effect form) in a domain body  → THREW out of the shared statement
//     dispatcher on node, dotnet, elixir, java and python alike.
//   `for` / `if let` outside a workflow     → lowered to the `<unknown>` call
//     sentinel: `this.<unknown>()` (node / .NET / Java), `self._<unknown>()`
//     (Python), `_ = <unknown>(record)` (Elixir).
//
// WHY THE FIXTURES LIVE HERE AND NOT IN `test/fixtures/corpus/`.  That corpus
// is a POSITIVE matrix — `corpus-coverage.test.ts` requires every `<id>.ddd`
// to GENERATE cleanly on each backend its `manifest.ts` row declares — so it
// has no representation for an expected-diagnostic fixture, and no
// `expectDiagnostics`-style key anywhere in `manifest.ts` or the corpus
// harnesses.  Negative shapes in this repo are pinned beside their gate
// (`test/ir/temporal-queryable-gate.test.ts`,
// `test/ir/projection-document-aggregation.test.ts`); these are the same, with
// the source in a real `.ddd` file so `ddd parse <fixture>` reproduces the
// refusal by hand.
// ---------------------------------------------------------------------------

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const PLACEMENT_CODES = [
  "loom.variant-match-placement",
  "loom.for-placement",
  "loom.if-let-placement",
] as const;

interface Raised {
  readonly code: string;
  readonly message: string;
  readonly line: number;
}

async function placementDiagnostics(fixture: string): Promise<Raised[]> {
  const src = readFileSync(join(FIXTURES, `${fixture}.ddd`), "utf8");
  const { diagnostics } = await parseString(src);
  return diagnostics
    .filter((d) => PLACEMENT_CODES.includes(d.code as (typeof PLACEMENT_CODES)[number]))
    .map((d) => ({
      code: String(d.code),
      message: d.message,
      line: d.range.start.line + 1,
    }));
}

/** The 1-based line of the first source line containing `needle`. */
function lineOf(fixture: string, needle: string): number {
  const lines = readFileSync(join(FIXTURES, `${fixture}.ddd`), "utf8").split("\n");
  const ix = lines.findIndex((l) => l.includes(needle));
  expect(ix, `fixture ${fixture}.ddd must contain ${JSON.stringify(needle)}`).toBeGreaterThan(-1);
  return ix + 1;
}

describe("statement placement (M-T5.28)", () => {
  it("refuses the effect form of `match` in a domain body, on the offending statement", async () => {
    const raised = await placementDiagnostics("stmt-placement-variant-match");
    expect(raised.map((r) => r.code)).toEqual(["loom.variant-match-placement"]);
    expect(raised[0]!.line).toBe(lineOf("stmt-placement-variant-match", "match probe()"));
    // The message names the body it found, so the span alone is not the only
    // way to locate it in a multi-operation aggregate.
    expect(raised[0]!.message).toContain("operation 'touch'");
    // PERMANENT refusal — it must not read as a gap waiting on an
    // implementation, and (M-T6.61 sequencing) it must not push the reader at
    // the value-form `match` as the replacement.
    expect(raised[0]!.message).toContain("permanent placement rule");
    expect(raised[0]!.message).not.toMatch(/M-T\d/);
  });

  it("refuses `if let` outside a workflow as a permanent rule", async () => {
    const raised = await placementDiagnostics("stmt-placement-if-let");
    expect(raised.map((r) => r.code)).toEqual(["loom.if-let-placement"]);
    expect(raised[0]!.line).toBe(lineOf("stmt-placement-if-let", "if let c = code"));
    expect(raised[0]!.message).toContain("operation 'touch'");
    expect(raised[0]!.message).toContain("permanent placement rule");
    expect(raised[0]!.message).not.toMatch(/M-T\d/);
  });

  it("refuses `for` outside a workflow as an HONEST GAP naming its successor mission", async () => {
    const raised = await placementDiagnostics("stmt-placement-for");
    expect(raised.map((r) => r.code)).toEqual(["loom.for-placement"]);
    expect(raised[0]!.line).toBe(lineOf("stmt-placement-for", "for n in notes"));
    expect(raised[0]!.message).toContain("operation 'touch'");
    // The half of ruling D-FOR-IN-DOMAIN this code exists to carry: a gap, with
    // a named owner — NOT a design rule.
    expect(raised[0]!.message).toContain("GAP, not a design rule");
    expect(raised[0]!.message).toContain("M-T5.30");
    expect(raised[0]!.message).not.toContain("permanent placement rule");
  });

  it("leaves all three alone in the bodies that DO lower them", async () => {
    // Workflow `create` + `commandHandler` for `for` / `if let`; a page
    // `action`'s `match await` for the effect-form match.  Every one of the six
    // sites is in this fixture, so a gate that classified any body wrong fails
    // here rather than in a user's project.
    expect(await placementDiagnostics("stmt-placement-allowed")).toEqual([]);
  });
});
