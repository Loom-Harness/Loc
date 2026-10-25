// A per-aggregate warning code (the denyByDefault read-gate family) fires once
// per aggregate and buried the warnings about one specific line.  Past
// `WARNING_GROUP_AFTER` occurrences a code prints once in full plus one line
// naming the rest; `--all-warnings` prints each.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WARNING_GROUP_AFTER, warningLines } from "../../src/cli/warning-lines.js";
import type { LoomDiagnostic } from "../../src/ir/validate/validate.js";

const warn = (code: string, source: string): LoomDiagnostic => ({
  severity: "warning",
  code,
  source,
  message: `msg for ${source}`,
});
const at = () => "";

describe("warningLines", () => {
  it("prints a code at or under the threshold in full", () => {
    const ws = Array.from({ length: WARNING_GROUP_AFTER }, (_, i) => warn("loom.x", `C/A${i}`));
    expect(warningLines(ws, at, false)).toHaveLength(WARNING_GROUP_AFTER);
  });

  it("collapses a repeated code to its first occurrence plus one summary line", () => {
    const ws = [
      warn("loom.x", "C/A"),
      warn("loom.y", "C/Solo"),
      warn("loom.x", "C/B"),
      warn("loom.x", "C/C"),
      warn("loom.x", "C/D"),
    ];
    expect(warningLines(ws, at, false)).toEqual([
      "loom.x C/A warning: msg for C/A",
      "  … and 3 more loom.x warning(s): C/B, C/C, C/D (pass --all-warnings to print each).",
      "loom.y C/Solo warning: msg for C/Solo",
    ]);
  });

  it("`all` prints every occurrence", () => {
    const ws = ["A", "B", "C", "D"].map((n) => warn("loom.x", `C/${n}`));
    expect(warningLines(ws, at, true)).toHaveLength(4);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "..", "bin", "cli.js");

const aggs = ["Ticket", "Agent", "Queue", "Tag"];
const SOURCE = `system Help {
  user { sub: string }
  auth {
    oidc { issuer: env("OIDC_ISSUER"), clientId: env("OIDC_CLIENT_ID"), audience: env("OIDC_AUDIENCE") }
    enforcement: denyByDefault
  }
  subdomain D {
    context Desk {
${aggs
  .map(
    (a) => `      aggregate ${a} {
        label: string
        create(label: string) { requires currentUser.sub != "" }
      }`,
  )
  .join("\n")}
    }
  }
  api A from D
  storage pg { type: postgres }
  resource deskState { for: Desk, kind: state, use: pg }
  deployable d { platform: node contexts: [Desk] dataSources: [deskState] serves: A port: 4000 auth: required }
}
`;

describe("`ddd parse` groups repeated warnings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-warngroup-"));
  const file = path.join(dir, "help.ddd");
  fs.writeFileSync(file, SOURCE);
  const run = (...flags: string[]) => {
    const r = spawnSync("node", [cli, "parse", ...flags, file], { encoding: "utf8" });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  };

  it("prints one full line per code plus a summary; the count is unchanged", () => {
    const out = run();
    const byId = out.split("\n").filter((l) => l.includes("loom.default-deny-by-id-ungated"));
    expect(byId).toHaveLength(2);
    expect(byId[1]).toContain(
      "… and 3 more loom.default-deny-by-id-ungated warning(s): Desk/Agent, Desk/Queue, Desk/Tag",
    );
    expect(out).toContain("0 error(s), 8 warning(s).");
  });

  it("--all-warnings prints each", () => {
    const out = run("--all-warnings");
    const byId = out.split("\n").filter((l) => l.includes("loom.default-deny-by-id-ungated"));
    expect(byId).toHaveLength(4);
    expect(out).not.toContain("more loom.default-deny");
    expect(out).toContain("0 error(s), 8 warning(s).");
  });
});
