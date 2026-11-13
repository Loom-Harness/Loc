import { describe, expect, it } from "vitest";
import { projectEntryPath } from "../../web/src/util/project-entry.js";

// The playground plans migrations and generates from the project's entry —
// the file declaring the `system` — not from whichever file the editor shows.

const MAIN = "/workspace/main.ddd";
const GRADE = "/workspace/grade.ddd";
const SYSTEM = 'import "./grade.ddd"\nsystem S {\n  context C { }\n}\n';
const FRAGMENT = "valueobject Grade { value: int }\n";

describe("projectEntryPath", () => {
  it("keeps the entry on main.ddd while a non-entry file is open", () => {
    const files = new Map([
      [MAIN, SYSTEM],
      [GRADE, FRAGMENT],
    ]);
    expect(projectEntryPath(files, GRADE, FRAGMENT)).toBe(MAIN);
  });

  it("keeps the active file when it declares the system (live text decides)", () => {
    const files = new Map([
      [MAIN, SYSTEM],
      [GRADE, FRAGMENT],
    ]);
    expect(projectEntryPath(files, MAIN, SYSTEM)).toBe(MAIN);
    expect(projectEntryPath(files, GRADE, "system Other {\n}\n")).toBe(GRADE);
  });

  it("finds a system file other than main.ddd, and ignores a commented-out system", () => {
    const files = new Map([
      [MAIN, "// system Old {\n/* system Older { */\n"],
      ["/workspace/app.ddd", SYSTEM],
      [GRADE, FRAGMENT],
    ]);
    expect(projectEntryPath(files, GRADE, FRAGMENT)).toBe("/workspace/app.ddd");
  });

  it("falls back to the active file when nothing declares a system", () => {
    const files = new Map([[GRADE, FRAGMENT]]);
    expect(projectEntryPath(files, GRADE, FRAGMENT)).toBe(GRADE);
  });
});
