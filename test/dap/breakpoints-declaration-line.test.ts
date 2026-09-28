// F-021 — a DECLARATION-level `.ddd` line (`operation complete(...) { `) used
// to resolve to generated line 1.
//
// The map carried accurate EXPRESSION-level regions (a statement line answered
// `domain/workOrder.ts:41:11`, column and all) and nothing at all between a
// statement and the whole FILE, so the one line an engineer actually sets a
// breakpoint on — the member header — matched only the file region and armed
// the import block.  `declarationSubRegion` (`src/generator/_trace/sourcemap.ts`)
// records one region per member body carrying the MEMBER's origin, which is
// what this test pins.
//
// The reverse direction (`resolveFrame`, `ddd trace`) must not regress: a
// generated line still has to answer with the narrowest origin covering it,
// which for a body line is its statement, not the new member region.

import { describe, expect, it } from "vitest";
import { translateBreakpoint } from "../../src/dap/breakpoints.js";
import { resolveFrame, type SourceMap } from "../../src/trace/resolve.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = `
system Field {
  subdomain Ops {
    context Work {
      enum WorkStatus { Draft  InProgress  Done }
      aggregate WorkOrder {
        ref: string
        note: string
        status: WorkStatus = Draft
        operation start() when status == Draft {
          status := InProgress
        }
        operation complete(note: string) when status == InProgress {
          this.note := note
          status := Done
        }
      }
      repository WorkOrders for WorkOrder { }
    }
  }

  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }
  api WorkApi from Ops

  deployable api { platform: node contexts: [Work] dataSources: [workState] serves: WorkApi port: 3000 }
}
`;

const lineOf = (needle: string): number =>
  SOURCE.split("\n").findIndex((l) => l.includes(needle)) + 1;

const COMPLETE_DECL_LINE = lineOf("operation complete(");
const START_DECL_LINE = lineOf("operation start(");
const STATEMENT_LINE = lineOf("status := Done");

async function map(): Promise<SourceMap> {
  // The checked helper (phases ① / ④ / ⑦), not `generateSystems` directly.
  const files = await generateSystemFiles(SOURCE, { sourcemap: true });
  return JSON.parse(files.get(".loom/sourcemap.json")!) as SourceMap;
}

describe("ddd breakpoints — declaration-level lines resolve to real generated lines", () => {
  it("an `operation` header resolves to the body's generated line, never line 1", async () => {
    const m = await map();
    const dddPath = m.sources[0]!;
    for (const declLine of [START_DECL_LINE, COMPLETE_DECL_LINE]) {
      const targets = translateBreakpoint(m, dddPath, declLine, () => SOURCE);
      expect(targets.length, `line ${declLine} maps somewhere`).toBeGreaterThan(0);
      // The defect, stated directly: every answer used to be `<file>:1`.
      expect(
        targets.map((t) => `${t.file}:${t.line}`),
        `line ${declLine} must not resolve to a file header`,
      ).toEqual(targets.map((t) => `${t.file}:${t.line}`).filter((s) => !s.endsWith(":1")));
      // …and it points into the aggregate's domain file, where the method is.
      expect(targets.some((t) => t.file.endsWith("domain/workOrder.ts"))).toBe(true);
    }
  }, 120_000);

  it("the two operations resolve to DIFFERENT generated lines", async () => {
    const m = await map();
    const dddPath = m.sources[0]!;
    const lineFor = (declLine: number): number =>
      translateBreakpoint(m, dddPath, declLine, () => SOURCE).find((t) =>
        t.file.endsWith("domain/workOrder.ts"),
      )!.line;
    expect(lineFor(START_DECL_LINE)).not.toBe(lineFor(COMPLETE_DECL_LINE));
  }, 120_000);

  // --- non-vacuity: the fine regions still win where they apply -------------

  it("a STATEMENT line still resolves to its own column-bearing region", async () => {
    const m = await map();
    const dddPath = m.sources[0]!;
    const targets = translateBreakpoint(m, dddPath, STATEMENT_LINE, () => SOURCE);
    const domain = targets.filter((t) => t.file.endsWith("domain/workOrder.ts"));
    expect(domain.length).toBeGreaterThan(0);
    // A member region would have swallowed the statement had it been recorded
    // as narrower; the column-bearing expression region must still be first.
    expect(domain[0]!.column).toBeDefined();
  }, 120_000);

  it("the reverse direction still resolves a body line to its own statement", async () => {
    const m = await map();
    const dddPath = m.sources[0]!;
    const target = translateBreakpoint(m, dddPath, STATEMENT_LINE, () => SOURCE).find((t) =>
      t.file.endsWith("domain/workOrder.ts"),
    )!;
    const back = resolveFrame({ lineIndex: 0, file: target.file, line: target.line }, m);
    expect(back?.source, "a generated body line chains back to .ddd source").toBeDefined();
    const backLine = SOURCE.slice(0, back!.source!.span.start).split("\n").length;
    expect(backLine).toBe(STATEMENT_LINE);
    void dddPath;
  }, 120_000);
});
