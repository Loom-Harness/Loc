// No tool name in generated output — the whole-corpus census (#5942).
//
// Generated projects carry no tool name (docs/decisions/D-NO-TOOL-NAME.md).
// This generates every tracked `.ddd` (a `__PLATFORM__` fixture on all five
// backends) plus the `ddd new --template crud` starter on every backend × every
// design pack, and extracts every tool-named NAME from the output
// (`test/_helpers/tool-name-scan.ts` says what a name is and what is out of
// scope).  The set is held against the shrink-only allowlist in
// `tool-name-census.allowlist.ts`:
//   - a name the output carries that no row covers fails — a NEW tool-named
//     identifier, which the rule forbids;
//   - a row no generated tree reaches fails as stale — a rename landed, and its
//     row goes in the same change.
// The fast tier carries the cheaper half (`tool-name-census-fast.test.ts`: a
// fixed sample, new names only); stale rows need the whole corpus, so they are
// judged only here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import {
  allowlistRowOf,
  rowLabel,
  starterSources,
  type ToolNameHit,
  toolNamesInTree,
} from "../_helpers/tool-name-scan.js";
import { BACKENDS, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";
import { TOOL_NAME_ALLOWLIST } from "./tool-name-census.allowlist.js";

/** Every opt-in emission switched on, so the Kubernetes manifests, the
 *  source-map markers and the trace wiring are in the scanned output. */
const ALL_OPTIONS_ON = { sourcemap: true, emitKubernetes: true, emitTrace: true } as const;

interface Case {
  readonly label: string;
  readonly source: string;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const ddd of trackedDddFiles()) {
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
  out.push(...starterSources());
  return out;
}

describe("no tool name in generated output (whole corpus)", () => {
  it("every tool-named name is allowlisted, and every allowlist row is still reached", async () => {
    const names = new Map<string, ToolNameHit & { firstCase: string }>();
    let generated = 0;
    for (const c of cases()) {
      let files: Map<string, string>;
      try {
        files = await generateSystemFiles(c.source, ALL_OPTIONS_ON);
      } catch {
        // A model that does not generate standalone (a deliberately invalid
        // fixture, a multi-file import graph) is ddd-source-census's business.
        continue;
      }
      generated++;
      for (const [name, hit] of toolNamesInTree(files, c.source)) {
        const seen = names.get(name);
        names.set(name, {
          count: (seen?.count ?? 0) + hit.count,
          samples: seen?.samples ?? hit.samples,
          firstCase: seen?.firstCase ?? c.label,
        });
      }
    }
    // DENOMINATOR FLOOR — a census that stopped generating reads as a pass.
    expectReach("generated trees", generated, 1400);

    const unlisted = [...names]
      .filter(([name]) => !allowlistRowOf(name, TOOL_NAME_ALLOWLIST))
      .map(
        ([name, h]) => `  ${name}  (${h.count}×, first in ${h.firstCase})\n      ${h.samples[0]}`,
      );
    expect(
      unlisted.join("\n"),
      "generated output carries a NEW tool-named identifier.  Generated code carries no\n" +
        "tool name (docs/decisions/D-NO-TOOL-NAME.md): give it a neutral name.  Only a name\n" +
        "whose siblings are all still tool-named may follow them — then add its row to\n" +
        "tool-name-census.allowlist.ts and list it on #5942.",
    ).toBe("");

    const reached = new Set(
      [...names.keys()].map((n) => allowlistRowOf(n, TOOL_NAME_ALLOWLIST)).filter(Boolean),
    );
    const stale = TOOL_NAME_ALLOWLIST.filter((r) => !reached.has(r)).map(rowLabel);
    expect(
      stale,
      "these allowlist rows match nothing the corpus generates any more — the rename\n" +
        "landed; delete the rows in the same change (the list only shrinks).",
    ).toEqual([]);
  }, 1_800_000);
});
