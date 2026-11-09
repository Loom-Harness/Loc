// Import hygiene (string tier: no compile tier sees which scan minted an
// import — only that one is missing): the drizzle-orm import line is derived
// from a scan of the rendered module, and that scan must see every call site.
import { describe, expect, it } from "vitest";
import {
  drizzleImports,
  stripStringLiterals,
} from "../../../src/generator/typescript/drizzle-imports.js";

describe("drizzle import scan", () => {
  it("an apostrophe in a comment does not hide the code after it", () => {
    const body = [
      "/** The stream scope of Thing: over the stream's tenant metadata. */",
      "export function s(): SQL | undefined {",
      "  return or(eq(a, b), sql`${a} like ${b} escape '!'`);",
      "}",
    ].join("\n");
    expect(drizzleImports(body)).toEqual(["eq", "or", "sql"]);
  });

  it("a name only in a comment or a string is not a reference", () => {
    const body = ["// or(x) in a comment", "/* and(y) */", 'const m = "eq(z)";', "isNull(c);"].join(
      "\n",
    );
    expect(drizzleImports(body)).toEqual(["isNull"]);
  });

  it("keeps the delimiters, so a tagged template is still a call site", () => {
    expect(stripStringLiterals("sql`x`; f(\"a\", 'b') // c")).toBe("sql``; f(\"\", '') ");
  });
});
