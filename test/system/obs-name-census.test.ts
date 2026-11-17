// Gate for D-NO-TOOL-NAME (docs/decisions).
//
// The observability names every backend writes — the span attribute keys that
// carry the execution-context ids, and Phoenix's domain telemetry events — are
// spelled once: the attribute keys in `src/generator/_obs/tracing.ts`
// (`SpanAttr`, under the `app.` namespace) and the telemetry event in
// `src/generator/_obs/render-phoenix.ts` (`phoenixDomainEvent`).  Dashboards
// and saved queries key on them across backends, so a copy spelled anywhere
// else in `src/` is refused, as is the tool-named spelling they replaced and a
// tracer or logger named after the tool.  A TypeScript comment line is skipped.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const SHARED_SOURCES = ["src/generator/_obs/tracing.ts", "src/generator/_obs/render-phoenix.ts"];

const SPELLED = new RegExp(
  [
    "\\b(?:app|loom)\\.(?:correlation_id|scope_id|actor_id)\\b",
    "\\[:[a-z_]+, :domain, :",
    '(?:getTracer|get_tracer|getLogger)\\("loom"\\)',
    'FormatterName = "loom"',
  ].join("|"),
  "g",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "generated") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function spelledOutSites(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const abs of files) {
    const file = relative(REPO_ROOT, abs).replaceAll("\\", "/");
    if (SHARED_SOURCES.includes(file)) continue;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const m of line.matchAll(SPELLED))
          out.push(`${file}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 120)}`);
      });
  }
  return out;
}

describe("observability names are spelled once", () => {
  const files = sourceFiles(join(REPO_ROOT, "src"));

  it("no span attribute key or domain telemetry event is spelled out of its shared source", () => {
    expect(
      spelledOutSites(files),
      "read the name from SpanAttr (src/generator/_obs/tracing.ts) or phoenixDomainEvent (render-phoenix.ts)",
    ).toEqual([]);
  });

  it("the scan reaches src/ (denominator)", () => {
    expectReach("src/ TypeScript files scanned", files.length, 500);
  });
});
