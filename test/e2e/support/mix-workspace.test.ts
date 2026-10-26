import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `sh` / `shResult` are stubbed: these tests pin the COMMANDS MixWorkspace
// issues, not docker.  The Hex/rebar install must happen exactly once, in a
// container of its own, be verified before any other container starts, and
// never be repeated by the concurrent fixture containers that share the mount.
const calls: string[] = [];
let verifyStatus = 0;
vi.mock("./parallel.js", () => ({
  sh: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    return "";
  }),
  shResult: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    return { status: verifyStatus, timedOut: false, output: "Could not start Hex" };
  }),
}));

const { MixWorkspace, VERIFY_ARCHIVES } = await import("./mix-workspace.js");

describe("MixWorkspace Hex/rebar archives", () => {
  let mix: InstanceType<typeof MixWorkspace>;
  beforeEach(() => {
    calls.length = 0;
    verifyStatus = 0;
    mix = new MixWorkspace("loom-mix-workspace-test");
  });
  afterEach(() => fs.rmSync(mix.root, { recursive: true, force: true }));

  it("refuses to build a container before the archives are ready", () => {
    expect(() => mix.dockerRun("", "", "true")).toThrow(/before `await ready\(\)`/);
  });

  it("installs once with --force (no stdin prompt), then verifies read-only", async () => {
    await Promise.all([mix.ready(), mix.ready(), mix.ready()]);
    expect(calls).toHaveLength(2);
    const [install, verify] = calls;
    expect(install).toContain(" local.hex --force");
    expect(install).toContain(" local.rebar --force");
    expect(install).not.toContain("--if-missing");
    expect(install).toMatch(/-mix:\/root\/\.mix /);
    expect(verify).toContain(VERIFY_ARCHIVES);
    expect(verify).toMatch(/-mix:\/root\/\.mix:ro /);
    expect(verify).not.toContain("local.hex");
  });

  it("fixture containers mount the archives read-only and never install", async () => {
    await mix.ready();
    const cmd = mix.dockerRun("-v /p:/app", "-e MIX_ENV=prod ", "mix compile");
    expect(cmd).toMatch(/-mix:\/root\/\.mix:ro /);
    expect(cmd).not.toMatch(/local\.(hex|rebar)/);
    expect(cmd).toContain("bash -c 'mix compile'");
  });

  it("a failed verification throws and keeps every fixture container from starting", async () => {
    verifyStatus = 1;
    await expect(mix.ready()).rejects.toThrow(/a fresh container cannot use them/);
    expect(() => mix.dockerRun("", "", "true")).toThrow(/before `await ready\(\)`/);
  });
});
