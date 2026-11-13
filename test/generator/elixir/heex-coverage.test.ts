import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCUMULATORS,
  formatHeexCoverage,
  type HeexCoverageRecorder,
  type HeexCoverageReport,
  heexRenderedPrimitives,
  installHeexCoverage,
} from "../../../scripts/heex-coverage.mjs";
import { WALKER_PRIMITIVES } from "../../../src/generator/_walker/registry.js";
import type { WalkResult } from "../../../src/generator/elixir/heex-walker.js";
import { uiCapability } from "../../../src/util/target-capabilities.js";
import { repoRoot } from "../../_helpers/examples.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// The HEEx showcase fixture reaches every walker primitive the HEEx target
// renders (`heexRenderedPrimitives`: every registered primitive the capability
// table admits on LiveView) and every `WalkResult` accumulator the HEEx walker
// fills.  This is the per-target primitive completeness check for HEEx.
//
// This is the coverage floor the HEEx walker refactors rely on: the corpus
// diff (`scripts/heex-corpus-diff.mjs`) can only prove a change byte-identical
// for the renders the corpus reaches, so every render path has to be reached by
// at least one input.  The fixture is that input.  A new primitive with a
// `heex` renderer, or a new `WalkResult` field, fails here until the fixture
// renders it.  `node scripts/heex-corpus-diff.mjs coverage` prints the same
// report across the whole HEEx corpus.

const FIXTURE = path.join(repoRoot, "test/fixtures/heex-showcase.ddd");

/** Compile-time: `ACCUMULATORS` keys are exactly `WalkResult`'s fields other
 *  than its two rendered outputs — the `heex` string and the page's
 *  `titleExpr`, which is rendered from the page declaration after the walk
 *  rather than accumulated while walking the body. */
type AccumulatorField = Exclude<keyof WalkResult, "heex" | "titleExpr">;
const EVERY_ACCUMULATOR: Record<AccumulatorField, true> = {
  handlers: true,
  formBindings: true,
  queryBindings: true,
  actionBindings: true,
  usedComponents: true,
  componentUses: true,
  usesSlot: true,
  usesChart: true,
  usesTableHelpers: true,
  idOptionsBindings: true,
  refLabelBindings: true,
  usedStores: true,
  uploadBindings: true,
  tableControls: true,
};

describe("HEEx showcase coverage", () => {
  let recorder: HeexCoverageRecorder;
  let report: HeexCoverageReport;
  let files: Map<string, string>;

  beforeAll(async () => {
    recorder = installHeexCoverage(
      WALKER_PRIMITIVES,
      heexRenderedPrimitives(WALKER_PRIMITIVES, uiCapability),
    );
    recorder.setInput("heex-showcase");
    try {
      files = await generateSystemFiles(fs.readFileSync(FIXTURE, "utf8"));
    } finally {
      recorder.uninstall();
    }
    report = recorder.report();
  }, 120_000);

  afterAll(() => recorder?.uninstall());

  it("measures exactly the WalkResult accumulators", () => {
    expect(Object.keys(ACCUMULATORS).sort()).toEqual(Object.keys(EVERY_ACCUMULATOR).sort());
  });

  it("renders LiveView pages", () => {
    const live = [...files.keys()].filter((p) => p.endsWith("_live.ex"));
    expect(live.length).toBeGreaterThanOrEqual(10);
  });

  it("reaches every heex primitive, every accumulator and every component-scoped binding", () => {
    const { text, gaps } = formatHeexCoverage(report);
    expect(gaps, `HEEx showcase coverage gaps:\n${text}`).toEqual([]);
  });
});
