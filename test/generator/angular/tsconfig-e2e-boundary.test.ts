import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// T7 note 1 (audit #2864) — the Angular frontend's ROOT tsconfig must not
// compile the `e2e/` project.
//
// A tsconfig with no `include`/`files` means "every .ts under this directory",
// and the generated Angular project has an `e2e/` tree sitting right there.  So
// the root project swept in 8 Playwright spec / page-object / fixture files,
// which import `@playwright/test` — a package the FRONTEND's package.json does
// not declare, and should not: `e2e/` is a self-contained project with its own
// `package.json` (declaring playwright) and its own `tsconfig.json`.  A plain
// `npx tsc -p tsconfig.json`, or opening the project in an editor, therefore
// reported errors before reaching any app code.
//
// Why no gate caught it: `ng build` reads `tsconfig.app.json`, whose
// `include` is already narrow (`src/**/*.ts`), so `generated-angular-build`
// stayed green while the root config was broken.  That is also why the fix must
// leave the app project's file set untouched — asserted below.
//
// The sibling frontends were never affected (react `include: ["src"]`, vue
// `include: ["src/**/*.ts", "src/**/*.vue"]`), and the last case here pins that
// so "Angular agrees now" cannot come from the siblings quietly widening.
//
// Fast suite: no docker, no LOOM_* env — pure in-memory generation.
// ---------------------------------------------------------------------------

/** The three shipping Angular design packs.  Each owns its own `tsconfig.hbs`,
 *  so the boundary has to hold on every one of them — a pack added later that
 *  copies the old template fails here. */
const ANGULAR_PACKS = ["angularMaterial", "primeng", "spartanNg"] as const;

const source = (platform: string, design?: string): string => `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Customer with crudish {
          name: string
        }
      }
    }
    ui Web { }
    storage primary { type: postgres }
    resource ordersState { for: Orders, kind: state, use: primary }
    deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
    deployable web {
      platform: ${platform}
      targets: api
      ui: Web
      port: 3004${design ? `\n      design: ${design}` : ""}
    }
  }
`;

/** The frontend deployable's own subtree, keyed by project-relative path. */
async function frontendFiles(platform: string, design?: string): Promise<Map<string, string>> {
  const all = await generateSystemFiles(source(platform, design));
  const out = new Map<string, string>();
  for (const [p, c] of all) if (p.startsWith("web/")) out.set(p.slice("web/".length), c);
  return out;
}

interface TsConfig {
  include?: string[];
  files?: string[];
  exclude?: string[];
}

/** True when this config leaves its file set unbounded — no `include`, no
 *  `files` — which is what makes TypeScript fall back to "everything below
 *  me", `e2e/` included. */
const unbounded = (cfg: TsConfig): boolean => !cfg.include && !cfg.files;

describe("angular root tsconfig — the e2e project stays out (T7, #2864)", () => {
  for (const design of ANGULAR_PACKS) {
    it(`${design}: the root project does not reach e2e/`, async () => {
      const files = await frontendFiles("angular", design);

      // The e2e tree must actually BE there, or the assertion below is about
      // nothing (experience_gathered.md §59 — a check that never reaches the
      // thing it names reads as a pass).
      const e2eFiles = [...files.keys()].filter((p) => p.startsWith("e2e/"));
      expect(
        e2eFiles.length,
        `${design}: no e2e/ tree was emitted, so this test is not exercising the defect`,
      ).toBeGreaterThan(0);

      const root = JSON.parse(files.get("tsconfig.json") ?? "{}") as TsConfig;

      // The defect, stated as the invariant: the root project must draw a
      // boundary, and that boundary must put e2e on the outside.  Either shape
      // is fine — a narrow `include`, or an `exclude` naming e2e — so a future
      // rewrite that switches strategy still passes.
      expect(
        unbounded(root) && !root.exclude?.some((p) => p.replace(/\/.*$/, "") === "e2e"),
        `${design}: the root tsconfig.json bounds nothing — no "include", no "files", ` +
          `and no "exclude" naming e2e — so TypeScript compiles every .ts below it, ` +
          `including the ${e2eFiles.length} e2e/ files that import @playwright/test ` +
          `(a dependency this project's package.json does not declare, and should not: ` +
          `e2e/ ships its own package.json and tsconfig.json).`,
      ).toBe(false);
    });

    it(`${design}: the ng build path is untouched — tsconfig.app.json still compiles src`, async () => {
      const files = await frontendFiles("angular", design);
      const app = JSON.parse(files.get("tsconfig.app.json") ?? "{}") as TsConfig;

      // `exclude` is inherited through `extends`, so excluding e2e at the root
      // reaches this config too.  Its own `include` was already narrower, so
      // the build's file set must not have moved — the fix closes an editor /
      // `tsc -p tsconfig.json` hole, it does not change what `ng build` reads.
      expect(app.include).toContain("src/**/*.ts");
      expect(app.files).toContain("src/main.ts");
    });

    it(`${design}: the frontend does not take on playwright as its own dependency`, async () => {
      const files = await frontendFiles("angular", design);
      const pkg = JSON.parse(files.get("package.json") ?? "{}") as {
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      // The other way to silence the original errors was to declare
      // `@playwright/test` here.  That is the wrong fix — it would make the app
      // project own files belonging to a separate project — so pin against it.
      expect(pkg.devDependencies ?? {}).not.toHaveProperty("@playwright/test");
      expect(pkg.dependencies ?? {}).not.toHaveProperty("@playwright/test");

      // …and the e2e project keeps declaring it, which is what makes the
      // exclusion correct rather than merely quiet.
      const e2ePkg = JSON.parse(files.get("e2e/package.json") ?? "{}") as {
        devDependencies?: Record<string, string>;
      };
      expect(e2ePkg.devDependencies ?? {}).toHaveProperty("@playwright/test");
    });
  }

  it("react and vue keep their own narrow include — Angular did not agree by accident", async () => {
    for (const [platform, expected] of [
      ["react", "src"],
      ["vue", "src/**/*.ts"],
    ] as const) {
      const files = await frontendFiles(platform);
      const root = JSON.parse(files.get("tsconfig.json") ?? "{}") as TsConfig;
      expect(root.include, `${platform}: root tsconfig lost its narrow include`).toContain(
        expected,
      );
    }
  });
});
