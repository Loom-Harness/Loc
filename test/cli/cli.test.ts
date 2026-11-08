import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");
const example = path.join(repoRoot, "examples", "sales.ddd");
/** `examples/sales.ddd`'s one deployable — its project lands under `<out>/sales/`. */
const proj = "sales";

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

describe("CLI", () => {
  it("`--dry-run` writes nothing and reports each path", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-dry-"));
    const result = runCli(["generate", "system", example, "-o", tmp, "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Would write \d+ file/);
    // Output dir is empty / has no generated artifacts.
    const entries = fs.readdirSync(tmp);
    expect(entries).toEqual([]);
    fs.rmSync(tmp, { recursive: true });
  });

  it("`--dry-run` over a fresh dir creates nothing on disk (not even the out dir)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "loom-dry2-"));
    // Point at a not-yet-existing subdir so we can assert the dry run
    // never mkdir'd it.
    const out = path.join(base, "nested", "out");
    const result = runCli(["generate", "system", example, "-o", out, "--dry-run"]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(path.dirname(out))).toBe(false);
    fs.rmSync(base, { recursive: true });
  });

  it("`--dry-run` over an up-to-date tree reports 0 would-writes (parity with a real run)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-dry-parity-"));
    // Real run first, so the tree is up to date.
    const real = runCli(["generate", "system", example, "-o", tmp]);
    expect(real.status).toBe(0);
    // The node deployable's project, the compose / monitoring files around it,
    // the scaffold-once orientation README, and `.loom/manifest.json` (the
    // emitted-path record the next run prunes against — see
    // `src/system/manifest.ts`).  No `LICENSE`: the licence belongs to
    // `ddd new`, the command that OWNS the project shell
    // (test/system/generation-defaults.test.ts § G9).
    expect(real.stdout).toMatch(/Wrote 54 file\(s\)/);

    // A dry run over the up-to-date tree must classify everything as
    // unchanged — 0 would-writes, matching what a real re-run does.
    const dry = runCli(["generate", "system", example, "-o", tmp, "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/Would write 0 file\(s\) in [^,]+, unchanged: 53/);
    fs.rmSync(tmp, { recursive: true });
  });

  it("`.loomignore` filters paths from the write set", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-pin-"));
    fs.writeFileSync(
      path.join(tmp, ".loomignore"),
      `${proj}/package.json\n/${proj}/index.ts\n`,
      "utf8",
    );
    const result = runCli(["generate", "system", example, "-o", tmp]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skipped \(\.loomignore\): 2/);
    expect(fs.existsSync(path.join(tmp, proj, "package.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, proj, "index.ts"))).toBe(false);
    // `http/index.ts` survives because `.loomignore` anchored `/sales/index.ts`.
    expect(fs.existsSync(path.join(tmp, proj, "http", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, proj, "domain", "order.ts"))).toBe(true);
    fs.rmSync(tmp, { recursive: true });
  });

  // `generate` used to inject a MIT LICENSE into whatever directory it was
  // pointed at — including a directory that was already someone else's
  // project.  It now emits none: the licence belongs to `ddd new`, which is
  // the command that creates a project (test/system/generation-defaults.test.ts
  // § G9 owns both halves).  Pinning it via `.loomignore` is therefore no
  // longer needed, so the assertion that used to prove the pin works now
  // proves the stronger property directly: a licence the generator never
  // wrote is a licence the generator cannot touch.
  it("emits no LICENSE, and leaves a licence the user put there alone", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-license-"));
    const first = runCli(["generate", "system", example, "-o", tmp]);
    expect(first.status).toBe(0);
    expect(fs.existsSync(path.join(tmp, "LICENSE"))).toBe(false);

    // The user drops in their own terms — no `.loomignore`, no ceremony — and
    // regenerates.  Their legal document survives verbatim.
    fs.writeFileSync(path.join(tmp, "LICENSE"), "Custom LICENSE\n", "utf8");
    const second = runCli(["generate", "system", example, "-o", tmp]);
    expect(second.status).toBe(0);
    expect(fs.readFileSync(path.join(tmp, "LICENSE"), "utf8")).toBe("Custom LICENSE\n");
    fs.rmSync(tmp, { recursive: true });
  });

  // The root `README.md` IS emitted — the scaffold-once orientation page for
  // the generated tree, written once and then left to the user.
  it("does not emit project-shell files (.env.example, .gitignore)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-shell-"));
    expect(runCli(["generate", "system", example, "-o", tmp]).status).toBe(0);
    for (const dir of [tmp, path.join(tmp, proj)]) {
      expect(fs.existsSync(path.join(dir, ".env.example"))).toBe(false);
      expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
    }
    expect(fs.existsSync(path.join(tmp, proj, "README.md"))).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });

  it("incremental: second run writes 0 files and reports unchanged count", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-inc-"));
    const first = runCli(["generate", "system", example, "-o", tmp]);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/Wrote 54 file\(s\)/);
    // Capture mtimes after the first run so we can verify the second
    // run doesn't re-touch anything.
    const sample = path.join(tmp, proj, "domain", "order.ts");
    const mtimeBefore = fs.statSync(sample).mtimeMs;

    const second = runCli(["generate", "system", example, "-o", tmp]);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(
      /Wrote 0 file\(s\) in [^,]+, unchanged: 53, preserved \(scaffold-once\): 1/,
    );
    const mtimeAfter = fs.statSync(sample).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    fs.rmSync(tmp, { recursive: true });
  });

  it("incremental: only touches files whose content actually changed", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-inc2-"));
    runCli(["generate", "system", example, "-o", tmp]);
    const idsPath = path.join(tmp, proj, "domain", "ids.ts");
    const orderPath = path.join(tmp, proj, "domain", "order.ts");
    const idsMtimeBefore = fs.statSync(idsPath).mtimeMs;
    const orderMtimeBefore = fs.statSync(orderPath).mtimeMs;

    // Mutate ids.ts on disk so the next regen *will* rewrite it (its
    // content no longer matches the generator's output).  order.ts
    // is untouched and should still be skipped.
    fs.writeFileSync(idsPath, "// stomped\n", "utf8");

    // Sleep briefly so any rewrite is observable in mtime resolution.
    const start = Date.now();
    while (Date.now() - start < 20) {
      // tight wait — fs mtime resolution on most platforms is ~1ms
    }

    const result = runCli(["generate", "system", example, "-o", tmp]);
    expect(result.status).toBe(0);
    // The stomp above IS a local modification, so the summary names it (F-019):
    // the digest this path recorded in `.loom/manifest.json` no longer matches
    // what is on disk, which is exactly the case the count exists to surface.
    expect(result.stdout).toMatch(
      /Wrote 1 file\(s\) in [^,]+, 1 of which had local modifications \(pinnable via \.loomignore\), unchanged: 52, preserved \(scaffold-once\): 1/,
    );
    expect(fs.statSync(idsPath).mtimeMs).toBeGreaterThan(idsMtimeBefore);
    expect(fs.statSync(orderPath).mtimeMs).toBe(orderMtimeBefore);
    fs.rmSync(tmp, { recursive: true });
  });
  it("a source with contexts but no deployable fails with the system to add", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-nodeploy-"));
    const src = path.join(tmp, "orders.ddd");
    fs.writeFileSync(src, "context Orders {\n  aggregate Order {\n    total: int\n  }\n}\n");
    const result = runCli(["generate", "system", src, "-o", path.join(tmp, "out")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No deployable declared");
    expect(result.stderr).toContain("resource ordersState { for: Orders, kind: state, use: db }");
    expect(result.stderr).toContain(
      "deployable orders { platform: node, contexts: [Orders], dataSources: [ordersState] }",
    );
    expect(fs.existsSync(path.join(tmp, "out"))).toBe(false);
    fs.rmSync(tmp, { recursive: true });
  });
});
