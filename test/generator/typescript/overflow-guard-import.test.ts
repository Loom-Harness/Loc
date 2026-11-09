// The checked-int guard throws through a static factory
// (`DomainError.arithmeticOverflow()`), not `new DomainError(`, so the
// aggregate's import scan must count a static call as a use.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system S {
  subdomain D {
    context C {
      aggregate Counter {
        count: int
        create(count: int) { }
        operation tick() { count := count + 1 }
      }
      repository Counters for Counter { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d { platform: node contexts: [C] dataSources: [st] serves: A port: 4000 }
}`;

describe("ts aggregate — overflow guard pulls the DomainError import", () => {
  it("imports DomainError where the only throw is the checked-int guard", async () => {
    const files = await generateSystemFiles(SOURCE);
    const counter = [...files].find(([p]) => p.endsWith("domain/counter.ts"))?.[1] ?? "";
    expect(counter).toContain("DomainError.arithmeticOverflow()");
    expect(counter).not.toMatch(/\bnew DomainError\(/);
    expect(counter).toMatch(/import \{[^}]*\bDomainError\b[^}]*\} from "\.\/errors(\.js)?"/);
  });
});
