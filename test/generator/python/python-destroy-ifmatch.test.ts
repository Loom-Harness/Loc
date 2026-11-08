// The canonical DELETE of a `versioned` aggregate reads `If-Match` like a named
// operation (`destroyVersionCheck`, src/ir/enrich/version-check.ts): a stale tag
// raises the ConcurrencyError a stale save raises (409).  A non-versioned
// aggregate's DELETE is untouched.
import { describe, expect, it } from "vitest";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";

function destroyRoute(files: Map<string, string>, snakeName: string): string {
  for (const [p, text] of files) {
    if (!p.endsWith(".py")) continue;
    const start = text.indexOf(`async def destroy_${snakeName}(`);
    if (start < 0) continue;
    const next = text.indexOf("\n@router.", start);
    return text.slice(start, next < 0 ? undefined : next);
  }
  throw new Error(`no destroy_${snakeName} route emitted`);
}

describe("python DELETE of a versioned aggregate", () => {
  it("refuses a stale If-Match tag, row and document shapes alike", async () => {
    const files = await generateCorpusCase("concurrency-two-writers", "python");
    for (const name of ["doc", "memo"]) {
      const route = destroyRoute(files, name);
      expect(route, name).toContain('request.headers.get("if-match"');
      expect(route, name).toMatch(/int\(_if_match\) != __loaded\.row_version/);
      expect(route, name).toContain("raise ConcurrencyError(");
    }
  });
});
