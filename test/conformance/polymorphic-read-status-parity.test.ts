// The polymorphic base reads (`GET /api/<bases>`, TPH `GET /api/<bases>/{id}`)
// declare exactly the error set their DERIVED operation carries
// (`polymorphicReadOperations`, `src/ir/plan/repo-polymorphic.ts`) — the
// surface the typed clients, the e2e validator and the api-caller census read.
// A concrete's list-read gate rides both reads (`readLadder`), so a gated base
// answers 403 there; the derived operation and every backend that declares the
// route's responses must say so, and an ungated base must not.
//
// Each extractor reads the backend's own declaration idiom at its own site, so
// a backend that re-derives the 403 itself and disagrees with the plan fails
// here.  Java's base-read controller declares no response annotations.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contextOperations } from "../../src/ir/plan/index.js";
import { elixirDocumentedOperations } from "../_helpers/elixir-openapi-ops.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";

const corpus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/corpus");
const source = (fixture: string, platform: string): string =>
  fs.readFileSync(path.join(corpus, `${fixture}.ddd`), "utf8").replace("__PLATFORM__", platform);

const PLATFORMS = ["node", "dotnet", "python", "elixir"] as const;
type Platform = (typeof PLATFORMS)[number];

function pick(files: Map<string, string>, re: RegExp): string {
  const hits = [...files.entries()].filter(([p]) => re.test(p));
  expect(hits.length, `expected one file matching ${re}, got ${hits.map(([p]) => p)}`).toBe(1);
  return hits[0]![1];
}

/** The declared non-200 statuses of the base read `kind` of `base` (path
 *  segment `seg`), ascending. */
const DECLARED: Record<
  Platform,
  (files: Map<string, string>, base: string, seg: string, kind: "find" | "getById") => number[]
> = {
  node: (files, base, _seg, kind) => {
    const src = pick(files, new RegExp(`/http/${base.toLowerCase()}\\.routes\\.ts$`));
    const at = src.indexOf(`operationId: "${kind === "find" ? `all${base}` : `get${base}ById`}"`);
    expect(at, `node ${base} ${kind}`).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("async (c) =>", at));
    return [...block.matchAll(/^\s+(\d{3}): \{ description:/gm)]
      .map((m) => Number(m[1]))
      .filter((s) => s !== 200);
  },
  python: (files, base, _seg, kind) => {
    const id = kind === "find" ? `all${base}` : `get${base}ById`;
    const line = [...files.values()]
      .flatMap((c) => c.split("\n"))
      .find((l) => l.includes(`operation_id="${id}"`));
    expect(line, `python ${base} ${kind}`).toBeDefined();
    return [...(line ?? "").matchAll(/(\d{3}): \{"model"/g)].map((m) => Number(m[1]));
  },
  dotnet: (files, base, _seg, kind) => {
    const src = [...files.entries()].find(
      ([p, c]) => p.endsWith("Controller.cs") && c.includes(`All${base}(`),
    )?.[1];
    expect(src, `dotnet ${base} controller`).toBeDefined();
    const action = src!.indexOf(kind === "find" ? `All${base}(` : `Get${base}ById(`);
    const block = src!.slice(src!.lastIndexOf("[HttpGet", action), action);
    return [...block.matchAll(/ProducesResponseType\(typeof\(ProblemResponse\), (\d{3})/g)].map(
      (m) => Number(m[1]),
    );
  },
  elixir: (files, _base, seg, kind) => {
    const block = elixirDocumentedOperations(files).get(
      kind === "find" ? `get /api/${seg}` : `get /api/${seg}/{id}`,
    );
    expect(block, `elixir ${seg} ${kind}`).toBeDefined();
    return [...block!.matchAll(/^\s+(\d{3}) => %OpenApiSpex\.Response\{/gm)]
      .map((m) => Number(m[1]))
      .filter((s) => s !== 200);
  },
};

describe("polymorphic base reads — the declared error set is the derived one", () => {
  for (const fixture of ["inheritance-read-gates", "inheritance-base-reads"]) {
    it(`${fixture}: every declaring backend matches polymorphicReadOperations`, async () => {
      const loom = await buildLoomModel(source(fixture, "node"));
      const ops = enrichedContexts(loom)
        .flatMap((c) => contextOperations(c))
        .filter((o) => o.polymorphicBase);
      expect(ops.length, "the fixture routes a polymorphic read").toBeGreaterThan(0);
      for (const platform of PLATFORMS) {
        const files = await generateSystemFiles(source(fixture, platform));
        for (const op of ops) {
          const seg = op.path.replace(/^\/api\//, "").replace(/\/\{id\}$/, "");
          const kind = op.kind as "find" | "getById";
          const declared = DECLARED[platform](files, op.aggregate, seg, kind).sort((a, b) => a - b);
          expect(declared, `${platform} ${op.method.toUpperCase()} ${op.path}`).toEqual(
            [...op.errorStatuses].sort((a, b) => a - b),
          );
        }
      }
    }, 300_000);
  }

  it("the gated fixture's derived reads carry the 403 and the ungated one's do not", async () => {
    const statuses = async (fixture: string): Promise<boolean[]> => {
      const loom = await buildLoomModel(source(fixture, "node"));
      return enrichedContexts(loom)
        .flatMap((c) => contextOperations(c))
        .filter((o) => o.polymorphicBase)
        .map((o) => o.errorStatuses.includes(403));
    };
    expect(new Set(await statuses("inheritance-read-gates"))).toEqual(new Set([true]));
    expect(new Set(await statuses("inheritance-base-reads"))).toEqual(new Set([false]));
  });
});
