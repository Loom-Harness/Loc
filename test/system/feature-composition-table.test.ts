// ---------------------------------------------------------------------------
// The capability table's FEATURE-TUPLE rows — completeness and witness gates.
//
// `src/util/target-capabilities.ts` gives every backend target a verdict per
// feature tuple (a pair of feature values from two composing axes).  There is
// no third state, and each verdict is held to account here:
//
//   completeness — the tuples are exactly the product of `COMPOSING_AXES`, and
//                  every backend decides every one; every axis takes part in a
//                  pair, and every feature value has a detector.
//   supported    — the named corpus fixture exists, declares the backend, runs
//                  a behavioural block there (not skipped, not an expected
//                  failure), and its model carries the pair on one aggregate.
//   refused      — a witness model carrying the pair draws
//                  `loom.target-unsupported` worded by the cell's own slug.
//   owned        — the witness draws the owning check's code.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { diagMessage } from "../../src/diagnostics/messages.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { Platform } from "../../src/ir/types/loom-ir.js";
import { aggregatesWithTuple, FEATURE_DETECTORS } from "../../src/ir/util/feature-atoms.js";
import { tupleUses } from "../../src/ir/validate/checks/target-capability-checks.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import {
  COMPOSING_AXES,
  type CompositionVerdict,
  FEATURE_AXES,
  FEATURE_TUPLES,
  type Feature,
  type FeatureTuple,
  TARGET_CAPABILITIES,
  tupleFeatures,
} from "../../src/util/target-capabilities.js";
import { parseString } from "../_helpers/index.js";
import {
  BEHAVIOURAL_SKIP,
  BEHAVIOURAL_XFAIL,
  hasBehaviouralBlock,
} from "../behavioral/registers.mjs";
import { BACKENDS, type Backend, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";
import { corpusSource, corpusSourceFor } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";

/** The backend targets: every platform whose table states backend verdicts. */
const BACKEND_TARGETS = (
  Object.entries(TARGET_CAPABILITIES) as [Platform, (typeof TARGET_CAPABILITIES)[Platform]][]
)
  .filter(([, t]) => t.backend !== undefined)
  .map(([p]) => p);

/** The corpus backend key a platform's fixtures are declared under. */
const CORPUS_BACKEND: Readonly<Partial<Record<Platform, Backend>>> = Object.fromEntries(
  BACKENDS.map((b) => [PLATFORM_CLAUSE[b], b]),
);

async function lowered(src: string) {
  const { model } = await parseString(src);
  return enrichLoomModel(lowerModel(model));
}

// --- witnesses ---------------------------------------------------------------

/** The aggregate-level spelling of one feature: the `with` capability it
 *  applies, a field it adds, and the header it needs. */
function capabilityParts(f: Feature | undefined): { cap: string; field: string } {
  if (f === "capability:provenanced") return { cap: "", field: "total: int provenanced" };
  // A share opens a tenant-scoped row, so `shareable` rides with `tenantOwned`.
  if (f === "capability:shareable") return { cap: "tenantOwned, shareable", field: "" };
  if (f?.startsWith("capability:")) return { cap: f.slice("capability:".length), field: "" };
  return { cap: "", field: "" };
}

const withs = (...caps: string[]): string => {
  const l = caps.filter(Boolean);
  return l.length > 0 ? `with ${l.join(", ")} ` : "";
};

/** The aggregates carrying `tuple` on one aggregate. */
function tupleAggregates(tuple: FeatureTuple): string {
  const [a, b] = tupleFeatures(tuple);
  const capFeature = [a, b].find((f) => f.startsWith("capability:"));
  const other = [a, b].find((f) => f !== capFeature)!;
  const { cap, field } = capabilityParts(capFeature);
  if (other === "persistence:eventLog") {
    return `event Opened { thing: Thing id, label: string }
      aggregate Thing persistedAs: eventLog, ${withs(cap)}{
        label: string ${field}
        create open(label: string) { emit Opened { thing: id, label: label } }
        apply(e: Opened) { label := e.label }
      }
      repository Things for Thing { }`;
  }
  if (other.startsWith("persistence:")) {
    const shape = other === "persistence:document" ? "shape: document, " : "";
    return `aggregate Thing ${shape}${withs(cap, "crudish")}{ label: string ${field} }
      repository Things for Thing { }`;
  }
  const layout = other.startsWith("inheritance:tph") ? "sharedTable" : "ownTable";
  const onBase = other.endsWith("-base");
  return `abstract aggregate Base inheritanceUsing: ${layout} ${withs(onBase ? cap : "")}{ label: string ${onBase ? field : ""} }
      aggregate Sub extends Base ${withs(onBase ? "" : cap, "crudish")}{ n: int ${onBase ? "" : field} }
      repository Subs for Sub { }`;
}

/** A one-context system hosting `tuple`'s aggregates on `platform`. */
function tupleWitness(tuple: FeatureTuple, platform: Platform): string {
  const tenancy =
    tuple.includes("capability:tenantOwned") || tuple.includes("capability:shareable");
  return `
system W {
  user { id: guid  tenantId: string }
  ${tenancy ? "tenancy by user.tenantId of Org" : ""}
  subdomain Core {
    context Main {
      ${tupleAggregates(tuple)}
      ${tenancy ? "aggregate Org with crudish { name: string  implements tenantRegistry }\n      repository Orgs for Org { }" : ""}
    }
  }
  api MainApi from Core
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  resource es { for: Main, kind: eventLog, use: pg }
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st, es], serves: MainApi, port: 3000, auth: required }
}
`;
}

// --- completeness --------------------------------------------------------------

describe("feature tuples — every backend decides every pair", () => {
  it("the tuples are exactly the product of the composing axes", () => {
    const product = COMPOSING_AXES.flatMap(([a, b]) =>
      FEATURE_AXES[a].flatMap((x) => FEATURE_AXES[b].map((y) => `${a}:${x}+${b}:${y}`)),
    );
    expect([...FEATURE_TUPLES].sort()).toEqual(product.sort());
    expect(new Set(FEATURE_TUPLES).size).toBe(FEATURE_TUPLES.length);
  });

  it("every axis takes part in a composing pair", () => {
    const paired = new Set(COMPOSING_AXES.flat());
    expect(Object.keys(FEATURE_AXES).filter((a) => !paired.has(a as never))).toEqual([]);
  });

  it("every feature value has a detector", () => {
    const values = Object.entries(FEATURE_AXES).flatMap(([a, vs]) => vs.map((v) => `${a}:${v}`));
    expect(Object.keys(FEATURE_DETECTORS).sort()).toEqual(values.sort());
  });

  it("covers every backend", () => {
    expect(new Set(BACKEND_TARGETS)).toEqual(
      new Set(["node", "dotnet", "python", "java", "elixir"]),
    );
  });

  for (const platform of BACKEND_TARGETS) {
    it(`${platform} states a verdict for every tuple and nothing else`, () => {
      const cells = TARGET_CAPABILITIES[platform].compositions ?? {};
      expect(Object.keys(cells).sort()).toEqual([...FEATURE_TUPLES].sort());
    });
  }
});

// --- witnesses -----------------------------------------------------------------

interface Cell {
  readonly id: string;
  readonly platform: Platform;
  readonly tuple: FeatureTuple;
  readonly verdict: CompositionVerdict;
}

/** Every DECIDED cell.  A missing one fails the completeness gate above, by
 *  name, rather than this file's collection. */
function cells(): Cell[] {
  return BACKEND_TARGETS.flatMap((platform) =>
    FEATURE_TUPLES.flatMap((tuple) => {
      const verdict = TARGET_CAPABILITIES[platform].compositions?.[tuple];
      return verdict ? [{ id: `${platform}|${tuple}`, platform, tuple, verdict }] : [];
    }),
  );
}

/** Why a fixture cannot witness `platform`, or `undefined` when it can. */
function fixtureDisqualified(fixture: string, platform: Platform): string | undefined {
  const row = CORPUS.find((f) => f.id === fixture);
  if (!row) return `no corpus fixture '${fixture}'`;
  const backend = CORPUS_BACKEND[platform];
  if (!backend || !row.backends.includes(backend))
    return `'${fixture}' does not declare ${platform}`;
  if (!hasBehaviouralBlock(corpusSource(fixture))) return `'${fixture}' runs no behavioural block`;
  const skip = (BEHAVIOURAL_SKIP as Record<string, Record<string, unknown>>)[platform];
  if (skip?.[fixture]) return `'${fixture}' is a behavioural skip on ${platform}`;
  const xfail = (BEHAVIOURAL_XFAIL as Record<string, Record<string, unknown>>)[platform];
  if (xfail?.[fixture]) return `'${fixture}' is an expected failure on ${platform}`;
  return undefined;
}

describe("feature tuples — every cell is witnessed (fixture) or refused (code)", () => {
  for (const cell of cells()) {
    const v = cell.verdict;
    if (v.verdict === "supported" && "construct" in v) {
      it(`${cell.id}: supported — by the '${v.construct}' row`, () => {
        expect(TARGET_CAPABILITIES[cell.platform].backend?.[v.construct]).toEqual({
          verdict: "supported",
        });
      });
    } else if (v.verdict === "supported") {
      it(`${cell.id}: supported — '${v.fixture}' runs the pair`, async () => {
        expect(fixtureDisqualified(v.fixture, cell.platform)).toBeUndefined();
        const model = await lowered(corpusSourceFor(v.fixture, CORPUS_BACKEND[cell.platform]!));
        const pool = model.systems.flatMap((s) =>
          s.subdomains.flatMap((sd) => sd.contexts.flatMap((c) => c.aggregates)),
        );
        expect(
          aggregatesWithTuple(cell.tuple, pool).length,
          `'${v.fixture}' carries no aggregate with ${cell.tuple}`,
        ).toBeGreaterThan(0);
        const diags = validateLoomModel(model);
        expect(diags.filter((d) => d.code === "loom.target-unsupported")).toEqual([]);
      });
    } else if (v.verdict === "refused") {
      it(`${cell.id}: refused — raises loom.target-unsupported#${v.slug}`, async () => {
        const model = await lowered(tupleWitness(cell.tuple, cell.platform));
        const diags = validateLoomModel(model);
        const sys = model.systems[0]!;
        const ctx = sys.subdomains[0]!.contexts[0]!;
        const use = tupleUses(cell.tuple, ctx, sys)[0];
        expect(use, `the witness for ${cell.tuple} carries no such aggregate`).toBeDefined();
        const want = diagMessage(
          `loom.target-unsupported#${v.slug}` as never,
          {
            what: use!.what,
            dName: "d",
            target: cell.platform,
          } as never,
        );
        const hit = diags.filter((d) => d.code === "loom.target-unsupported");
        expect(
          hit.map((d) => d.message),
          `${cell.id} is refused but nothing refuses it`,
        ).toContain(want);
        expect(hit.every((d) => d.severity === "error")).toBe(true);
      });
    } else {
      it(`${cell.id}: owned — raises ${v.code}`, async () => {
        const diags = validateLoomModel(await lowered(tupleWitness(cell.tuple, cell.platform)));
        expect(diags.map((d) => d.code)).toContain(v.code);
      });
    }
  }

  // Every tuple's witness reaches the pair, whatever its verdicts: the
  // generator that builds the refused witnesses is itself proven here.
  for (const tuple of FEATURE_TUPLES) {
    it(`${tuple}: the witness model carries the pair`, async () => {
      const model = await lowered(tupleWitness(tuple, "node"));
      const sys = model.systems[0]!;
      expect(tupleUses(tuple, sys.subdomains[0]!.contexts[0]!, sys).length).toBeGreaterThan(0);
    });
  }
});
