import { readFileSync, writeFileSync } from "node:fs";
import { EmptyFileSystem } from "langium";
import { it, vi } from "vitest";
import { createDddServices } from "../../src/language/ddd-module.js";
it("x", () => {
  const reports: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    reports.push(a.map(String).join(" "));
  });
  const parser = createDddServices(EmptyFileSystem).Ddd.parser.LangiumParser;
  const src = readFileSync(process.env.SRC_FILE ?? "", "utf8");
  const r = parser.parse(src);
  vi.restoreAllMocks();
  writeFileSync(process.env.OUT_FILE ?? "test/zzscratch/out.json", JSON.stringify({ reports, lex: r.lexerErrors.length, parse: r.parserErrors.map((e) => e.message) }, null, 1));
});
