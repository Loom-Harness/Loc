import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The TEST-STATEMENT census: every (test tier × backend × statement kind)
// either RENDERS or is REFUSED by a `loom.*` diagnostic.
//
// This is the completeness half of the test-tier statement vocabulary
// (`UNIT_TEST_STMT_KINDS` / `INTEGRATION_TEST_STMT_KINDS` in
// `src/ir/validate/checks/test-checks.ts`). That vocabulary is a capability
// manifest the validator consumes: it names, once, the statement kinds each
// tier's renderers handle. The census checks the manifest against the
// renderers, so the two can't drift: a kind the manifest admits but some
// backend's renderer throws on fails here, and so does a kind it refuses that
// every renderer would in fact handle (a stale narrowing shows up as a
// refusal where the renderer would render, which this census reports via
// the "refused" set being pinned below).
//
// Before #3133 the three tiers other than the aggregate one had NO
// vocabulary: `precondition` / `emit` / `:=` in a value-object, domain-service
// or context test parsed with 0 errors and crashed `generate` on every
// backend.
// ---------------------------------------------------------------------------

const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];
type Tier = "aggregate" | "value-object" | "domain-service" | "context";
const TIERS: readonly Tier[] = ["aggregate", "value-object", "domain-service", "context"];

/** One statement per kind the grammar lets a `test` body hold. */
const STMTS: readonly { kind: string; src: string }[] = [
  { kind: "let", src: "let q = Qty { n: 1 }" },
  { kind: "expect", src: "expect(Qty { n: 1 }.n).toBe(1)" },
  { kind: "expect-throws", src: "expect(Qty { n: -1 }).toThrow()" },
  { kind: "precondition", src: "precondition 1 > 0" },
  { kind: "emit", src: "emit Pinged { n: 1 }" },
];

const tname = (i: number): string => `t${String(i).padStart(2, "0")}`;

function tests(stmts: readonly number[], indent: string): string {
  return stmts.map((i) => `${indent}test "${tname(i)}" { ${STMTS[i]?.src} }`).join("\n");
}

function source(backend: Backend, tier: Tier, stmts: readonly number[]): string {
  const at = (t: Tier): string => (tier === t ? tests(stmts, "        ") : "");
  return `
system S {
  api TA from P
  subdomain P {
    context T {
      event Pinged { n: int }
      valueobject Qty {
        n: int
        invariant n >= 0
${at("value-object")}
      }
      domainService Pricing {
        operation twice(n: int): int { return n * 2 }
${at("domain-service")}
      }
      aggregate Task with crudish {
        title: string
${at("aggregate")}
      }
      repository Tasks for Task { }
${at("context")}
    }
  }
  storage primary { type: postgres }
  resource st { for: T, kind: state, use: primary }
  deployable api { platform: ${backend} contexts: [T] dataSources: [st] serves: TA port: 4000 }
}
`;
}

type Outcome = "renders" | "refused" | `crash: ${string}`;

async function generateOutcome(src: string): Promise<Outcome> {
  try {
    await generateSystemFilesUnchecked(
      src,
      "census probe: validation already ran, and this measures what generate does",
    );
    return "renders";
  } catch (err) {
    return `crash: ${String((err as Error).message)
      .split("\n")[0]
      ?.slice(0, 160)}`;
  }
}

async function measure(backend: Backend, tier: Tier): Promise<Map<number, Outcome>> {
  const all = STMTS.map((_, i) => i);
  const report = await validate(source(backend, tier, all));
  const refused = new Set<number>();
  const unattributed: string[] = [];
  for (const d of report.diagnostics.filter((x) => x.severity === "error")) {
    const hay = `${d.message} ${JSON.stringify(d)}`;
    const hit = all.find((i) => hay.includes(tname(i)));
    if (hit === undefined) unattributed.push(`${d.code}: ${d.message}`);
    else refused.add(hit);
  }
  if (unattributed.length)
    throw new Error(`${backend} × ${tier}: unattributable errors\n${unattributed.join("\n")}`);
  const out = new Map<number, Outcome>();
  for (const i of refused) out.set(i, "refused");
  const admitted = all.filter((i) => !refused.has(i));
  const batch = admitted.length
    ? await generateOutcome(source(backend, tier, admitted))
    : "renders";
  for (const i of admitted) {
    out.set(i, batch === "renders" ? "renders" : await generateOutcome(source(backend, tier, [i])));
  }
  return out;
}

/** The kinds each tier admits, per the manifest. A refused kind must be
 *  refused on every backend and an admitted one rendered on every backend:
 *  the vocabulary is target-neutral. */
const ADMITTED: Record<Tier, readonly string[]> = {
  aggregate: ["let", "expect", "expect-throws"],
  "value-object": ["let", "expect", "expect-throws"],
  "domain-service": ["let", "expect", "expect-throws"],
  context: ["let", "expect", "expect-throws"],
};

describe("test-statement census — every tier × backend × statement kind renders or is refused", () => {
  for (const tier of TIERS) {
    for (const backend of BACKENDS) {
      it(`${tier} × ${backend}`, async () => {
        const cells = await measure(backend, tier);
        const bad: string[] = [];
        for (const [i, outcome] of cells) {
          const kind = STMTS[i]?.kind ?? String(i);
          const want = ADMITTED[tier].includes(kind) ? "renders" : "refused";
          if (outcome !== want)
            bad.push(`${tier} × ${backend} × ${kind}: ${outcome} (expected ${want})`);
        }
        expect(bad).toEqual([]);
      }, 300_000);
    }
  }
});
