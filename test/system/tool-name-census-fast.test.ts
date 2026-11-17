// Gate for D-NO-TOOL-NAME (docs/decisions).
// No tool name in generated output — the fast-tier half of the census (#5942).
//
// The whole-corpus census (`tool-name-census.test.ts`) runs in the `corpus`
// project, outside `npm test`.  This half runs in `npm test` over a fixed
// sample — the `ddd new --template crud` starter on every backend × every
// design pack, plus two feature-wide examples — and fails on a tool-named name
// no allowlist row covers.  It catches a new name on the common emission path;
// a new name only a rarer feature emits, and every stale row, are the corpus
// census's.  The allowlist's own shape is checked here too, so a malformed row
// fails fast.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import {
  allowlistRowOf,
  namesIn,
  starterSources,
  toolNamesInTree,
} from "../_helpers/tool-name-scan.js";
import { TOOL_NAME_ALLOWLIST } from "./tool-name-census.allowlist.js";

const ALL_OPTIONS_ON = { sourcemap: true, emitKubernetes: true, emitTrace: true } as const;

/**
 * The allowlist's row count.  The allowlist only shrinks: a new row fails
 * here unless this ceiling is raised in the same diff (the PR body says why
 * the name cannot be renamed instead), and a removed row fails until the
 * ceiling comes down with it, so freed room cannot be silently re-spent.
 */
const TOOL_NAME_ALLOWLIST_CEILING = 313;

/** Two examples that between them reach auth, channels, workflows, provenance
 *  and every backend. */
const EXAMPLES = ["examples/acme.ddd", "examples/showcase.ddd"];

describe("no tool name in generated output (fast sample)", () => {
  it("the starter on every backend × design pack and the wide examples emit only allowlisted names", async () => {
    const sources: { label: string; source: string }[] = EXAMPLES.map((f) => ({
      label: f,
      source: readFileSync(resolve(REPO_ROOT, f), "utf8"),
    }));
    sources.push(...starterSources());
    // REACH FLOOR — 2 examples + the starter on 5 backends × the design packs.
    expectReach("generated sample trees", sources.length, 50);
    const unlisted: string[] = [];
    for (const { label, source } of sources) {
      const files = await generateSystemFiles(source, ALL_OPTIONS_ON);
      for (const [name, hit] of toolNamesInTree(files, source)) {
        if (!allowlistRowOf(name, TOOL_NAME_ALLOWLIST)) {
          unlisted.push(`  ${name}  (${label})\n      ${hit.samples[0]}`);
        }
      }
    }
    expect(
      unlisted.join("\n"),
      "generated output carries a NEW tool-named identifier (docs/decisions/D-NO-TOOL-NAME.md)",
    ).toBe("");
  }, 300_000);

  it("every allowlist row is well-formed and unique", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const r of TOOL_NAME_ALLOWLIST) {
      const key = "name" in r ? `name:${r.name}` : `pattern:${r.pattern}`;
      if (seen.has(key)) problems.push(`duplicate row ${key}`);
      seen.add(key);
      if ("pattern" in r && !/^\^.*\$$/.test(r.pattern)) problems.push(`unanchored ${r.pattern}`);
      if ((r.step === "pending-design") !== (r.group === "pending"))
        problems.push(`${key}: pending step/group`);
      if ((r.step === "standing") !== (r.group === "user"))
        problems.push(`${key}: standing step/group`);
      // An exact row a pattern also covers is dead weight.
      if ("name" in r) {
        const p = TOOL_NAME_ALLOWLIST.find(
          (q) => "pattern" in q && new RegExp(q.pattern).test(r.name),
        );
        if (p) problems.push(`${key} is also covered by a pattern row`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the allowlist row count sits at its ceiling", () => {
    const n = TOOL_NAME_ALLOWLIST.length;
    const verdict =
      n > TOOL_NAME_ALLOWLIST_CEILING
        ? `GREW past its ceiling (${n} > ${TOOL_NAME_ALLOWLIST_CEILING}): rename the new name instead of listing it, or raise TOOL_NAME_ALLOWLIST_CEILING in this diff and say why in the PR body`
        : n < TOOL_NAME_ALLOWLIST_CEILING
          ? `fell below its ceiling (${n} < ${TOOL_NAME_ALLOWLIST_CEILING}): lower TOOL_NAME_ALLOWLIST_CEILING to ${n}`
          : "";
    expect(verdict, "tool-name allowlist ceiling").toBe("");
  });

  it("names are extracted and normalised as documented (positive control)", () => {
    expect(namesIn('const t = trace.getTracer("loom");', false)).toEqual(['"loom"']);
    expect(namesIn("[:loom, :domain, :fault]", false)).toEqual([":loom"]);
    expect(namesIn("package com.loom.shop.domain;", false)).toEqual(["com.loom"]);
    expect(namesIn("src/main/java/com/loom/shop/App.java", true)).toEqual(["path:com/loom"]);
    expect(namesIn("see .loom/sourcemap.json", false)).toEqual([".loom/"]);
    expect(namesIn(".loom/wire-spec.json", true)).toEqual(["path:.loom"]);
    expect(namesIn('logger.info({ "loom.correlation_id": id })', false)).toEqual([
      "loom.correlation_id",
    ]);
    expect(namesIn("{/* loom:unrendered [loom.page-primitive-arg-missing] */}", false)).toEqual([
      "loom:unrendered",
      "loom.<diagnostic-code>",
    ]);
    expect(namesIn('headers["x-loom-attempts"] = n; insert into __loom_outbox', false)).toEqual([
      "x-loom-attempts",
      "__loom_outbox",
    ]);
    // A name the user's own model spells is the user's.
    const tree = new Map([["web/package.json", '"name": "loom-landing"']]);
    expect([...toolNamesInTree(tree, "system LoomLanding {}").keys()]).toEqual([]);
    expect([...toolNamesInTree(tree, "system Shop {}").keys()]).toEqual(["loom-landing"]);
  });
});
