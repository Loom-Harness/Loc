// Phase-⑦ (IR) diagnostics used to print `code Ctx/Agg: message` with no
// `path:line` (eval-closure item 28), while the AST diagnostics from the same
// file led with `<abs>.ddd:10:59`.  A diagnostic naming `Orders/Noop` in a
// multi-file project is a scavenger hunt; one naming `orders.ddd:6:7` is a
// click.  `LoomDiagnostic.origin` now carries the IR node's provenance, the
// CLI prefixes it as `path:line:col`, and the JSON report maps it to `range`.
//
// Pinned on BOTH severities (an IR error and an IR warning), on the human
// `parse` output and on the `validate()` wire report, because they are two
// separate renderers of the same field.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

// Line numbers below are 1-based: `deployable d` is line 14, col 3;
// `workflow Noop` is line 6, col 7.
const SOURCE = `system Shop {
  subdomain D {
    context Orders {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
      workflow Noop transactional {
        create() {
        }
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [Orders]
    port: 3000
  }
}
`;

describe("IR-phase diagnostics carry their source location (item 28)", () => {
  it("`ddd parse` prefixes an IR error and an IR warning with path:line:col", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-irloc-"));
    const file = path.join(dir, "orders.ddd");
    fs.writeFileSync(file, SOURCE);
    const r = spawnSync("node", [cli, "parse", file], { encoding: "utf8" });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status).toBe(1);
    const lines = out.split("\n");
    const err = lines.find((l) => l.includes("loom.datasource-binding-missing"));
    const warn = lines.find((l) => l.includes("loom.transactional-no-effect"));
    expect(err).toBeDefined();
    expect(warn).toBeDefined();
    expect(err?.startsWith(`${file}:14:3 loom.datasource-binding-missing Shop/d: `)).toBe(true);
    expect(warn?.startsWith(`${file}:6:7 loom.transactional-no-effect Orders/Noop warning: `)).toBe(
      true,
    );
  });

  it("`validate()` maps the IR diagnostic's origin to the wire range", async () => {
    const report = await validate(SOURCE);
    const err = report.diagnostics.find((d) => d.code === "loom.datasource-binding-missing");
    const warn = report.diagnostics.find((d) => d.code === "loom.transactional-no-effect");
    expect(err?.phase).toBe("ir-validate");
    expect(err?.range?.start).toEqual({ line: 13, character: 2 });
    expect(warn?.range?.start).toEqual({ line: 5, character: 6 });
  });
});
