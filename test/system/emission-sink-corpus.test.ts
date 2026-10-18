// No generated tree loses a file to a path clobber — over the WHOLE tracked
// `.ddd` corpus, every `__PLATFORM__` fixture on all five backends.
//
// The class (#3045; the per-context `workflows_controller.ex` note in
// `elixir/vanilla/workflow-execution-emit.ts`): two emitters resolve to ONE
// output path, the second `set` silently replaces the first, and the generated
// tree ships missing a file with `0 error(s)`. Every orchestrator now writes
// into an `EmissionSink` (src/util/emission-sink.ts), whose `set` throws an
// `EmissionClobberError` naming both writers on a second write of different
// content. This census drives the corpus through `generate system` and fails on
// any such throw.
//
// It separates the clobber from every OTHER generation failure on purpose: the
// sibling corpus censuses `catch { continue }` a model that will not generate
// (a deliberately invalid fixture, a multi-file import graph), and a clobber
// thrown inside that `catch` would just shrink their denominator. Here a
// clobber is the one failure that is never skipped.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EmissionClobberError } from "../../src/util/emission-sink.js";
import { REPO_ROOT, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { BACKENDS, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";

/** Every opt-in emission switched ON. The post-processing passes that rewrite
 *  an already-emitted file (import-extension rewriting, source-map
 *  directives) only run behind these flags, so a default-options sweep never
 *  reaches the writes most likely to clobber. The default path is exercised
 *  by every other generator test, each of which now writes into a sink. */
const ALL_OPTIONS_ON = { sourcemap: true, emitKubernetes: true, emitTrace: true } as const;

interface Case {
  readonly label: string;
  readonly source: string;
}

/** Every tracked `.ddd`; a `__PLATFORM__` template expands to one case per backend. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const ddd of trackedDddFiles()) {
    if (ddd === UNPARSEABLE_DDD) continue;
    const text = readFileSync(resolve(REPO_ROOT, ddd), "utf8");
    if (!text.includes("__PLATFORM__")) {
      out.push({ label: ddd, source: text });
      continue;
    }
    for (const b of BACKENDS) {
      out.push({
        label: `${ddd} [${b}]`,
        source: text.replaceAll("__PLATFORM__", PLATFORM_CLAUSE[b]),
      });
    }
  }
  return out;
}

describe("write-once emission: no generated path is written twice with different content", () => {
  it("the whole corpus generates without an EmissionClobberError", async () => {
    const clobbers: string[] = [];
    let generated = 0;
    for (const c of cases()) {
      try {
        const files = await generateSystemFiles(c.source, ALL_OPTIONS_ON);
        if (files.size > 0) generated++;
      } catch (err) {
        if (err instanceof EmissionClobberError)
          clobbers.push(`${c.label}\n    ${err.message.replaceAll("\n", "\n    ")}`);
        // Any other failure is a model that does not generate standalone — the
        // sibling censuses' business (ddd-source-census.test.ts), not this one's.
      }
    }
    // DENOMINATOR FLOOR — a census that silently stopped generating reads as a pass.
    expect(generated, "the corpus stopped generating — this census is vacuous").toBeGreaterThan(
      500,
    );
    expect(clobbers.join("\n\n"), "a generated path was clobbered").toBe("");
  }, 1_800_000);
});
