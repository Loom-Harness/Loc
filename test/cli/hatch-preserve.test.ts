// Gate for D-NO-READ-BACK (docs/decisions).
// Escape-hatch files and regeneration: existence is the whole state.
//
// A hatch file (an `extern` hook or handler implementation, `docs/extern.md`)
// is the user's code.  `generate system` never writes one: while a hatch the
// model calls for is missing it refuses, names the file, and writes nothing;
// `ddd scaffold` writes the missing ones and never touches an existing file.
// Nothing marks a hatch — the user's version below carries no marker.

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

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(" ")}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
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

describe("a hatch path is never a generated path", () => {
  // Existence is a hatch's whole state, so a path the user owns under one
  // model must not be a generated file under another: adding the first
  // `extern`, or removing the last, would otherwise overwrite the user's code
  // or keep a stale generated file as theirs.
  it.each(PLATFORMS)("%s: with and without the externs", async (platform) => {
    const withExterns = await generateSystemResult(system(platform));
    const without = await generateSystemResult(
      system(platform)
        .replace(/\s*operation confirm\(\) extern \{[^}]*\}/, "")
        .replace(/\s*extern queryHandler GetQuote\([^)]*\): string;/, "")
        .replace(/\s*route GET "\/quotes\/\{sku\}" -> C\.GetQuote/, ""),
    );
    expect(without.hatches.size).toBe(0);
    for (const p of withExterns.hatches.keys()) {
      expect(withExterns.files.has(p), p).toBe(false);
      expect(without.files.has(p), p).toBe(false);
    }
  });
});

describe("generate system / scaffold — hatch files", () => {
  it.each(
    PLATFORMS,
  )("%s: generate refuses while one is missing; scaffold writes only missing ones", async (platform) => {
    const source = system(platform);
    const { hatches, files } = await generateSystemResult(source);
    // An extern op and an extern handler: at least one hatch each, never a
    // path that is also generated.
    expect(hatches.size).toBeGreaterThanOrEqual(2);
    for (const p of hatches.keys()) expect(files.has(p)).toBe(false);
    // The in-process tag that carries a stub to the orchestrator never leaks.
    for (const content of [...files.values(), ...[...hatches.values()].map((h) => h.stub)]) {
      expect(containsHatchTag(content)).toBe(false);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hatch-preserve-"));
    const dddPath = path.join(tmp, "main.ddd");
    fs.writeFileSync(dddPath, source);
    const out = path.join(tmp, "out");
    const generate = () => runCli(["generate", "system", dddPath, "-o", out]);
    const scaffold = () => runCli(["scaffold", dddPath, "-o", out]);

    // A missing hatch: generate refuses, names every one, writes nothing.
    const refused = generate();
    expect(refused.status).toBe(1);
    for (const p of hatches.keys()) expect(refused.stderr).toContain(`  ${p}`);
    expect(refused.stderr).toContain("ddd scaffold");
    expect(fs.existsSync(out)).toBe(false);

    // `scaffold` writes each stub; then generate succeeds.
    const first = scaffold();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`Wrote ${hatches.size} hatch file(s)`);
    for (const [p, { stub }] of hatches) {
      expect(fs.readFileSync(path.join(out, p), "utf8")).toBe(stub);
    }
    expect(generate().status).toBe(0);

    // The user replaces every hatch with their own code — no marker anywhere.
    const sentinel = (p: string) => `user implementation of ${p}\n`;
    for (const p of hatches.keys()) fs.writeFileSync(path.join(out, p), sentinel(p));
    const regen = generate();
    expect(regen.status).toBe(0);
    expect(regen.stdout).toContain(`hatch files (yours): ${hatches.size}`);
    const again = scaffold();
    expect(again.stdout).toContain(
      `Wrote 0 hatch file(s) in ${out}, already present: ${hatches.size}`,
    );
    for (const p of hatches.keys()) {
      expect(fs.readFileSync(path.join(out, p), "utf8")).toBe(sentinel(p));
    }

    // Deleting one makes it pending again; `scaffold` writes only that one.
    const [gone, ...kept] = [...hatches.keys()];
    fs.rmSync(path.join(out, gone!));
    const pending = generate();
    expect(pending.status).toBe(1);
    expect(pending.stderr).toContain(`  ${gone}`);
    for (const p of kept) expect(pending.stderr).not.toContain(`  ${p}\n`);
    expect(scaffold().stdout).toContain(`Wrote 1 hatch file(s)`);
    expect(fs.readFileSync(path.join(out, gone!), "utf8")).toBe(hatches.get(gone!)!.stub);
    for (const p of kept) expect(fs.readFileSync(path.join(out, p), "utf8")).toBe(sentinel(p));
    fs.rmSync(tmp, { recursive: true });
  });
});
