// A `match` arm over a scalar variant (`string s => s`) binds the variant's
// value, not its tagged carrier.  Every backend carries a primitive / id /
// enum variant as `{ type, value }` (a one-field `Value` record on .NET /
// Java), so an arm that binds the carrier hands a dict, a record or a tagged
// object to code that expects the string — a runtime TypeError on python, a
// type error on the others.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system Demo {
  subdomain S { context C {
    error Nope { resource: string }
    aggregate Thing with crudish {
      name: string
      operation probe(): string or Nope { return name }
      operation tag(): string {
        let r = probe()
        let msg = match r { string s => s, Nope e => e.resource }
        return msg + "!"
      }
    }
    repository Things for Thing { }
  } }
  api A from S { httpStatus Nope -> 409 }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}  contexts: [C]  dataSources: [st]  serves: A }
}
`;

async function fileOf(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`${platform}: no file ending ${suffix}`);
  return hit[1];
}

describe("a match arm over a scalar variant binds its value", () => {
  it("node reads the carrier's value", async () => {
    const src = await fileOf("node", "api/domain/thing.ts");
    expect(src).toContain('const msg = (r.type === "string" ? r.value : r.resource);');
  });

  it("python reads the carrier's value", async () => {
    const src = await fileOf("python", "api/app/domain/thing.py");
    expect(src).toContain(
      'msg = (r["value"] if r["type"] == "string" else cast(str, r["resource"]))',
    );
  });

  it("dotnet reads the record's Value", async () => {
    const src = await fileOf("dotnet", "Domain/Things/Thing.cs");
    expect(src).toContain("stringOrNope_string s => s.Value,");
    expect(src).toContain("stringOrNope_Nope e => e.Resource,");
  });

  it("java reads the record's value()", async () => {
    const src = await fileOf("java", "things/Thing.java");
    expect(src).toContain("case stringOrNope_string s -> s.value();");
    expect(src).toContain("case stringOrNope_Nope e -> e.resource();");
  });
});
