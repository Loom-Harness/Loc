import { describe, expect, it } from "vitest";
import { generateBackendFromSource } from "../../_helpers/generate.js";

// A repository names every enum its body spells, including enums reached
// only through a value-object element's fields, and enums on the fields of
// the events an event-sourced stream (de)serialises.

async function gen(src: string): Promise<Map<string, string>> {
  return generateBackendFromSource(src, "node");
}

function valueObjectsImport(file: string): string {
  const m = /import (?:type )?\{([^}]*)\} from "\.\.\/\.\.\/domain\/value-objects";/.exec(file);
  expect(m, file).not.toBeNull();
  return m?.[1] ?? "";
}

describe("repository enum imports", () => {
  it("imports the enum behind a value-object collection element", async () => {
    const out = await gen(`
context C {
  enum Effect { Points, Require }
  valueobject Rule { key: string  effect: Effect }
  aggregate Set with crudish { name: string  rules: Rule[] }
}`);
    const repo = out.get("db/repositories/set-repository.ts") ?? "";
    expect(repo).toContain("as Effect");
    expect(valueObjectsImport(repo)).toMatch(/\bEffect\b/);
  });

  it("imports the enum on an event-sourced event field", async () => {
    const out = await gen(`
context C {
  enum Kind { Open, Closed }
  event Opened { account: Account id, kind: Kind }
  aggregate Account persistedAs: eventLog {
    n: int
    create open(kind: Kind) { emit Opened { account: id, kind: kind } }
    apply(e: Opened) { n := 1 }
  }
  repository Accounts for Account { }
}`);
    const repo = out.get("db/repositories/account-repository.ts") ?? "";
    expect(valueObjectsImport(repo)).toMatch(/\bKind\b/);
  });
});
