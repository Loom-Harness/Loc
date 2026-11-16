// `ddd generate system` never overwrites an escape-hatch file that exists.
//
// A hatch file (an `extern` hook or handler implementation, `docs/extern.md`)
// is the user's from the moment it exists.  Nothing marks it: the generator
// knows the path from the model, and the file's existence is the whole state.
// The user's version below carries no marker of any kind.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { containsHatchTag } from "../../src/util/hatch.js";
import { generateSystemResult } from "../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(" ")}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

const PLATFORMS = ["node", "dotnet", "java", "python", "elixir"] as const;

const system = (platform: string): string => `
system S {
  subdomain M {
    context C {
      aggregate Order {
        status: string
        operation confirm() extern { precondition status == "draft" }
      }
      repository Orders for Order { }
      extern queryHandler GetQuote(sku: string): string;
    }
  }
  api CApi from M {
    route GET "/quotes/{sku}" -> C.GetQuote
  }
  storage pg { type: postgres }
  resource ordersState { for: C, kind: state, use: pg }
  deployable api {
    platform: ${platform}
    contexts: [C]
    dataSources: [ordersState]
    serves: CApi
    port: 4000
  }
}
`;

describe("generate system — hatch files are never overwritten", () => {
  it.each(
    PLATFORMS,
  )("%s: the user's hatch files survive a regenerate untouched", async (platform) => {
    const source = system(platform);
    const { hatches, files } = await generateSystemResult(source);
    // An extern op and an extern handler: at least one hatch each, never a
    // path that is also generated.
    expect(hatches.size).toBeGreaterThanOrEqual(2);
    for (const p of hatches.keys()) expect(files.has(p)).toBe(false);
    // The in-process tag that carries a stub to the orchestrator never leaks.
    for (const content of [...files.values(), ...hatches.values()]) {
      expect(containsHatchTag(content)).toBe(false);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hatch-preserve-"));
    const dddPath = path.join(tmp, "main.ddd");
    fs.writeFileSync(dddPath, source);
    const out = path.join(tmp, "out");

    // First generate writes each missing hatch from its stub.
    expect(runCli(["generate", "system", dddPath, "-o", out]).status).toBe(0);
    for (const [p, stub] of hatches) {
      expect(fs.readFileSync(path.join(out, p), "utf8")).toBe(stub);
    }
    // The user replaces every hatch with their own code — no marker anywhere.
    const sentinel = (p: string) => `user implementation of ${p}\n`;
    for (const p of hatches.keys()) fs.writeFileSync(path.join(out, p), sentinel(p));

    const regen = runCli(["generate", "system", dddPath, "-o", out]);
    expect(regen.status).toBe(0);
    expect(regen.stdout).toContain(`preserved (hatch): ${hatches.size}`);
    for (const p of hatches.keys()) {
      expect(fs.readFileSync(path.join(out, p), "utf8")).toBe(sentinel(p));
    }
    fs.rmSync(tmp, { recursive: true });
  });
});
