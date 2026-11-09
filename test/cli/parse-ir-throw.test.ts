// `ddd parse` runs the same lowering + enrichment + IR validation as
// `generate system`.  When one of those phases throws on a model the AST
// validator accepted, `parse` must report it and exit non-zero — the model
// would crash `generate`, so an `OK` here is the pre-flight lying.
//
// The throw is seeded with a `node --import` hook that replaces the built
// `enrichLoomModel` (a real lowering crash is a bug that gets fixed, which
// would leave this test with nothing to reach).

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "..", "..", "bin", "cli.js");
const hook = path.join(here, "fixtures", "seed-enrich-throw.mjs");

const VALID = `system Shop {
  subdomain D {
    context Orders {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
    }
  }
}
`;

function parse(withHook: boolean): { out: string; status: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-parse-throw-"));
  const file = path.join(dir, "main.ddd");
  fs.writeFileSync(file, VALID);
  const args = withHook ? ["--import", hook, cli, "parse", file] : [cli, "parse", file];
  const r = spawnSync("node", args, { encoding: "utf8" });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status ?? 1 };
}

describe("ddd parse — a throw in the IR phases", () => {
  it("is clean without the seeded throw (vacuity guard)", () => {
    const { out, status } = parse(false);
    expect(status).toBe(0);
    expect(out).toContain("OK:");
  });

  it("is reported as an error and exits non-zero", () => {
    const { out, status } = parse(true);
    expect(out).toContain("seeded enrichment failure");
    expect(out).toContain("1 error(s)");
    expect(out).not.toContain("OK:");
    expect(status).toBe(1);
  });
});
