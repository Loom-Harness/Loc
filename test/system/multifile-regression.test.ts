import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSystemFiles, generateSystemFilesFromProject } from "../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/** The single-file path: one source string, parsed and generated on its
 *  own — no project loader, no import graph. */
const generateSingleFile = (absoluteSourcePath: string): Promise<Map<string, string>> =>
  generateSystemFiles(fs.readFileSync(absoluteSourcePath, "utf8"));

/** The project-loader path `ddd generate system` takes: parse the entry,
 *  walk imports, lower the graph as one project, enrich, generate. */
const generateProject = (absoluteEntryPath: string): Promise<Map<string, string>> =>
  generateSystemFilesFromProject(absoluteEntryPath);

function expectEqualFileMaps(a: Map<string, string>, b: Map<string, string>): void {
  const aKeys = [...a.keys()].sort();
  const bKeys = [...b.keys()].sort();
  expect(bKeys, "file set differs").toEqual(aKeys);
  for (const k of aKeys) {
    expect(b.get(k), `content of ${k} differs`).toBe(a.get(k));
  }
}

describe("multi-file regression — byte-identical with the single-file baseline", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mf-regress-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // The gating regression: an existing single-file example wrapped
  // in a trivial `main.ddd` that just imports the original file must
  // produce a byte-identical file map.  Proves the multi-file path
  // doesn't perturb generator output.
  for (const example of ["examples/acme.ddd", "examples/provenance.ddd"]) {
    it(`${example}: trivial import wrapper matches single-file output`, async () => {
      const sourceAbs = path.join(repoRoot, example);
      const baseline = await generateSingleFile(sourceAbs);
      expect(baseline.size).toBeGreaterThan(0);

      // Copy the original into the temp dir under a different name,
      // and create a main.ddd that does nothing but import it.
      const innerName = path.basename(example);
      fs.copyFileSync(sourceAbs, path.join(tmp, innerName));
      fs.writeFileSync(path.join(tmp, "main.ddd"), `import "./${innerName}"\n`, "utf8");

      const wrapped = await generateProject(path.join(tmp, "main.ddd"));
      expectEqualFileMaps(baseline, wrapped);
    });
  }

  // End-to-end exercise of the root-level VO emission path: a tiny
  // project with the VO at root in a separate file generates output
  // where the VO actually appears in the per-context emitted code.
  // This confirms the enrichment injection reaches backend emitters.
  it("root-level valueobject in its own file emits into the consuming context", async () => {
    writeProject(tmp, {
      "main.ddd": `
        import "./shared/money.ddd"
        import "./catalog.ddd"
        system Tiny {
          subdomain M {
            context Catalog {
              aggregate Product {
                sku: string
                price: Money
                create(sku: string, price: Money) { sku := sku  price := price }
              }
              repository Products for Product { }
            }
          }
          storage pg { type: postgres }
          resource catalogState { for: Catalog, kind: state, use: pg }
          deployable api { platform: node, contexts: [Catalog], dataSources: [catalogState] }
        }
      `,
      "shared/money.ddd": `
        valueobject Money {
          amount: decimal
          currency: string
        }
      `,
      // catalog.ddd is unused (the context is inlined in the system
      // for simplicity).  Imported just to confirm imports of files
      // with no live contributions don't break.
      "catalog.ddd": `// reserved for future catalog content`,
    });

    const files = await generateProject(path.join(tmp, "main.ddd"));
    // The hono backend bundles every VO into a single
    // `domain/value-objects.ts` per deployable.  Confirm the root VO
    // (Money) made it there, *and* that the Product emission imports
    // and references it — proves the injection reaches generators
    // and that the type reference resolves through the linker.
    const vos = files.get("api/domain/value-objects.ts") ?? "";
    expect(vos, "expected value-objects.ts to contain Money").toContain("Money");
    const productRoutes = files.get("api/http/product.routes.ts") ?? "";
    expect(productRoutes, "expected product routes to import Money").toContain(
      'import { Money } from "../domain/value-objects"',
    );
  });

  function writeProject(rootDir: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(rootDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
  }
});
