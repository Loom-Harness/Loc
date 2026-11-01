import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// A field named `constructor` cannot back a class getter (TS1341: "Class
// constructor may not be an accessor"), and an instance's own `.constructor`
// is the class.  Node escapes only the instance-member spelling
// (`constructor_`); the wire key, column name and plain-object keys keep the
// declared name.

const SRC = `
system S { subdomain D { context C {
  aggregate A with crudish {
    constructor: string
    n: int
    contains items: Item[]
    entity Item { constructor: string  q: int }
  }
} }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}
`;

describe("node: a field named `constructor`", () => {
  it("escapes the getter and every instance read, keeps wire/column keys", async () => {
    const files = await generateSystemFiles(SRC);
    const domain = files.get("api/domain/a.ts")!;
    expect(domain).not.toMatch(/get constructor\(/);
    expect(domain.match(/get constructor_\(\): string/g)).toHaveLength(2);

    const repo = files.get("api/db/repositories/a-repository.ts")!;
    expect(repo).toContain("constructor: aggregate.constructor_,");
    expect(repo).toContain("constructor: child.constructor_,");
    expect(repo).not.toMatch(/(aggregate|child)\.constructor\b[^_]/);

    // The wire contract and the column stay `constructor`.
    expect(files.get("api/http/a.routes.ts")!).toContain("constructor: z.string()");
    expect(files.get("api/db/schema.ts")!).toContain('constructor: text("constructor")');
  });
});
