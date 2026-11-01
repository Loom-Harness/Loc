import { describe, expect, it } from "vitest";
import { generateTypeScript } from "../../../src/platform/hono/v4/emit.js";
import { BACKEND_PINS as HONO_PINS } from "../../../src/platform/hono/v5/pins.js";
import { parseString } from "../../_helpers/parse.js";

// A repository names every enum its body spells, including enums reached
// only through a value-object element's fields.

async function gen(src: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(src);
  expect(errors, errors.join("\n")).toEqual([]);
  return generateTypeScript(model, HONO_PINS);
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
});
