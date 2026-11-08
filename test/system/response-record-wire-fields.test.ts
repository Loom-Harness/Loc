// The scaffolded `<Agg>Response` record carries the canonical wire field list
// on every backend.
//
// `with scaffoldHandlers` splices a `response <Agg>Response` record, and every
// backend's response DTO / OpenAPI schema is rendered from THAT record, while
// the repository serialises the derived shape (`forApiRead(wireFieldsFor…)`).
// The record walk must therefore reproduce the derived list exactly — same
// names, same order — or the DTO understates (or reorders, for the positional
// .NET / Java records) what the serializer emits.  Three shapes reach the arms
// a record walk can miss:
//
//   inheritance.ddd          fields inherited through `extends` (TPH + TPC)
//   provenance.ddd           a `provenanced` field (the `Provenanced<T>` carrier)
//   part-rules-private-op    an INFERRED containment (`lines: Line[]`, no
//                            `contains`), which belongs in the containment slot
//                            after `version`, not among the value properties
//
// The expectation is read off the enriched IR, not hand-written, so it is the
// derived shape itself the emitted records are compared against.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { forApiRead, wireFieldsForAggregate } from "../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const PLATFORMS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Platform = (typeof PLATFORMS)[number];

const FIXTURES: Record<string, readonly string[]> = {
  "inheritance.ddd": ["Customer", "Vendor", "Machine", "Vehicle"],
  "provenance.ddd": ["Order"],
  "part-rules-private-op.ddd": ["Invoice"],
};

/** The corpus fixture with `with scaffoldHandlers` on every context — the same
 *  injection the wire/contract divergence census uses. */
function injected(file: string, platform: Platform): string {
  return readFileSync(new URL(`../fixtures/corpus/${file}`, import.meta.url), "utf8")
    .replaceAll("__PLATFORM__", platform)
    .replace(
      /^(\s*context\s+\w+)(\s+with\s+[^{]*?)?\s*\{/gm,
      (_m, head: string, clause?: string) =>
        clause ? `${head}${clause}, scaffoldHandlers {` : `${head} with scaffoldHandlers {`,
    );
}

/** Split a positional record's parameter list at top-level commas. */
function topLevelParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of params) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    if (ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** The record's fields as `[name, declaration]`, in emitted order, read off the
 *  backend's own response DTO / schema. */
function emittedRecord(
  files: ReadonlyMap<string, string>,
  platform: Platform,
  rec: string,
): [string, string][] {
  const all = [...files.values()].join("\n");
  const grab = (re: RegExp): string => {
    const m = re.exec(all);
    if (!m?.[1]) throw new Error(`${platform}: no emitted ${rec}`);
    return m[1];
  };
  switch (platform) {
    case "node":
      return grab(new RegExp(`export const ${rec} = z\\.object\\(\\{\\n([\\s\\S]*?)\\n\\}\\)`))
        .split("\n")
        .map((l) => [/^\s+(\w+):/.exec(l)?.[1] ?? "", l]);
    case "python":
      return grab(new RegExp(`class ${rec}\\(BaseModel\\):\\n((?:    \\w+:.*\\n)+)`))
        .trimEnd()
        .split("\n")
        .map((l) => [/^\s+(\w+):/.exec(l)?.[1] ?? "", l]);
    case "elixir":
      return grab(new RegExp(`title: "${rec}",[\\s\\S]*?properties: %\\{\\n([\\s\\S]*?)\\n    \\}`))
        .split("\n")
        .filter((l) => /^ {6}\w+:/.test(l))
        .map((l) => [/^\s+(\w+):/.exec(l)?.[1] ?? "", l]);
    case "dotnet":
    case "java":
      return topLevelParams(grab(new RegExp(`record ${rec}\\(([^\\n]*?)\\)\\s*[;{]`))).map((p) => [
        lowerFirst(p.split(/\s+/).pop() ?? ""),
        p,
      ]);
  }
}

/** The carrier marker each backend's DTO spells for `Provenanced<T>`. */
const CARRIER: Record<Platform, RegExp> = {
  node: /lineage/,
  dotnet: /Provenanced</,
  java: /Provenanced</,
  python: /Provenanced\[/,
  elixir: /lineage/,
};

describe("scaffolded <Agg>Response records carry the canonical wire fields", () => {
  for (const [file, aggs] of Object.entries(FIXTURES)) {
    for (const platform of PLATFORMS) {
      it(`${file} on ${platform}`, async () => {
        const source = injected(file, platform);
        const { model } = await parseString(source, { validate: true });
        const enriched = enrichLoomModel(lowerModel(model));
        const byName = new Map(
          allContexts(enriched).flatMap((c) => c.aggregates.map((a) => [a.name, a])),
        );
        const files = await generateSystemFiles(source);
        for (const name of aggs) {
          const agg = byName.get(name);
          if (!agg) throw new Error(`${file}: no aggregate ${name}`);
          const wire = forApiRead(wireFieldsForAggregate(agg));
          const emitted = emittedRecord(files, platform, `${name}Response`);
          expect(
            emitted.map(([n]) => n),
            `${platform} ${name}Response must carry the derived wire fields, in order`,
          ).toEqual(wire.map((w) => w.name));
          for (const w of wire) {
            if (w.type.kind !== "genericInstance" || w.type.ctor !== "provenanced") continue;
            const decl = emitted.find(([n]) => n === w.name)?.[1] ?? "";
            expect(decl, `${platform} ${name}Response.${w.name} ships the carrier`).toMatch(
              CARRIER[platform],
            );
          }
        }
      }, 600_000);
    }
  }
});
