// A seed row's datetime string literal must parse to an `Instant` in the
// generated Java seed runner — a bare string is "String cannot be converted to
// Instant" under `gradle bootJar`, which aborts the image build (and with it
// `docker compose up` on the conformance-parity gate).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
  system S {
    subdomain Core {
      context Catalog {
        aggregate Project {
          name: string
          description: string?
          active: bool
          createdAt: datetime
        }

        repository Projects for Project

        seed default {
          Project { name: "Alpha", active: true, createdAt: "2024-01-01T00:00:00Z" }
        }
      }
    }
    api A from Core
    storage pg { type: postgres }
    resource catalogState { for: Catalog, kind: state, use: pg }
    deployable svc { platform: java  contexts: [Catalog]  serves: A  dataSources: [catalogState]  port: 8081 }
  }
`;

function find(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no file ending ${suffix}; have:\n${[...files.keys()].join("\n")}`);
  return files.get(key)!;
}

describe("java seed — datetime literals", () => {
  it("seed datetime string literals parse to Instant", async () => {
    const seed = find(
      await generateSystemFiles(SRC),
      "infrastructure/persistence/CatalogSeedRunner.java",
    );
    expect(seed).toContain('Instant.parse("2024-01-01T00:00:00Z")');
    expect(seed).toContain("import java.time.Instant;");
  });
});
