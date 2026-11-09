// The advice's malformed-If-Match arm names `IfMatch.Malformed`, so it must ride
// the same gate that emits `api/IfMatch.java`. An event-sourced aggregate is
// versioned yet binds no `If-Match` header: its project carries neither.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const FIXTURE = "test/e2e/fixtures/java-build/event-sourced.ddd";

describe("java advice — malformed If-Match arm gate", () => {
  it("names IfMatch only when IfMatch.java is emitted", async () => {
    const files = await generateSystemFiles(readFileSync(FIXTURE, "utf8"));
    const paths = [...files.keys()];
    const hasParser = paths.some((p) => p.endsWith("/IfMatch.java"));
    const advice = paths.find((p) => p.endsWith("/ApiExceptionAdvice.java"));
    expect(advice).toBeDefined();
    expect(hasParser).toBe(false);
    expect(files.get(advice as string)).not.toContain("IfMatch");
  });
});
