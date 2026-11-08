import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A `raw` seed row for a TPH (`sharedTable`) concrete lands in the hierarchy's
// one shared table, whose `kind` discriminator is NOT NULL with no default —
// every backend's raw INSERT must therefore name it.

const source = (platform: string) => `
system F7 {
  subdomain Core {
    context Books {
      abstract aggregate Asset inheritanceUsing: sharedTable { label: string }
      aggregate Car extends Asset {
        wheels: int
        create(label: string, wheels: int) { label := label  wheels := wheels }
      }
      repository Cars for Car { }
      seed fixtures raw {
        Car { id: "22222222-2222-2222-2222-222222222222", label: "c2", wheels: 3 }
      }
    }
  }
  storage primary { type: postgres }
  resource s { for: Books, kind: state, use: primary }
  deployable d { platform: ${platform} contexts: [Books] dataSources: [s] port: 4000 }
}`;

/** The seed file each backend writes the raw INSERT into. */
const SEED_FILE: Record<string, RegExp> = {
  node: /\/db\/seed\.ts$/,
  python: /\/db\/seed\.py$/,
  java: /SeedRunner\.java$/,
  dotnet: /\/Seed\.cs$/,
  elixir: /\/seeds\.ex$/,
};

describe("raw seed row for a TPH concrete", () => {
  for (const [platform, fileRe] of Object.entries(SEED_FILE)) {
    it(`${platform}: inserts into the shared table with the kind discriminator`, async () => {
      const files = await generateSystemFiles(source(platform));
      const seed = [...files].find(([path]) => fileRe.test(path));
      expect(seed, `no seed file matching ${fileRe}`).toBeDefined();
      const text = seed![1].replace(/\\"/g, '"').replace(/""/g, '"');
      expect(text).toMatch(/INSERT INTO "books"\."assets" \("id", "label", "wheels", "kind"/);
      expect(text).toContain("'Car'");
      expect(text).not.toContain('"cars"');
    });
  }
});
