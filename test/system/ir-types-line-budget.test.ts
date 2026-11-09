import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { irTypeModules } from "../_helpers/ir-types-source.js";

// ---------------------------------------------------------------------------
// Line budget for the IR vocabulary under `src/ir/types/`.
//
// The IR is one module per declaration area, re-exported by `loom-ir.ts`, so
// parallel changes to different areas touch different files.  A module over
// the budget is the single-file shape coming back: split it along a
// declaration boundary and re-export the new module from the barrel.  The
// barrel itself declares nothing, so every declaration lives in a module this
// budget covers.
// ---------------------------------------------------------------------------

const BUDGET = 800;
const typesDir = path.resolve(import.meta.dirname, "..", "..", "src", "ir", "types");

describe("IR types — per-module line budget", () => {
  const files = fs.readdirSync(typesDir).filter((f) => f.endsWith(".ts"));

  it("every module under src/ir/types/ stays within the budget", () => {
    expect(files.length).toBeGreaterThan(10);
    const over = files
      .map((f) => [f, fs.readFileSync(path.join(typesDir, f), "utf8").split("\n").length] as const)
      .filter(([, n]) => n > BUDGET);
    expect(over, `modules over ${BUDGET} lines`).toEqual([]);
  });

  it("loom-ir.ts only re-exports — it declares nothing of its own", () => {
    const code = fs
      .readFileSync(path.join(typesDir, "loom-ir.ts"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("//"));
    expect(code.every((l) => /^export \* from "\.\/[\w-]+\.js";$/.test(l))).toBe(true);
    expect(irTypeModules().length).toBe(code.length);
  });
});
