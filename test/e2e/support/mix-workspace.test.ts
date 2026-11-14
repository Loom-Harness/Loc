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

const { INSTALL_NATIVE_TOOLCHAIN, MixWorkspace, VERIFY_ARCHIVES } = await import(
  "./mix-workspace.js"
);

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

describe("MixWorkspace dependency templates", () => {
  let mix: InstanceType<typeof MixWorkspace>;
  beforeEach(() => {
    calls.length = 0;
    verifyStatus = 0;
    mix = new MixWorkspace("loom-mix-workspace-test");
  });
  afterEach(() => fs.rmSync(mix.root, { recursive: true, force: true }));

  function project(deps: string): string {
    const dir = fs.mkdtempSync(`${mix.root}/proj-`);
    fs.writeFileSync(
      `${dir}/mix.exs`,
      `defmodule App.MixProject do\n  defp deps do\n    [\n${deps}\n    ]\n  end\nend\n`,
    );
    fs.mkdirSync(`${dir}/config`);
    return dir;
  }

  // brod's crc32cer is a NIF built with make + cmake, which the slim image lacks.
  it("installs the C toolchain before compiling a dependency set that names brod", async () => {
    await mix.template(project(`      {:phoenix, "~> 1.7"},\n      {:brod, "~> 4.0"}`));
    const build = calls.at(-1) as string;
    expect(build).toContain(INSTALL_NATIVE_TOOLCHAIN);
    expect(build.indexOf(INSTALL_NATIVE_TOOLCHAIN)).toBeLessThan(build.indexOf("deps.compile"));
  });

  it("leaves every other dependency set on the bare image", async () => {
    await mix.template(project(`      {:phoenix, "~> 1.7"}`));
    expect(calls.at(-1)).not.toContain("apt-get");
  });
});
