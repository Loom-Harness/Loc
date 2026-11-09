// The README's first-ten-minutes path stays true: the Quick example is a real
// file a reader can generate, and the Node floor the README states is the one
// `package.json` declares and the CLI enforces at startup.  Spelling-only
// claims with no runtime effect a booted tier could observe.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "../..");
const readme = readFileSync(join(REPO, "README.md"), "utf8");

describe("README quickstart", () => {
  it("the Quick example fence is byte-identical to examples/quickstart.ddd", () => {
    const section = readme.slice(readme.indexOf("## Quick example"));
    const fence = /```ddd\n([\s\S]*?)```/.exec(section)?.[1];
    expect(fence).toBeDefined();
    expect(fence).toBe(readFileSync(join(REPO, "examples/quickstart.ddd"), "utf8"));
    expect(section).toContain("generate system examples/quickstart.ddd");
  });

  it("states the same Node floor as package.json engines and bin/cli.js", () => {
    const engines = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).engines.node;
    const floor = /^>=(\d+)\.(\d+)$/.exec(engines);
    expect(floor).not.toBeNull();
    const [, major, minor] = floor ?? [];
    expect(readme).toContain(`Node ${major}.${minor}+`);
    const bin = readFileSync(join(REPO, "bin/cli.js"), "utf8");
    expect(bin).toContain(`var MIN_NODE = [${major}, ${minor}];`);
  });
});
