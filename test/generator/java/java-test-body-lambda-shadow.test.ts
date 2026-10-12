// Java — a lambda binder inside a `test` body that shadows a test `let`.
//
// A Loom lambda binder legally shadows an enclosing name; a Java lambda
// parameter may not redeclare an enclosing local ("variable l is already
// defined in method …").  The domain, workflow and service emitters seed the
// render context's lambda scope with the method's locals so such a binder
// renders as `<name>_`; the two test emitters (aggregate unit tests and context
// integration tests) rendered with no scope, so a test like the one below
// failed `gradle testClasses`.  The emitted project for this model compiles.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system S {
  subdomain Core {
    context Core {
      valueobject Tag { name: string weight: int }
      aggregate Order with crudish {
        name: string
        cap: int
        entity Line {
          sku: string
          qty: int
          tags: Tag[]
        }
        contains lines: Line[]
        test "unit shadow" {
          let o = Order.create({ name: "a", cap: 1 })
          let t = 2
          expect(o.lines.any(o => o.tags.any(t => t.weight > 0))).toBe(false)
          expect(o.lines.where(t => t.qty > 5).count + t).toBe(2)
        }
      }
      repository Orders for Order { }
      test "integration shadow" {
        let o = Order.create({ name: "a", cap: 1 })
        let l = 3
        expect(o.lines.any(l => l.qty > 1)).toBe(false)
        expect(o.lines.any(o => o.tags.any(o => o.weight > l))).toBe(false)
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Core, kind: state, use: primary }
  deployable api { platform: java contexts: [Core] dataSources: [st] port: 8080 }
}
`;

async function testFile(suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix}`).toBeDefined();
  return hit![1];
}

describe("java — test-body lambda binders clear the test's locals", () => {
  it("aggregate unit test: a binder named like a `let` renders as `<name>_`", async () => {
    const src = await testFile("/OrderTests.java");
    expect(src).toContain("var o = Order.create(");
    expect(src).toContain("var t = 2;");
    expect(src).toContain(
      "o.lines().stream().anyMatch(o_ -> o_.tags().stream().anyMatch(t_ -> t_.weight() > 0))",
    );
    // The `+ t` outside the lambda still names the test local.
    expect(src).toContain("o.lines().stream().filter(t_ -> t_.qty() > 5).toList().size() + t");
  });

  it("context integration test: same rule, nested binders stack the suffix", async () => {
    const src = await testFile("/CoreIntegrationTests.java");
    expect(src).toContain("var l = 3;");
    expect(src).toContain("o.lines().stream().anyMatch(l_ -> l_.qty() > 1)");
    expect(src).toContain(
      "o.lines().stream().anyMatch(o_ -> o_.tags().stream().anyMatch(o__ -> o__.weight() > l))",
    );
  });
});
