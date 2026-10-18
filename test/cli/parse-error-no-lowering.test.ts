// A SYNTAX error is reported as a syntax error — the CLI never lowers a
// parse-recovered AST (eval-closure review item #8).
//
// `apply Opened {` (the `(e: Opened)` parameter list missing) recovers to an
// `Apply` node whose required `event` cross-ref is simply absent.  `parse` and
// `generate system` both collected the parse error — and then lowered the
// recovered AST anyway, so the run died with
//
//     TypeError: Cannot read properties of undefined (reading 'ref')
//         at lowerApply (out/ir/lower/lower-members.js)
//
// before printing it.  `parseProject` now lowers lazily, only once a caller has
// checked `errorCount`, and `lowerApply` reads the ref defensively.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const BROKEN_APPLY = `system Ledger {
  subdomain Core {
    context Accounts {
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        create open(owner: string) {
          emit Opened { account: id, owner: owner }
        }
        apply Opened {
          owner := "x"
        }
      }
      repository Accounts for Account { }
    }
  }
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable api { platform: node, contexts: [Accounts], dataSources: [accountsLog], port: 4000 }
}
`;

function write(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-parse-err-"));
  const file = path.join(dir, "main.ddd");
  fs.writeFileSync(file, source);
  return file;
}

function run(args: string[]): { stderr: string; status: number } {
  const r = spawnSync("node", [cli, ...args], { encoding: "utf8" });
  return { stderr: `${r.stderr ?? ""}${r.stdout ?? ""}`, status: r.status ?? -1 };
}

describe("a parse error is printed, not crashed on (item #8)", () => {
  it("`ddd parse` prints the syntax error and exits 1", () => {
    const file = write(BROKEN_APPLY);
    const { stderr, status } = run(["parse", file]);
    expect(stderr).not.toMatch(/TypeError/);
    expect(stderr).toMatch(/error: Expecting token of type '\(' but found `Opened`/);
    expect(stderr).toMatch(/^1 error\(s\), 0 warning\(s\)\.$/m);
    expect(status).toBe(1);
  });

  it("`ddd generate system` prints the syntax error and exits 1", () => {
    const file = write(BROKEN_APPLY);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "loom-parse-err-out-"));
    const { stderr, status } = run(["generate", "system", file, "-o", out]);
    expect(stderr).not.toMatch(/TypeError/);
    expect(stderr).toMatch(/error: Expecting token of type '\(' but found `Opened`/);
    expect(status).toBe(1);
  });

  it("lowerApply tolerates the recovered AST's absent event ref", async () => {
    const { model, errors } = await parseString(BROKEN_APPLY);
    expect(errors.length).toBeGreaterThan(0); // it IS the recovered AST
    expect(() => lowerModel(model)).not.toThrow();
  });
});
