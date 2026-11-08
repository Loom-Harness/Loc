// A diagnostic raised INSIDE code a macro synthesised must land on the
// `with <macro>(...)` clause that produced it, and name the macro.
//
// The synthesised nodes are built in memory by the macro factories, so they
// have no `$cstNode`; without the redirect in `DddDocumentValidator`, Langium's
// range lookup falls back to 1:1 — a position in text the user never wrote,
// with nothing saying which macro wrote it.  `loom.macro-threw` already lands
// on the clause; this pins the same for an ordinary AST-phase check
// (`loom.assign-type-mismatch`) raised on a synthesised assignment, on both
// surfaces a user reads it from: the toolkit `validate()` (playground, MCP,
// LSP adapters) and the CLI `parse` command.  The attribution text is the
// `loom.macro-synthesised` catalog entry; the diagnostic keeps its own code.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import type { MacroDefinition } from "../../src/macros/api/define.js";
import { assignStmt, field, operation, primType, stringLit } from "../../src/macros/api/index.js";
import { lookupMacro, registerMacro } from "../../src/macros/registry.js";
import { loadStdlibMacros } from "../../src/macros/stdlib/index.js";

// The registry is process-global and stdlib-first (see
// `misbehaving-macro-diagnostics.test.ts`): boot the stdlib before registering.
loadStdlibMacros();

const MACRO = "loomTestWithLateFees";

/** A macro whose synthesised operation assigns a string to a money field. */
const definition = {
  name: MACRO,
  target: "aggregate",
  apiVersion: 1,
  params: { ratePct: { kind: "int", default: 5 } },
  expand: () => [
    field("lateFees", primType("money")),
    operation("chargeLateFee", [], [assignStmt("lateFees", stringLit("oops"))]),
  ],
} as unknown as MacroDefinition;

if (!lookupMacro(MACRO)) registerMacro(definition);

// Line 4 (1-based) / 3 (0-based); the macro name starts at 0-based column 36.
const SOURCE = `system M {
  subdomain S {
    context C {
      aggregate Lease with crudish, ${MACRO}(ratePct: 7) {
        monthlyRent: money
      }
      repository Leases for Lease { }
    }
  }
}
`;
const CLAUSE_LINE = 3;
const CLAUSE_COL = SOURCE.split("\n")[CLAUSE_LINE]!.indexOf(MACRO);
const ATTRIBUTION = `(in code synthesised by '${MACRO}')`;

describe("diagnostics on macro-synthesised code", () => {
  it("validate(): lands on the `with` clause and names the macro", async () => {
    const result = await validate(SOURCE);
    const mismatch = result.diagnostics.filter((d) => d.code === "loom.assign-type-mismatch");
    expect(mismatch, JSON.stringify(result.diagnostics, null, 2)).toHaveLength(1);
    const [d] = mismatch;
    expect(d!.message).toBe(`Cannot assign 'string' to 'money' ${ATTRIBUTION}`);
    expect(d!.range).toEqual({
      start: { line: CLAUSE_LINE, character: CLAUSE_COL },
      end: { line: CLAUSE_LINE, character: CLAUSE_COL + MACRO.length },
    });
  });

  it("CLI parse: prints the clause's line:col and the macro attribution", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const out = (rel: string) => pathToFileURL(path.join(repoRoot, "out", rel)).href;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-macro-range-"));
    try {
      // The CLI loads no project-local macros, so a launcher registers the
      // same macro in the CLI process before handing it the argv.
      const launcher = path.join(dir, "launch.mjs");
      fs.writeFileSync(
        launcher,
        [
          `const { registerMacro } = await import(${JSON.stringify(out("macros/registry.js"))});`,
          `const { loadStdlibMacros } = await import(${JSON.stringify(out("macros/stdlib/index.js"))});`,
          `const api = await import(${JSON.stringify(out("macros/api/index.js"))});`,
          "loadStdlibMacros();",
          "registerMacro({",
          `  name: ${JSON.stringify(MACRO)}, target: "aggregate", apiVersion: 1,`,
          `  params: { ratePct: { kind: "int", default: 5 } },`,
          "  expand: () => [",
          `    api.field("lateFees", api.primType("money")),`,
          `    api.operation("chargeLateFee", [], [api.assignStmt("lateFees", api.stringLit("oops"))]),`,
          "  ],",
          "});",
          `await import(${JSON.stringify(out("cli/main.js"))});`,
        ].join("\n"),
      );
      const ddd = path.join(dir, "single.ddd");
      fs.writeFileSync(ddd, SOURCE);
      const r = spawnSync("node", [launcher, "parse", ddd], { encoding: "utf8" });
      const output = `${r.stdout}${r.stderr}`;
      expect(r.status, output).toBe(1);
      expect(output).toContain(
        `single.ddd:${CLAUSE_LINE + 1}:${CLAUSE_COL + 1} error: Cannot assign 'string' to 'money' ${ATTRIBUTION}`,
      );
      expect(output).not.toMatch(/:1:1 error/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
